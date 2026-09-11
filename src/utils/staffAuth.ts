import { Client, GuildMember, PermissionFlagsBits, User } from 'discord.js';
import { config } from '../config.js';
import { supabase } from '../services/supabase.js';
import { logger } from './logger.js';

export interface StaffAuthResult {
    authorized: boolean;
    tierName?: string;
    isSuperOwner?: boolean;
}

/**
 * Robust verification for administrative and infrastructure-controlling bot commands.
 * 
 * SECURITY GUARANTEE:
 * External Discord server owners or administrators inviting this bot to their servers
 * will NEVER receive access to Victus Cloud infrastructure commands (e.g. /staffai, /admin, /deploy).
 * Authorization is strictly anchored to:
 * 1. Discord Application Owner / Dev Team
 * 2. Official Victus Cloud Support Guild Owner
 * 3. Official Support Guild Administrators
 * 4. Verified Victus Platform Administrators in Supabase (linked account)
 * 5. Official Support Guild Staff Roles / Antigravity Roles
 */
export async function verifyStaffOrAdmin(user: User, client: Client): Promise<StaffAuthResult> {
    const userId = user.id;

    // 1. Check Discord Application Owner / Developer Team (Super Owner)
    try {
        const app = client.application;
        const application = typeof app?.fetch === 'function' ? await app.fetch().catch(() => app) : app;
        const owner = application?.owner || app?.owner;
        if (owner) {
            if ('id' in owner && owner.id === userId) {
                return { authorized: true, tierName: '👑 Super Owner (Application Owner)', isSuperOwner: true };
            }
            if ('members' in (owner as any)) {
                const teamMembers = (owner as any).members;
                if (teamMembers?.has?.(userId)) {
                    return { authorized: true, tierName: '👑 Super Owner (Dev Team)', isSuperOwner: true };
                }
            }
        }
    } catch (err) {
        logger.debug('[StaffAuth] Application owner fetch note:', err);
    }

    // 2. Evaluate permissions strictly inside the official Victus Cloud Support Guild
    const supportGuildId = config.bot.supportGuildId || config.discord.guildId;
    if (supportGuildId) {
        try {
            const supportGuild = await client.guilds.fetch(supportGuildId).catch(() => null);
            if (supportGuild) {
                // Official Support Guild Owner
                if (supportGuild.ownerId === userId) {
                    return { authorized: true, tierName: '👑 Super Owner (Support Guild Owner)', isSuperOwner: true };
                }

                // Member in the official support guild
                const supportMember = await supportGuild.members.fetch(userId).catch(() => null);
                if (supportMember) {
                    // Support Guild Administrator
                    if (supportMember.permissions.has(PermissionFlagsBits.Administrator)) {
                        return { authorized: true, tierName: '🛡️ Support Administrator' };
                    }

                    // Official bot settings staff roles
                    const settings = await supabase.getBotSettings(supportGuild.id).catch(() => null);
                    const adminRoleIds = (settings?.ticket_admin_role_ids || []) as string[];
                    const staffRoleIds = (settings?.ticket_staff_role_ids || []) as string[];
                    const antigravityStaffRoles = config.antigravity.staffRoleIds || [];

                    if (adminRoleIds.some((rId) => supportMember.roles.cache.has(rId))) {
                        return { authorized: true, tierName: '🛡️ Platform Admin Role' };
                    }

                    const combinedStaffRoles = [...staffRoleIds, ...antigravityStaffRoles];
                    if (combinedStaffRoles.some((rId) => supportMember.roles.cache.has(rId))) {
                        return { authorized: true, tierName: '⚡ Platform Staff Role' };
                    }
                }
            }
        } catch (guildErr) {
            logger.debug('[StaffAuth] Support guild member check note:', guildErr);
        }
    }

    // 3. Supabase Platform Admin check (via linked account or direct user ID)
    try {
        let isPlatformAdmin = await supabase.isUserAdmin(userId).catch(() => false);
        if (!isPlatformAdmin) {
            const linked = await supabase.getLinkedAccount(userId).catch(() => null);
            if (linked?.user_id) {
                isPlatformAdmin = await supabase.isUserAdmin(linked.user_id).catch(() => false);
            }
        }

        if (isPlatformAdmin) {
            return { authorized: true, tierName: '🛡️ Verified Victus Platform Admin' };
        }
    } catch (dbErr) {
        logger.debug('[StaffAuth] Supabase admin check note:', dbErr);
    }

    // Explicit denial: External guild owners or external administrators have NO access!
    return { authorized: false };
}

/**
 * Convenience helper returning boolean
 */
export async function isVictusStaffOrAdmin(user: User, client: Client): Promise<boolean> {
    const res = await verifyStaffOrAdmin(user, client);
    return res.authorized;
}
