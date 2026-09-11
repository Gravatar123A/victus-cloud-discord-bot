import { ChannelType } from 'discord.js';
import { config } from '../config.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { calculateLevel, getLevelProgress, getTierForLevel, progressBar } from '../utils/vccrs.js';
import { logger } from '../utils/logger.js';
import { syncRankRole } from '../utils/roles.js';
import { supabase } from './supabase.js';
import { levelSettings } from './levelSettings.js';
import { getLastActiveGuild } from './activityXp.js';
let processing = false;
function levelCard(discordId, level, totalXp, rankedUp) {
    const current = getLevelProgress(totalXp);
    const tier = getTierForLevel(level);
    const heading = rankedUp ? `${tier.emoji} RANK UP — ${tier.name}` : `🎉 LEVEL UP — LEVEL ${level}`;
    return ComponentsV2.baseContainer(tier.color).addTextDisplayComponents(ComponentsV2.text(`# ${heading}\n<@${discordId}> has reached **Level ${level}**!\n\n` +
        `> **Rank**  ${tier.emoji} ${tier.name}\n` +
        `> **Total XP**  ${totalXp.toLocaleString('en-US')}\n` +
        `> **Progress**  ${progressBar(current.progress)} ${current.progress.toFixed(0)}%\n` +
        `> **Next level**  ${current.cpToNext.toLocaleString('en-US')} XP remaining\n\n` +
        `### Level rewards\n✨ **+${config.economy.xpPerLevel} XP**  ·  🪙 **+${config.economy.coinsPerLevel} COINS**\n` +
        `-# Victus Cloud cross-guild progression: real COINS deposited to your wallet for free server hosting.`));
}
async function processOne(client) {
    const event = await supabase.claimLevelUpEvent();
    if (!event)
        return false;
    try {
        if (!event.xp_rewarded_at) {
            const reward = await supabase.applyLevelXpReward(event.id, config.economy.xpPerLevel);
            event.xp_rewarded_at = new Date().toISOString();
            if (reward?.new_xp != null)
                event.total_xp = Number(reward.new_xp);
        }
        const loadedProfile = await supabase.getUserProfile(event.user_id);
        if (!loadedProfile)
            throw new Error('Victus profile no longer exists');
        const profile = loadedProfile;
        if (!event.coins_rewarded_at) {
            if (!profile.email)
                throw new Error('No profile email is available for the Paymenter reward');
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
        if (!linked?.discord_id)
            throw new Error('No linked Discord account; notification will retry after linking');
        const liveXp = Number(profile.total_xp ?? event.total_xp ?? 0);
        const eventXp = Number(event.total_xp ?? liveXp);
        const liveLevel = calculateLevel(liveXp);
        const rankedUp = getTierForLevel(event.previous_level).name !== getTierForLevel(event.level).name;
        if (!event.role_synced_at) {
            try {
                await syncRankRole(client, linked.discord_id, liveLevel);
            }
            catch (roleErr) {
                logger.debug(`[LevelUp] Role sync note for ${linked.discord_id}:`, roleErr);
            }
            await supabase.updateLevelUpEvent(event.id, { role_synced_at: new Date().toISOString() });
        }
        if (!event.dm_sent_at) {
            const user = await client.users.fetch(linked.discord_id).catch(() => null);
            if (user) {
                try {
                    await user.send({ components: [levelCard(linked.discord_id, event.level, eventXp, rankedUp)], flags: ComponentsV2.IS_COMPONENTS_V2 });
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    if (!/no mutual guilds|cannot send messages to this user|50007|50001/i.test(message))
                        throw error;
                    logger.info(`Level event ${event.id}: DM unavailable; continuing with public notification`);
                }
            }
            await supabase.updateLevelUpEvent(event.id, { dm_sent_at: new Date().toISOString() });
        }
        if (!event.announcement_sent_at) {
            const card = levelCard(linked.discord_id, event.level, eventXp, rankedUp);
            // 1. If user was recently active in an external guild, announce in that guild's configured level channel
            const activeLoc = getLastActiveGuild(linked.discord_id);
            if (activeLoc?.guildId && activeLoc.guildId !== config.bot.supportGuildId) {
                try {
                    const extChannelId = await levelSettings.getChannelId(activeLoc.guildId);
                    const extChannel = await client.channels.fetch(extChannelId).catch(() => null);
                    if (extChannel && extChannel.isTextBased() && extChannel.type !== ChannelType.DM && 'send' in extChannel) {
                        await extChannel.send({ components: [card], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => { });
                    }
                }
                catch (extErr) {
                    logger.debug(`[LevelUp] External guild level announcement note:`, extErr);
                }
            }
            // 2. Announce in official Support Guild if configured
            if (config.bot.supportGuildId) {
                try {
                    const supportChannelId = await levelSettings.getChannelId(config.bot.supportGuildId);
                    const supportChannel = await client.channels.fetch(supportChannelId).catch(() => null);
                    if (supportChannel && supportChannel.isTextBased() && supportChannel.type !== ChannelType.DM && 'send' in supportChannel) {
                        await supportChannel.send({ components: [card], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => { });
                    }
                }
                catch (supErr) {
                    logger.debug(`[LevelUp] Support guild level announcement note:`, supErr);
                }
            }
            await supabase.updateLevelUpEvent(event.id, { announcement_sent_at: new Date().toISOString() });
        }
        await supabase.updateLevelUpEvent(event.id, { notified_at: new Date().toISOString(), processing_at: null, last_error: null });
        logger.info(`Processed level ${event.level} for Victus user ${event.user_id}`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await supabase.updateLevelUpEvent(event.id, { processing_at: null, last_error: message.slice(0, 1000) }).catch(() => undefined);
        logger.warn(`Level event ${event.id} deferred: ${message}`);
    }
    return true;
}
export async function processLevelUps(client) {
    if (processing)
        return;
    processing = true;
    try {
        for (let i = 0; i < 25; i++)
            if (!(await processOne(client)))
                break;
    }
    catch (error) {
        logger.error('Level-up worker cycle failed:', error);
    }
    finally {
        processing = false;
    }
}
export function startLevelUpWorker(client) {
    void processLevelUps(client);
    const timer = setInterval(() => void processLevelUps(client), 15_000);
    timer.unref?.();
    logger.info('Level-up reward and Discord synchronization worker started (15s interval)');
}
