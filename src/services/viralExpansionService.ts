import { Client, Guild, TextChannel, User, Message, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { viralExpansionStore, BotGuild, BotWorldBoss, BotAllianceWar } from './viralExpansionStore.js';
import { CoinTransactionLock } from './coinTransactionLock.js';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { config } from '../config.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

export class ViralExpansionService {
    private client: Client | null = null;
    private airdropCooldowns = new Map<string, number>(); // guildId -> next allowed drop timestamp
    private activeAirDrops = new Map<string, { messageId: string; channelId: string; coins: number; expiresAt: number }>();

    init(client: Client): void {
        this.client = client;
        logger.info('ViralExpansionService initialized');

        // Check for dead chat airdrops every 5 minutes
        setInterval(() => this.checkDeadChatAirDrops(), 5 * 60 * 1000);

        // Check boss decay and war expiration every 1 minute
        setInterval(() => this.tickBossAndWars(), 60 * 1000);
    }

    // ============================================
    // MODULE A: FIRST INTERACTION BONUS (+5 COINS TO OWNER)
    // ============================================

    /**
     * Checks if a user's command is their first command globally across the bot network.
     * If so and account age > 7 days, awards +5 COINS to the guild owner!
     */
    async handleCommandInteraction(user: User, guild: Guild | null): Promise<void> {
        if (!guild || user.bot) return;

        try {
            // Guardrail 1: Account age must be > 7 days
            const accountAgeMs = Date.now() - user.createdTimestamp;
            if (accountAgeMs < SEVEN_DAYS_MS) {
                return;
            }

            // Guardrail 2: Global 1-time check
            const botUser = await viralExpansionStore.getUser(user.id);
            if (botUser.global_claim_flag) {
                return;
            }

            // Mark as claimed immediately to prevent race conditions
            await viralExpansionStore.setUserGlobalClaim(user.id, guild.id);

            // Award 5 COINS to guild owner
            const ownerId = guild.ownerId;
            if (!ownerId || ownerId === user.id) return; // avoid self-farming

            const ownerVictus = await CoinTransactionLock.resolveLinkedUser(ownerId);
            if (!ownerVictus) {
                logger.info(`Server owner ${ownerId} of ${guild.name} is not linked to Victus Cloud; +5 COINS pending link.`);
                return;
            }

            const grantRes = await CoinTransactionLock.grantCoins(
                ownerId,
                5,
                'owner_unique_user_bonus',
                `first_cmd:${guild.id}:${user.id}`,
                `First interaction bonus from ${user.username} in ${guild.name}`
            );

            if (grantRes.success) {
                logger.info(`Granted +5 COINS to owner ${ownerVictus.email} for first command by ${user.username} in ${guild.name}`);
            }

            // Award Guild Battle Pass XP (+25 XP for first unique user interaction)
            await this.addGuildActivityXp(guild.id, 25, guild.ownerId);
        } catch (err) {
            logger.error('Error in handleCommandInteraction:', err);
        }
    }

    // ============================================
    // MODULE A: PANEL REFERRAL SIGNUP (+30 COINS TO OWNER)
    // ============================================

    /**
     * Called when a referred user verifies their email on Victus Cloud.
     */
    async handleReferralVerified(guildId: string, referredDiscordId: string, referredEmail: string): Promise<boolean> {
        try {
            const guild = await viralExpansionStore.getGuild(guildId);
            if (!guild.owner_id) return false;

            const grantRes = await CoinTransactionLock.grantCoins(
                guild.owner_id,
                30,
                'guild_referral_verified',
                `ref_signup:${guildId}:${referredDiscordId}`,
                `Referral signup (+30 COINS) from verified member ${referredEmail}`
            );

            if (grantRes.success) {
                // Award Guild Battle Pass XP (+100 XP for referral)
                await this.addGuildActivityXp(guildId, 100, guild.owner_id);
                return true;
            }
            return false;
        } catch (err) {

            logger.error(`Failed to handle referral verification for guild ${guildId}:`, err);
            return false;
        }
    }

    // ============================================
    // MODULE D: SERVER BATTLE PASS (XP & MILESTONES)
    // ============================================

    async addGuildActivityXp(guildId: string, amount: number, ownerId?: string): Promise<void> {
        try {
            const res = await viralExpansionStore.addGuildXp(guildId, amount, ownerId);
            if (res.leveledUp && this.client) {
                const guild = this.client.guilds.cache.get(guildId);
                if (!guild) return;

                // Check for alliance war points
                const activeWar = await viralExpansionStore.getActiveWar(guildId);
                if (activeWar && activeWar.status === 'active') {
                    if (activeWar.guild_1_id === guildId) {
                        activeWar.points_1 += amount;
                    } else if (activeWar.guild_2_id === guildId) {
                        activeWar.points_2 += amount;
                    }
                    await viralExpansionStore.saveAllianceWar(activeWar);
                }

                // Announce in system channel or first writable channel
                const channel = (guild.systemChannel ||
                    guild.channels.cache.find((c) => c.isTextBased() && (c as TextChannel).permissionsFor(guild.members.me!)?.has('SendMessages'))
                ) as TextChannel | undefined;

                if (channel) {
                    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.success);
                    let body = `# 🎖️ Server Battle Pass: Level Up!\n\n` +
                        `**${guild.name}** has reached **Battle Pass Level ${res.guild.guild_level}**! (Total XP: \`${res.guild.guild_xp.toLocaleString()}\`)\n\n`;

                    if (res.newRewards.length > 0) {
                        body += `### 🎁 Unlocked Milestone Rewards:\n` + res.newRewards.map((r) => `› **${r}**`).join('\n') + `\n\n`;
                        body += `_Server owner <@${guild.ownerId}> can view & redeem rewards on [victuscloud.com](https://victuscloud.com)!_\n`;
                    }

                    c.addTextDisplayComponents(ComponentsV2.text(body));
                    await channel.send({ components: [c], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => {});
                }
            }
        } catch (err) {
            logger.error(`Error adding guild XP for ${guildId}:`, err);
        }
    }

    // ============================================
    // MODULE D: DEAD CHAT AIRDROP REVIVER
    // ============================================

    async recordChatMessage(message: Message): Promise<void> {
        if (!message.guild || message.author.bot) return;

        const guildId = message.guild.id;
        const now = new Date().toISOString();

        // Update last chat time
        await viralExpansionStore.updateGuildSettings(guildId, { last_chat_at: now });

        // Add minor Guild XP for normal active chatter (+2 XP)
        await this.addGuildActivityXp(guildId, 2, message.guild.ownerId);

        // Check for active Alliance War points
        const activeWar = await viralExpansionStore.getActiveWar(guildId);
        if (activeWar && activeWar.status === 'active') {
            if (activeWar.guild_1_id === guildId) activeWar.points_1 += 2;
            else if (activeWar.guild_2_id === guildId) activeWar.points_2 += 2;
            await viralExpansionStore.saveAllianceWar(activeWar);
        }

        // Random Mob Spawn (2% chance on messages in text channels with > 5 messages)
        if (Math.random() < 0.02) {
            await this.spawnWildMob(message.channel as TextChannel);
        }
    }

    private async checkDeadChatAirDrops(): Promise<void> {
        if (!this.client) return;

        for (const guild of this.client.guilds.cache.values()) {
            try {
                const botGuild = await viralExpansionStore.getGuild(guild.id, guild.ownerId);
                const lastChat = botGuild.last_chat_at ? new Date(botGuild.last_chat_at).getTime() : 0;
                const idleDuration = Date.now() - lastChat;

                // If chat has been dead for > 3 hours and cooldown expired
                const nextAllowed = this.airdropCooldowns.get(guild.id) || 0;
                if (idleDuration >= THREE_HOURS_MS && Date.now() > nextAllowed) {
                    await this.dropAirDropChest(guild, botGuild);
                }
            } catch (err) {
                logger.error(`Error checking airdrops for ${guild.id}:`, err);
            }
        }
    }

    private async dropAirDropChest(guild: Guild, botGuild: BotGuild): Promise<void> {
        let targetChannel: TextChannel | null = null;
        if (botGuild.airdrop_channel_id) {
            targetChannel = guild.channels.cache.get(botGuild.airdrop_channel_id) as TextChannel | null;
        }
        if (!targetChannel) {
            targetChannel = (guild.systemChannel ||
                guild.channels.cache.find((c) => c.isTextBased() && (c as TextChannel).permissionsFor(guild.members.me!)?.has('SendMessages'))
            ) as TextChannel | null;
        }

        if (!targetChannel) return;

        const container = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
        const roleMention = botGuild.airdrop_role_id ? `<@&${botGuild.airdrop_role_id}> ` : '';

        const text = `# 🪂 SUPPLY AIRDROP DETECTED!\n\n` +
            `${roleMention}Chat has been quiet for over **3 hours**! A high-altitude Victus Cloud supply crate just parachuted into the channel!\n\n` +
            `› **Reward:** **10 COINS** (Directly credited to your Victus Cloud balance!)\n` +
            `› **Objective:** First person to execute \`/claim\` claims the payload!`;

        container.addTextDisplayComponents(ComponentsV2.text(text));

        const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('victus_airdrop_claim_btn')
                .setLabel('Claim AirDrop (10 COINS)')
                .setEmoji('📦')
                .setStyle(ButtonStyle.Success)
        );

        const sentMsg = await targetChannel.send({
            content: roleMention ? roleMention : undefined,
            components: [container, btnRow],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        }).catch(() => null);

        if (sentMsg) {
            this.activeAirDrops.set(guild.id, {
                messageId: sentMsg.id,
                channelId: targetChannel.id,
                coins: 10,
                expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour window
            });
            // Cooldown of 4 hours per guild for airdrops
            this.airdropCooldowns.set(guild.id, Date.now() + 4 * 60 * 60 * 1000);
        }
    }

    async claimAirDrop(guildId: string, user: User): Promise<{ success: boolean; message: string }> {
        const active = this.activeAirDrops.get(guildId);
        if (!active || Date.now() > active.expiresAt) {
            return { success: false, message: 'There is no active Supply AirDrop in this server right now.' };
        }

        const grant = await CoinTransactionLock.grantCoins(
            user.id,
            active.coins,
            'airdrop_claim',
            `airdrop:${guildId}:${active.messageId}`,
            `AirDrop claim in guild ${guildId}`
        );

        if (grant.unlinked) {
            return {
                success: false,
                message: 'You must link your Victus Cloud account using `/link` before claiming real COINS!',
            };
        }

        if (!grant.success) {
            return { success: false, message: grant.error || 'Failed to claim AirDrop coins.' };
        }

        this.activeAirDrops.delete(guildId);

        // Edit original message to show claimed
        if (this.client) {
            const guild = this.client.guilds.cache.get(guildId);
            const channel = guild?.channels.cache.get(active.channelId) as TextChannel | undefined;
            if (channel) {
                const msg = await channel.messages.fetch(active.messageId).catch(() => null);
                if (msg) {
                    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.success);
                    c.addTextDisplayComponents(
                        ComponentsV2.text(
                            `# 📦 AirDrop Claimed!\n\n` +
                            `<@${user.id}> successfully intercepted the Supply Crate and won **+10 COINS**!`
                        )
                    );
                    await msg.edit({ components: [c], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => {});
                }
            }
        }

        return {
            success: true,
            message: `🎉 **AirDrop Claimed!** You secured **+10 COINS**! Your new balance is **${grant.newBalance} COINS**.`,
        };
    }

    // ============================================
    // MODULE B: MOB GACHA (RANDOM SPAWNS)
    // ============================================

    private activeWildMob = new Map<string, { mobName: string; species: string; rarity: string; power: number; channelId: string; expiresAt: number }>();

    private async spawnWildMob(channel: TextChannel): Promise<void> {
        if (!channel.guild || this.activeWildMob.has(channel.guild.id)) return;

        const MOBS = [
            { name: 'Pink Axolotl', species: 'Axolotl', rarity: 'rare', power: 45 },
            { name: 'Cyan Axolotl', species: 'Axolotl', rarity: 'epic', power: 75 },
            { name: 'Blue Axolotl', species: 'Axolotl', rarity: 'mythic', power: 150 },
            { name: 'Ancient Warden', species: 'Warden', rarity: 'legendary', power: 180 },
            { name: 'Tamed Wolf', species: 'Wolf', rarity: 'common', power: 25 },
            { name: 'Iron Golem Guardian', species: 'Iron Golem', rarity: 'rare', power: 60 },
            { name: 'Singing Allay', species: 'Allay', rarity: 'epic', power: 85 },
            { name: 'Fox with Emerald', species: 'Fox', rarity: 'rare', power: 50 },
        ];

        const selected = MOBS[Math.floor(Math.random() * MOBS.length)];
        const container = ComponentsV2.baseContainer(ComponentsV2.Accents.info);

        const text = `# 🐾 A Wild Mob Appeared!\n\n` +
            `A wild **${selected.name}** [${selected.rarity.toUpperCase()}] just wandered into the chat!\n\n` +
            `› **Combat Power:** \`${selected.power} CP\`\n` +
            `› **Species:** ${selected.species}\n` +
            `› **Action:** Quick! Type \`/tame\` to capture it before it flees!`;

        container.addTextDisplayComponents(ComponentsV2.text(text));

        const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('victus_mob_tame_btn')
                .setLabel(`Tame ${selected.name}`)
                .setEmoji('🦴')
                .setStyle(ButtonStyle.Primary)
        );

        const msg = await channel.send({ components: [container, btnRow], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => null);
        if (msg) {
            this.activeWildMob.set(channel.guild.id, {
                mobName: selected.name,
                species: selected.species,
                rarity: selected.rarity,
                power: selected.power,
                channelId: channel.id,
                expiresAt: Date.now() + 3 * 60 * 1000, // 3 minutes
            });
        }
    }

    async tameWildMob(guildId: string, user: User): Promise<{ success: boolean; message: string }> {
        const active = this.activeWildMob.get(guildId);
        if (!active || Date.now() > active.expiresAt) {
            return { success: false, message: 'There is no wild mob nearby to tame!' };
        }

        const inv = await viralExpansionStore.getInventory(user.id);
        const newMob = {
            id: `mob_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: active.mobName,
            species: active.species,
            rarity: active.rarity as any,
            power: active.power,
            health: active.power * 2,
            capturedAt: new Date().toISOString(),
            stars: active.rarity === 'mythic' ? 5 : active.rarity === 'legendary' ? 4 : active.rarity === 'epic' ? 3 : 2,
        };

        inv.mobs_json.push(newMob);
        await viralExpansionStore.saveInventory(inv);

        this.activeWildMob.delete(guildId);

        return {
            success: true,
            message: `✨ **Tamed!** You captured a **${active.mobName}** [${active.rarity.toUpperCase()}] with **${active.power} Combat Power**! View your collection anytime with \`/zoo\`.`,
        };
    }

    // ============================================
    // MODULE B: CROSS-SERVER WORLD BOSS RAIDS
    // ============================================

    async attackWorldBoss(
        user: User,
        actionType: 'melee' | 'bow' | 'magic'
    ): Promise<{ success: boolean; damageDealt: number; remainingHp: number; defeated: boolean; rewardSummary?: string }> {
        let boss = await viralExpansionStore.getActiveWorldBoss();
        if (!boss || boss.status !== 'active') {
            // Spawn a new boss if none active (Ender Dragon 10,000 HP or Wither 7,500 HP)
            const isDragon = Math.random() > 0.5;
            boss = {
                id: `boss_${Date.now()}`,
                boss_type: isDragon ? 'ender_dragon' : 'wither',
                max_hp: isDragon ? 10000 : 7500,
                current_hp: isDragon ? 10000 : 7500,
                pool_coins: isDragon ? 1000 : 750,
                participants_json: {},
                channel_ids: [],
                status: 'active',
                spawned_at: new Date().toISOString(),
            };
            await viralExpansionStore.saveWorldBoss(boss);
        }

        const inv = await viralExpansionStore.getInventory(user.id);
        const pickaxeMultipliers: Record<string, number> = {
            wood: 1,
            stone: 1.5,
            iron: 2.2,
            diamond: 3.5,
            netherite: 5.0,
        };

        const mult = pickaxeMultipliers[inv.pickaxe_tier] || 1;
        let baseDmg = actionType === 'magic' ? 40 : actionType === 'bow' ? 25 : 15;
        // Add random variance (+/- 20%)
        const variance = (Math.random() * 0.4) + 0.8;
        const damageDealt = Math.round(baseDmg * mult * variance);

        const newHp = Math.max(0, boss.current_hp - damageDealt);
        boss.current_hp = newHp;

        // Record participant
        const prev = boss.participants_json[user.id] || { damage: 0, name: user.username, hits: 0 };
        prev.damage += damageDealt;
        prev.hits += 1;
        boss.participants_json[user.id] = prev;

        let defeated = false;
        let rewardSummary: string | undefined;

        if (newHp <= 0) {
            boss.status = 'defeated';
            boss.defeated_at = new Date().toISOString();
            defeated = true;

            // Split COINS pool proportionally among participants!
            const totalDmg = Object.values(boss.participants_json).reduce((sum, p) => sum + p.damage, 0);
            const payouts: string[] = [];

            for (const [pUserId, data] of Object.entries(boss.participants_json)) {
                const ratio = data.damage / (totalDmg || 1);
                let rewardCoins = Math.max(5, Math.floor(boss.pool_coins * ratio));

                // MVP or finishing blow bonus
                if (pUserId === user.id) {
                    rewardCoins += 25; // finishing blow bonus
                }

                await CoinTransactionLock.grantCoins(
                    pUserId,
                    rewardCoins,
                    'world_boss_raid',
                    `boss:${boss.id}:${pUserId}`,
                    `World Boss ${boss.boss_type} defeat reward (+${rewardCoins} COINS)`
                ).catch(() => {});

                payouts.push(`<@${pUserId}>: **+${rewardCoins} COINS** (${data.damage.toLocaleString()} DMG)`);
            }

            rewardSummary = payouts.slice(0, 5).join('\n');
        }

        await viralExpansionStore.saveWorldBoss(boss);
        return {
            success: true,
            damageDealt,
            remainingHp: newHp,
            defeated,
            rewardSummary,
        };
    }

    private async tickBossAndWars(): Promise<void> {
        // Boss expiration check (active for 24h)
        const boss = await viralExpansionStore.getActiveWorldBoss();
        if (boss && boss.status === 'active') {
            const age = Date.now() - new Date(boss.spawned_at).getTime();
            if (age > 24 * 60 * 60 * 1000) {
                boss.status = 'expired';
                await viralExpansionStore.saveWorldBoss(boss);
            }
        }
    }
}

export const viralExpansionService = new ViralExpansionService();
