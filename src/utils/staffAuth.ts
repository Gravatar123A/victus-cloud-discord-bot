import type { Client, User } from 'discord.js';
import { config } from '../config.js';
import { supabase } from '../services/supabase.js';
import { logger } from './logger.js';

export interface StaffAuthResult {
    authorized: boolean;
    tierName?: string;
    isSuperOwner?: boolean;
}

export const VICTUS_STAFF_ROLE_ID = '1340607428252794973';

/** Only current official staff membership grants platform access. */
export async function verifyStaffOrAdmin(user: User, client: Client): Promise<StaffAuthResult> {
    const guildId = config.bot.supportGuildId;
    if (!guildId || user.bot) return { authorized: false };
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch({ user: user.id, force: true });
        if (!member || member.guild.id !== guildId) return { authorized: false };
        if (guild.ownerId === user.id) {
            return { authorized: true, tierName: 'Official Victus Owner', isSuperOwner: true };
        }
        if ([VICTUS_STAFF_ROLE_ID, ...config.antigravity.staffRoleIds].some(id => id !== guildId && member.roles.cache.has(id))) {
            return { authorized: true, tierName: 'Official Victus Staff' };
        }
        const settings = await supabase.getBotSettings(guildId).catch(() => null);
        const roleIds = [
            VICTUS_STAFF_ROLE_ID,
            ...config.antigravity.staffRoleIds,
            ...(settings?.ticket_staff_role_ids || []),
            ...(settings?.ticket_admin_role_ids || []),
        ];
        if (roleIds.some(id => id !== guildId && member.roles.cache.has(id))) {
            return { authorized: true, tierName: 'Official Victus Staff' };
        }
    } catch {
        logger.warn('[StaffAuth] Could not verify official staff membership; access denied.');
    }
    return { authorized: false };
}

export async function isVictusStaffOrAdmin(user: User, client: Client): Promise<boolean> {
    return (await verifyStaffOrAdmin(user, client)).authorized;
}

export function isVictusStaffComponent(id: string): boolean {
    return ['vpsstats:', 'announce_', 'annc:', 'staffai_', 'victus_res_staff_', 'victus_res_modal_reject:', 'ticket_question_'].some(prefix => id.startsWith(prefix));
}
