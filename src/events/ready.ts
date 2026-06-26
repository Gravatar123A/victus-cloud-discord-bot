import { ActivityType, Client } from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { assignLinkedRole, syncLinkedRoles } from '../utils/roles.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { sendAuditLog, sendNotificationDM } from '../utils/auditing.js';
import type { Event } from '../types/index.js';
import { registerApplicationCommands } from '../utils/registerCommands.js';
import { initTicketBridge } from '../services/ticketBridge.js';
import { startUptimeHeartbeat } from '../services/uptimeHeartbeat.js';

let dmQueueProcessing = false;

async function processAdminDmQueue(client: Client<true>) {
    if (dmQueueProcessing) return;
    dmQueueProcessing = true;

    try {
        const queuedMessages = await supabase.getPendingDiscordDms(10);
        for (const queued of queuedMessages) {
            const job = await supabase.claimDiscordDm(queued.id);
            if (!job) continue;

            try {
                const target = await client.users.fetch(job.discord_id).catch(() => null);
                if (!target) throw new Error(`Could not fetch Discord user ${job.discord_id}`);

                await target.send({
                    components: [ComponentsV2.adminDmContainer(job.subject, job.message, job.admin_email)],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });

                await supabase.markDiscordDmSent(job.id);
                logger.info(`Admin Discord DM sent to ${target.tag} (${job.discord_id})`);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown Discord DM delivery failure';
                await supabase.markDiscordDmFailed(job.id, message);
                logger.warn(`Admin Discord DM failed for ${job.discord_id}: ${message}`);
            }
        }
    } catch (error) {
        logger.error('Discord DM queue processor failed:', error);
    } finally {
        dmQueueProcessing = false;
    }
}

export const readyEvent: Event = {
    name: 'clientReady',
    once: true,
    async execute(client: Client<true>) {
        logger.info(`Logged in as ${client.user.tag}`);
        logger.info(`Serving ${client.guilds.cache.size} guilds`);

        // Connect to the Lavalink music node now that the gateway is ready.
        try {
            await client.lavalink.init({ id: client.user.id, username: client.user.username });
            logger.info('🎵 Lavalink manager initialized');
        } catch (error) {
            logger.error('🎵 Lavalink init failed:', error);
        }

        if (config.bot.autoRegisterCommands) {
            await registerApplicationCommands('bot startup').catch((error) => {
                logger.error('Startup slash command sync failed:', error);
            });
        }

        await syncLinkedRoles(client);

        logger.info('Setting up Supabase Realtime subscription...');
        supabase.subscribeToLinks(async (payload) => {
            logger.info('Realtime account link event received:', JSON.stringify(payload, null, 2));
            const { discord_id } = payload.new;

            const roleSuccess = await assignLinkedRole(client, discord_id);

            const dmContainer = ComponentsV2.successContainer(
                'Account Successfully Linked',
                'Your Discord account has been linked to Victus Cloud.\n\n' +
                'You now have access to account-aware server, billing, and support commands.\n' +
                '› Use `/servers` to view your servers.\n' +
                '› Use `/help` to explore the command center.'
            );
            await sendNotificationDM(client, discord_id, dmContainer, 'security');

            const supportGuildId = config.bot.supportGuildId;
            if (supportGuildId) {
                await sendAuditLog(
                    client,
                    supportGuildId,
                    'Account Linked (Realtime)',
                    `User ID: \`${discord_id}\`\n` +
                    `Status: ${roleSuccess ? 'Role assigned' : 'User not in server or role missing'}\n` +
                    `Action: Linked via website`,
                    ComponentsV2.Accents.success
                );
            }
        });

        // Bridge website tickets <-> Discord ticket channels.
        initTicketBridge(client);

        // Keep the Uptime Kuma "Discord Bot" push monitor green.
        startUptimeHeartbeat(client);

        await processAdminDmQueue(client);
        setInterval(() => {
            processAdminDmQueue(client).catch((error) => logger.error('DM queue interval failed:', error));
        }, 15000);

        client.user.setPresence({
            status: 'online',
            activities: [
                {
                    name: `${config.branding.name} | /help`,
                    type: ActivityType.Watching,
                },
            ],
        });

        const activities = [
            { name: `${config.branding.name} | /help`, type: ActivityType.Watching },
            { name: 'your cloud services', type: ActivityType.Watching },
            { name: '/link to connect accounts', type: ActivityType.Playing },
            { name: 'support workflows', type: ActivityType.Listening },
        ];

        let i = 0;
        setInterval(() => {
            client.user.setActivity(activities[i].name, { type: activities[i].type as ActivityType });
            i = (i + 1) % activities.length;
        }, 30000);
    },
};
