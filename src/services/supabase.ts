import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { LinkedAccount, LinkToken, UserProfile } from '../types/index.js';

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

class SupabaseService {
    private client: SupabaseClient;

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
    async getAllLinkedAccounts(): Promise<{ discord_id: string }[]> {
        const { data, error } = await this.client
            .from('discord_linked_accounts')
            .select('discord_id');

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
    async getBotSettings(guildId: string): Promise<any | null> {
        const { data, error } = await this.client
            .from('bot_settings')
            .select('*')
            .eq('guild_id', guildId)
            .single();

        if (error && error.code !== 'PGRST116') {
            logger.error(`Failed to get bot settings for ${guildId}:`, error);
        }
        return data;
    }

    /**
     * Update bot settings
     */
    async updateBotSettings(guildId: string, settings: { linked_role_id?: string; log_channel_id?: string; ai_channel_id?: string | null }): Promise<boolean> {
        const { error } = await this.client
            .from('bot_settings')
            .upsert({
                guild_id: guildId,
                ...settings,
                updated_at: new Date().toISOString()
            });

        if (error) {
            logger.error(`Failed to update bot settings for ${guildId}:`, error);
            return false;
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

    /**
     * Check if user is admin
     */
    async isUserAdmin(userId: string): Promise<boolean> {
        const profile = await this.getUserProfile(userId);
        return profile?.is_admin ?? false;
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
            logger.error(`Pterodactyl API call failed (${endpoint}):`, error);
            if (error instanceof Error) {
                logger.error('Error details:', error.message);
            }
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

    private async getPaymenterCreditsByEmail(email: string): Promise<CreditBalance> {
        const encodedEmail = encodeURIComponent(email);
        const userLookups = [
            `/api/v1/admin/users?filter[email]=${encodedEmail}&include=credits&per_page=5`,
            `/api/admin/users?filter[email]=${encodedEmail}&include=credits&per_page=5`,
            `/api/v1/admin/users?search=${encodedEmail}&include=credits&per_page=5`,
            `/api/admin/users?search=${encodedEmail}&include=credits&per_page=5`,
        ];

        let matchedUser: any = null;
        let userPayload: any = null;
        for (const path of userLookups) {
            const payload = await this.paymenterDirect(path);
            const users = asArray(payload?.data ?? payload);
            matchedUser = users.find((user) => String(getResourceRecord(user).email || '').toLowerCase() === email.toLowerCase());
            if (matchedUser) {
                userPayload = payload;
                break;
            }
        }

        if (!matchedUser) return { amount: 0, currency: 'USD', found: false, source: 'none' };

        const directAmount = pickAmount(matchedUser);
        if (directAmount !== null) {
            return { amount: directAmount, currency: pickCurrency(matchedUser), found: true, source: 'paymenter' };
        }

        const includedCredits = asArray(userPayload?.included).filter((item) => {
            const type = String(item.type || '').toLowerCase();
            return type === 'credit' || type === 'credits';
        });
        const credits = includedCredits
            .map((credit) => ({ amount: pickAmount(credit), currency: pickCurrency(credit) }))
            .filter((credit): credit is { amount: number; currency: string } => credit.amount !== null);

        const userId = getResourceRecord(matchedUser).id ?? matchedUser.id;
        if (credits.length === 0 && userId) {
            const creditLookups = [
                `/api/v1/admin/credits?filter[user_id]=${encodeURIComponent(String(userId))}&per_page=100`,
                `/api/admin/credits?filter[user_id]=${encodeURIComponent(String(userId))}&per_page=100`,
                `/api/v1/admin/users/${encodeURIComponent(String(userId))}?include=credits`,
                `/api/admin/users/${encodeURIComponent(String(userId))}?include=credits`,
            ];

            for (const path of creditLookups) {
                const payload = await this.paymenterDirect(path);
                const creditRows = path.includes('/users/')
                    ? asArray(payload?.included).filter((item) => {
                        const type = String(item.type || '').toLowerCase();
                        return type === 'credit' || type === 'credits';
                    })
                    : asArray(payload?.data ?? payload);

                credits.push(...creditRows
                    .map((credit) => ({ amount: pickAmount(credit), currency: pickCurrency(credit) }))
                    .filter((credit): credit is { amount: number; currency: string } => credit.amount !== null));

                if (credits.length > 0) break;
            }
        }

        if (credits.length === 0) return { amount: 0, currency: 'USD', found: true, source: 'paymenter' };

        const totals = credits.reduce<Record<string, number>>((acc, credit) => {
            acc[credit.currency] = (acc[credit.currency] || 0) + credit.amount;
            return acc;
        }, {});
        const [currency = 'USD', amount = 0] = Object.entries(totals).sort((a, b) => b[1] - a[1])[0] || [];
        return { amount, currency, found: true, source: 'paymenter' };
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
            logger.error(`Paymenter API call failed (${endpoint}):`, error);
            if (error instanceof Error) {
                logger.error('Error details:', error.message);
            }
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
        user_id: string;
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
}

export const supabase = new SupabaseService();
