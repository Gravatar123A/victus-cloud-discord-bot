import {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    SlashCommandOptionsOnlyBuilder,
    SlashCommandSubcommandsOnlyBuilder,
    ButtonInteraction,
    StringSelectMenuInteraction,
    ModalSubmitInteraction,
    AutocompleteInteraction,
} from 'discord.js';

// ============================================
// Command Types
// ============================================

export interface Command {
    data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
    execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
    autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
    handleButton?: (interaction: ButtonInteraction) => Promise<void>;
    handleSelectMenu?: (interaction: StringSelectMenuInteraction) => Promise<void>;
    handleModal?: (interaction: ModalSubmitInteraction) => Promise<void>;
    requiresLink?: boolean; // If true, user must have linked account
    adminOnly?: boolean; // If true, user must be admin
    cooldown?: number; // Cooldown in seconds
}

export interface Event {
    name: string;
    once?: boolean;
    execute: (...args: any[]) => Promise<void>;
}

// ============================================
// Component Types
// ============================================

export interface ButtonHandler {
    customId: string | RegExp;
    execute: (interaction: ButtonInteraction) => Promise<void>;
}

export interface SelectMenuHandler {
    customId: string | RegExp;
    execute: (interaction: StringSelectMenuInteraction) => Promise<void>;
}

export interface ModalHandler {
    customId: string | RegExp;
    execute: (interaction: ModalSubmitInteraction) => Promise<void>;
}

// ============================================
// API Response Types
// ============================================

export interface LinkedAccount {
    id: string;
    user_id: string;
    discord_id: string;
    discord_username: string;
    discord_avatar: string | null;
    linked_at: string;
}

export interface LinkToken {
    id: string;
    discord_id: string;
    discord_username: string;
    token: string;
    expires_at: string;
    used: boolean;
}

export interface UserProfile {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    full_name?: string | null;
    username?: string | null;
    is_admin: boolean;
    billing_panel_created?: boolean;
    billing_account_created?: boolean;
    control_panel_created: boolean;
    victus_drive_created?: boolean;
    avatar_url: string | null;
    credits?: number | string | null;
    credit?: number | string | null;
    balance?: number | string | null;
    paymenter_credits?: number | string | null;
    created_at: string;
}

// ============================================
// Pterodactyl Types
// ============================================

export interface PterodactylServer {
    id: number;
    identifier: string;
    uuid: string;
    name: string;
    description: string;
    status: string | null;
    is_suspended: boolean;
    limits: {
        memory: number;
        disk: number;
        cpu: number;
    };
    feature_limits: {
        databases: number;
        backups: number;
        allocations: number;
    };
    user: number;
    node: number;
    allocation: number;
}

export interface PterodactylServerStats {
    current_state: 'running' | 'starting' | 'stopping' | 'offline';
    is_suspended: boolean;
    resources: {
        memory_bytes: number;
        cpu_absolute: number;
        disk_bytes: number;
        network_rx_bytes: number;
        network_tx_bytes: number;
        uptime: number;
    };
}

export interface PterodactylBackup {
    uuid: string;
    name: string;
    ignored_files: string[];
    sha256_hash: string | null;
    bytes: number;
    created_at: string;
    completed_at: string | null;
    is_successful: boolean;
    is_locked: boolean;
}

// ============================================
// Paymenter Types
// ============================================

export interface PaymenterService {
    id: number;
    user_id: number;
    product_id: number;
    product_name: string;
    status: 'active' | 'suspended' | 'cancelled' | 'pending';
    price: number;
    billing_cycle: string;
    due_date: string | null;
    created_at: string;
}

export interface PaymenterInvoice {
    id: number;
    user_id: number;
    total: number;
    status: 'paid' | 'unpaid' | 'cancelled' | 'refunded';
    due_date: string;
    paid_at: string | null;
    created_at: string;
    items: PaymenterInvoiceItem[];
}

export interface PaymenterInvoiceItem {
    id: number;
    description: string;
    price: number;
    quantity: number;
}

// ============================================
// Ticket Types
// ============================================

export interface Ticket {
    id: string;
    ticket_number: number;
    guild_id: string;
    channel_id: string | null;
    user_id: string;
    discord_id: string;
    category_id: string;
    subject: string;
    description: string;
    email: string;
    status: 'open' | 'claimed' | 'locked' | 'closed';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    claimed_by: string | null;
    claimed_by_name: string | null;
    linked_server_id: string | null;
    linked_invoice_id: string | null;
    custom_answers: Record<string, string>;
    created_at: string;
    updated_at: string;
    closed_at: string | null;
    // Joined fields
    category?: TicketCategory;
}

export interface TicketCategory {
    id: string;
    guild_id: string;
    name: string;
    emoji: string;
    description: string | null;
    priority_default: 'low' | 'medium' | 'high' | 'urgent';
    staff_roles: string[];
    custom_questions: TicketQuestion[];
    position: number;
    enabled: boolean;
    discord_category_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface TicketQuestion {
    id: string;
    label: string;
    placeholder?: string;
    type: 'short' | 'paragraph';
    required: boolean;
    max_length?: number;
}

export interface TicketMessage {
    id: string;
    ticket_id: string;
    author_discord_id: string;
    author_username: string | null;
    author_is_staff: boolean;
    content: string;
    attachments: string[];
    created_at: string;
}

export interface UserPreferences {
    id: string;
    user_id: string;
    discord_id: string;
    dm_maintenance: boolean;
    dm_billing: boolean;
    dm_security: boolean;
    dm_promotions: boolean;
    created_at: string;
    updated_at: string;
}

export interface Announcement {
    id: string;
    guild_id: string;
    title: string;
    content: string;
    type: 'info' | 'warning' | 'success' | 'error';
    target: 'channel' | 'dm' | 'both';
    dm_category: 'maintenance' | 'billing' | 'security' | 'promotions' | null;
    channel_id: string | null;
    status: 'draft' | 'scheduled' | 'sending' | 'completed' | 'cancelled';
    scheduled_at: string | null;
    sent_count: number;
    failed_count: number;
    created_by: string;
    created_by_name: string | null;
    created_at: string;
    completed_at: string | null;
}

// ============================================
// Embed Theme
// ============================================

export const VICTUS_COLORS = {
    primary: 0x6366f1,    // Indigo
    success: 0x10b981,    // Emerald
    warning: 0xf59e0b,    // Amber
    error: 0xef4444,      // Red
    info: 0x3b82f6,       // Blue
    neutral: 0x64748b,    // Slate
} as const;

export type VictusColor = keyof typeof VICTUS_COLORS;
