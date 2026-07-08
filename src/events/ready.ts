import { ActivityType, Client } from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { assignLinkedRole, syncLinkedRoles } from '../utils/roles.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { NotificationTemplates } from '../embeds/notificationTemplates.js';
import type { NotificationType } from '../embeds/notificationTemplates.js';
import { sendAuditLog, sendNotificationDM } from '../utils/auditing.js';
import type { Event } from '../types/index.js';
import { registerApplicationCommands } from '../utils/registerCommands.js';
import { initTicketBridge } from '../services/ticketBridge.js';
import { startUptimeHeartbeat } from '../services/uptimeHeartbeat.js';
import { initializeFonts } from 'musicard';
import { startGiveawayScheduler } from '../commands/giveaway.js';
import { updateServerStats } from '../commands/serverstats.js';

let dmQueueProcessing = false;

function buildNotificationContainer(job: any): any {
    const type: NotificationType | null = job.notification_type || null;
    const meta = job.metadata || {};

    switch (type) {
        case 'welcome':
            return NotificationTemplates.welcomeDM(meta.discord_username || 'User');
        case 'account_linked':
            return NotificationTemplates.accountLinkedDM(meta.discord_username || 'User');
        case 'invoice_due':
            return NotificationTemplates.invoiceDueDM(
                meta.invoice_id || '',
                meta.amount || '0.00',
                meta.currency || '$',
                meta.due_date || 'Unknown',
                config.branding.billing
            );
        case 'invoice_paid':
            return NotificationTemplates.invoicePaidDM(
                meta.invoice_id || '',
                meta.amount || '0.00',
                meta.currency || '$'
            );
        case 'server_created':
            return NotificationTemplates.serverCreatedDM(
                meta.server_name || 'Server',
                meta.server_type || 'Game Server',
                config.branding.panel
            );
        case 'server_installed':
            return NotificationTemplates.serverInstalledDM(
                meta.server_name || 'Server',
                config.branding.panel
            );
        case 'order_confirmed':
            return NotificationTemplates.orderConfirmedDM(
                meta.order_id || '',
                meta.product_name || 'Product',
                meta.amount || '0.00',
                meta.currency || '$'
            );
        case 'ticket_created':
            return NotificationTemplates.ticketCreatedDM(
                meta.ticket_id || '',
                meta.subject || 'Support Request'
            );
        case 'login_detected':
            return NotificationTemplates.loginDetectedDM(
                meta.ip || 'Unknown',
                meta.device || 'Unknown',
                meta.time || 'Unknown'
            );
        default:
            return ComponentsV2.adminDmContainer(job.subject, job.message, job.admin_email);
    }
}

async function processNotificationQueue(client: Client<true>) {
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

                const container = buildNotificationContainer(job);

                await target.send({
                    components: [container],
                    flags: NotificationTemplates.IS_COMPONENTS_V2,
                });

                await supabase.markDiscordDmSent(job.id);
                logger.info(`Notification DM sent to ${target.tag} (${job.discord_id}) type=${job.notification_type || 'admin'}`);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown Discord DM delivery failure';
                await supabase.markDiscordDmFailed(job.id, message);
                logger.warn(`Notification DM failed for ${job.discord_id}: ${message}`);
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

        // Initialize musicard fonts
        try {
            initializeFonts();
        } catch (err) {
            logger.error('Failed to initialize musicard fonts:', err);
        }
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
            const { discord_id, discord_username } = payload.new;

            const roleSuccess = await assignLinkedRole(client, discord_id);

            const dmContainer = NotificationTemplates.accountLinkedDM(discord_username || 'User');
            await sendNotificationDM(client, discord_id, dmContainer, 'security');

            const supportGuildId = config.bot.supportGuildId;
            if (supportGuildId) {
                await sendAuditLog(
                    client,
                    supportGuildId,
                    'Account Linked (Realtime)',
                    `User ID: \`${discord_id}\`\n` +
                    `Discord: **${discord_username || 'Unknown'}**\n` +
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

        // Start background giveaway ends_at checks scheduler
        startGiveawayScheduler(client);

        // Server Stats Auto-Updater
        const runServerStats = async () => {
            for (const guild of client.guilds.cache.values()) {
                await updateServerStats(guild).catch(() => {});
            }
        };
        await runServerStats();
        setInterval(runServerStats, 5 * 60 * 1000);

        await processNotificationQueue(client);
        setInterval(() => {
            processNotificationQueue(client).catch((error) => logger.error('DM queue interval failed:', error));
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
