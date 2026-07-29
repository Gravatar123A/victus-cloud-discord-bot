import type { Client, GuildMember } from 'discord.js';
import { config } from '../config.js';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
import {
    isActiveFreeServer,
    isActivePaidService,
    resolveEntitlementRole,
    type EntitlementRole,
} from './entitlementRules.js';

export { isActiveFreeServer, isActivePaidService, resolveEntitlementRole } from './entitlementRules.js';

type RoleSyncRecord = {
    discordId: string;
    email: string;
};

function record(resource: any): Record<string, any> {
    return { ...(resource || {}), ...(resource?.attributes || {}) };
}

async function applyRole(member: GuildMember, entitlement: EntitlementRole): Promise<boolean> {
    const freeRoleId = config.bot.freeUserRoleId;
    const paidRoleId = config.bot.paidClientRoleId;
    const addRoleId = entitlement === 'paid' ? paidRoleId : entitlement === 'free' ? freeRoleId : null;
    const removeRoleIds = [freeRoleId, paidRoleId].filter((roleId) => roleId !== addRoleId && member.roles.cache.has(roleId));
    let changed = false;

    if (removeRoleIds.length > 0) {
        await member.roles.remove(removeRoleIds, 'Victus Cloud server entitlement changed');
        changed = true;
    }
    if (addRoleId && !member.roles.cache.has(addRoleId)) {
        await member.roles.add(addRoleId, `Victus Cloud ${entitlement} server entitlement`);
        changed = true;
    }
    return changed;
}

function indexUserIdsByEmail(users: any[]): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    for (const resource of users) {
        const user = record(resource);
        const email = String(user.email || '').trim().toLowerCase();
        const id = user.id;
        if (!email || id == null) continue;
        const ids = result.get(email) || new Set<string>();
        ids.add(String(id));
        result.set(email, ids);
    }
    return result;
}

function ownersWithActiveResources(resources: any[], ownerKey: (item: Record<string, any>) => unknown, active: (item: any) => boolean): Set<string> {
    const owners = new Set<string>();
    for (const resource of resources) {
        const item = record(resource);
        const ownerId = ownerKey(item);
        if (ownerId != null && active(resource)) owners.add(String(ownerId));
    }
    return owners;
}

function activePaidServerServiceIds(servers: any[]): Set<string> {
    const serviceIds = new Set<string>();
    for (const resource of servers) {
        const server = record(resource);
        if (String(server.server_type || '').toLowerCase() !== 'free' && server.external_id != null) {
            serviceIds.add(String(server.external_id));
        }
    }
    return serviceIds;
}

async function loadRoleSyncRecords(): Promise<RoleSyncRecord[]> {
    const links = await supabase.getAllLinkedAccounts();
    const profiles = await supabase.getUserProfiles([...new Set(links.map((link) => link.user_id))]);
    const emails = new Map(profiles.map((profile) => [profile.id, profile.email?.trim().toLowerCase()]));
    return links.flatMap((link) => {
        const email = emails.get(link.user_id);
        return email ? [{ discordId: link.discord_id, email }] : [];
    });
}

export async function syncEntitlementRoles(client: Client, discordId?: string): Promise<number> {
    const guildId = config.bot.supportGuildId || config.discord.guildId;
    if (!guildId) {
        logger.warn('Entitlement role sync skipped: DISCORD_SUPPORT_GUILD_ID is not configured');
        return 0;
    }

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
        logger.warn(`Entitlement role sync skipped: guild ${guildId} is unavailable`);
        return 0;
    }

    const [records, panelUsers, panelServers, billingUsers, billingServices] = await Promise.all([
        loadRoleSyncRecords(),
        supabase.getPterodactylUsers(),
        supabase.getServers(),
        supabase.getBillingUsers(),
        supabase.getPaymenterServices(),
    ]);

    const panelIdsByEmail = indexUserIdsByEmail(panelUsers);
    const billingIdsByEmail = indexUserIdsByEmail(billingUsers);
    const paidServerServiceIds = activePaidServerServiceIds(panelServers);
    const activeFreeOwners = ownersWithActiveResources(
        panelServers,
        (server) => server.user ?? server.owner_id ?? server.user_id,
        isActiveFreeServer
    );
    const activePaidOwners = ownersWithActiveResources(
        billingServices,
        (service) => service.user_id ?? service.client_id ?? service.user?.id,
        (service) => {
            const billingService = record(service);
            return paidServerServiceIds.has(String(billingService.id)) && isActivePaidService(service);
        }
    );

    const linkedDiscordIds = new Set(records.map((item) => item.discordId));
    const guildMembers = await guild.members.fetch();
    let changed = 0;
    for (const member of guildMembers.values()) {
        const hasManagedRole = member.roles.cache.has(config.bot.freeUserRoleId)
            || member.roles.cache.has(config.bot.paidClientRoleId);
        if (hasManagedRole && !linkedDiscordIds.has(member.id) && await applyRole(member, 'none')) changed++;
    }

    for (const linked of records.filter((item) => !discordId || item.discordId === discordId)) {
        const member = guildMembers.get(linked.discordId);
        if (!member) continue;

        const hasPaid = [...(billingIdsByEmail.get(linked.email) || [])].some((id) => activePaidOwners.has(id));
        const hasFree = [...(panelIdsByEmail.get(linked.email) || [])].some((id) => activeFreeOwners.has(id));
        if (await applyRole(member, resolveEntitlementRole(hasPaid, hasFree))) changed++;
    }

    logger.info(`Victus entitlement role sync complete: ${changed} member(s) updated`);
    return changed;
}

export async function removeEntitlementRoles(member: GuildMember): Promise<void> {
    const roleIds = [config.bot.freeUserRoleId, config.bot.paidClientRoleId]
        .filter((roleId) => member.roles.cache.has(roleId));
    if (roleIds.length > 0) {
        await member.roles.remove(roleIds, 'Victus Cloud account unlinked');
    }
}