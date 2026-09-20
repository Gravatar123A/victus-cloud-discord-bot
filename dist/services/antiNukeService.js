import { AuditLogEvent, EmbedBuilder } from 'discord.js';
import { whitelistSettings } from './whitelistSettings.js';
import { antiNukeSettings } from './antiNukeSettings.js';
import { extraOwnerSettings } from './extraOwnerSettings.js';
import { isGrav } from '../utils/securityAuth.js';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
// Track executor actions to determine if they should be kicked or banned
const actionHistory = new Map();
/**
 * Increment and get the action count for a user in a guild within a 15s window.
 */
function getAndIncrementActionCount(guildId, userId) {
    const key = `${guildId}:${userId}`;
    const now = Date.now();
    const history = actionHistory.get(key) || { count: 0, lastReset: now };
    if (now - history.lastReset > 15000) { // 15-second window
        history.count = 1;
        history.lastReset = now;
    }
    else {
        history.count += 1;
    }
    actionHistory.set(key, history);
    return history.count;
}
/**
 * Check if a user/bot is whitelisted or immune to Anti-Nuke triggers.
 * Exemptions:
 * 1. Bot itself
 * 2. Guild Owner
 * 3. Grav (Primary Bot/Server Owner)
 * 4. Extra Owners (Users or Members holding Extra Owner roles)
 * 5. Explicitly whitelisted users
 */
async function isWhitelisted(guild, userId) {
    if (userId === guild.client.user.id)
        return true;
    if (userId === guild.ownerId)
        return true;
    // Check Grav (Primary Owner)
    const user = await guild.client.users.fetch(userId).catch(() => null);
    if (user && await isGrav(user, guild.client, guild))
        return true;
    // Check Extra Owners (User ID or Role Holder)
    const member = await guild.members.fetch(userId).catch(() => null);
    if (user && await extraOwnerSettings.isExtraOwner(guild, user, member))
        return true;
    // Check standard whitelist
    const config = await whitelistSettings.get(guild.id);
    return config.users.some((u) => u.userId === userId);
}
/**
 * Punish the perpetrator by first stripping roles, and then either kicking or banning.
 */
async function punishPerpetrator(guild, executorId, isNukePattern, reason) {
    const member = await guild.members.fetch(executorId).catch(() => null);
    if (!member)
        return 'Perpetrator is no longer in the server';
    if (!member.manageable) {
        return '⚠️ Perpetrator is not manageable (higher role or server owner)';
    }
    // Strip roles first to immediately eliminate elevated permissions
    const manageableRoles = member.roles.cache.filter((role) => role.id !== guild.id &&
        role.managed === false &&
        role.comparePositionTo(guild.members.me.roles.highest) < 0);
    if (manageableRoles.size > 0) {
        await member.roles.remove(manageableRoles, 'Anti-Nuke: Immediate privilege neutralization before punishment').catch(() => { });
    }
    if (isNukePattern) {
        await guild.members.ban(executorId, { reason: `Anti-Nuke Defense: ${reason}` }).catch(() => { });
        return '🔨 **PERPETRATOR BANNED & ROLES STRIPPED** *(Mass/Nuke Pattern Detected)*';
    }
    else {
        await member.kick(`Anti-Nuke Defense: ${reason}`).catch(() => { });
        return '📤 **PERPETRATOR KICKED & ROLES STRIPPED** *(Unauthorized Action)*';
    }
}
/**
 * Send a modern, high-impact cybersecurity audit alert.
 */
async function sendAlert(guild, title, description, isExemption = false) {
    try {
        const settings = await supabase.getBotSettings(guild.id).catch(() => null);
        const logChannelId = settings?.moderation_log_channel_id || settings?.log_channel_id;
        const channel = logChannelId ? guild.channels.cache.get(logChannelId) : null;
        const targetChannel = (channel && channel.isTextBased()) ? channel : guild.systemChannel;
        const isExempt = isExemption || title.toLowerCase().includes('exemption');
        const color = isExempt ? 0x00d2ff : 0xef4444;
        const iconEmoji = isExempt ? '🛡️' : '🚨';
        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`${iconEmoji} VICTUS ANTI-NUKE • ${title.toUpperCase()}`)
            .setDescription(`${description}\n\n` +
            `-# 🔒 Protected by Victus Cloud Defense Protocol • Authorized by Grav & Extra Owners`)
            .setFooter({ text: 'Victus Cloud Advanced Security System', iconURL: 'https://victuscloud.com/favicon.png' })
            .setTimestamp();
        if (targetChannel && 'send' in targetChannel) {
            await targetChannel.send({ embeds: [embed] }).catch(() => { });
        }
    }
    catch (error) {
        logger.error('Failed to send Anti-Nuke alert:', error);
    }
}
export class AntiNukeService {
    async handleMemberRemove(member) {
        try {
            const config = await antiNukeSettings.get(member.guild.id);
            if (!config.enabled || !config.anti_kick)
                return;
            const auditLogs = await member.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry)
                return;
            const now = Date.now();
            if (entry.targetId !== member.id || now - entry.createdTimestamp > 10000)
                return;
            const executor = entry.executor;
            if (!executor)
                return;
            const whitelisted = await isWhitelisted(member.guild, executor.id);
            if (whitelisted) {
                await sendAlert(member.guild, 'Exemption Verified', `### 🛡️ Authorized Action Permitted\n\n` +
                    `> **Security Module:** 👢 \`ANTI-KICK SHIELD\`\n` +
                    `> **Authorized Actor:** <@${executor.id}> (\`${executor.username}\`)\n` +
                    `> **Exemption Tier:** 👑 Grav / Extra Owner / Whitelist\n` +
                    `> **Action:** Kicked member <@${member.id}> without penalty.`, true);
                return;
            }
            const count = getAndIncrementActionCount(member.guild.id, executor.id);
            const isNuke = count > 1;
            const punishment = await punishPerpetrator(member.guild, executor.id, isNuke, `Unauthorized kick of <@${member.id}>`);
            await sendAlert(member.guild, 'Kick Protection Triggered', `### 🚨 Unauthorized Member Kick Intercepted\n\n` +
                `> **Security Module:** 👢 \`ANTI-KICK SHIELD\`\n` +
                `> **Perpetrator:** <@${executor.id}> (\`${executor.username}\` · \`${executor.id}\`)\n` +
                `> **Target Victim:** <@${member.id}> (\`${member.user.username}\`)\n` +
                `> **Mitigation Action:** ${punishment}\n` +
                `> **Status:** 🛡️ Server protected immediately.`);
        }
        catch (error) {
            logger.error('Error in handleMemberRemove anti-nuke:', error);
        }
    }
    async handleBanAdd(ban) {
        try {
            const config = await antiNukeSettings.get(ban.guild.id);
            if (!config.enabled || !config.anti_ban)
                return;
            const auditLogs = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry)
                return;
            const now = Date.now();
            if (entry.targetId !== ban.user.id || now - entry.createdTimestamp > 10000)
                return;
            const executor = entry.executor;
            if (!executor)
                return;
            const whitelisted = await isWhitelisted(ban.guild, executor.id);
            if (whitelisted) {
                await sendAlert(ban.guild, 'Exemption Verified', `### 🛡️ Authorized Action Permitted\n\n` +
                    `> **Security Module:** 🔨 \`ANTI-BAN SHIELD\`\n` +
                    `> **Authorized Actor:** <@${executor.id}> (\`${executor.username}\`)\n` +
                    `> **Exemption Tier:** 👑 Grav / Extra Owner / Whitelist\n` +
                    `> **Action:** Banned user <@${ban.user.id}> without penalty.`, true);
                return;
            }
            const count = getAndIncrementActionCount(ban.guild.id, executor.id);
            const isNuke = count > 1;
            const punishment = await punishPerpetrator(ban.guild, executor.id, isNuke, `Unauthorized ban of <@${ban.user.id}>`);
            // Revert action (unban target)
            await ban.guild.members.unban(ban.user.id, 'Anti-Nuke Protection: Reversing unauthorized ban').catch(() => { });
            await sendAlert(ban.guild, 'Ban Protection Triggered', `### 🚨 Unauthorized Member Ban Intercepted\n\n` +
                `> **Security Module:** 🔨 \`ANTI-BAN SHIELD\`\n` +
                `> **Perpetrator:** <@${executor.id}> (\`${executor.username}\` · \`${executor.id}\`)\n` +
                `> **Target Victim:** <@${ban.user.id}> (\`${ban.user.username}\`)\n` +
                `> **Mitigation Action:** ${punishment}\n` +
                `> **Automated Reversion:** 🔄 Target has been automatically unbanned.`);
        }
        catch (error) {
            logger.error('Error in handleBanAdd anti-nuke:', error);
        }
    }
    async handleBanRemove(ban) {
        try {
            const config = await antiNukeSettings.get(ban.guild.id);
            if (!config.enabled || !config.anti_ban_remove)
                return;
            const auditLogs = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanRemove }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry)
                return;
            const now = Date.now();
            if (entry.targetId !== ban.user.id || now - entry.createdTimestamp > 10000)
                return;
            const executor = entry.executor;
            if (!executor)
                return;
            const whitelisted = await isWhitelisted(ban.guild, executor.id);
            if (whitelisted) {
                await sendAlert(ban.guild, 'Exemption Verified', `### 🛡️ Authorized Action Permitted\n\n` +
                    `> **Security Module:** 🔓 \`ANTI-BAN-REMOVE SHIELD\`\n` +
                    `> **Authorized Actor:** <@${executor.id}> (\`${executor.username}\`)\n` +
                    `> **Exemption Tier:** 👑 Grav / Extra Owner / Whitelist\n` +
                    `> **Action:** Unbanned user <@${ban.user.id}> without penalty.`, true);
                return;
            }
            const count = getAndIncrementActionCount(ban.guild.id, executor.id);
            const isNuke = count > 1;
            const punishment = await punishPerpetrator(ban.guild, executor.id, isNuke, `Unauthorized unban of <@${ban.user.id}>`);
            // Revert action (re-ban target)
            await ban.guild.members.ban(ban.user.id, { reason: 'Anti-Nuke Protection: Reversing unauthorized unban' }).catch(() => { });
            await sendAlert(ban.guild, 'Ban-Remove Protection Triggered', `### 🚨 Unauthorized Member Unban Intercepted\n\n` +
                `> **Security Module:** 🔓 \`ANTI-BAN-REMOVE SHIELD\`\n` +
                `> **Perpetrator:** <@${executor.id}> (\`${executor.username}\` · \`${executor.id}\`)\n` +
                `> **Target Member:** <@${ban.user.id}> (\`${ban.user.username}\`)\n` +
                `> **Mitigation Action:** ${punishment}\n` +
                `> **Automated Reversion:** 🔄 Target has been re-banned immediately.`);
        }
        catch (error) {
            logger.error('Error in handleBanRemove anti-nuke:', error);
        }
    }
    async handleChannelCreate(channel) {
        try {
            if (!channel.guild)
                return;
            const config = await antiNukeSettings.get(channel.guild.id);
            if (!config.enabled || !config.anti_channel_create)
                return;
            const auditLogs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelCreate }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry)
                return;
            const now = Date.now();
            if (entry.targetId !== channel.id || now - entry.createdTimestamp > 10000)
                return;
            const executor = entry.executor;
            if (!executor)
                return;
            const whitelisted = await isWhitelisted(channel.guild, executor.id);
            if (whitelisted) {
                await sendAlert(channel.guild, 'Exemption Verified', `### 🛡️ Authorized Action Permitted\n\n` +
                    `> **Security Module:** ➕ \`ANTI-CHANNEL-CREATE SHIELD\`\n` +
                    `> **Authorized Actor:** <@${executor.id}> (\`${executor.username}\`)\n` +
                    `> **Exemption Tier:** 👑 Grav / Extra Owner / Whitelist\n` +
                    `> **Action:** Created channel \`${channel.name}\` without penalty.`, true);
                return;
            }
            const count = getAndIncrementActionCount(channel.guild.id, executor.id);
            const isNuke = count > 1;
            const punishment = await punishPerpetrator(channel.guild, executor.id, isNuke, `Unauthorized channel creation: \`${channel.name}\``);
            // Revert action (delete unauthorized channel)
            await channel.delete('Anti-Nuke Protection: Deleting unauthorized channel').catch(() => { });
            await sendAlert(channel.guild, 'Channel-Create Protection Triggered', `### 🚨 Unauthorized Channel Creation Intercepted\n\n` +
                `> **Security Module:** ➕ \`ANTI-CHANNEL-CREATE SHIELD\`\n` +
                `> **Perpetrator:** <@${executor.id}> (\`${executor.username}\` · \`${executor.id}\`)\n` +
                `> **Created Channel:** \`${channel.name}\` (\`${channel.id}\`)\n` +
                `> **Mitigation Action:** ${punishment}\n` +
                `> **Automated Reversion:** 🔄 Unauthorized channel deleted immediately.`);
        }
        catch (error) {
            logger.error('Error in handleChannelCreate anti-nuke:', error);
        }
    }
    async handleChannelDelete(channel) {
        try {
            if (!channel.guild)
                return;
            const config = await antiNukeSettings.get(channel.guild.id);
            if (!config.enabled || !config.anti_channel_delete)
                return;
            const auditLogs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry)
                return;
            const now = Date.now();
            if (entry.targetId !== channel.id || now - entry.createdTimestamp > 10000)
                return;
            const executor = entry.executor;
            if (!executor)
                return;
            const whitelisted = await isWhitelisted(channel.guild, executor.id);
            if (whitelisted) {
                await sendAlert(channel.guild, 'Exemption Verified', `### 🛡️ Authorized Action Permitted\n\n` +
                    `> **Security Module:** ❌ \`ANTI-CHANNEL-DELETE SHIELD\`\n` +
                    `> **Authorized Actor:** <@${executor.id}> (\`${executor.username}\`)\n` +
                    `> **Exemption Tier:** 👑 Grav / Extra Owner / Whitelist\n` +
                    `> **Action:** Deleted channel \`${channel.name}\` without penalty.`, true);
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
                permissionOverwrites: channel.permissionOverwrites.cache.map((p) => ({
                    id: p.id,
                    type: p.type,
                    allow: p.allow.toArray(),
                    deny: p.deny.toArray(),
                })),
            }).catch(() => null);
            await sendAlert(channel.guild, 'Channel-Delete Protection Triggered', `### 🚨 Unauthorized Channel Deletion Intercepted\n\n` +
                `> **Security Module:** ❌ \`ANTI-CHANNEL-DELETE SHIELD\`\n` +
                `> **Perpetrator:** <@${executor.id}> (\`${executor.username}\` · \`${executor.id}\`)\n` +
                `> **Deleted Channel:** \`${channel.name}\`\n` +
                `> **Mitigation Action:** ${punishment}\n` +
                `> **Automated Reversion:** 🔄 Deleted channel recreated successfully ${restoredChannel ? `<#${restoredChannel.id}>` : '(Recreation failed due to permissions)'}.`);
        }
        catch (error) {
            logger.error('Error in handleChannelDelete anti-nuke:', error);
        }
    }
    async handleRoleCreate(role) {
        try {
            const config = await antiNukeSettings.get(role.guild.id);
            if (!config.enabled || !config.anti_role_create)
                return;
            const auditLogs = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleCreate }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry)
                return;
            const now = Date.now();
            if (entry.targetId !== role.id || now - entry.createdTimestamp > 10000)
                return;
            const executor = entry.executor;
            if (!executor)
                return;
            const whitelisted = await isWhitelisted(role.guild, executor.id);
            if (whitelisted) {
                await sendAlert(role.guild, 'Exemption Verified', `### 🛡️ Authorized Action Permitted\n\n` +
                    `> **Security Module:** 🎭 \`ANTI-ROLE-CREATE SHIELD\`\n` +
                    `> **Authorized Actor:** <@${executor.id}> (\`${executor.username}\`)\n` +
                    `> **Exemption Tier:** 👑 Grav / Extra Owner / Whitelist\n` +
                    `> **Action:** Created role \`${role.name}\` without penalty.`, true);
                return;
            }
            const count = getAndIncrementActionCount(role.guild.id, executor.id);
            const isNuke = count > 1;
            const punishment = await punishPerpetrator(role.guild, executor.id, isNuke, `Unauthorized role creation: \`${role.name}\``);
            // Revert action (delete role)
            await role.delete('Anti-Nuke Protection: Deleting unauthorized role').catch(() => { });
            await sendAlert(role.guild, 'Role-Create Protection Triggered', `### 🚨 Unauthorized Role Creation Intercepted\n\n` +
                `> **Security Module:** 🎭 \`ANTI-ROLE-CREATE SHIELD\`\n` +
                `> **Perpetrator:** <@${executor.id}> (\`${executor.username}\` · \`${executor.id}\`)\n` +
                `> **Created Role:** \`${role.name}\` (\`${role.id}\`)\n` +
                `> **Mitigation Action:** ${punishment}\n` +
                `> **Automated Reversion:** 🔄 Unauthorized role deleted immediately.`);
        }
        catch (error) {
            logger.error('Error in handleRoleCreate anti-nuke:', error);
        }
    }
    async handleRoleDelete(role) {
        try {
            const config = await antiNukeSettings.get(role.guild.id);
            if (!config.enabled || !config.anti_role_delete)
                return;
            const auditLogs = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry)
                return;
            const now = Date.now();
            if (entry.targetId !== role.id || now - entry.createdTimestamp > 10000)
                return;
            const executor = entry.executor;
            if (!executor)
                return;
            const whitelisted = await isWhitelisted(role.guild, executor.id);
            if (whitelisted) {
                await sendAlert(role.guild, 'Exemption Verified', `### 🛡️ Authorized Action Permitted\n\n` +
                    `> **Security Module:** 🗑️ \`ANTI-ROLE-DELETE SHIELD\`\n` +
                    `> **Authorized Actor:** <@${executor.id}> (\`${executor.username}\`)\n` +
                    `> **Exemption Tier:** 👑 Grav / Extra Owner / Whitelist\n` +
                    `> **Action:** Deleted role \`${role.name}\` without penalty.`, true);
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
                permissions: role.permissions,
            }).catch(() => null);
            await sendAlert(role.guild, 'Role-Delete Protection Triggered', `### 🚨 Unauthorized Role Deletion Intercepted\n\n` +
                `> **Security Module:** 🗑️ \`ANTI-ROLE-DELETE SHIELD\`\n` +
                `> **Perpetrator:** <@${executor.id}> (\`${executor.username}\` · \`${executor.id}\`)\n` +
                `> **Deleted Role:** \`${role.name}\`\n` +
                `> **Mitigation Action:** ${punishment}\n` +
                `> **Automated Reversion:** 🔄 Deleted role recreated successfully ${restoredRole ? `<@&${restoredRole.id}>` : '(Recreation failed due to permissions)'}.`);
        }
        catch (error) {
            logger.error('Error in handleRoleDelete anti-nuke:', error);
        }
    }
    async handleRoleUpdate(oldRole, newRole) {
        try {
            const config = await antiNukeSettings.get(newRole.guild.id);
            if (!config.enabled || !config.anti_role_update)
                return;
            const auditLogs = await newRole.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleUpdate }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry)
                return;
            const now = Date.now();
            if (entry.targetId !== newRole.id || now - entry.createdTimestamp > 10000)
                return;
            const executor = entry.executor;
            if (!executor)
                return;
            const whitelisted = await isWhitelisted(newRole.guild, executor.id);
            if (whitelisted) {
                await sendAlert(newRole.guild, 'Exemption Verified', `### 🛡️ Authorized Action Permitted\n\n` +
                    `> **Security Module:** 📝 \`ANTI-ROLE-UPDATE SHIELD\`\n` +
                    `> **Authorized Actor:** <@${executor.id}> (\`${executor.username}\`)\n` +
                    `> **Exemption Tier:** 👑 Grav / Extra Owner / Whitelist\n` +
                    `> **Action:** Modified role \`${newRole.name}\` without penalty.`, true);
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
                permissions: oldRole.permissions,
            }, 'Anti-Nuke Protection: Reverting unauthorized role modification').catch(() => { });
            await sendAlert(newRole.guild, 'Role-Update Protection Triggered', `### 🚨 Unauthorized Dangerous Role Update Intercepted\n\n` +
                `> **Security Module:** 📝 \`ANTI-ROLE-UPDATE SHIELD\`\n` +
                `> **Perpetrator:** <@${executor.id}> (\`${executor.username}\` · \`${executor.id}\`)\n` +
                `> **Target Role:** \`${newRole.name}\` (<@&${newRole.id}>)\n` +
                `> **Mitigation Action:** ${punishment}\n` +
                `> **Automated Reversion:** 🔄 Role modifications have been successfully reverted.`);
        }
        catch (error) {
            logger.error('Error in handleRoleUpdate anti-nuke:', error);
        }
    }
    async handleEmojiDelete(emoji) {
        try {
            const config = await antiNukeSettings.get(emoji.guild.id);
            if (!config.enabled || !config.anti_emoji_delete)
                return;
            const auditLogs = await emoji.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.EmojiDelete }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry)
                return;
            const now = Date.now();
            if (entry.targetId !== emoji.id || now - entry.createdTimestamp > 10000)
                return;
            const executor = entry.executor;
            if (!executor)
                return;
            const whitelisted = await isWhitelisted(emoji.guild, executor.id);
            if (whitelisted) {
                await sendAlert(emoji.guild, 'Exemption Verified', `### 🛡️ Authorized Action Permitted\n\n` +
                    `> **Security Module:** 😀 \`ANTI-EMOJI-DELETE SHIELD\`\n` +
                    `> **Authorized Actor:** <@${executor.id}> (\`${executor.username}\`)\n` +
                    `> **Exemption Tier:** 👑 Grav / Extra Owner / Whitelist\n` +
                    `> **Action:** Deleted emoji \`${emoji.name}\` without penalty.`, true);
                return;
            }
            const count = getAndIncrementActionCount(emoji.guild.id, executor.id);
            const isNuke = count > 1;
            const punishment = await punishPerpetrator(emoji.guild, executor.id, isNuke, `Unauthorized emoji deletion: \`${emoji.name}\``);
            await sendAlert(emoji.guild, 'Emoji-Delete Protection Triggered', `### 🚨 Unauthorized Emoji Deletion Intercepted\n\n` +
                `> **Security Module:** 😀 \`ANTI-EMOJI-DELETE SHIELD\`\n` +
                `> **Perpetrator:** <@${executor.id}> (\`${executor.username}\` · \`${executor.id}\`)\n` +
                `> **Target Emoji:** \`${emoji.name}\`\n` +
                `> **Mitigation Action:** ${punishment}\n` +
                `> **Status:** ⚠️ Perpetrator neutralized. (Emoji asset deleted from Discord CDN).`);
        }
        catch (error) {
            logger.error('Error in handleEmojiDelete anti-nuke:', error);
        }
    }
    async handleStickerDelete(sticker) {
        try {
            const config = await antiNukeSettings.get(sticker.guild.id);
            if (!config.enabled || !config.anti_sticker_delete)
                return;
            const auditLogs = await sticker.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.StickerDelete }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry)
                return;
            const now = Date.now();
            if (entry.targetId !== sticker.id || now - entry.createdTimestamp > 10000)
                return;
            const executor = entry.executor;
            if (!executor)
                return;
            const whitelisted = await isWhitelisted(sticker.guild, executor.id);
            if (whitelisted) {
                await sendAlert(sticker.guild, 'Exemption Verified', `### 🛡️ Authorized Action Permitted\n\n` +
                    `> **Security Module:** 🏷️ \`ANTI-STICKER-DELETE SHIELD\`\n` +
                    `> **Authorized Actor:** <@${executor.id}> (\`${executor.username}\`)\n` +
                    `> **Exemption Tier:** 👑 Grav / Extra Owner / Whitelist\n` +
                    `> **Action:** Deleted sticker \`${sticker.name}\` without penalty.`, true);
                return;
            }
            const count = getAndIncrementActionCount(sticker.guild.id, executor.id);
            const isNuke = count > 1;
            const punishment = await punishPerpetrator(sticker.guild, executor.id, isNuke, `Unauthorized sticker deletion: \`${sticker.name}\``);
            await sendAlert(sticker.guild, 'Sticker-Delete Protection Triggered', `### 🚨 Unauthorized Sticker Deletion Intercepted\n\n` +
                `> **Security Module:** 🏷️ \`ANTI-STICKER-DELETE SHIELD\`\n` +
                `> **Perpetrator:** <@${executor.id}> (\`${executor.username}\` · \`${executor.id}\`)\n` +
                `> **Target Sticker:** \`${sticker.name}\`\n` +
                `> **Mitigation Action:** ${punishment}\n` +
                `> **Status:** ⚠️ Perpetrator neutralized. (Sticker asset deleted from Discord CDN).`);
        }
        catch (error) {
            logger.error('Error in handleStickerDelete anti-nuke:', error);
        }
    }
    async handleGuildUpdate(oldGuild, newGuild) {
        try {
            const config = await antiNukeSettings.get(newGuild.id);
            if (!config.enabled || !config.anti_guild_update)
                return;
            const auditLogs = await newGuild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.GuildUpdate }).catch(() => null);
            const entry = auditLogs?.entries.first();
            if (!entry)
                return;
            const now = Date.now();
            if (now - entry.createdTimestamp > 10000)
                return;
            const executor = entry.executor;
            if (!executor)
                return;
            const whitelisted = await isWhitelisted(newGuild, executor.id);
            if (whitelisted) {
                await sendAlert(newGuild, 'Exemption Verified', `### 🛡️ Authorized Action Permitted\n\n` +
                    `> **Security Module:** 🌐 \`ANTI-GUILD-UPDATE SHIELD\`\n` +
                    `> **Authorized Actor:** <@${executor.id}> (\`${executor.username}\`)\n` +
                    `> **Exemption Tier:** 👑 Grav / Extra Owner / Whitelist\n` +
                    `> **Action:** Updated server settings without penalty.`, true);
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
                publicUpdatesChannel: oldGuild.publicUpdatesChannel,
            }, 'Anti-Nuke Protection: Reverting unauthorized server settings modification').catch(() => { });
            await sendAlert(newGuild, 'Guild-Update Protection Triggered', `### 🚨 Unauthorized Server Configuration Modification Intercepted\n\n` +
                `> **Security Module:** 🌐 \`ANTI-GUILD-UPDATE SHIELD\`\n` +
                `> **Perpetrator:** <@${executor.id}> (\`${executor.username}\` · \`${executor.id}\`)\n` +
                `> **Mitigation Action:** ${punishment}\n` +
                `> **Automated Reversion:** 🔄 Server settings modifications have been successfully reverted.`);
        }
        catch (error) {
            logger.error('Error in handleGuildUpdate anti-nuke:', error);
        }
    }
}
export const antiNukeService = new AntiNukeService();
