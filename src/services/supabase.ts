import { createClient, SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type {
    BotSettings, LinkedAccount, LinkToken, UserProfile,
    CustomEmbed, EmbedSettings, Suggestion, SuggestionVote, Giveaway, CustomCommand,
    InviteCredit
} from '../types/index.js';
import { localSettings } from './localSettings.js';

type CreditBalance = {
    amount: number;
    currency: string;
    found: boolean;
    source: 'paymenter' | 'profile' | 'none';
};

const DEFAULT_DM_PREFERENCES = {
    dm_maintenance: true,
    dm_billing: true,
    dm_security: true,
    dm_promotions: true,
};

function normalizeBaseUrl(url: string): string {
    return url.replace(/\/$/, '');
}

function getResourceRecord(resource: any): Record<string, any> {
    return {
        ...(resource || {}),
        ...(resource?.attributes || {}),
    };
}

function asArray(value: unknown): any[] {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return [value];
    return [];
}

function toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value.replace(/[^0-9.-]+/g, ''));
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function pickAmount(resource: any): number | null {
    const record = getResourceRecord(resource);
    for (const key of ['amount', 'balance', 'credits', 'credit', 'value', 'total', 'available']) {
        const amount = toNumber(record[key]);
        if (amount !== null) return amount;
    }
    return null;
}

function pickCurrency(resource: any): string {
    const record = getResourceRecord(resource);
    const currency = record.currency;
    if (typeof currency === 'string' && currency.trim()) return currency.toUpperCase();
    if (currency && typeof currency === 'object') {
        const currencyRecord = getResourceRecord(currency);
        for (const key of ['code', 'name', 'currency']) {
            const value = currencyRecord[key];
            if (typeof value === 'string' && value.trim()) return value.toUpperCase();
        }
    }
    for (const key of ['currency_code', 'code']) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.toUpperCase();
    }
    return 'USD';
}

async function describeFunctionError(error: unknown): Promise<string> {
    const message = error instanceof Error ? error.message : String(error);
    const context = (error as { context?: unknown; response?: unknown } | null)?.context
        || (error as { response?: unknown } | null)?.response;

    if (context && typeof (context as Response).clone === 'function') {
        const response = context as Response;
        const responseText = await response.clone().text().catch(() => '');
        const parts = [`${message} (status ${response.status})`];

        if (responseText.trim()) {
            try {
                parts.push(JSON.stringify(JSON.parse(responseText)));
            } catch {
                parts.push(responseText.slice(0, 500));
            }
        }

        return parts.join(': ');
    }

    const status = (context as { status?: unknown } | null)?.status;
    return status ? `${message} (status ${status})` : message;
}

class SupabaseService {
    public client: SupabaseClient;

    constructor() {
        // Create client with service role key and auth bypass
        this.client = createClient(config.supabase.url, config.supabase.serviceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
            db: {
                schema: 'public',
            },
            realtime: {
                params: {
                    eventsPerSecond: 10,
                },
                transport: ws as any,
            },
        });
    }

    /**
     * Subscribe to real-time changes on linked accounts
     */
    subscribeToLinks(callback: (payload: any) => void) {
        logger.debug('🔌 Initializing Realtime connection to discord_linked_accounts...');

        const channel = this.client
            .channel('any-channel-name') // Channel name can be anything
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'discord_linked_accounts',
                },
                (payload) => {
                    logger.info('🚀 Realtime: Received INSERT event');
                    callback(payload);
                }
            );

        channel.subscribe((status, error) => {
            if (status === 'SUBSCRIBED') {
                logger.info('✅ Realtime: Successfully subscribed to database changes!');
            } else if (status === 'CHANNEL_ERROR') {
                logger.error('❌ Realtime Channel Error:', error?.message || 'Unknown error');
            } else if (status === 'TIMED_OUT') {
                logger.warn('⚠️ Realtime: Connection timed out. Ensure "supabase_realtime" publication includes "discord_linked_accounts".');
            } else {
                logger.debug(`📡 Realtime Status Update: ${status}`);
            }
        });

        return channel;
    }

    /**
     * Subscribe to ticket + ticket_message inserts to drive the Discord bridge:
     * new website tickets -> Discord channels, and website messages -> Discord.
     */
    subscribeToTicketBridge(
        onTicketInsert: (ticket: any) => void,
        onMessageInsert: (message: any) => void,
    ) {
        const channel = this.client
            .channel('ticket-bridge')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets' },
                (payload) => onTicketInsert(payload.new))
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ticket_messages' },
                (payload) => onMessageInsert(payload.new));

        channel.subscribe((status, error) => {
            if (status === 'SUBSCRIBED') {
                logger.info('✅ Realtime: Ticket bridge subscribed.');
            } else if (status === 'CHANNEL_ERROR') {
                logger.error('❌ Realtime ticket bridge error:', error?.message || 'Unknown error');
            } else if (status === 'TIMED_OUT') {
                logger.warn('⚠️ Ticket bridge timed out. Ensure "supabase_realtime" includes "tickets" and "ticket_messages".');
            }
        });

        return channel;
    }

    /**
     * Point a website ticket at its freshly created Discord channel.
     */
    async setTicketChannel(ticketId: string, channelId: string): Promise<boolean> {
        const { error } = await this.client
            .from('tickets')
            .update({ channel_id: channelId, updated_at: new Date().toISOString() })
            .eq('id', ticketId);
        if (error) {
            logger.error('Failed to set ticket channel:', error);
            return false;
        }
        return true;
    }

    /**
     * Atomically claim a website message for relaying to Discord. Returns true
     * only for the caller that wins the race (bridged_at was null), so the
     * realtime relay and the catch-up never double-post.
     */
    async claimMessageForBridge(messageId: string): Promise<boolean> {
        const { data, error } = await this.client
            .from('ticket_messages')
            .update({ bridged_at: new Date().toISOString() })
            .eq('id', messageId)
            .is('bridged_at', null)
            .select('id');
        if (error) {
            logger.error('Failed to claim message for bridge:', error);
            return false;
        }
        return Array.isArray(data) && data.length > 0;
    }

    /**
     * Website messages on a ticket that have not yet been relayed to Discord.
     */
    async getUnbridgedMessages(ticketId: string): Promise<any[]> {
        const { data, error } = await this.client
            .from('ticket_messages')
            .select('*')
            .eq('ticket_id', ticketId)
            .is('bridged_at', null)
            .order('created_at', { ascending: true });
        if (error) {
            logger.error('Failed to load unbridged messages:', error);
            return [];
        }
        return data || [];
    }

    // ============================================
    // Account Linking
    // ============================================

    /**
     * Get linked account by Discord ID
     */
    async getLinkedAccount(discordId: string): Promise<LinkedAccount | null> {
        const { data, error } = await this.client
            .from('discord_linked_accounts')
            .select('*')
            .eq('discord_id', discordId)
            .single();

        if (error && error.code !== 'PGRST116') {
            logger.error('Failed to get linked account:', error);
        }
        return data;
    }

    /**
     * Get linked account by Victus Cloud user ID
     */
    async getLinkedAccountByUserId(userId: string): Promise<LinkedAccount | null> {
        const { data, error } = await this.client
            .from('discord_linked_accounts')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error && error.code !== 'PGRST116') {
            logger.error('Failed to get linked account by user ID:', error);
        }
        return data;
    }

    /**
     * Create a link token for account verification
     */
    async createLinkToken(
        discordId: string,
        discordUsername: string,
        token: string,
        expiresAt: Date
    ): Promise<LinkToken | null> {
        // First, invalidate any existing tokens for this Discord ID
        await this.client
            .from('discord_link_tokens')
            .delete()
            .eq('discord_id', discordId);

        const { data, error } = await this.client
            .from('discord_link_tokens')
            .insert({
                discord_id: discordId,
                discord_username: discordUsername,
                token,
                expires_at: expiresAt.toISOString(),
            })
            .select()
            .single();

        if (error) {
            logger.error('Failed to create link token:', error);
            return null;
        }
        return data;
    }

    /**
     * Verify and consume a link token
     */
    async verifyLinkToken(token: string, userId: string): Promise<boolean> {
        // Get the token
        const { data: tokenData, error: tokenError } = await this.client
            .from('discord_link_tokens')
            .select('*')
            .eq('token', token)
            .eq('used', false)
            .single();

        if (tokenError || !tokenData) {
            logger.warn('Invalid or used link token');
            return false;
        }

        // Check if expired
        if (new Date(tokenData.expires_at) < new Date()) {
            logger.warn('Link token expired');
            return false;
        }

        // Create the link
        const { error: linkError } = await this.client
            .from('discord_linked_accounts')
            .insert({
                user_id: userId,
                discord_id: tokenData.discord_id,
                discord_username: tokenData.discord_username,
            });

        if (linkError) {
            logger.error('Failed to create account link:', linkError);
            return false;
        }

        // Mark token as used
        await this.client
            .from('discord_link_tokens')
            .update({ used: true })
            .eq('id', tokenData.id);

        logger.info(`Account linked: Discord ${tokenData.discord_id} -> User ${userId}`);
        return true;
    }

    /**
     * Unlink a Discord account
     */
    async unlinkAccount(discordId: string): Promise<boolean> {
        const { error } = await this.client
            .from('discord_linked_accounts')
            .delete()
            .eq('discord_id', discordId);

        if (error) {
            logger.error('Failed to unlink account:', error);
            return false;
        }
        return true;
    }

    /**
     * Get all linked accounts (for startup role sync)
     */
    async getAllLinkedAccounts(): Promise<{ discord_id: string; user_id: string }[]> {
        const { data, error } = await this.client
            .from('discord_linked_accounts')
            .select('discord_id, user_id');

        if (error) {
            logger.error('Failed to get all linked accounts:', error);
            return [];
        }
        return data || [];
    }

    // ============================================
    // Bot Settings
    // ============================================

    /**
     * Get bot settings for a guild
     */
    async getBotSettings(guildId: string): Promise<BotSettings | null> {
        const { data, error } = await this.client
            .from('bot_settings')
            .select('*')
            .eq('guild_id', guildId)
            .single();

        if (error && error.code !== 'PGRST116') {
            logger.error(`Failed to get bot settings for ${guildId}:`, error);
        }

        const fallbackAiChannelId = await localSettings.getAiChannelId(guildId);
        if (!fallbackAiChannelId) return data as BotSettings | null;
        return {
            ...(data || { guild_id: guildId }),
            ai_channel_id: data?.ai_channel_id || fallbackAiChannelId,
        } as BotSettings;
    }

    /**
     * Update bot settings
     */
    async updateBotSettings(
        guildId: string,
        settings: Partial<Omit<BotSettings, 'guild_id' | 'updated_at'>>
    ): Promise<boolean> {
        const { error } = await this.client
            .from('bot_settings')
            .upsert({
                guild_id: guildId,
                ...settings,
                updated_at: new Date().toISOString()
            });

        if (error) {
            const missingAiColumn = 'ai_channel_id' in settings && (
                error.code === '42703' ||
                error.code === 'PGRST204' ||
                String(error.message || '').includes('ai_channel_id')
            );
            if (missingAiColumn) {
                logger.warn('bot_settings.ai_channel_id is missing in Supabase; using local file fallback. Apply the migration when possible.');
                return localSettings.setAiChannelId(guildId, settings.ai_channel_id ?? null);
            }
            logger.error(`Failed to update bot settings for ${guildId}:`, error);
            return false;
        }

        if ('ai_channel_id' in settings) {
            await localSettings.setAiChannelId(guildId, settings.ai_channel_id ?? null);
        }
        return true;
    }

    // ============================================
    // User Profile
    // ============================================

    /**
     * Get user profile by user ID
     */
    async getUserProfile(userId: string): Promise<UserProfile | null> {
        const { data, error } = await this.client
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (error) {
            logger.error('Failed to get user profile:', error);
            return null;
        }
        return data;
    }

    async getUserProfiles(userIds: string[]): Promise<UserProfile[]> {
        const ids = [...new Set(userIds.filter(Boolean))];
        if (ids.length === 0) return [];

        const profiles: UserProfile[] = [];
        for (let offset = 0; offset < ids.length; offset += 200) {
            const { data, error } = await this.client
                .from('profiles')
                .select('*')
                .in('id', ids.slice(offset, offset + 200));
            if (error) {
                logger.error('Failed to get user profiles for entitlement role sync:', error);
                throw error;
            }
            profiles.push(...((data || []) as UserProfile[]));
        }
        return profiles;
    }

    // ── VCCRS / CP economy ────────────────────────────────────────────────

    /** Top profiles by CP (for the leaderboard). */
    async getCpLeaderboard(limit = 10, offset = 0): Promise<any[]> {
        const { data, error } = await this.client
            .from('profiles')
            .select('*')
            .order('total_cp', { ascending: false, nullsFirst: false })
            .range(offset, offset + limit - 1);
        if (error) {
            logger.error('getCpLeaderboard failed:', error);
            return [];
        }
        return data || [];
    }

    /** The user's 1-based CP rank (how many profiles have more CP, +1). */
    async getCpRank(userId: string): Promise<number | null> {
        const profile = await this.getUserProfile(userId);
        if (!profile) return null;
        const myCp = Number((profile as any).total_cp ?? 0);
        const { count, error } = await this.client
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .gt('total_cp', myCp);
        if (error) {
            logger.error('getCpRank failed:', error);
            return null;
        }
        return (count ?? 0) + 1;
    }

    /** Recent CP ledger entries for a user. */
    async getCpTransactions(userId: string, limit = 6, offset = 0): Promise<any[]> {
        const { data, error } = await this.client
            .from('cp_transactions')
            .select('action_type, cp_earned, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
        if (error) {
            logger.error('getCpTransactions failed:', error);
            return [];
        }
        return data || [];
    }

    /**
     * Award XP to a linked user, mirroring how the website grants upload XP:
     * bump profiles.total_xp via the increment_xp RPC and write a row to the XP
     * ledger (cp_transactions). action_type drives the friendly label shown in
     * the wallet's "Recent Activity (XP)" panel. Returns true on success.
     */
    async grantXp(userId: string, amount: number, actionType: string, metadata: Record<string, unknown> = {}): Promise<boolean> {
        if (!userId || !Number.isFinite(amount) || amount <= 0) return false;
        const { error: rpcError } = await this.client.rpc('award_xp', {
            p_user_id: userId,
            p_amount: Math.floor(amount),
            p_source: actionType,
        });
        if (rpcError) {
            logger.error('grantXp increment_xp failed:', rpcError);
            return false;
        }
        const { error: ledgerError } = await this.client
            .from('cp_transactions')
            .insert({ user_id: userId, action_type: actionType, cp_earned: Math.floor(amount), metadata });
        if (ledgerError) {
            // XP already credited; ledger row is cosmetic, so don't fail hard.
            logger.warn(`grantXp ledger insert failed: ${ledgerError.message}`);
        }
        return true;
    }

    async claimLevelUpEvent(): Promise<any | null> {
        const { data, error } = await this.client.rpc('claim_level_up_event');
        if (error) throw new Error(`claim_level_up_event failed: ${error.message}`);
        return Array.isArray(data) ? (data[0] ?? null) : data;
    }

    async applyLevelXpReward(eventId: string, amount: number): Promise<any> {
        const { data, error } = await this.client.rpc('apply_level_xp_reward', {
            p_event_id: eventId,
            p_amount: Math.floor(amount),
        });
        if (error) throw new Error(`apply_level_xp_reward failed: ${error.message}`);
        return data;
    }

    async updateLevelUpEvent(eventId: string, fields: Record<string, unknown>): Promise<void> {
        const { error } = await this.client
            .from('level_up_events')
            .update({ ...fields, updated_at: new Date().toISOString() })
            .eq('id', eventId);
        if (error) throw new Error(`level_up_events update failed: ${error.message}`);
    }

    /** Total CP ledger entries for a user (for pagination). */
    async getCpTransactionCount(userId: string): Promise<number> {
        const { count, error } = await this.client
            .from('cp_transactions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);
        if (error) return 0;
        return count ?? 0;
    }

    // ── Economy money-movement RPCs (all atomic, server-side) ─────────────

    private async econRpc(fn: string, params: Record<string, unknown>): Promise<any> {
        const { data, error } = await this.client.rpc(fn, params);
        if (error) {
            logger.error(`${fn} failed:`, error);
            return { ok: false, error: error.message || 'Database error' };
        }
        return data;
    }

    econTransferCp(fromUserId: string, toUserId: string, amount: number, reason?: string) {
        return this.econRpc('econ_transfer_cp', { p_from: fromUserId, p_to: toUserId, p_amount: amount, p_reason: reason ?? null });
    }

    econBank(userId: string, op: 'deposit' | 'withdraw', amount: number) {
        return this.econRpc('econ_bank', { p_user: userId, p_op: op, p_amount: amount });
    }

    econSpendCp(userId: string, amount: number, reason?: string, meta?: Record<string, unknown>) {
        return this.econRpc('econ_spend_cp', { p_user: userId, p_amount: amount, p_reason: reason ?? null, p_meta: meta ?? {} });
    }

    econGrantCp(userId: string, amount: number, kind = 'convert_in', reason?: string, meta?: Record<string, unknown>) {
        return this.econRpc('econ_grant_cp', { p_user: userId, p_amount: amount, p_kind: kind, p_reason: reason ?? null, p_meta: meta ?? {} });
    }

    econAdminAdjustCp(adminUserId: string, userId: string, delta: number, reason?: string) {
        return this.econRpc('econ_admin_adjust_cp', { p_admin: adminUserId, p_user: userId, p_delta: delta, p_reason: reason ?? null });
    }

    econAdminSetFrozen(adminUserId: string, userId: string, frozen: boolean) {
        return this.econRpc('econ_admin_set_frozen', { p_admin: adminUserId, p_user: userId, p_frozen: frozen });
    }

    async getEconomyRates(): Promise<any[]> {
        const { data, error } = await this.client.from('economy_rates').select('*').eq('enabled', true);
        if (error) {
            logger.error('getEconomyRates failed:', error);
            return [];
        }
        return data || [];
    }

    async getEconomyLedger(userId: string, limit = 8, offset = 0): Promise<any[]> {
        const { data, error } = await this.client
            .from('economy_ledger')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
        if (error) {
            logger.error('getEconomyLedger failed:', error);
            return [];
        }
        return data || [];
    }

    /**
     * Check if user is admin
     */
    async isUserAdmin(userIdOrDiscordId: string): Promise<boolean> {
        let userId = userIdOrDiscordId;
        if (!userIdOrDiscordId.includes('-')) {
            const linked = await this.getLinkedAccount(userIdOrDiscordId).catch(() => null);
            if (!linked) return false;
            userId = linked.user_id;
        }
        const profile = await this.getUserProfile(userId);
        return profile?.is_admin ?? false;
    }

    async resolveBillingCreditTarget(target: string): Promise<{ email?: string; user_id?: string; label: string }> {
        const cleaned = target.trim().replace(/^<@!?/, '').replace(/>$/, '');

        if (cleaned.includes('@')) {
            return { email: cleaned.toLowerCase(), label: cleaned.toLowerCase() };
        }

        const linked = await this.getLinkedAccount(cleaned).catch(() => null);
        if (linked) {
            const profile = await this.getUserProfile(linked.user_id).catch(() => null);
            if (profile?.email) {
                return { email: profile.email.toLowerCase(), label: `${profile.email} (Discord ${cleaned})` };
            }
        }

        const { data: profile, error } = await this.client
            .from('profiles')
            .select('id, email')
            .eq('id', cleaned)
            .maybeSingle();

        if (!error && profile?.email) {
            return { email: String(profile.email).toLowerCase(), label: String(profile.email).toLowerCase() };
        }

        return { user_id: cleaned, label: `Paymenter user #${cleaned}` };
    }

    private sumCreditRows(rows: any[]): Record<string, number> {
        return rows.reduce((acc: Record<string, number>, c: any) => {
            const a = pickAmount(c);
            const cur = String(pickCurrency(c) || 'USD').toUpperCase();
            if (a !== null) acc[cur] = (acc[cur] || 0) + a;
            return acc;
        }, {});
    }

    /**
     * Live Paymenter balances split by currency: coins (VICTUS_COINS_CURRENCY)
     * and credits (VICTUS_COINS_PAYMENT_CURRENCY). This is the source of truth
     * for a user's Coins balance.
     *
     * Routes through the admin-paymenter edge function (credits.balance) so the
     * bot no longer needs the direct Paymenter API creds configured. Falls back
     * to the direct API only if those creds are present; otherwise returns
     * { found:false } and callers degrade to profiles.total_cp.
     */
    async getPaymenterBalances(email: string): Promise<{ coins: number; credits: number; found: boolean }> {
        if (!email) return { coins: 0, credits: 0, found: false };

        try {
            const { data, error } = await this.client.functions.invoke('admin-paymenter', {
                body: { endpoint: 'credits.balance', email },
            });
            if (error) {
                logger.warn(`getPaymenterBalances edge function failed: ${await describeFunctionError(error)}`);
            } else if (data && (data as any).found) {
                return {
                    coins: Number((data as any).coins) || 0,
                    credits: Number((data as any).credits) || 0,
                    found: true,
                };
            }
        } catch (e) {
            logger.warn(`getPaymenterBalances edge invoke error: ${(e as Error).message}`);
        }

        // Fall back to the direct Paymenter API only when it is configured.
        if (config.paymenter.url && config.paymenter.apiKey) {
            return this.getPaymenterBalancesDirect(email);
        }
        return { coins: 0, credits: 0, found: false };
    }

    /**
     * Direct-to-Paymenter balance lookup (fallback path for getPaymenterBalances
     * when the edge function is unavailable). Requires PAYMENTER_URL + API key.
     */
    private async getPaymenterBalancesDirect(email: string): Promise<{ coins: number; credits: number; found: boolean }> {
        const coinsCur = (process.env.VICTUS_COINS_CURRENCY || 'COINS').toUpperCase();
        const creditCur = (process.env.VICTUS_COINS_PAYMENT_CURRENCY || 'USD').toUpperCase();
        const out = (totals: Record<string, number>, found: boolean) => ({ coins: totals[coinsCur] || 0, credits: totals[creditCur] || 0, found });
        if (!email) return out({}, false);

        const enc = encodeURIComponent(email);
        let userId: string | number | null = null;
        for (const path of [
            `/api/v1/admin/users?filter[email]=${enc}&include=credits&per_page=5`,
            `/api/admin/users?filter[email]=${enc}&include=credits&per_page=5`,
        ]) {
            const payload = await this.paymenterDirect(path);
            const user = asArray(payload?.data ?? payload).find(
                (u) => String(getResourceRecord(u).email || '').toLowerCase() === email.toLowerCase(),
            );
            if (!user) continue;
            userId = getResourceRecord(user).id ?? user.id;
            const inc = asArray(payload?.included).filter((it) => ['credit', 'credits'].includes(String(it.type || '').toLowerCase()));
            const totals = this.sumCreditRows(inc);
            if (Object.keys(totals).length) return out(totals, true);
            break;
        }
        if (!userId) return out({}, false);

        for (const path of [
            `/api/v1/admin/credits?filter[user_id]=${encodeURIComponent(String(userId))}&per_page=100`,
            `/api/admin/credits?filter[user_id]=${encodeURIComponent(String(userId))}&per_page=100`,
        ]) {
            const payload = await this.paymenterDirect(path);
            const totals = this.sumCreditRows(asArray(payload?.data ?? payload));
            if (Object.keys(totals).length) return out(totals, true);
        }
        return out({}, true);
    }

    /** Set a user's Paymenter coins balance (mirror of the economy wallet). */
    async setPaymenterCoins(target: { email?: string; user_id?: string }, amount: number): Promise<void> {
        await this.adjustPaymenterCredits({
            ...target,
            currency: process.env.VICTUS_COINS_CURRENCY || 'COINS',
            mode: 'set',
            amount: Math.max(0, Math.round(amount)),
        }).catch((e) => logger.warn(`setPaymenterCoins failed: ${(e as Error).message}`));
    }

    /** Directly set the Supabase coins mirror (profiles.total_cp). */
    async setProfileCoins(userId: string, amount: number): Promise<void> {
        const { error } = await this.client.from('profiles').update({ total_cp: Math.max(0, Math.round(amount)) }).eq('id', userId);
        if (error) logger.warn(`setProfileCoins failed: ${error.message}`);
    }

    async adjustPaymenterCredits(input: {
        email?: string;
        user_id?: string;
        currency?: string;
        mode: 'set' | 'add' | 'remove';
        amount: number;
    }): Promise<any> {
        if ((process.env.PAYMENTER_AUDIT_MODE === 'true' || process.env.PAYMENTER_BALANCE_FREEZE === 'true') && (input.mode === 'add' || input.mode === 'set')) {
            throw new Error('Paymenter balance increases are temporarily disabled while balances are audited');
        }

        const { data, error } = await this.client.functions.invoke('admin-paymenter', {
            body: {
                endpoint: 'credits.adjust',
                ...input,
            },
        });

        if (error) {
            const message = await describeFunctionError(error);
            logger.error(`Paymenter credit adjustment failed: ${message}`);
            throw new Error(message);
        }

        return data;
    }

    // ============================================
    // Discord Invite Coins (escrow ledger)
    // ============================================

    /**
     * Grant invite-reward COINS to an inviter via the CANONICAL Paymenter rail
     * (adjustPaymenterCredits, currency=COINS, mode 'add') — NOT profiles.total_cp
     * / econGrantCp. Resolves the inviter's Paymenter account by their linked
     * Victus profile email. Returns false (so the caller can leave the credit
     * 'pending' and retry later) if the inviter has no profile/email or the
     * Paymenter adjustment fails.
     */
    async grantInviteCoins(inviterUserId: string, amount: number, reference?: string): Promise<boolean> {
        if (!inviterUserId || !Number.isFinite(amount) || amount <= 0) return false;
        const profile = await this.getUserProfile(inviterUserId);
        if (!profile?.email) {
            logger.warn(`grantInviteCoins: no profile/email for user ${inviterUserId}; leaving credit pending`);
            return false;
        }
        const email = String(profile.email).toLowerCase();
        const amt = Math.round(amount);
        const ref = reference || `invite:${inviterUserId}:${Date.now()}`;
        const paymenterUrl = (config.paymenter.url || process.env.PAYMENTER_URL || process.env.VICTUS_PANEL_URL || 'https://billing.victuscloud.com').replace(/\/$/, '');
        const internalToken = process.env.VICTUS_INTERNAL_API_TOKEN || process.env.PAYMENTER_INTERNAL_API_TOKEN || process.env.PTERODACTYL_INTERNAL_API_TOKEN || 'UPPhseRQIhFDs2wKN1qnx2FC2YCv1n9C-YJHtK6kAqhLjMt61jP0QanVrb48DJl1';
        try {
            const res = await fetch(`${paymenterUrl}/api/victus/coins/grant`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${internalToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({
                    email,
                    amount: amt,
                    source: 'discord_invite',
                    reference: String(ref).slice(0, 191),
                    description: `Discord invite reward`,
                }),
            });
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
            if (!res.ok) {
                const msg = data?.error || data?.message || text || `HTTP ${res.status}`;
                throw new Error(msg);
            }
            logger.info(`grantInviteCoins: +${amt} COINS to ${email} (user ${inviterUserId}) via victus grant`);
            return true;
        } catch (e) {
            logger.warn(`grantInviteCoins via victus grant failed for ${inviterUserId}: ${(e as Error).message} — falling back to legacy adjust`);
            try {
                await this.adjustPaymenterCredits({
                    email,
                    currency: process.env.VICTUS_COINS_CURRENCY || 'COINS',
                    mode: 'add',
                    amount: amt,
                });
                logger.info(`grantInviteCoins fallback: +${amt} COINS to ${email} (user ${inviterUserId})`);
                return true;
            } catch (e2) {
                logger.error(`grantInviteCoins failed for ${inviterUserId}: ${(e2 as Error).message}`);
                return false;
            }
        }
    }

    // ============================================
    // Discord Link 100 COINS reward (join + /link, revoke on leave)
    // ============================================

    /**
     * Grant 100 COINS for linking Discord via /link. Idempotent: only grants once
     * per discord_linked_accounts row (coins_granted flag). Uses the canonical
     * victus/coins/grant rail so the credit is Paymenter-authoritative and appears
     * in the panel's Coin History as source=discord_link.
     */
    async grantDiscordLinkCoins(linked: { user_id: string; discord_id: string }): Promise<boolean> {
        if (!config.economy.discordLink.enabled) return false;
        const amount = Math.round(config.economy.discordLink.amount);
        if (!linked.user_id || !linked.discord_id || amount <= 0) return false;

        // Idempotency: skip if already granted (tracked in discord_linked_accounts).
        // Use select('*') so the query doesn't fail if the migration hasn't been applied yet;
        // we then check the fields via optional chaining.
        const { data: row, error: rowErr } = await this.client
            .from('discord_linked_accounts')
            .select('*')
            .eq('user_id', linked.user_id)
            .eq('discord_id', linked.discord_id)
            .maybeSingle() as any;
        if (rowErr) {
            logger.warn(`grantDiscordLinkCoins: failed to read reward flag for ${linked.discord_id}: ${rowErr.message}`);
        } else if ((row as any)?.coins_granted) {
            logger.debug(`grantDiscordLinkCoins: already granted for ${linked.discord_id}, skipping`);
            return true;
        }
        if ((row as any)?.coins_revoked) {
            logger.info(`grantDiscordLinkCoins: ${linked.discord_id} previously revoked (left server), not re-granting until re-link`);
            return false;
        }

        const profile = await this.getUserProfile(linked.user_id);
        if (!profile?.email) {
            logger.warn(`grantDiscordLinkCoins: no profile/email for user ${linked.user_id}`);
            return false;
        }
        const email = String(profile.email).toLowerCase();
        const paymenterUrl = (config.paymenter.url || process.env.PAYMENTER_URL || process.env.VICTUS_PANEL_URL || 'https://billing.victuscloud.com').replace(/\/$/, '');
        const internalToken = process.env.VICTUS_INTERNAL_API_TOKEN || process.env.PAYMENTER_INTERNAL_API_TOKEN || process.env.PTERODACTYL_INTERNAL_API_TOKEN || 'UPPhseRQIhFDs2wKN1qnx2FC2YCv1n9C-YJHtK6kAqhLjMt61jP0QanVrb48DJl1';
        const reference = `discord_link:${linked.discord_id}`;

        try {
            const res = await fetch(`${paymenterUrl}/api/victus/coins/grant`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${internalToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({
                    email,
                    amount,
                    source: 'discord_link',
                    reference: reference.slice(0, 191),
                    description: 'Linked Discord account via /link',
                }),
            });
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
            if (!res.ok) {
                // If panel says already granted (deduped by reference), treat as success and mark flag.
                const msg = String(data?.error || data?.message || text || '').toLowerCase();
                if (msg.includes('already') || msg.includes('duplicate') || res.status === 409) {
                    await this.client.from('discord_linked_accounts').update({ coins_granted: true, coins_granted_at: new Date().toISOString(), coins_amount: amount }).eq('user_id', linked.user_id).eq('discord_id', linked.discord_id);
                    logger.info(`grantDiscordLinkCoins: deduped grant for ${linked.discord_id} (panel says already granted)`);
                    return true;
                }
                throw new Error(data?.error || data?.message || text || `HTTP ${res.status}`);
            }
            // Mark as granted (best-effort; ignore if columns missing before migration)
            await this.client.from('discord_linked_accounts').update({ coins_granted: true, coins_granted_at: new Date().toISOString(), coins_amount: amount, coins_revoked: false, coins_revoked_at: null } as any).eq('user_id', linked.user_id).eq('discord_id', linked.discord_id).then(() => {}, (e) => logger.debug(`grantDiscordLinkCoins: mark granted failed (migration pending): ${(e as Error).message}`));
            logger.info(`grantDiscordLinkCoins: +${amount} COINS to ${email} (discord ${linked.discord_id})`);
            return true;
        } catch (e) {
            logger.warn(`grantDiscordLinkCoins via victus grant failed for ${linked.discord_id}: ${(e as Error).message}, falling back to legacy adjust`);
            try {
                await this.adjustPaymenterCredits({ email, currency: process.env.VICTUS_COINS_CURRENCY || 'COINS', mode: 'add', amount });
                await this.client.from('discord_linked_accounts').update({ coins_granted: true, coins_granted_at: new Date().toISOString(), coins_amount: amount } as any).eq('user_id', linked.user_id).eq('discord_id', linked.discord_id).then(() => {}, () => {});
                logger.info(`grantDiscordLinkCoins fallback: +${amount} COINS to ${email}`);
                return true;
            } catch (e2) {
                logger.error(`grantDiscordLinkCoins failed for ${linked.discord_id}: ${(e2 as Error).message}`);
                return false;
            }
        }
    }

    /**
     * Revoke 100 COINS when a linked user leaves the Discord guild.
     * Only revokes once; uses spend via Paymenter (mode=remove). The panel records
     * a negative credit_transactions row (source=discord_link_revoke).
     */
    async revokeDiscordLinkCoins(discordId: string): Promise<boolean> {
        if (!config.economy.discordLink.enabled) return false;
        const amount = Math.round(config.economy.discordLink.amount);
        const { data: row, error } = await this.client
            .from('discord_linked_accounts')
            .select('*')
            .eq('discord_id', discordId)
            .maybeSingle() as any;
        if (error || !row) {
            logger.debug(`revokeDiscordLinkCoins: no linked row for ${discordId}, skipping`);
            return false;
        }
        if (!(row as any).coins_granted || (row as any).coins_revoked) {
            logger.debug(`revokeDiscordLinkCoins: ${discordId} not granted or already revoked, skipping`);
            return false;
        }
        const profile = await this.getUserProfile(row.user_id);
        if (!profile?.email) {
            logger.warn(`revokeDiscordLinkCoins: no profile/email for ${row.user_id}`);
            return false;
        }
        const email = String(profile.email).toLowerCase();
        try {
            await this.adjustPaymenterCredits({ email, currency: process.env.VICTUS_COINS_CURRENCY || 'COINS', mode: 'remove', amount });
            await this.client.from('discord_linked_accounts').update({ coins_revoked: true, coins_revoked_at: new Date().toISOString() } as any).eq('discord_id', discordId).then(() => {}, (e) => logger.debug(`revoke mark failed: ${(e as Error).message}`));
            // Also record a local panel history entry via the internal token if available (best-effort).
            const paymenterUrl = (config.paymenter.url || process.env.PAYMENTER_URL || process.env.VICTUS_PANEL_URL || 'https://billing.victuscloud.com').replace(/\/$/, '');
            const internalToken = process.env.VICTUS_INTERNAL_API_TOKEN || process.env.PAYMENTER_INTERNAL_API_TOKEN || process.env.PTERODACTYL_INTERNAL_API_TOKEN || '';
            if (internalToken && paymenterUrl) {
                await fetch(`${paymenterUrl}/api/victus/coins/grant`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${internalToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({ email, amount, source: 'discord_link_revoke', reference: `discord_link_revoke:${discordId}:${Date.now()}`, description: 'Left Discord server — 100 COINS deducted' }),
                }).catch(() => {});
            }
            logger.info(`revokeDiscordLinkCoins: -${amount} COINS from ${email} (discord ${discordId} left)`);
            return true;
        } catch (e) {
            logger.error(`revokeDiscordLinkCoins failed for ${discordId}: ${(e as Error).message}`);
            return false;
        }
    }

    /**
     * Insert a pending (or unattributed) invite credit. UNIQUE(invitee_discord_id)
     * + ignoreDuplicates makes this idempotent: a re-invite / rejoin is a no-op
     * and returns null. Returns the created row on a fresh insert.
     */
    async createInviteCredit(row: {
        guild_id: string;
        inviter_discord_id: string | null;
        invitee_discord_id: string;
        invite_code: string | null;
        inviter_user_id: string | null;
        coins: number;
        status: InviteCredit['status'];
        qualify_at: string;
    }): Promise<InviteCredit | null> {
        const { data, error } = await this.client
            .from('discord_invite_credits')
            .upsert(row, { onConflict: 'invitee_discord_id', ignoreDuplicates: true })
            .select()
            .maybeSingle();
        if (error) {
            logger.error('createInviteCredit failed:', error);
            return null;
        }
        return (data as InviteCredit | null) ?? null;
    }

    /** Look up a single invite credit by the invited person's Discord ID. */
    async getInviteCreditByInvitee(inviteeDiscordId: string): Promise<InviteCredit | null> {
        const { data, error } = await this.client
            .from('discord_invite_credits')
            .select('*')
            .eq('invitee_discord_id', inviteeDiscordId)
            .maybeSingle();
        if (error) {
            logger.error('getInviteCreditByInvitee failed:', error);
            return null;
        }
        return (data as InviteCredit | null) ?? null;
    }

    /** Patch an invite credit (auto-stamps updated_at). */
    async updateInviteCredit(id: string, patch: Partial<InviteCredit>): Promise<boolean> {
        const { error } = await this.client
            .from('discord_invite_credits')
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) {
            logger.error('updateInviteCredit failed:', error);
            return false;
        }
        return true;
    }

    /** Pending credits whose qualify_at has passed — the scheduler's work queue. */
    async getDueInviteCredits(limit = 50): Promise<InviteCredit[]> {
        const { data, error } = await this.client
            .from('discord_invite_credits')
            .select('*')
            .eq('status', 'pending')
            .lte('qualify_at', new Date().toISOString())
            .order('qualify_at', { ascending: true })
            .limit(limit);
        if (error) {
            logger.error('getDueInviteCredits failed:', error);
            return [];
        }
        return (data as InviteCredit[]) || [];
    }

    /** Count an inviter's pending+confirmed credits since `sinceIso` (rate cap). */
    async countRecentInviterCredits(inviterDiscordId: string, sinceIso: string): Promise<number> {
        const { count, error } = await this.client
            .from('discord_invite_credits')
            .select('id', { count: 'exact', head: true })
            .eq('inviter_discord_id', inviterDiscordId)
            .in('status', ['pending', 'confirmed'])
            .gte('joined_at', sinceIso);
        if (error) {
            logger.error('countRecentInviterCredits failed:', error);
            return 0;
        }
        return count ?? 0;
    }

    /**
     * Get detailed user activity history (simplified for now)
     */
    async getUserHistory(userId: string): Promise<any[]> {
        // This will eventually pull from a separate activity_logs or transactions table
        // For now, we'll return an empty array if no specific table exists
        const { data, error } = await this.client
            .from('audit_logs')
            .select('*')
            .or(`admin_id.eq.${userId},target_id.eq.${userId}`)
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) {
            logger.error('Failed to get user history:', error);
            return [];
        }
        return data || [];
    }

    // ============================================
    // Pterodactyl API Proxy
    // ============================================

    /**
     * Call Pterodactyl API through edge function
     */
    async pterodactylApi(endpoint: string, method = 'GET', body?: any): Promise<any> {
        const { data, error } = await this.client.functions.invoke('admin-pterodactyl', {
            body: { endpoint, method, body },
        });

        if (error) {
            logger.error(`Pterodactyl API call failed (${endpoint}): ${await describeFunctionError(error)}`);
            throw error;
        }
        return data;
    }

    /**
     * Get all servers
     */
    async getServers(): Promise<any[]> {
        try {
            const result = await this.pterodactylApi('servers');
            return result?.data || [];
        } catch (error) {
            logger.error('Failed to get servers:', error);
            return [];
        }
    }

    /**
     * Get servers for a specific user (by email)
     */
    async getUserServers(userEmail: string): Promise<any[]> {
        if (!userEmail) return [];
        const servers = await this.getServers();
        const users = await this.getPterodactylUsers();
        const email = userEmail.toLowerCase();

        const matchedUsers = users.filter((user: any) => {
            const record = getResourceRecord(user);
            return String(record.email || '').toLowerCase() === email;
        });
        const userIds = new Set(matchedUsers.map((user: any) => String(getResourceRecord(user).id ?? user.id)));

        return servers.filter((server: any) => {
            const record = getResourceRecord(server);
            const serverUser = record.user ?? record.owner_id ?? record.user_id;
            const serverEmail = String(record.user_email || record.email || record.owner_email || '').toLowerCase();
            return (serverEmail && serverEmail === email) || userIds.has(String(serverUser));
        });
    }

    /**
     * Get Pterodactyl users
     */
    async getPterodactylUsers(): Promise<any[]> {
        try {
            const result = await this.pterodactylApi('users');
            return result?.data || [];
        } catch (error) {
            logger.error('Failed to get Pterodactyl users:', error);
            return [];
        }
    }

    /**
     * Get Paymenter credits for a Victus profile by email.
     */
    async getCreditBalance(profile: UserProfile | null): Promise<CreditBalance> {
        const profileAmount =
            toNumber(profile?.paymenter_credits) ??
            toNumber(profile?.credits) ??
            toNumber(profile?.credit) ??
            toNumber(profile?.balance);

        if (!profile?.email) {
            return {
                amount: profileAmount ?? 0,
                currency: 'USD',
                found: profileAmount !== null,
                source: profileAmount !== null ? 'profile' : 'none',
            };
        }

        const paymenterBalance = await this.getPaymenterCreditsByEmail(profile.email);
        if (paymenterBalance.found) return paymenterBalance;

        return {
            amount: profileAmount ?? 0,
            currency: 'USD',
            found: profileAmount !== null,
            source: profileAmount !== null ? 'profile' : 'none',
        };
    }

    private async paymenterDirect(path: string): Promise<any | null> {
        if (!config.paymenter.url || !config.paymenter.apiKey) return null;

        const response = await fetch(`${normalizeBaseUrl(config.paymenter.url)}${path}`, {
            headers: {
                Authorization: `Bearer ${config.paymenter.apiKey}`,
                Accept: 'application/vnd.api+json, application/json',
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            logger.warn(`Paymenter direct request failed ${response.status}: ${path}`);
            return null;
        }

        return response.json();
    }

    /**
     * Billing credit balance (the payment/USD figure) for a Victus email.
     * Sources from the admin-paymenter edge function via getPaymenterBalances so
     * /account + the AI no longer depend on direct Paymenter creds being set.
     */
    private async getPaymenterCreditsByEmail(email: string): Promise<CreditBalance> {
        const creditCur = (process.env.VICTUS_COINS_PAYMENT_CURRENCY || 'USD').toUpperCase();
        const balances = await this.getPaymenterBalances(email);
        if (!balances.found) {
            return { amount: 0, currency: creditCur, found: false, source: 'none' };
        }
        return { amount: balances.credits, currency: creditCur, found: true, source: 'paymenter' };
    }

    /**
     * Get nodes
     */
    async getNodes(): Promise<any[]> {
        try {
            const result = await this.pterodactylApi('nodes');
            return result?.data || [];
        } catch (error) {
            logger.error('Failed to get nodes:', error);
            return [];
        }
    }

    // ============================================
    // Paymenter API Proxy
    // ============================================

    /**
     * Call Paymenter API through edge function
     */
    async paymenterApi(endpoint: string, method = 'GET', body?: any): Promise<any> {
        const { data, error } = await this.client.functions.invoke('admin-paymenter', {
            body: { endpoint, method, body },
        });

        if (error) {
            logger.error(`Paymenter API call failed (${endpoint}): ${await describeFunctionError(error)}`);
            throw error;
        }
        return data;
    }

    /**
     * Get all orders
     */
    async getOrders(): Promise<any[]> {
        const result = await this.paymenterApi('orders');
        return result?.data || [];
    }

    /**
     * Get all invoices
     */
    async getInvoices(): Promise<any[]> {
        const result = await this.paymenterApi('invoices');
        return result?.data || [];
    }

    async getPaymenterServices(): Promise<any[]> {
        const result = await this.paymenterApi('services');
        return result?.data || [];
    }

    /**
     * Get the billing services (Paymenter) belonging to a user, by email.
     * Returns a normalized shape: { name, status, price, renewsAt }.
     */
    async getUserServices(email: string): Promise<any[]> {
        if (!email) return [];
        try {
            const billingUser = await this.getBillingUserByEmail(email);
            if (!billingUser) return [];
            const userId = String(getResourceRecord(billingUser).id ?? '');
            if (!userId) return [];

            const [servicesRes, productsRes] = await Promise.all([
                this.paymenterApi('services').catch(() => null),
                this.paymenterApi('products').catch(() => null),
            ]);
            const services = servicesRes?.data || [];
            const products = productsRes?.data || [];

            const productName: Record<string, string> = {};
            for (const p of products) {
                const r = getResourceRecord(p);
                if (r?.id != null) productName[String(r.id)] = r.name || r.title || `Product #${r.id}`;
            }

            return services
                .map((s: any) => getResourceRecord(s))
                .filter((r: any) => String(r?.user_id ?? r?.client_id ?? '') === userId)
                .map((r: any) => ({
                    name: r.name || productName[String(r.product_id)] || `Service #${r.id}`,
                    status: String(r.status ?? 'unknown'),
                    price: r.price != null ? String(r.price) : '',
                    renewsAt: r.expires_at || r.due_date || r.renews_at || undefined,
                }));
        } catch (error) {
            logger.error('Failed to get user services:', error);
            return [];
        }
    }

    /**
     * Get billing users
     */
    async getBillingUsers(): Promise<any[]> {
        const result = await this.paymenterApi('users');
        return result?.data || [];
    }

    async getBillingUserByEmail(email: string): Promise<any | null> {
        if (!email) return null;
        try {
            const users = await this.getBillingUsers();
            return users.find((user: any) => {
                const record = getResourceRecord(user);
                return String(record.email || '').toLowerCase() === email.toLowerCase();
            }) || null;
        } catch (error) {
            logger.error('Failed to lookup billing user:', error);
            return null;
        }
    }

    // ============================================
    // Audit Logging
    // ============================================

    /**
     * Log an audit event
     */
    async logAudit(
        adminId: string | null,
        adminEmail: string | null,
        action: string,
        targetType: string,
        targetId: string,
        details: Record<string, any> = {}
    ): Promise<void> {
        const { error } = await this.client
            .from('audit_logs')
            .insert({
                admin_id: adminId,
                admin_email: adminEmail,
                action,
                target_type: targetType,
                target_id: targetId,
                details,
            });

        if (error) {
            logger.error('Failed to log audit event:', error);
        }
    }

    // ============================================
    // Ticket Categories
    // ============================================

    /**
     * Get all enabled ticket categories for a guild
     */
    async getTicketCategories(guildId: string): Promise<any[]> {
        const { data, error } = await this.client
            .from('ticket_categories')
            .select('*')
            .eq('guild_id', guildId)
            .eq('enabled', true)
            .order('position', { ascending: true });

        if (error) {
            logger.error('Failed to get ticket categories:', error);
            return [];
        }
        return data || [];
    }

    /**
     * Get all ticket categories (including disabled) for admin
     */
    async getAllTicketCategories(guildId: string): Promise<any[]> {
        const { data, error } = await this.client
            .from('ticket_categories')
            .select('*')
            .eq('guild_id', guildId)
            .order('position', { ascending: true });

        if (error) {
            logger.error('Failed to get all ticket categories:', error);
            return [];
        }
        return data || [];
    }

    /**
     * Create a ticket category
     */
    async createTicketCategory(category: {
        guild_id: string;
        name: string;
        emoji?: string;
        description?: string;
        priority_default?: string;
        staff_roles?: string[];
        custom_questions?: any[];
        position?: number;
        discord_category_id?: string | null;
    }): Promise<any | null> {
        const { data, error } = await this.client
            .from('ticket_categories')
            .insert(category)
            .select()
            .single();

        if (error) {
            logger.error('Failed to create ticket category:', error);
            return null;
        }
        return data;
    }

    /**
     * Update a ticket category
     */
    async updateTicketCategory(id: string, updates: Partial<{
        name: string;
        emoji: string;
        description: string;
        priority_default: string;
        staff_roles: string[];
        custom_questions: any[];
        position: number;
        enabled: boolean;
        discord_category_id: string | null;
    }>): Promise<boolean> {
        const { error } = await this.client
            .from('ticket_categories')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id);

        if (error) {
            logger.error('Failed to update ticket category:', error);
            return false;
        }
        return true;
    }

    /**
     * Delete a ticket category
     */
    async deleteTicketCategory(id: string): Promise<boolean> {
        const { error } = await this.client
            .from('ticket_categories')
            .delete()
            .eq('id', id);

        if (error) {
            logger.error('Failed to delete ticket category:', error);
            return false;
        }
        return true;
    }

    /**
     * Get category by ID
     */
    async getTicketCategory(id: string): Promise<any | null> {
        const { data, error } = await this.client
            .from('ticket_categories')
            .select('*')
            .eq('id', id)
            .single();

        if (error && error.code !== 'PGRST116') {
            logger.error('Failed to get ticket category:', error);
        }
        return data;
    }

    // ============================================
    // Tickets
    // ============================================

    /**
     * Create a new ticket
     */
    async createTicket(ticketData: {
        guild_id: string;
        channel_id: string;
        user_id: string | null;
        discord_id: string;
        category_id: string;
        subject: string;
        description: string;
        email: string;
        priority?: string;
        custom_answers?: Record<string, string>;
    }): Promise<any | null> {
        const { data, error } = await this.client
            .from('tickets')
            .insert(ticketData)
            .select('*, category:ticket_categories(*)')
            .single();

        if (error) {
            logger.error('Failed to create ticket:', error);
            return null;
        }
        return data;
    }

    /**
     * Get ticket by ID
     */
    async getTicket(id: string): Promise<any | null> {
        const { data, error } = await this.client
            .from('tickets')
            .select('*, category:ticket_categories(*)')
            .eq('id', id)
            .single();

        if (error && error.code !== 'PGRST116') {
            logger.error('Failed to get ticket:', error);
        }
        return data;
    }

    /**
     * Get ticket by channel ID
     */
    async getTicketByChannel(channelId: string): Promise<any | null> {
        const { data, error } = await this.client
            .from('tickets')
            .select('*, category:ticket_categories(*)')
            .eq('channel_id', channelId)
            .single();

        if (error && error.code !== 'PGRST116') {
            logger.error('Failed to get ticket by channel:', error);
        }
        return data;
    }

    /**
     * Update ticket
     */
    async updateTicket(id: string, updates: Partial<{
        status: string;
        priority: string;
        claimed_by: string;
        claimed_by_name: string;
        linked_server_id: string;
        linked_invoice_id: string;
        closed_at: string;
    }>): Promise<boolean> {
        const { error } = await this.client
            .from('tickets')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id);

        if (error) {
            logger.error('Failed to update ticket:', error);
            return false;
        }
        return true;
    }

    /**
     * Get open tickets by user
     */
    async getOpenTicketsByUser(discordId: string): Promise<any[]> {
        const { data, error } = await this.client
            .from('tickets')
            .select('*, category:ticket_categories(*)')
            .eq('discord_id', discordId)
            .neq('status', 'closed')
            .order('created_at', { ascending: false });

        if (error) {
            logger.error('Failed to get user tickets:', error);
            return [];
        }
        return data || [];
    }

    /**
     * Get all tickets for a guild (admin)
     */
    async getGuildTickets(guildId: string, status?: string): Promise<any[]> {
        let query = this.client
            .from('tickets')
            .select('*, category:ticket_categories(*)')
            .eq('guild_id', guildId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (status) {
            query = query.eq('status', status);
        }

        const { data, error } = await query;

        if (error) {
            logger.error('Failed to get guild tickets:', error);
            return [];
        }
        return data || [];
    }

    /**
     * Get next ticket number for a guild
     */
    async getNextTicketNumber(guildId: string): Promise<number> {
        const { data, error } = await this.client
            .from('tickets')
            .select('ticket_number')
            .eq('guild_id', guildId)
            .order('ticket_number', { ascending: false })
            .limit(1)
            .single();

        if (error || !data) {
            return 1;
        }
        return (data.ticket_number || 0) + 1;
    }

    // ============================================
    // Ticket Messages
    // ============================================

    /**
     * Log a ticket message
     */
    async logTicketMessage(message: {
        ticket_id: string;
        author_discord_id: string;
        author_username: string;
        author_is_staff: boolean;
        content: string;
        attachments?: string[];
    }): Promise<boolean> {
        const { error } = await this.client
            .from('ticket_messages')
            .insert(message);

        if (error) {
            logger.error('Failed to log ticket message:', error);
            return false;
        }
        return true;
    }

    /**
     * Get ticket messages (for AI context)
     */
    async getTicketMessages(ticketId: string, limit = 50): Promise<any[]> {
        const { data, error } = await this.client
            .from('ticket_messages')
            .select('*')
            .eq('ticket_id', ticketId)
            .order('created_at', { ascending: true })
            .limit(limit);

        if (error) {
            logger.error('Failed to get ticket messages:', error);
            return [];
        }
        return data || [];
    }

    // ============================================
    // User Preferences
    // ============================================

    /**
     * Get user preferences
     */
    async getUserPreferences(discordId: string): Promise<any | null> {
        const { data, error } = await this.client
            .from('user_preferences')
            .select('*')
            .eq('discord_id', discordId)
            .single();

        if (error && error.code !== 'PGRST116') {
            logger.error('Failed to get user preferences:', error);
        }
        return data;
    }

    /**
     * Create or update user preferences
     */
    async upsertUserPreferences(discordId: string, userId: string, prefs: Partial<{
        dm_maintenance: boolean;
        dm_billing: boolean;
        dm_security: boolean;
        dm_promotions: boolean;
    }>): Promise<boolean> {
        const existing = await this.getUserPreferences(discordId);
        const { error } = await this.client
            .from('user_preferences')
            .upsert({
                discord_id: discordId,
                user_id: userId,
                ...(existing ? {} : DEFAULT_DM_PREFERENCES),
                ...prefs,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'discord_id' });

        if (error) {
            logger.error('Failed to upsert user preferences:', error);
            return false;
        }
        return true;
    }

    /**
     * Get all users opted in for a DM category
     */
    async getUsersOptedInForDM(category: 'maintenance' | 'billing' | 'security' | 'promotions'): Promise<string[]> {
        const column = `dm_${category}`;
        const { data: linkedAccounts, error: linkedError } = await this.client
            .from('discord_linked_accounts')
            .select('discord_id');

        if (linkedError) {
            logger.error(`Failed to get linked accounts for ${category} DMs:`, linkedError);
            return [];
        }

        const { data: optedOut, error } = await this.client
            .from('user_preferences')
            .select('discord_id')
            .eq(column, false);

        if (error) {
            logger.error(`Failed to get users opted in for ${category}:`, error);
            return [];
        }

        const optedOutIds = new Set((optedOut || []).map(u => u.discord_id));
        return (linkedAccounts || [])
            .map(account => account.discord_id)
            .filter(discordId => discordId && !optedOutIds.has(discordId));
    }

    // ============================================
    // Discord Announcements
    // ============================================

    /**
     * Create a new announcement
     */
    async createDiscordAnnouncement(announcement: {
        guild_id: string;
        title: string;
        content: string;
        type?: string;
        target?: string;
        dm_category?: string;
        channel_id?: string;
        scheduled_at?: string;
        created_by: string;
        created_by_name?: string;
    }): Promise<any | null> {
        const { data, error } = await this.client
            .from('discord_announcements')
            .insert({ ...announcement, status: 'draft' })
            .select()
            .single();

        if (error) {
            logger.error('Failed to create announcement:', error);
            return null;
        }
        return data;
    }

    /**
     * Get announcement by ID
     */
    async getDiscordAnnouncement(id: string): Promise<any | null> {
        const { data, error } = await this.client
            .from('discord_announcements')
            .select('*')
            .eq('id', id)
            .single();

        if (error && error.code !== 'PGRST116') {
            logger.error('Failed to get announcement:', error);
        }
        return data;
    }

    /**
     * Update announcement
     */
    async updateDiscordAnnouncement(id: string, updates: Partial<{
        title: string;
        content: string;
        type: string;
        target: string;
        dm_category: string;
        status: string;
        sent_count: number;
        failed_count: number;
        completed_at: string;
    }>): Promise<boolean> {
        const { error } = await this.client
            .from('discord_announcements')
            .update(updates)
            .eq('id', id);

        if (error) {
            logger.error('Failed to update announcement:', error);
            return false;
        }
        return true;
    }

    /**
     * Get recent announcements for a guild
     */
    async getGuildAnnouncements(guildId: string, limit = 10): Promise<any[]> {
        const { data, error } = await this.client
            .from('discord_announcements')
            .select('*')
            .eq('guild_id', guildId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            logger.error('Failed to get guild announcements:', error);
            return [];
        }
        return data || [];
    }

    /**
     * Increment announcement counters
     */
    async incrementAnnouncementCounters(id: string, sent: number, failed: number): Promise<boolean> {
        const current = await this.getDiscordAnnouncement(id);
        if (!current) return false;

        return this.updateDiscordAnnouncement(id, {
            sent_count: (current.sent_count || 0) + sent,
            failed_count: (current.failed_count || 0) + failed,
        });
    }

    // ============================================
    // Admin Discord DM Queue
    // ============================================

    async getPendingDiscordDms(limit = 10): Promise<any[]> {
        const { data, error } = await this.client
            .from('discord_dm_queue')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .limit(limit);

        if (error) {
            logger.error('Failed to get pending Discord DMs:', error);
            return [];
        }
        return data || [];
    }

    async claimDiscordDm(id: string): Promise<any | null> {
        const { data, error } = await this.client
            .from('discord_dm_queue')
            .update({ status: 'sending', error_message: null })
            .eq('id', id)
            .eq('status', 'pending')
            .select('*')
            .maybeSingle();

        if (error) {
            logger.error('Failed to claim Discord DM:', error);
            return null;
        }
        return data;
    }

    async markDiscordDmSent(id: string): Promise<boolean> {
        const { error } = await this.client
            .from('discord_dm_queue')
            .update({
                status: 'sent',
                sent_at: new Date().toISOString(),
                error_message: null,
            })
            .eq('id', id);

        if (error) {
            logger.error('Failed to mark Discord DM sent:', error);
            return false;
        }
        return true;
    }

    async markDiscordDmFailed(id: string, errorMessage: string): Promise<boolean> {
        const { error } = await this.client
            .from('discord_dm_queue')
            .update({
                status: 'failed',
                error_message: errorMessage.slice(0, 500),
            })
            .eq('id', id);

        if (error) {
            logger.error('Failed to mark Discord DM failed:', error);
            return false;
        }
        return true;
    }

    /**
     * Queue a new Discord DM notification (used by billing webhook and other services)
     */
    async queueDiscordDm(params: {
        discord_id: string;
        notification_type?: string;
        subject: string;
        message: string;
        metadata?: Record<string, any>;
    }): Promise<any | null> {
        const { data, error } = await this.client
            .from('discord_dm_queue')
            .insert({
                discord_id: params.discord_id,
                notification_type: params.notification_type || null,
                subject: params.subject,
                message: params.message,
                metadata: params.metadata || null,
                status: 'pending',
            })
            .select()
            .single();

        if (error) {
            logger.error('Failed to queue Discord DM:', error);
            return null;
        }
        return data;
    }

    // ============================================
    // Custom Embeds
    // ============================================

    async getCustomEmbed(guildId: string, name: string): Promise<CustomEmbed | null> {
        const { data, error } = await this.client
            .from('custom_embeds')
            .select('*')
            .eq('guild_id', guildId)
            .eq('name', name)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            logger.error(`Failed to get custom embed ${name} for ${guildId}:`, error);
            return null;
        }
        return data;
    }

    async saveCustomEmbed(guildId: string, name: string, embed: Partial<CustomEmbed>): Promise<boolean> {
        const existing = await this.getCustomEmbed(guildId, name);
        if (existing) {
            const { error } = await this.client
                .from('custom_embeds')
                .update({
                    ...embed,
                    updated_at: new Date().toISOString()
                })
                .eq('id', existing.id);

            if (error) {
                logger.error(`Failed to update custom embed ${name} for ${guildId}:`, error);
                return false;
            }
        } else {
            const { error } = await this.client
                .from('custom_embeds')
                .insert({
                    guild_id: guildId,
                    name: name,
                    ...embed,
                    updated_at: new Date().toISOString()
                });

            if (error) {
                logger.error(`Failed to insert custom embed ${name} for ${guildId}:`, error);
                return false;
            }
        }
        return true;
    }

    async deleteCustomEmbed(guildId: string, name: string): Promise<boolean> {
        const { error } = await this.client
            .from('custom_embeds')
            .delete()
            .eq('guild_id', guildId)
            .eq('name', name);

        if (error) {
            logger.error(`Failed to delete custom embed ${name} for ${guildId}:`, error);
            return false;
        }
        return true;
    }

    async listCustomEmbeds(guildId: string): Promise<CustomEmbed[]> {
        const { data, error } = await this.client
            .from('custom_embeds')
            .select('*')
            .eq('guild_id', guildId)
            .order('name', { ascending: true });

        if (error) {
            logger.error(`Failed to list custom embeds for ${guildId}:`, error);
            return [];
        }
        return data || [];
    }

    async getEmbedSettings(guildId: string): Promise<EmbedSettings | null> {
        const { data, error } = await this.client
            .from('embed_settings')
            .select('*')
            .eq('guild_id', guildId)
            .maybeSingle();

        if (error) {
            logger.error(`Failed to get embed settings for ${guildId}:`, error);
            return null;
        }
        return data;
    }

    async updateEmbedSettings(guildId: string, settings: Partial<EmbedSettings>): Promise<boolean> {
        const { error } = await this.client
            .from('embed_settings')
            .upsert({
                guild_id: guildId,
                ...settings,
                updated_at: new Date().toISOString()
            });

        if (error) {
            logger.error(`Failed to update embed settings for ${guildId}:`, error);
            return false;
        }
        return true;
    }

    // ============================================
    // Suggestions
    // ============================================

    async createSuggestion(
        guildId: string,
        channelId: string,
        messageId: string,
        userId: string,
        authorTag: string,
        title: string,
        content: string
    ): Promise<Suggestion | null> {
        const { data, error } = await this.client
            .from('suggestions')
            .insert({
                guild_id: guildId,
                channel_id: channelId,
                message_id: messageId,
                user_id: userId,
                author_tag: authorTag,
                title: title,
                content: content,
                status: 'pending'
            })
            .select()
            .single();

        if (error) {
            logger.error('Failed to create suggestion:', error);
            return null;
        }
        return data;
    }

    async getSuggestion(id: number): Promise<Suggestion | null> {
        const { data, error } = await this.client
            .from('suggestions')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (error) {
            logger.error(`Failed to get suggestion #${id}:`, error);
            return null;
        }
        return data;
    }

    async getSuggestionByMessage(messageId: string): Promise<Suggestion | null> {
        const { data, error } = await this.client
            .from('suggestions')
            .select('*')
            .eq('message_id', messageId)
            .maybeSingle();

        if (error) {
            logger.error(`Failed to get suggestion for message ${messageId}:`, error);
            return null;
        }
        return data;
    }

    async updateSuggestionStatus(id: number, status: 'pending' | 'approved' | 'denied' | 'implemented'): Promise<boolean> {
        const { error } = await this.client
            .from('suggestions')
            .update({ status: status, updated_at: new Date().toISOString() })
            .eq('id', id);

        if (error) {
            logger.error(`Failed to update suggestion status for #${id}:`, error);
            return false;
        }
        return true;
    }

    async toggleSuggestionLock(id: number): Promise<boolean> {
        const suggestion = await this.getSuggestion(id);
        if (!suggestion) return false;

        const { error } = await this.client
            .from('suggestions')
            .update({ locked: !suggestion.locked, updated_at: new Date().toISOString() })
            .eq('id', id);

        if (error) {
            logger.error(`Failed to toggle suggestion lock for #${id}:`, error);
            return false;
        }
        return true;
    }

    async deleteSuggestion(id: number): Promise<boolean> {
        const { error } = await this.client
            .from('suggestions')
            .delete()
            .eq('id', id);

        if (error) {
            logger.error(`Failed to delete suggestion #${id}:`, error);
            return false;
        }
        return true;
    }

    async addSuggestionVote(
        suggestionId: number,
        userId: string,
        username: string,
        voteType: 'up' | 'down'
    ): Promise<boolean> {
        const { error } = await this.client
            .from('suggestion_votes')
            .upsert(
                {
                    suggestion_id: suggestionId,
                    user_id: userId,
                    username: username,
                    vote_type: voteType,
                    created_at: new Date().toISOString()
                },
                { onConflict: 'suggestion_id,user_id' }
            );

        if (error) {
            logger.error(`Failed to add suggestion vote for #${suggestionId} by ${userId}:`, error);
            return false;
        }
        return true;
    }

    async removeSuggestionVote(suggestionId: number, userId: string): Promise<boolean> {
        const { error } = await this.client
            .from('suggestion_votes')
            .delete()
            .eq('suggestion_id', suggestionId)
            .eq('user_id', userId);

        if (error) {
            logger.error(`Failed to remove suggestion vote for #${suggestionId} by ${userId}:`, error);
            return false;
        }
        return true;
    }

    async getSuggestionVoteCounts(suggestionId: number): Promise<{ up: number; down: number }> {
        const { data, error } = await this.client
            .from('suggestion_votes')
            .select('vote_type')
            .eq('suggestion_id', suggestionId);

        if (error) {
            logger.error(`Failed to get suggestion vote counts for #${suggestionId}:`, error);
            return { up: 0, down: 0 };
        }

        const counts = { up: 0, down: 0 };
        data?.forEach((v: { vote_type: string }) => {
            if (v.vote_type === 'up') counts.up++;
            else if (v.vote_type === 'down') counts.down++;
        });
        return counts;
    }

    async getSuggestionVotes(suggestionId: number): Promise<SuggestionVote[]> {
        const { data, error } = await this.client
            .from('suggestion_votes')
            .select('*')
            .eq('suggestion_id', suggestionId)
            .order('created_at', { ascending: false });

        if (error) {
            logger.error(`Failed to get suggestion votes for #${suggestionId}:`, error);
            return [];
        }
        return data || [];
    }

    // ============================================
    // Giveaways
    // ============================================

    async createGiveaway(
        guildId: string,
        channelId: string,
        messageId: string,
        prize: string,
        duration: string,
        winnersCount: number,
        endsAt: Date,
        hostId: string,
        requirements: any,
        bonusEntries: any
    ): Promise<Giveaway | null> {
        const { data, error } = await this.client
            .from('giveaways')
            .insert({
                guild_id: guildId,
                channel_id: channelId,
                message_id: messageId,
                prize: prize,
                duration: duration,
                winners_count: winnersCount,
                ends_at: endsAt.toISOString(),
                host_id: hostId,
                requirements: requirements,
                bonus_entries: bonusEntries,
                status: 'active',
                participants: [],
                winners: []
            })
            .select()
            .single();

        if (error) {
            logger.error('Failed to create giveaway:', error);
            return null;
        }
        return data;
    }

    async getGiveaway(idOrMessageId: string): Promise<Giveaway | null> {
        const { data, error } = await this.client
            .from('giveaways')
            .select('*')
            .or(`id.eq.${idOrMessageId},message_id.eq.${idOrMessageId}`)
            .maybeSingle();

        if (error) {
            logger.error(`Failed to get giveaway ${idOrMessageId}:`, error);
            return null;
        }
        return data;
    }

    async updateGiveaway(id: string, updates: Partial<Giveaway>): Promise<boolean> {
        const { error } = await this.client
            .from('giveaways')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id);

        if (error) {
            logger.error(`Failed to update giveaway ${id}:`, error);
            return false;
        }
        return true;
    }

    async listGiveaways(guildId: string, activeOnly = false): Promise<Giveaway[]> {
        let query = this.client
            .from('giveaways')
            .select('*')
            .eq('guild_id', guildId);

        if (activeOnly) {
            query = query.eq('status', 'active');
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) {
            logger.error(`Failed to list giveaways for ${guildId}:`, error);
            return [];
        }
        return data || [];
    }

    async deleteGiveaway(id: string): Promise<boolean> {
        const { error } = await this.client
            .from('giveaways')
            .delete()
            .eq('id', id);

        if (error) {
            logger.error(`Failed to delete giveaway ${id}:`, error);
            return false;
        }
        return true;
    }

    // ============================================
    // Custom Commands
    // ============================================

    async createCustomCommand(guildId: string, cmd: Partial<CustomCommand>): Promise<boolean> {
        const { error } = await this.client
            .from('custom_commands')
            .upsert({
                guild_id: guildId,
                name: cmd.name,
                ...cmd,
                updated_at: new Date().toISOString()
            });

        if (error) {
            logger.error(`Failed to create custom command ${cmd.name} for ${guildId}:`, error);
            return false;
        }
        return true;
    }

    async deleteCustomCommand(guildId: string, name: string): Promise<boolean> {
        const { error } = await this.client
            .from('custom_commands')
            .delete()
            .eq('guild_id', guildId)
            .eq('name', name);

        if (error) {
            logger.error(`Failed to delete custom command ${name} for ${guildId}:`, error);
            return false;
        }
        return true;
    }

    async listCustomCommands(guildId: string): Promise<CustomCommand[]> {
        const { data, error } = await this.client
            .from('custom_commands')
            .select('*')
            .eq('guild_id', guildId)
            .order('name', { ascending: true });

        if (error) {
            logger.error(`Failed to list custom commands for ${guildId}:`, error);
            return [];
        }
        return data || [];
    }

    async getCustomCommand(guildId: string, name: string): Promise<CustomCommand | null> {
        const { data, error } = await this.client
            .from('custom_commands')
            .select('*')
            .eq('guild_id', guildId);

        if (error) {
            logger.error(`Failed to get custom command ${name} for ${guildId}:`, error);
            return null;
        }
        if (!data) return null;

        const command = data.find(c => c.name.toLowerCase() === name.toLowerCase() || 
            (Array.isArray(c.aliases) && c.aliases.some((a: string) => a.toLowerCase() === name.toLowerCase()))
        );
        return command || null;
    }

    async updateCustomCommand(guildId: string, name: string, updates: Partial<CustomCommand>): Promise<boolean> {
        const { error } = await this.client
            .from('custom_commands')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('guild_id', guildId)
            .eq('name', name);

        if (error) {
            logger.error(`Failed to update custom command ${name} for ${guildId}:`, error);
            return false;
        }
        return true;
    }
}

export const supabase = new SupabaseService();
