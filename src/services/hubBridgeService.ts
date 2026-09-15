import type { Client, Guild, Message, TextChannel, NewsChannel } from 'discord.js';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';

export interface HubBridgeConfig {
    enabled: boolean;
    channelId: string | null;
    webhookUrl: string | null;
    minecraftEndpoint: string;
    secret: string;
}

const DEFAULT_CONFIG: HubBridgeConfig = {
    enabled: true,
    channelId: process.env.HUB_BRIDGE_CHANNEL_ID || '1416377943776559204',
    webhookUrl: process.env.HUB_BRIDGE_WEBHOOK_URL || null,
    minecraftEndpoint: process.env.HUB_BRIDGE_ENDPOINT || 'http://172.18.0.4:25588',
    secret: process.env.HUB_BRIDGE_SECRET || 'victus_hub_bridge_secret',
};

export class HubBridgeService {
    private client: Client | null = null;
    private cachedConfig: HubBridgeConfig = { ...DEFAULT_CONFIG };
    private initialized = false;

    /**
     * Start the hub bridge service and preload configuration
     */
    public async start(client: Client): Promise<void> {
        this.client = client;
        try {
            // Find primary guild to load config
            const guild = client.guilds.cache.first();
            if (guild) {
                const cfg = await this.getConfig(guild.id);
                this.cachedConfig = cfg;

                // Auto-provision webhook if channel is set but webhook is missing
                if (cfg.channelId && !cfg.webhookUrl) {
                    try {
                        const ch = await client.channels.fetch(cfg.channelId).catch(() => null);
                        if (ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)) {
                            const textCh = ch as TextChannel;
                            const webhooks = await textCh.fetchWebhooks().catch(() => null);
                            let webhook = webhooks?.find((w) => w.name === 'Victus Hub Bridge');
                            if (!webhook) {
                                webhook = await textCh.createWebhook({
                                    name: 'Victus Hub Bridge',
                                    avatar: 'https://cdn.discordapp.com/app-icons/1445385853777215510/4b6e5b2c73200130dbb1e42f9e4ea096.png',
                                    reason: 'Main Hub Discord Chat and Join/Leave Synchronization Bridge',
                                });
                            }
                            this.cachedConfig.webhookUrl = webhook.url;
                            await this.saveConfig(guild.id, { webhookUrl: webhook.url });
                            // Notify Minecraft hub
                            await fetch(`${this.cachedConfig.minecraftEndpoint}/api/configure`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    channelId: cfg.channelId,
                                    webhookUrl: webhook.url,
                                    secret: this.cachedConfig.secret,
                                }),
                                signal: AbortSignal.timeout(4000),
                            }).catch(() => {});
                        }
                    } catch (e) {
                        logger.warn('[hubBridgeService] Could not auto-provision webhook:', e);
                    }
                }
            }
            this.initialized = true;
            logger.info(`🌉 HubBridgeService initialized. Linked channel: ${this.cachedConfig.channelId || 'none'}, Webhook: ${this.cachedConfig.webhookUrl ? 'ready' : 'none'}`);
        } catch (err) {
            logger.error('Failed to initialize HubBridgeService:', err);
        }
    }

    /**
     * Retrieve hub bridge configuration for a guild
     */
    public async getConfig(guildId: string): Promise<HubBridgeConfig> {
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_hub_bridge_settings');
            if (embed?.description) {
                const parsed = JSON.parse(embed.description);
                return { ...DEFAULT_CONFIG, ...parsed };
            }
        } catch (err) {
            logger.error(`Failed to get hub bridge config for guild ${guildId}:`, err);
        }
        return this.cachedConfig;
    }

    /**
     * Save hub bridge configuration
     */
    public async saveConfig(guildId: string, updates: Partial<HubBridgeConfig>): Promise<HubBridgeConfig> {
        const current = await this.getConfig(guildId);
        const updated = { ...current, ...updates };
        try {
            await supabase.saveCustomEmbed(guildId, '_hub_bridge_settings', {
                description: JSON.stringify(updated),
            });
            this.cachedConfig = updated;
        } catch (err) {
            logger.error(`Failed to save hub bridge config for guild ${guildId}:`, err);
        }
        return updated;
    }

    /**
     * Link and configure a Discord channel for the Minecraft Main Hub bridge
     */
    public async setupChannel(
        guild: Guild,
        channel: TextChannel | NewsChannel
    ): Promise<{ webhookUrl: string; hubConnected: boolean }> {
        // Ensure bot permissions in target channel
        const perms = channel.permissionsFor(guild.members.me!);
        if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.ManageWebhooks)) {
            throw new Error(`The bot needs **Send Messages** and **Manage Webhooks** permissions in <#${channel.id}>.`);
        }

        // Find or create webhook for Minecraft player skins & names
        let webhook = (await channel.fetchWebhooks()).find((w) => w.name === 'Victus Hub Bridge');
        if (!webhook) {
            webhook = await channel.createWebhook({
                name: 'Victus Hub Bridge',
                avatar: 'https://cdn.discordapp.com/app-icons/1445385853777215510/4b6e5b2c73200130dbb1e42f9e4ea096.png',
                reason: 'Main Hub Discord Chat and Join/Leave Synchronization Bridge',
            });
        }

        const webhookUrl = webhook.url;

        // Persist configuration in database
        const updated = await this.saveConfig(guild.id, {
            enabled: true,
            channelId: channel.id,
            webhookUrl,
        });

        // Push configuration to Minecraft server via internal HTTP endpoint
        let hubConnected = false;
        try {
            const res = await fetch(`${updated.minecraftEndpoint}/api/configure`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    channelId: channel.id,
                    webhookUrl,
                    secret: updated.secret,
                }),
                signal: AbortSignal.timeout(4000),
            });
            hubConnected = res.ok;
        } catch (e) {
            logger.warn(`Could not push bridge config to Minecraft hub endpoint (${updated.minecraftEndpoint}):`, e);
        }

        // Send confirmation announcement to the channel
        await channel.send({
            content:
                '🟢 **Victus Main Hub Discord Bridge Connected**\n' +
                'This channel is now synchronized with the Victus Minecraft Main Hub (`Lobby #344`).\n' +
                '• In-game chat and Discord messages will sync bidirectionally.\n' +
                '• In-game join and leave events will broadcast here with player heads.\n' +
                `• Bridge status: ${hubConnected ? '✅ **Active & Synchronized**' : '⚠️ **Configured (waiting for hub reload)**'}`,
        }).catch(() => undefined);

        return { webhookUrl, hubConnected };
    }

    /**
     * Relays incoming Discord messages from the bridged channel to Minecraft
     */
    public async relayDiscordToMinecraft(message: Message): Promise<void> {
        try {
            if (message.author?.bot) return;
            if (message.webhookId) return;

            // Check if message is in the linked channel
            const targetChannelId = this.cachedConfig.channelId;
            if (!targetChannelId || message.channelId !== targetChannelId) return;

            let content = (message.cleanContent || message.content || '').trim();
            if (!content && message.attachments.size > 0) {
                content = '[Attachment: ' + message.attachments.first()?.name + ']';
            } else if (content && message.attachments.size > 0) {
                content += ' [Attachment]';
            }

            if (!content) return;

            const author = message.member?.displayName || message.author.username || 'Discord User';

            await fetch(`${this.cachedConfig.minecraftEndpoint}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    author,
                    content,
                    secret: this.cachedConfig.secret,
                }),
                signal: AbortSignal.timeout(3000),
            });
        } catch (err) {
            logger.debug(`[hubBridgeService] error relaying to Minecraft: ${err}`);
        }
    }

    /**
     * Query status of the Minecraft Hub bridge
     */
    public async getHubStatus(): Promise<{ online: boolean; players?: number; channelId?: string; hasWebhook?: boolean }> {
        try {
            const res = await fetch(`${this.cachedConfig.minecraftEndpoint}/api/status`, {
                signal: AbortSignal.timeout(3000),
            });
            if (!res.ok) return { online: false };
            const data = (await res.json()) as any;
            return {
                online: data.status === 'online',
                players: data.onlinePlayers,
                channelId: data.channelId,
                hasWebhook: data.hasWebhook,
            };
        } catch {
            return { online: false };
        }
    }
}

export const hubBridgeService = new HubBridgeService();
