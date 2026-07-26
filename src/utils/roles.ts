import { Client, GuildMember, Role } from 'discord.js';
import { config } from '../config.js';
import { logger } from './logger.js';
import { supabase } from '../services/supabase.js';
import { calculateLevel, getTierForLevel } from './vccrs.js';

export const RANK_ROLE_IDS: Record<string, string> = {
    Initiate: '1528247575231074485',
    Vanguard: '1528247645481467964',
    Stormborn: '1528247776217927731',
    Celestial: '1528247862247559268',
    Titan: '1528248002823585843',
    Aethel: '1528248074307244133',
};

const ALL_RANK_ROLE_IDS = Object.values(RANK_ROLE_IDS);

/** Keep exactly the rank role represented by the member's shared Victus XP. */
export async function syncRankRole(client: Client, discordId: string, level: number): Promise<boolean> {
    const guildId = config.bot.supportGuildId;
    if (!guildId) {
        logger.warn('Cannot sync rank role: DISCORD_SUPPORT_GUILD_ID is not configured');
        return false;
    }
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    const member = guild ? await guild.members.fetch(discordId).catch(() => null) : null;
    if (!member) return false;

    const tier = getTierForLevel(level);
    const desired = RANK_ROLE_IDS[tier.name];
    const removable = ALL_RANK_ROLE_IDS.filter((id) => id !== desired && member.roles.cache.has(id));
    if (removable.length) await member.roles.remove(removable, 'Victus rank synchronization');
    if (!member.roles.cache.has(desired)) await member.roles.add(desired, `Victus rank: ${tier.name}`);
    return true;
}

export async function syncAllRankRoles(client: Client): Promise<void> {
    const accounts = await supabase.getAllLinkedAccounts();
    let synced = 0;
    for (const account of accounts) {
        const profile = await supabase.getUserProfile(account.user_id).catch(() => null);
        if (!profile) continue;
        const level = calculateLevel(Number(profile.total_xp ?? 0));
        if (await syncRankRole(client, account.discord_id, level).catch(() => false)) synced++;
    }
    logger.info(`✅ Rank role sync complete: ${synced}/${accounts.length} linked users`);
}

/**
 * Get bot configuration for a guild (DB with env fallback)
 */
async function getBotConfig(client: Client, discordId: string) {
    // Try to find which guild the user is in to get the settings
    // For now, we assume the support server from config or the first guild the bot is in
    let supportGuildId = config.bot.supportGuildId;
    let linkedRoleId = config.bot.linkedRoleId;

    // Fetch from DB if possible
    if (supportGuildId) {
        const settings = await supabase.getBotSettings(supportGuildId);
        if (settings?.linked_role_id) {
            linkedRoleId = settings.linked_role_id;
        }
    }

    return { supportGuildId, linkedRoleId };
}

/**
 * Assign the "Linked" role to a user in the support server
 */
export async function assignLinkedRole(client: Client, discordId: string): Promise<boolean> {
    const { supportGuildId, linkedRoleId } = await getBotConfig(client, discordId);

    if (!supportGuildId) {
        logger.warn('Support guild ID not configured (DISCORD_SUPPORT_GUILD_ID missing)');
        return false;
    }

    if (!linkedRoleId) {
        logger.debug('Linked role ID not configured, skipping role assignment');
        return false;
    }

    try {
        const guild = await client.guilds.fetch(supportGuildId).catch(() => null);
        if (!guild) {
            logger.warn(`Support guild ${supportGuildId} not found or bot not in it`);
            return false;
        }

        const member = await guild.members.fetch(discordId).catch(() => null);
        if (!member) {
            logger.debug(`User ${discordId} not in support server ${guild.name}, cannot assign role`);
            return false;
        }

        if (member.roles.cache.has(linkedRoleId)) {
            logger.debug(`User ${discordId} already has linked role in ${guild.name}`);
            return true;
        }

        await member.roles.add(linkedRoleId, 'Victus Cloud account linked');
        logger.info(`✅ Assigned linked role to ${member.user.tag} in ${guild.name}`);
        return true;
    } catch (error) {
        logger.error(`❌ Failed to assign linked role to ${discordId}:`, error);
        return false;
    }
}

/**
 * Remove the "Linked" role from a user
 */
export async function removeLinkedRole(client: Client, discordId: string): Promise<boolean> {
    const { supportGuildId, linkedRoleId } = await getBotConfig(client, discordId);

    if (!linkedRoleId || !supportGuildId) {
        return false;
    }

    try {
        const guild = await client.guilds.fetch(supportGuildId).catch(() => null);
        if (!guild) return false;

        const member = await guild.members.fetch(discordId).catch(() => null);
        if (!member) return false;

        if (!member.roles.cache.has(linkedRoleId)) {
            return true;
        }

        await member.roles.remove(linkedRoleId, 'Victus Cloud account unlinked');
        logger.info(`🔓 Removed linked role from ${member.user.tag} in ${guild.name}`);
        return true;
    } catch (error) {
        logger.error(`Failed to remove linked role from ${discordId}:`, error);
        return false;
    }
}

/**
 * Sync all linked accounts with their roles on bot startup
 */
export async function syncLinkedRoles(client: Client): Promise<void> {
    try {
        const linkedAccounts = await supabase.getAllLinkedAccounts();
        logger.info(`🔄 Syncing roles for ${linkedAccounts.length} linked users...`);

        let synced = 0;
        for (const account of linkedAccounts) {
            const success = await assignLinkedRole(client, account.discord_id);
            if (success) synced++;
        }

        logger.info(`✅ Role sync complete: ${synced}/${linkedAccounts.length} users synced`);
    } catch (error) {
        logger.error('Failed to sync linked roles:', error);
    }
}
