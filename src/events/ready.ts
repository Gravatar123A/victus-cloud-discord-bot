import { ActivityType, Client } from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { assignLinkedRole, syncAllRankRoles, syncLinkedRoles, syncRankRole } from '../utils/roles.js';
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
import { setGuildInvites, type CachedInvite } from '../services/inviteCache.js';
import { startLevelUpWorker } from '../services/levelUp.js';
import { restoreVoiceXpSessions } from './voiceStateUpdate.js';

let dmQueueProcessing = false;
let inviteCreditsProcessing = false;

/**
 * Seed the in-memory invite-use cache for every guild the bot is in. Requires
 * the bot to have Manage Server in each guild; failures are logged and skipped
 * so a single missing permission never blocks startup.
 */
async function seedInviteCache(client: Client<true>): Promise<void> {
    let seeded = 0;
    for (const guild of client.guilds.cache.values()) {
        try {
            const invites = await guild.invites.fetch();
            const snapshot = new Map<string, CachedInvite>();
            for (const invite of invites.values()) {
                snapshot.set(invite.code, {
                    uses: invite.uses ?? 0,
                    inviterId: invite.inviterId ?? invite.inviter?.id ?? null,
                });
            }
            setGuildInvites(guild.id, snapshot);
            seeded += snapshot.size;
        } catch (err) {
            logger.warn(`Invite cache: could not fetch invites for guild ${guild.id} (needs Manage Server): ${(err as Error).message}`);
        }
    }
    logger.info(`Invite cache seeded: ${seeded} invites across ${client.guilds.cache.size} guild(s)`);
}

/**
 * Pay out due invite credits (escrow settlement). For each PENDING credit whose
 * qualify_at has passed: verify the invitee is still a member and the inviter's
 * Victus account is linked, then grant the COINS via the CANONICAL Paymenter
 * rail (supabase.grantInviteCoins -> adjustPaymenterCredits currency=COINS) and
 * mark the row 'confirmed'. If the invitee already left, void it; if the inviter
 * is unlinked or the grant fails, the row stays 'pending' for the next pass.
 */
async function processInviteCredits(client: Client<true>): Promise<void> {
    if (!config.economy.invite.enabled) return;
    if (inviteCreditsProcessing) return;
    inviteCreditsProcessing = true;

    try {
        const due = await supabase.getDueInviteCredits(50);
        for (const credit of due) {
            try {
                const guild = client.guilds.cache.get(credit.guild_id);
                if (!guild) continue; // bot not in that guild right now; retry later

                // Invitee must still be a member.
                const member = await guild.members.fetch(credit.invitee_discord_id).catch(() => null);
                if (!member) {
                    await supabase.updateInviteCredit(credit.id, {
                        status: 'voided',
                        left_at: credit.left_at || new Date().toISOString(),
                    });
                    logger.info(`Invite credit VOIDED at payout: invitee ${credit.invitee_discord_id} no longer a member`);
                    continue;
                }

                // Inviter must have a linked Victus account. Re-resolve if we
                // did not have it when the credit was created.
                let inviterUserId = credit.inviter_user_id;
                if (!inviterUserId && credit.inviter_discord_id) {
                    const linked = await supabase.getLinkedAccount(credit.inviter_discord_id).catch(() => null);
                    inviterUserId = linked?.user_id ?? null;
                }
                if (!inviterUserId) {
                    logger.debug(`Invite credit ${credit.id}: inviter not linked yet; leaving pending`);
                    continue;
                }

                // Grant via the canonical Paymenter COINS rail.
                const ok = await supabase.grantInviteCoins(inviterUserId, credit.coins);
                if (!ok) {
                    logger.warn(`Invite credit ${credit.id}: COINS grant failed; leaving pending for retry`);
                    continue;
                }

                await supabase.updateInviteCredit(credit.id, {
                    status: 'confirmed',
                    inviter_user_id: inviterUserId,
                    paid_at: new Date().toISOString(),
                });
                logger.info(`Invite credit CONFIRMED: +${credit.coins} COINS to inviter ${credit.inviter_discord_id} for ${credit.invitee_discord_id}`);

                // Best-effort DM to the inviter.
                if (credit.inviter_discord_id) {
                    const container = ComponentsV2.successContainer(
                        `+${credit.coins} COINS Earned`,
                        `Thanks for growing ${config.branding.name}! You earned **${credit.coins} COINS** because <@${credit.invitee_discord_id}> joined with your invite and stuck around.`
                    );
                    await sendNotificationDM(client, credit.inviter_discord_id, container, 'promotions').catch(() => {});
                }
            } catch (err) {
                logger.error(`processInviteCredits: error settling credit ${credit.id}:`, err);
            }
        }
    } catch (error) {
        logger.error('processInviteCredits failed:', error);
    } finally {
        inviteCreditsProcessing = false;
    }
}

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
        await syncAllRankRoles(client);
        restoreVoiceXpSessions(client);
        startLevelUpWorker(client);

        logger.info('Setting up Supabase Realtime subscription...');
        supabase.subscribeToLinks(async (payload) => {
            logger.info('Realtime account link event received:', JSON.stringify(payload, null, 2));
            const { discord_id, discord_username } = payload.new;

            const roleSuccess = await assignLinkedRole(client, discord_id);
            const linked = await supabase.getLinkedAccount(discord_id).catch(() => null);
            const profile = linked ? await supabase.getUserProfile(linked.user_id).catch(() => null) : null;
            if (profile) {
                const { calculateLevel } = await import('../utils/vccrs.js');
                await syncRankRole(client, discord_id, calculateLevel(Number(profile.total_xp ?? 0))).catch(() => false);
            }

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

        // Invite -> COINS escrow: seed the invite cache and start the payout
        // scheduler. Entirely inert unless DISCORD_INVITE_COINS_ENABLED=true.
        if (config.economy.invite.enabled) {
            await seedInviteCache(client);
            await processInviteCredits(client);
            setInterval(() => {
                processInviteCredits(client).catch((error) => logger.error('Invite credits interval failed:', error));
            }, 60_000);
            logger.info('Invite COINS escrow scheduler started (60s interval)');
        } else {
            logger.info('Invite COINS escrow disabled (set DISCORD_INVITE_COINS_ENABLED=true to enable)');
        }

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
