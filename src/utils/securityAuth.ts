import { Client, Guild, GuildMember, User } from 'discord.js';
import { extraOwnerSettings } from '../services/extraOwnerSettings.js';
import { config } from '../config.js';
import { logger } from './logger.js';

/**
 * Check if the user is Grav (the Primary Bot/Server Owner).
 * Grav is identified by:
 * 1. Explicit env variables (GRAV_USER_ID or PRIMARY_OWNER_ID)
 * 2. Discord Application Owner or Team Member
 * 3. Official Support Guild Owner
 * 4. Current Server Owner
 */
export async function isGrav(user: User, client: Client, guild?: Guild | null): Promise<boolean> {
    const userId = user.id;

    // 1. Explicit env variable
    if (process.env.GRAV_USER_ID && process.env.GRAV_USER_ID === userId) return true;
    if (process.env.PRIMARY_OWNER_ID && process.env.PRIMARY_OWNER_ID === userId) return true;

    // 2. Discord Application Owner / Developer Team
    try {
        const app = client.application;
        const application = typeof app?.fetch === 'function' ? await app.fetch().catch(() => app) : app;
        const owner = application?.owner || app?.owner;
        if (owner) {
            if ('id' in owner && owner.id === userId) return true;
            if ('members' in (owner as any) && (owner as any).members?.has?.(userId)) return true;
        }
    } catch (err) {
        logger.debug('[SecurityAuth] App owner check note:', err);
    }

    // 3. Official Victus Cloud Support Guild Owner
    const supportGuildId = config.bot.supportGuildId || config.discord.guildId;
    if (supportGuildId) {
        try {
            const supportGuild = await client.guilds.fetch(supportGuildId).catch(() => null);
            if (supportGuild && supportGuild.ownerId === userId) return true;
        } catch (err) {
            logger.debug('[SecurityAuth] Support guild owner check note:', err);
        }
    }

    // 4. Current Guild Owner
    if (guild && guild.ownerId === userId) return true;

    return false;
}

/**
 * Determine if a user is permitted to use /antinuke, /whitelist, and /extraowner commands.
 * Rules:
 * - Grav: Full access, can manage settings and add/remove extra owners.
 * - Extra Owners: Access to /antinuke and /whitelist commands, but CANNOT add/remove other extra owners.
 * - Everyone else (including regular Admins): BLOCKED.
 */
export async function canManageSecurity(
    user: User,
    client: Client,
    guild: Guild,
    member?: GuildMember | null
): Promise<{ authorized: boolean; isGrav: boolean; isExtraOwner: boolean; error?: string }> {
    const isGravOwner = await isGrav(user, client, guild);
    if (isGravOwner) {
        return { authorized: true, isGrav: true, isExtraOwner: false };
    }

    const isExtra = await extraOwnerSettings.isExtraOwner(guild, user, member);
    if (isExtra) {
        return { authorized: true, isGrav: false, isExtraOwner: true };
    }

    return {
        authorized: false,
        isGrav: false,
        isExtraOwner: false,
        error: 'Only Grav (Primary Owner) or designated Extra Owners can manage Anti-Nuke and Whitelist security.',
    };
}
