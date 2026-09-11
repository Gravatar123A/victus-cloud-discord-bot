import { AuditLogEvent, Guild, GuildMember, User, EmbedBuilder, GuildBan } from 'discord.js';
import { whitelistSettings } from './whitelistSettings.js';
import { antiNukeSettings } from './antiNukeSettings.js';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';

// Track executor actions to determine if they should be kicked or banned
const actionHistory = new Map<string, { count: number; lastReset: number }>();

/**
 * Increment and get the action count for a user in a guild within a 15s window.
 */
function getAndIncrementActionCount(guildId: string, userId: string): number {
    const key = `${guildId}:${userId}`;
    const now = Date.now();
    const history = actionHistory.get(key) || { count: 0, lastReset: now };
    
    if (now - history.lastReset > 15000) { // 15-second window
        history.count = 1;
        history.lastReset = now;
    } else {
        history.count += 1;
    }
    actionHistory.set(key, history);
    return history.count;
}

/**
 * Check if a user/bot is whitelisted or immune to Anti-Nuke triggers.
 */
async function isWhitelisted(guild: Guild, userId: string): Promise<boolean> {
    if (userId === guild.client.user!.id) return true;
    if (userId === guild.ownerId) return true;
    
    const config = await whitelistSettings.get(guild.id);
    return config.users.some(u => u.userId === userId);
}

/**
 * Punish the perpetrator by first stripping roles, and then either kicking or banning.
 */
async function punishPerpetrator(guild: Guild, executorId: string, isNukePattern: boolean, reason: string): Promise<string> {
    const member = await guild.members.fetch(executorId).catch(() => null);
    if (!member) return 'Perpetrator is no longer in the server';
    
    if (!member.manageable) {
        return 'Perpetrator is not manageable by the bot (higher role or owner)';
    }
    
    // Strip roles first to immediately remove all permissions
    const manageableRoles = member.roles.cache.filter(role => 
        role.id !== guild.id && 
        role.managed === false && 
        role.comparePositionTo(guild.members.me!.roles.highest) < 0
    );
    if (manageableRoles.size > 0) {
        await member.roles.remove(manageableRoles, 'Anti-Nuke: Immediate role strip before punishment').catch(() => {});
    }
    
    if (isNukePattern) {
        // Ban for clear nuke patterns
        await guild.members.ban(executorId, { reason: `Anti-Nuke Protection: ${reason}` }).catch(() => {});
        return 'Banned (Nuke pattern/Mass actions detected) 🔨';
    } else {
        // Kick for single suspicious action
        await member.kick(`Anti-Nuke Protection: ${reason}`).catch(() => {});
        return 'Kicked (Single suspicious action) 📤';
    }
}

/**
 * Send an audit/moderation log alert.
 */
async function sendAlert(guild: Guild, title: string, description: string) {
    try {
        const settings = await supabase.getBotSettings(guild.id).catch(() => null);
        const logChannelId = settings?.moderation_log_channel_id || settings?.log_channel_id;
        if (!logChannelId) return;
        
        const channel = guild.channels.cache.get(logChannelId);
        if (!channel || !channel.isTextBased()) return;
        
        const embed = new EmbedBuilder()
            .setColor(0xf87171) // Soft Pastel Red / Unauthorized
            .setTitle(`🛡️ Anti-Nuke: ${title}`)
            .setDescription(description)
            .setFooter({ text: 'Victus Bot Anti-Nuke Operations' })
            .setTimestamp();
            
        await (channel as any).send({ embeds: [embed] }).catch(() => {});
    } catch (error) {
        logger.error('Failed to send Anti-Nuke alert:', error);
    }
}

export class AntiNukeService {
    async handleMemberRemove(member: GuildMember) {
        try {
            const config = await antiNukeSettings.get(member.guild.id);
            if (!config.enabled || !config.anti_kick) return;
            
            const auditLogs = await member.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry) return;
            
            const now = Date.now();
            if (entry.targetId !== member.id || now - entry.createdTimestamp > 10000) return;
            
            const executor = entry.executor;
            if (!executor) return;
            
            const whitelisted = await isWhitelisted(member.guild, executor.id);
            if (whitelisted) {
                await sendAlert(member.guild, 'Exemption Triggered', `Bot/User <@${executor.id}> kicked <@${member.id}> but is whitelisted/exempt.`);
                return;
            }
            
            const count = getAndIncrementActionCount(member.guild.id, executor.id);
            const isNuke = count > 1;
            const punishment = await punishPerpetrator(member.guild, executor.id, isNuke, `Unauthorized kick of <@${member.id}>`);
            
            await sendAlert(member.guild, 'Kick Protection Triggered', 
                `**Perpetrator:** <@${executor.id}> (${executor.username})\n` +
                `**Target:** <@${member.id}> (${member.user.username})\n` +
                `**Mitigation Action:** ${punishment}`
            );
        } catch (error) {
            logger.error('Error in handleMemberRemove anti-nuke:', error);
        }
    }

    async handleBanAdd(ban: GuildBan) {
        try {
            const config = await antiNukeSettings.get(ban.guild.id);
            if (!config.enabled || !config.anti_ban) return;
            
            const auditLogs = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry) return;
            
            const now = Date.now();
            if (entry.targetId !== ban.user.id || now - entry.createdTimestamp > 10000) return;
            
            const executor = entry.executor;
            if (!executor) return;
            
            const whitelisted = await isWhitelisted(ban.guild, executor.id);
            if (whitelisted) {
                await sendAlert(ban.guild, 'Exemption Triggered', `Bot/User <@${executor.id}> banned <@${ban.user.id}> but is whitelisted/exempt.`);
                return;
            }
            
            const count = getAndIncrementActionCount(ban.guild.id, executor.id);
            const isNuke = count > 1;
            const punishment = await punishPerpetrator(ban.guild, executor.id, isNuke, `Unauthorized ban of <@${ban.user.id}>`);
            
            // Revert action (unban target)
            await ban.guild.members.unban(ban.user.id, 'Anti-Nuke Protection: Reversing unauthorized ban').catch(() => {});
            
            await sendAlert(ban.guild, 'Ban Protection Triggered', 
                `**Perpetrator:** <@${executor.id}> (${executor.username})\n` +
                `**Target:** <@${ban.user.id}> (${ban.user.username})\n` +
                `**Mitigation Action:** ${punishment}\n` +
                `**Reversion:** Target has been unbanned successfully.`
            );
        } catch (error) {
            logger.error('Error in handleBanAdd anti-nuke:', error);
        }
    }

    async handleBanRemove(ban: GuildBan) {
        try {
            const config = await antiNukeSettings.get(ban.guild.id);
            if (!config.enabled || !config.anti_ban_remove) return;
            
            const auditLogs = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanRemove }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry) return;
            
            const now = Date.now();
            if (entry.targetId !== ban.user.id || now - entry.createdTimestamp > 10000) return;
            
            const executor = entry.executor;
            if (!executor) return;
            
            const whitelisted = await isWhitelisted(ban.guild, executor.id);
            if (whitelisted) {
                await sendAlert(ban.guild, 'Exemption Triggered', `Bot/User <@${executor.id}> unbanned <@${ban.user.id}> but is whitelisted/exempt.`);
                return;
            }
            
            const count = getAndIncrementActionCount(ban.guild.id, executor.id);
            const isNuke = count > 1;
            const punishment = await punishPerpetrator(ban.guild, executor.id, isNuke, `Unauthorized unban of <@${ban.user.id}>`);
            
            // Revert action (re-ban target)
            await ban.guild.members.ban(ban.user.id, { reason: 'Anti-Nuke Protection: Reversing unauthorized unban' }).catch(() => {});
            
            await sendAlert(ban.guild, 'BanRemove Protection Triggered', 
                `**Perpetrator:** <@${executor.id}> (${executor.username})\n` +
                `**Target:** <@${ban.user.id}> (${ban.user.username})\n` +
                `**Mitigation Action:** ${punishment}\n` +
                `**Reversion:** Target has been re-banned successfully.`
            );
        } catch (error) {
            logger.error('Error in handleBanRemove anti-nuke:', error);
        }
    }

    async handleChannelCreate(channel: any) {
        try {
            if (!channel.guild) return;
            const config = await antiNukeSettings.get(channel.guild.id);
            if (!config.enabled || !config.anti_channel_create) return;
            
            const auditLogs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelCreate }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry) return;
            
            const now = Date.now();
            if (entry.targetId !== channel.id || now - entry.createdTimestamp > 10000) return;
            
            const executor = entry.executor;
            if (!executor) return;
            
            const whitelisted = await isWhitelisted(channel.guild, executor.id);
            if (whitelisted) {
                await sendAlert(channel.guild, 'Exemption Triggered', `Bot/User <@${executor.id}> created channel \`${channel.name}\` but is whitelisted/exempt.`);
                return;
            }
            
            const count = getAndIncrementActionCount(channel.guild.id, executor.id);
            const isNuke = count > 1;
            const punishment = await punishPerpetrator(channel.guild, executor.id, isNuke, `Unauthorized channel creation: \`${channel.name}\``);
            
            // Revert action (delete unauthorized channel)
            await channel.delete('Anti-Nuke Protection: Deleting unauthorized channel').catch(() => {});
            
            await sendAlert(channel.guild, 'ChannelCreate Protection Triggered', 
                `**Perpetrator:** <@${executor.id}> (${executor.username})\n` +
                `**Target Channel:** \`${channel.name}\`\n` +
                `**Mitigation Action:** ${punishment}\n` +
                `**Reversion:** Unauthorized channel has been deleted successfully.`
            );
        } catch (error) {
            logger.error('Error in handleChannelCreate anti-nuke:', error);
        }
    }

    async handleChannelDelete(channel: any) {
        try {
            if (!channel.guild) return;
            const config = await antiNukeSettings.get(channel.guild.id);
            if (!config.enabled || !config.anti_channel_delete) return;
            
            const auditLogs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry) return;
            
            const now = Date.now();
            if (entry.targetId !== channel.id || now - entry.createdTimestamp > 10000) return;
            
            const executor = entry.executor;
            if (!executor) return;
            
            const whitelisted = await isWhitelisted(channel.guild, executor.id);
            if (whitelisted) {
                await sendAlert(channel.guild, 'Exemption Triggered', `Bot/User <@${executor.id}> deleted channel \`${channel.name}\` but is whitelisted/exempt.`);
                return;
            }
            
            const count = getAndIncrementActionCount(channel.guild.id, executor.id);
            const isNuke = count > 1;
            const punishment = await punishPerpetrator(channel.guild, executor.id, isNuke, `Unauthorized channel deletion: \`${channel.name}\``);
            
            // Revert action (recreate channel)
            const restoredChannel = await channel.guild.channels.create({
                name: channel.name,
                type: channel.type,
                parent: channel.parentId || undefined,
                permissionOverwrites: channel.permissionOverwrites.cache.map((p: any) => ({
                    id: p.id,
                    type: p.type,
                    allow: p.allow.toArray(),
                    deny: p.deny.toArray()
                }))
            }).catch(() => null);
            
            await sendAlert(channel.guild, 'ChannelDelete Protection Triggered', 
                `**Perpetrator:** <@${executor.id}> (${executor.username})\n` +
                `**Target Channel:** \`${channel.name}\`\n` +
                `**Mitigation Action:** ${punishment}\n` +
                `**Reversion:** Deleted channel has been recreated successfully ${restoredChannel ? `<#${restoredChannel.id}>` : '(Recreation failed due to permissions)'}.`
            );
        } catch (error) {
            logger.error('Error in handleChannelDelete anti-nuke:', error);
        }
    }

    async handleRoleCreate(role: any) {
        try {
            const config = await antiNukeSettings.get(role.guild.id);
            if (!config.enabled || !config.anti_role_create) return;
            
            const auditLogs = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleCreate }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry) return;
            
            const now = Date.now();
            if (entry.targetId !== role.id || now - entry.createdTimestamp > 10000) return;
            
            const executor = entry.executor;
            if (!executor) return;
            
            const whitelisted = await isWhitelisted(role.guild, executor.id);
            if (whitelisted) {
                await sendAlert(role.guild, 'Exemption Triggered', `Bot/User <@${executor.id}> created role \`${role.name}\` but is whitelisted/exempt.`);
                return;
            }
            
            const count = getAndIncrementActionCount(role.guild.id, executor.id);
            const isNuke = count > 1;
            const punishment = await punishPerpetrator(role.guild, executor.id, isNuke, `Unauthorized role creation: \`${role.name}\``);
            
            // Revert action (delete role)
            await role.delete('Anti-Nuke Protection: Deleting unauthorized role').catch(() => {});
            
            await sendAlert(role.guild, 'RoleCreate Protection Triggered', 
                `**Perpetrator:** <@${executor.id}> (${executor.username})\n` +
                `**Target Role:** \`${role.name}\`\n` +
                `**Mitigation Action:** ${punishment}\n` +
                `**Reversion:** Unauthorized role has been deleted successfully.`
            );
        } catch (error) {
            logger.error('Error in handleRoleCreate anti-nuke:', error);
        }
    }

    async handleRoleDelete(role: any) {
        try {
            const config = await antiNukeSettings.get(role.guild.id);
            if (!config.enabled || !config.anti_role_delete) return;
            
            const auditLogs = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry) return;
            
            const now = Date.now();
            if (entry.targetId !== role.id || now - entry.createdTimestamp > 10000) return;
            
            const executor = entry.executor;
            if (!executor) return;
            
            const whitelisted = await isWhitelisted(role.guild, executor.id);
            if (whitelisted) {
                await sendAlert(role.guild, 'Exemption Triggered', `Bot/User <@${executor.id}> deleted role \`${role.name}\` but is whitelisted/exempt.`);
                return;
            }
            
            const count = getAndIncrementActionCount(role.guild.id, executor.id);
            const isNuke = count > 1;
            const punishment = await punishPerpetrator(role.guild, executor.id, isNuke, `Unauthorized role deletion: \`${role.name}\``);
            
            // Revert action (recreate role)
            const restoredRole = await role.guild.roles.create({
                name: role.name,
                color: role.color,
                hoist: role.hoist,
                mentionable: role.mentionable,
                permissions: role.permissions
            }).catch(() => null);
            
            await sendAlert(role.guild, 'RoleDelete Protection Triggered', 
                `**Perpetrator:** <@${executor.id}> (${executor.username})\n` +
                `**Target Role:** \`${role.name}\`\n` +
                `**Mitigation Action:** ${punishment}\n` +
                `**Reversion:** Deleted role has been recreated successfully ${restoredRole ? `<@&${restoredRole.id}>` : '(Recreation failed due to permissions)'}.`
            );
        } catch (error) {
            logger.error('Error in handleRoleDelete anti-nuke:', error);
        }
    }

    async handleRoleUpdate(oldRole: any, newRole: any) {
        try {
            const config = await antiNukeSettings.get(newRole.guild.id);
            if (!config.enabled || !config.anti_role_update) return;
            
            const auditLogs = await newRole.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleUpdate }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry) return;
            
            const now = Date.now();
            if (entry.targetId !== newRole.id || now - entry.createdTimestamp > 10000) return;
            
            const executor = entry.executor;
            if (!executor) return;
            
            const whitelisted = await isWhitelisted(newRole.guild, executor.id);
            if (whitelisted) {
                await sendAlert(newRole.guild, 'Exemption Triggered', `Bot/User <@${executor.id}> modified role \`${newRole.name}\` but is whitelisted/exempt.`);
                return;
            }
            
            const count = getAndIncrementActionCount(newRole.guild.id, executor.id);
            const isNuke = count > 1;
            const punishment = await punishPerpetrator(newRole.guild, executor.id, isNuke, `Unauthorized role modification: \`${newRole.name}\``);
            
            // Revert action (restore role properties)
            await newRole.edit({
                name: oldRole.name,
                color: oldRole.color,
                hoist: oldRole.hoist,
                mentionable: oldRole.mentionable,
                permissions: oldRole.permissions
            }, 'Anti-Nuke Protection: Reverting unauthorized role modification').catch(() => {});
            
            await sendAlert(newRole.guild, 'RoleUpdate Protection Triggered', 
                `**Perpetrator:** <@${executor.id}> (${executor.username})\n` +
                `**Target Role:** \`${newRole.name}\`\n` +
                `**Mitigation Action:** ${punishment}\n` +
                `**Reversion:** Role modifications have been successfully reverted.`
            );
        } catch (error) {
            logger.error('Error in handleRoleUpdate anti-nuke:', error);
        }
    }

    async handleEmojiDelete(emoji: any) {
        try {
            const config = await antiNukeSettings.get(emoji.guild.id);
            if (!config.enabled || !config.anti_emoji_delete) return;
            
            const auditLogs = await emoji.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.EmojiDelete }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry) return;
            
            const now = Date.now();
            if (entry.targetId !== emoji.id || now - entry.createdTimestamp > 10000) return;
            
            const executor = entry.executor;
            if (!executor) return;
            
            const whitelisted = await isWhitelisted(emoji.guild, executor.id);
            if (whitelisted) {
                await sendAlert(emoji.guild, 'Exemption Triggered', `Bot/User <@${executor.id}> deleted emoji \`${emoji.name}\` but is whitelisted/exempt.`);
                return;
            }
            
            const count = getAndIncrementActionCount(emoji.guild.id, executor.id);
            const isNuke = count > 1;
            const punishment = await punishPerpetrator(emoji.guild, executor.id, isNuke, `Unauthorized emoji deletion: \`${emoji.name}\``);
            
            await sendAlert(emoji.guild, 'EmojiDelete Protection Triggered', 
                `**Perpetrator:** <@${executor.id}> (${executor.username})\n` +
                `**Target Emoji:** \`${emoji.name}\`\n` +
                `**Mitigation Action:** ${punishment}\n` +
                `**Reversion:** perpetrator neutralized. Deleted emoji cannot be automatically recovered because the raw asset is lost.`
            );
        } catch (error) {
            logger.error('Error in handleEmojiDelete anti-nuke:', error);
        }
    }

    async handleStickerDelete(sticker: any) {
        try {
            const config = await antiNukeSettings.get(sticker.guild.id);
            if (!config.enabled || !config.anti_sticker_delete) return;
            
            const auditLogs = await sticker.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.StickerDelete }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry) return;
            
            const now = Date.now();
            if (entry.targetId !== sticker.id || now - entry.createdTimestamp > 10000) return;
            
            const executor = entry.executor;
            if (!executor) return;
            
            const whitelisted = await isWhitelisted(sticker.guild, executor.id);
            if (whitelisted) {
                await sendAlert(sticker.guild, 'Exemption Triggered', `Bot/User <@${executor.id}> deleted sticker \`${sticker.name}\` but is whitelisted/exempt.`);
                return;
            }
            
            const count = getAndIncrementActionCount(sticker.guild.id, executor.id);
            const isNuke = count > 1;
            const punishment = await punishPerpetrator(sticker.guild, executor.id, isNuke, `Unauthorized sticker deletion: \`${sticker.name}\``);
            
            await sendAlert(sticker.guild, 'StickerDelete Protection Triggered', 
                `**Perpetrator:** <@${executor.id}> (${executor.username})\n` +
                `**Target Sticker:** \`${sticker.name}\`\n` +
                `**Mitigation Action:** ${punishment}\n` +
                `**Reversion:** perpetrator neutralized. Deleted sticker cannot be automatically recovered because the raw asset is lost.`
            );
        } catch (error) {
            logger.error('Error in handleStickerDelete anti-nuke:', error);
        }
    }

    async handleGuildUpdate(oldGuild: any, newGuild: any) {
        try {
            const config = await antiNukeSettings.get(newGuild.id);
            if (!config.enabled || !config.anti_guild_update) return;
            
            const auditLogs = await newGuild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.GuildUpdate }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry) return;
            
            const now = Date.now();
            if (now - entry.createdTimestamp > 10000) return;
            
            const executor = entry.executor;
            if (!executor) return;
            
            const whitelisted = await isWhitelisted(newGuild, executor.id);
            if (whitelisted) {
                await sendAlert(newGuild, 'Exemption Triggered', `Bot/User <@${executor.id}> updated server settings but is whitelisted/exempt.`);
                return;
            }
            
            const count = getAndIncrementActionCount(newGuild.id, executor.id);
            const isNuke = count > 1;
            const punishment = await punishPerpetrator(newGuild, executor.id, isNuke, 'Unauthorized server settings update');
            
            // Revert action (restore server settings)
            await newGuild.edit({
                name: oldGuild.name,
                icon: oldGuild.icon,
                splash: oldGuild.splash,
                banner: oldGuild.banner,
                description: oldGuild.description,
                verificationLevel: oldGuild.verificationLevel,
                defaultMessageNotifications: oldGuild.defaultMessageNotifications,
                explicitContentFilter: oldGuild.explicitContentFilter,
                afkChannel: oldGuild.afkChannel,
                afkTimeout: oldGuild.afkTimeout,
                systemChannel: oldGuild.systemChannel,
                rulesChannel: oldGuild.rulesChannel,
                publicUpdatesChannel: oldGuild.publicUpdatesChannel
            }, 'Anti-Nuke Protection: Reverting unauthorized server settings modification').catch(() => {});
            
            await sendAlert(newGuild, 'GuildUpdate Protection Triggered', 
                `**Perpetrator:** <@${executor.id}> (${executor.username})\n` +
                `**Mitigation Action:** ${punishment}\n` +
                `**Reversion:** Server settings modifications have been successfully reverted.`
            );
        } catch (error) {
            logger.error('Error in handleGuildUpdate anti-nuke:', error);
        }
    }
}

export const antiNukeService = new AntiNukeService();
