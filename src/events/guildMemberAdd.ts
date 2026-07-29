import { ChannelType, Events, EmbedBuilder } from 'discord.js';
import type { GuildMember } from 'discord.js';
import type { Event } from '../types/index.js';
import { welcomeSettings } from '../services/welcomeSettings.js';
import { buildWelcomePayload } from '../commands/welcome.js';
import { auditLogSettings } from '../services/auditLogSettings.js';
import { sendNotificationDM } from '../utils/auditing.js';
import { NotificationTemplates } from '../embeds/notificationTemplates.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { supabase } from '../services/supabase.js';
import { getGuildInvites, setGuildInvites, type CachedInvite } from '../services/inviteCache.js';
import { syncEntitlementRoles } from '../services/entitlementRoles.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Attribute this join to the invite that was used (by diffing live invite
 * use-counts against the cache), run the anti-abuse gates, and record a
 * PENDING invite credit. No COINS move here — the ready-time scheduler pays out
 * only after the invitee has stayed the qualifying period (escrow model).
 *
 * Runs in its own try/catch so an invite failure never breaks the welcome flow.
 * Inert unless config.economy.invite.enabled and, if configured, restricted to
 * the support guild.
 */
async function handleInviteAttribution(member: GuildMember): Promise<void> {
    const inviteCfg = config.economy.invite;
    if (!inviteCfg.enabled) return;

    // Gate to the main support guild only (if one is configured).
    const supportGuildId = config.bot.supportGuildId;
    if (supportGuildId && member.guild.id !== supportGuildId) return;

    // Never reward inviting a bot.
    if (member.user.bot) return;

    // Re-fetch the guild's invites. Requires Manage Server; fail soft.
    let fetched;
    try {
        fetched = await member.guild.invites.fetch();
    } catch (err) {
        logger.warn(`Invite attribution: cannot fetch invites for guild ${member.guild.id} (bot needs Manage Server): ${(err as Error).message}`);
        return;
    }

    // Diff each live invite against the cached use-count to find which one grew.
    const cache = getGuildInvites(member.guild.id);
    const grew: Array<{ code: string; inviterId: string | null }> = [];
    const snapshot = new Map<string, CachedInvite>();
    for (const invite of fetched.values()) {
        const now = invite.uses ?? 0;
        const inviterId = invite.inviterId ?? invite.inviter?.id ?? null;
        snapshot.set(invite.code, { uses: now, inviterId });
        const prev = cache.get(invite.code)?.uses ?? 0;
        if (now > prev) grew.push({ code: invite.code, inviterId });
    }
    // Refresh the cache to the current state regardless of the outcome.
    setGuildInvites(member.guild.id, snapshot);

    // Only attribute when EXACTLY one invite incremented. Zero (vanity URL,
    // server widget, or an invite the cache never saw) or multiple (a race
    // between near-simultaneous joins) is ambiguous -> record 'unattributed'
    // so the invitee slot is consumed but nothing is ever paid out.
    if (grew.length !== 1) {
        logger.info(`Invite attribution: ${grew.length} candidate invites for ${member.user.tag}; marking unattributed`);
        await supabase.createInviteCredit({
            guild_id: member.guild.id,
            inviter_discord_id: null,
            invitee_discord_id: member.id,
            invite_code: null,
            inviter_user_id: null,
            coins: inviteCfg.amount,
            status: 'unattributed',
            qualify_at: new Date().toISOString(),
        }).catch(() => null);
        return;
    }

    const { code, inviterId } = grew[0];

    // No inviter (or self-invite) -> nothing to reward.
    if (!inviterId || inviterId === member.id) return;

    // Account-age gate: block throwaway alts joining via a farmer's link.
    const accountAgeMs = Date.now() - member.user.createdTimestamp;
    if (accountAgeMs < inviteCfg.minAccountAgeDays * DAY_MS) {
        logger.info(`Invite attribution: ${member.user.tag} account younger than ${inviteCfg.minAccountAgeDays}d; skipping`);
        return;
    }

    // Rate cap: how many credits has this inviter earned in the trailing 24h?
    const since = new Date(Date.now() - DAY_MS).toISOString();
    const recent = await supabase.countRecentInviterCredits(inviterId, since);
    if (recent >= inviteCfg.dailyCap) {
        logger.warn(`Invite attribution: inviter ${inviterId} hit daily cap (${inviteCfg.dailyCap}); skipping`);
        return;
    }

    // Resolve the inviter's linked Victus account now (may be null; the
    // scheduler re-checks the link at payout time).
    const linked = await supabase.getLinkedAccount(inviterId).catch(() => null);
    const qualifyAt = new Date(Date.now() + inviteCfg.qualifyDays * DAY_MS).toISOString();

    const created = await supabase.createInviteCredit({
        guild_id: member.guild.id,
        inviter_discord_id: inviterId,
        invitee_discord_id: member.id,
        invite_code: code,
        inviter_user_id: linked?.user_id ?? null,
        coins: inviteCfg.amount,
        status: 'pending',
        qualify_at: qualifyAt,
    });

    if (created) {
        logger.info(`Invite credit PENDING: inviter ${inviterId} for invitee ${member.user.tag} via ${code}; qualifies ${qualifyAt}`);
    } else {
        logger.debug(`Invite credit skipped (invitee ${member.id} already recorded)`);
    }
}

export const guildMemberAddEvent: Event = {
    name: Events.GuildMemberAdd,
    async execute(member: GuildMember) {
        // Invite -> COINS attribution (escrow). Isolated so a failure here never
        // affects the welcome/roles/audit flow below.
        await handleInviteAttribution(member).catch((error) => {
            logger.error('Error during invite attribution:', error);
        });

        try {
            // Send welcome DM to new member
            const dmContainer = NotificationTemplates.welcomeDM(member.user.username);
            await sendNotificationDM(member.client, member.id, dmContainer, 'promotions');

            // Welcome channel message
            const welcomeConfig = await welcomeSettings.get(member.guild.id);
            if (welcomeConfig.enabled && welcomeConfig.channelId) {
                const channel = member.guild.channels.cache.get(welcomeConfig.channelId);
                if (channel && channel.type === ChannelType.GuildText) {
                    const payload = await buildWelcomePayload(welcomeConfig, member);
                    await channel.send(payload).catch((err) => {
                        logger.error(`Failed to send welcome message for ${member.user.tag}:`, err);
                    });
                }
            }

            // Assign Auto-Roles
            if (welcomeConfig.autoRoleIds && welcomeConfig.autoRoleIds.length > 0) {
                const rolesToAssign = welcomeConfig.autoRoleIds.filter(id => member.guild.roles.cache.has(id));
                if (rolesToAssign.length > 0) {
                    await member.roles.add(rolesToAssign).catch((err) => {
                        logger.error(`Failed to assign auto-roles to ${member.user.tag}:`, err);
                    });
                }
            }

            if (member.guild.id === (config.bot.supportGuildId || config.discord.guildId)) {
                await syncEntitlementRoles(member.client, member.id).catch((err) => {
                    logger.error(`Failed to sync server entitlement roles for ${member.user.tag}:`, err);
                });
            }

            // Audit logging join event
            const auditConfig = await auditLogSettings.get(member.guild.id);
            if (auditConfig.enabled && auditConfig.channelId && auditConfig.events.includes('member_join')) {
                const logChannel = member.guild.channels.cache.get(auditConfig.channelId);
                if (logChannel && logChannel.isTextBased()) {
                    const accountAge = `<t:${Math.floor(member.user.createdTimestamp / 1000)}:f> (<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>)`;
                    const embed = new EmbedBuilder()
                        .setColor(0x10b981) // Green
                        .setThumbnail(member.user.displayAvatarURL())
                        .setAuthor({
                            name: member.user.tag,
                            iconURL: member.user.displayAvatarURL()
                        })
                        .setTitle('📥 Member Joined')
                        .setDescription(`**User:** <@${member.user.id}> (${member.user.username})\n**ID:** \`${member.user.id}\``)
                        .addFields(
                            { name: 'Account Creation Date', value: accountAge }
                        )
                        .setTimestamp();

                    await (logChannel as any).send({ embeds: [embed] }).catch(() => {});
                }
            }
        } catch (error) {
            logger.error('Error executing guildMemberAdd event:', error);
        }
    }
};
