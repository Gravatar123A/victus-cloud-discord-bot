export type EntitlementRole = 'paid' | 'free' | 'none';

function record(resource: any): Record<string, any> {
    return { ...(resource || {}), ...(resource?.attributes || {}) };
}

function validFutureDate(value: unknown, now: Date): boolean {
    if (!value) return true;
    const timestamp = new Date(String(value)).getTime();
    return Number.isFinite(timestamp) && timestamp > now.getTime();
}

export function isActiveFreeServer(resource: any, now = new Date()): boolean {
    const server = record(resource);
    return String(server.server_type || '').toLowerCase() === 'free'
        && !Boolean(server.is_paused_due_to_renewal)
        && !Boolean(server.suspended || server.is_suspended)
        && String(server.status || '').toLowerCase() !== 'suspended'
        && Boolean(server.renewal_deadline)
        && validFutureDate(server.renewal_deadline, now);
}

export function isActivePaidService(resource: any, now = new Date()): boolean {
    const service = record(resource);
    const planType = String(service.plan_type || service.plan?.type || '').toLowerCase();
    return String(service.status || '').toLowerCase() === 'active'
        && planType !== 'free'
        && validFutureDate(service.expires_at || service.due_date || service.renews_at, now);
}

export function resolveEntitlementRole(hasPaidServer: boolean, hasFreeServer: boolean): EntitlementRole {
    if (hasPaidServer) return 'paid';
    if (hasFreeServer) return 'free';
    return 'none';
}