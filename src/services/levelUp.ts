import { ChannelType, Client, ContainerBuilder } from 'discord.js';
import { config } from '../config.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { calculateLevel, getLevelProgress, getTierForLevel, progressBar } from '../utils/vccrs.js';
import { logger } from '../utils/logger.js';
import { syncRankRole } from '../utils/roles.js';
import { supabase } from './supabase.js';

let processing = false;

function levelCard(discordId: string, level: number, totalXp: number, rankedUp: boolean): ContainerBuilder {
    const current = getLevelProgress(totalXp);
    const tier = getTierForLevel(level);
    const heading = rankedUp ? `${tier.emoji} RANK UP — ${tier.name}` : `🎉 LEVEL UP — LEVEL ${level}`;
    return ComponentsV2.baseContainer(tier.color).addTextDisplayComponents(
        ComponentsV2.text(
            `# ${heading}\n<@${discordId}> has reached **Level ${level}**!\n\n` +
            `> **Rank**  ${tier.emoji} ${tier.name}\n` +
            `> **Total XP**  ${totalXp.toLocaleString('en-US')}\n` +
            `> **Progress**  ${progressBar(current.progress)} ${current.progress.toFixed(0)}%\n` +
            `> **Next level**  ${current.cpToNext.toLocaleString('en-US')} XP remaining\n\n` +
            `### Level rewards\n✨ **+${config.economy.xpPerLevel} XP**  ·  🪙 **+${config.economy.coinsPerLevel} COINS**\n` +
            `-# Victus Community and Discord progression are fully synchronized.`,
        ),
    );
}

async function processOne(client: Client<true>): Promise<boolean> {
    const event = await supabase.claimLevelUpEvent();
    if (!event) return false;
    try {
        if (!event.xp_rewarded_at) {
            const reward = await supabase.applyLevelXpReward(event.id, config.economy.xpPerLevel);
            event.xp_rewarded_at = new Date().toISOString();
            if (reward?.new_xp != null) event.total_xp = Number(reward.new_xp);
        }

        const loadedProfile = await supabase.getUserProfile(event.user_id);
        if (!loadedProfile) throw new Error('Victus profile no longer exists');
        const profile = loadedProfile;

        if (!event.coins_rewarded_at) {
            if (!profile.email) throw new Error('No profile email is available for the Paymenter reward');
            await supabase.updateLevelUpEvent(event.id, { coins_processing_at: new Date().toISOString() });
            
            const granted = await supabase.grantLevelCoins(event.user_id, event.level, event.id, config.economy.coinsPerLevel);
            if (!granted) {
                throw new Error('Paymenter level COINS reward grant failed');
            }

            const now = new Date().toISOString();
            const syncedProfile = await supabase.getUserProfile(event.user_id);
            await supabase.updateLevelUpEvent(event.id, {
                coins_rewarded_at: now,
                coins_processing_at: null,
                coins_target: Number(syncedProfile?.total_cp ?? profile.total_cp ?? 0),
            });
            event.coins_rewarded_at = now;
        }

        const linked = await supabase.getLinkedAccountByUserId(event.user_id);
        if (!linked?.discord_id) throw new Error('No linked Discord account; notification will retry after linking');
        const liveXp = Number(profile.total_xp ?? event.total_xp ?? 0);
        const eventXp = Number(event.total_xp ?? liveXp);
        const liveLevel = calculateLevel(liveXp);
        const rankedUp = getTierForLevel(event.previous_level).name !== getTierForLevel(event.level).name;

        if (!event.role_synced_at) {
            const synced = await syncRankRole(client, linked.discord_id, liveLevel);
            if (!synced) throw new Error('Discord member or support guild unavailable for rank role sync');
            await supabase.updateLevelUpEvent(event.id, { role_synced_at: new Date().toISOString() });
        }

        if (!event.dm_sent_at) {
            const user = await client.users.fetch(linked.discord_id);
            await user.send({ components: [levelCard(linked.discord_id, event.level, eventXp, rankedUp)], flags: ComponentsV2.IS_COMPONENTS_V2 });
            await supabase.updateLevelUpEvent(event.id, { dm_sent_at: new Date().toISOString() });
        }

        if (!event.announcement_sent_at) {
            const channel = await client.channels.fetch(config.bot.levelUpChannelId).catch(() => null);
            if (!channel || !channel.isTextBased() || channel.type === ChannelType.DM || !('send' in channel)) throw new Error('Level-up announcement channel is unavailable');
            await channel.send({ components: [levelCard(linked.discord_id, event.level, eventXp, rankedUp)], flags: ComponentsV2.IS_COMPONENTS_V2 });
            await supabase.updateLevelUpEvent(event.id, { announcement_sent_at: new Date().toISOString() });
        }

        await supabase.updateLevelUpEvent(event.id, { notified_at: new Date().toISOString(), processing_at: null, last_error: null });
        logger.info(`Processed level ${event.level} for Victus user ${event.user_id}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await supabase.updateLevelUpEvent(event.id, { processing_at: null, last_error: message.slice(0, 1000) }).catch(() => undefined);
        logger.warn(`Level event ${event.id} deferred: ${message}`);
    }
    return true;
}

export async function processLevelUps(client: Client<true>): Promise<void> {
    if (processing) return;
    processing = true;
    try {
        for (let i = 0; i < 25; i++) if (!(await processOne(client))) break;
    } catch (error) {
        logger.error('Level-up worker cycle failed:', error);
    } finally {
        processing = false;
    }
}

export function startLevelUpWorker(client: Client<true>): void {
    void processLevelUps(client);
    const timer = setInterval(() => void processLevelUps(client), 15_000);
    timer.unref?.();
    logger.info('Level-up reward and Discord synchronization worker started (15s interval)');
}
