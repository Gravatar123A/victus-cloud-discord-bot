import { Client, ActivityType } from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { syncLinkedRoles, assignLinkedRole } from '../utils/roles.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { sendAuditLog, sendNotificationDM } from '../utils/auditing.js';
import type { Event } from '../types/index.js';

export const readyEvent: Event = {
    name: 'clientReady',
    once: true,
    async execute(client: Client<true>) {
        logger.info(`✅ Logged in as ${client.user.tag}!`);
        logger.info(`📊 Serving ${client.guilds.cache.size} guilds`);

        // Sync linked roles on startup
        await syncLinkedRoles(client);

        // Subscribe to NEW account links (Realtime)
        logger.info('📡 Setting up Supabase Realtime subscription...');
        const subscription = supabase.subscribeToLinks(async (payload) => {
            logger.info('📥 Realtime Event Received:', JSON.stringify(payload, null, 2));
            const { discord_id, user_id } = payload.new;
            logger.info(`✨ Realtime: New account link detected for ${discord_id}`);

            // 1. Assign Role
            const roleSuccess = await assignLinkedRole(client, discord_id);

            // 2. Send DM Notification
            const dmContainer = ComponentsV2.successContainer(
                '🎉 Account Successfully Linked!',
                'Your Discord account has been linked to Victus Cloud.\n\n' +
                'You now have access to server management commands!\n' +
                `• Use \`/servers\` to see your servers.\n` +
                `• Use \`/help\` to see all commands.`
            );
            await sendNotificationDM(client, discord_id, dmContainer);

            // 3. Send Audit Log
            // Since we don't have guildId in the payload, we use supportGuildId from config if available
            const supportGuildId = config.bot.supportGuildId;
            if (supportGuildId) {
                await sendAuditLog(
                    client,
                    supportGuildId,
                    'Account Linked (Realtime)',
                    `👤 **User ID:** \`${discord_id}\`\n` +
                    `🔗 **Status:** ${roleSuccess ? '✅ Role Assigned' : '⚠️ User not in server'}\n` +
                    `🌐 **Action:** Linked via Website`,
                    ComponentsV2.Accents.success
                );
            }
        });

        // Set bot activity
        client.user.setPresence({
            status: 'online',
            activities: [
                {
                    name: `${config.branding.name} | /help`,
                    type: ActivityType.Watching,
                },
            ],
        });

        // Rotate activity messages
        const activities = [
            { name: `${config.branding.name} | /help`, type: ActivityType.Watching },
            { name: 'your servers 🎮', type: ActivityType.Watching },
            { name: '/link to get started', type: ActivityType.Playing },
            { name: 'for support tickets', type: ActivityType.Listening },
        ];

        let i = 0;
        setInterval(() => {
            client.user.setActivity(activities[i].name, { type: activities[i].type as ActivityType });
            i = (i + 1) % activities.length;
        }, 30000); // Change every 30 seconds
    },
};
