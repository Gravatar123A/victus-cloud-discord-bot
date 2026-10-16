import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
/** A Discord role is deliberately not proof of a currently paid service. */
export function isPremiumSupportCategory(category) {
    return category?.premium_support === true || String(category?.name || '').trim().toLowerCase() === 'premium support';
}
export function customerMayRequestHuman(category) {
    const name = String(category?.name || '').trim().toLowerCase();
    return isPremiumSupportCategory(category) || /^(billing|partnership)(?:\s+tickets?)?$/.test(name);
}
export function isCurrentPaidService(service, now = new Date()) {
    if (String(service?.status || '').toLowerCase() !== 'active')
        return false;
    if (String(service?.plan_type || '').toLowerCase() === 'free')
        return false;
    const price = Number(String(service?.price ?? '').replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(price) || price <= 0)
        return false;
    const name = String(service?.name || '').toLowerCase();
    if (/\bfree\b/.test(name))
        return false;
    const renewalDate = service?.renewsAt || service?.expires_at || service?.due_date;
    if (renewalDate) {
        const due = new Date(renewalDate).getTime();
        if (!Number.isFinite(due) || due <= now.getTime())
            return false;
    }
    return true;
}
async function paymenterGet(path) {
    if (!config.paymenter.url || !config.paymenter.apiKey)
        throw new Error('Paymenter API is not configured');
    const response = await fetch(`${config.paymenter.url.replace(/\/$/, '')}${path}`, {
        headers: { Authorization: `Bearer ${config.paymenter.apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
        throw new Error(`Paymenter returned ${response.status}`);
    return response.json();
}
/** Paymenter's email filter and user detail are authoritative; collection pages are not. */
export async function hasActivePaidServiceForEmail(email) {
    const normalized = email.trim().toLowerCase();
    if (!normalized)
        return false;
    const users = await paymenterGet(`/api/v1/admin/users?filter[email]=${encodeURIComponent(normalized)}&per_page=5`);
    const user = (Array.isArray(users?.data) ? users.data : []).find((item) => String(item?.attributes?.email || item?.email || '').trim().toLowerCase() === normalized);
    if (!user)
        return false;
    const userId = String(user?.attributes?.id ?? user?.id ?? '');
    if (!/^\d+$/.test(userId))
        return false;
    const detail = await paymenterGet(`/api/v1/admin/users/${encodeURIComponent(userId)}?include=services`);
    const detailEmail = String(detail?.data?.attributes?.email || '').trim().toLowerCase();
    if (detailEmail !== normalized)
        return false;
    const serviceIds = new Set((detail?.data?.relationships?.services?.data || []).map((item) => String(item.id)));
    return (Array.isArray(detail?.included) ? detail.included : []).some((item) => item?.type === 'services' && serviceIds.has(String(item.id)) &&
        String(item?.attributes?.user_id ?? '') === userId && isCurrentPaidService(item.attributes));
}
/** Fail closed when the link, profile, or live billing lookup is unavailable. */
export async function hasVerifiedPaidAccount(discordId) {
    try {
        const linked = await supabase.getLinkedAccount(discordId);
        if (!linked?.user_id || linked.discord_id !== discordId)
            return false;
        const profile = await supabase.getUserProfile(linked.user_id);
        if (!profile?.email)
            return false;
        return await hasActivePaidServiceForEmail(profile.email);
    }
    catch (error) {
        logger.warn('Premium Support eligibility check failed:', error);
        return false;
    }
}
/** Idempotently create the Discord ticket category in the support guild. */
export async function ensurePremiumSupportCategory(guildId) {
    const categories = await supabase.getAllTicketCategories(guildId);
    // An empty result can also mean the database is down. Never seed from that ambiguity.
    if (categories.length === 0)
        return;
    if (categories.some(isPremiumSupportCategory))
        return;
    const created = await supabase.createTicketCategory({
        guild_id: guildId,
        name: 'Premium Support',
        premium_support: true,
        emoji: '💎',
        description: 'Priority help for verified accounts with an active paid plan',
        priority_default: 'high',
        staff_roles: categories.find((category) => /^support tickets?$/i.test(category.name))?.staff_roles || [],
        position: categories.length,
    });
    if (!created)
        logger.warn('Premium Support category could not be created; check database connectivity.');
}
