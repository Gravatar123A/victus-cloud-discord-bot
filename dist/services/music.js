import { LavalinkManager } from 'lavalink-client';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { nowPlayingContainer } from '../embeds/music.js';
const V2 = ComponentsV2.IS_COMPONENTS_V2;
/**
 * Build the Lavalink manager, attach it to the client (`client.lavalink`) and
 * forward Discord's raw voice packets so voice connections can be established.
 */
export function createLavalinkManager(client) {
    if (!config.lavalink.password) {
        logger.error('🎵 LAVALINK_PASSWORD is not set. Music commands will remain unavailable.');
    }
    const nodes = [
        {
            id: config.lavalink.id,
            host: config.lavalink.host,
            port: config.lavalink.port,
            authorization: config.lavalink.password,
            secure: config.lavalink.secure,
            retryAmount: 5,
            retryDelay: 30_000,
        },
    ];
    // If host is 135.125.222.36 and configured port is not 25578 (e.g. legacy 25704 in server .env), also register 25578
    if (config.lavalink.port !== 25578 && config.lavalink.host === '135.125.222.36') {
        nodes.push({
            id: `${config.lavalink.id}-25578`,
            host: '135.125.222.36',
            port: 25578,
            authorization: config.lavalink.password,
            secure: config.lavalink.secure,
            retryAmount: 5,
            retryDelay: 30_000,
        });
    }
    const manager = new LavalinkManager({
        nodes,
        sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard?.send(payload),
        client: {
            id: config.discord.clientId,
            username: config.branding.name,
        },
        autoSkip: true,
        playerOptions: {
            defaultSearchPlatform: config.lavalink.defaultSource,
            clientBasedPositionUpdateInterval: 1000,
            onDisconnect: { autoReconnect: true, destroyPlayer: false },
            // Leave the voice channel a couple of minutes after the queue runs dry.
            onEmptyQueue: { destroyAfterMs: 120_000 },
        },
        queueOptions: { maxPreviousTracks: 25 },
    });
    client.lavalink = manager;
    // Forward raw gateway events (VOICE_STATE_UPDATE / VOICE_SERVER_UPDATE).
    client.on('raw', (d) => {
        manager.sendRawData(d).catch(() => undefined);
    });
    attachNodeListeners(manager);
    attachPlayerListeners(client, manager);
    return manager;
}
function attachNodeListeners(manager) {
    manager.nodeManager
        .on('connect', (node) => logger.info(`🎵 Lavalink node "${node.id}" connected`))
        .on('reconnecting', (node) => logger.warn(`🎵 Lavalink node "${node.id}" reconnecting...`))
        .on('disconnect', (node, reason) => logger.warn(`🎵 Lavalink node "${node.id}" disconnected: ${JSON.stringify(reason)}`))
        .on('error', (node, error) => {
        const message = error?.message || String(error);
        const authenticationHint = /\b(401|403|unauthori[sz]ed|forbidden)\b/i.test(message)
            ? ' Check that LAVALINK_PASSWORD matches server.password on the node.'
            : '';
        logger.error(`🎵 Lavalink node "${node.id}" error: ${message}.${authenticationHint}`);
    });
}
/** Whether at least one authenticated Lavalink websocket is ready for work. */
export function isMusicAvailable(client) {
    if (!config.lavalink.password)
        return false;
    return client.lavalink.nodeManager.leastUsedNodes().length > 0;
}
async function getTextChannel(client, player) {
    if (!player.textChannelId)
        return null;
    const channel = client.channels.cache.get(player.textChannelId) ||
        (await client.channels.fetch(player.textChannelId).catch(() => null));
    return channel && channel.isTextBased() ? channel : null;
}
/** Delete the previous Now Playing panel for a player, if any. */
async function clearNowPlaying(client, player) {
    const msg = player.get('npMessage');
    if (msg) {
        await msg.delete().catch(() => undefined);
        player.set('npMessage', undefined);
    }
}
/** Post a fresh Now Playing panel, replacing any previous one. */
export async function postNowPlaying(client, player) {
    const channel = await getTextChannel(client, player);
    if (!channel || !('send' in channel))
        return;
    await clearNowPlaying(client, player);
    const payload = await nowPlayingContainer(player, 'guild' in channel ? channel.guild : undefined);
    const sent = await channel
        .send({ embeds: payload.embeds, components: payload.components, files: payload.files, flags: V2 })
        .catch(() => null);
    if (sent)
        player.set('npMessage', sent);
}
/** Refresh the existing Now Playing panel in place (e.g. after pause/loop). */
export async function refreshNowPlaying(player) {
    const msg = player.get('npMessage');
    if (!msg)
        return;
    const payload = await nowPlayingContainer(player, msg.guild);
    await msg.edit({ embeds: payload.embeds, components: payload.components, files: payload.files, flags: V2 }).catch(() => undefined);
}
function attachPlayerListeners(client, manager) {
    manager
        .on('trackStart', async (player) => {
        await postNowPlaying(client, player);
    })
        .on('queueEnd', async (player) => {
        await clearNowPlaying(client, player);
        const channel = await getTextChannel(client, player);
        if (channel && 'send' in channel) {
            await channel
                .send({
                components: [
                    ComponentsV2.infoContainer('Queue Finished', 'That was the last track. Add more with `/play` — I will leave the voice channel if the queue stays empty.'),
                ],
                flags: V2,
            })
                .catch(() => undefined);
        }
    })
        .on('playerDestroy', async (player) => {
        await clearNowPlaying(client, player);
    })
        .on('trackError', async (player, track, payload) => {
        const errDetails = JSON.stringify(payload?.exception ?? payload);
        logger.warn(`🎵 Track error in guild ${player.guildId}: ${errDetails}`);
        // 1. Check if we can attempt a seamless SoundCloud fallback for blocked YouTube tracks
        const isFallback = track?._scFallback;
        const trackTitle = track?.info?.title;
        const trackAuthor = track?.info?.author || '';
        if (!isFallback && trackTitle) {
            logger.info(`🎵 Attempting seamless SoundCloud fallback for "${trackTitle}" by "${trackAuthor}"...`);
            try {
                const fallbackQuery = `${trackTitle} ${trackAuthor}`.trim();
                const searchOutcome = await player.search({ query: fallbackQuery, source: 'scsearch' }, client.user);
                if (searchOutcome && searchOutcome.tracks?.length > 0) {
                    const fallbackTrack = searchOutcome.tracks[0];
                    fallbackTrack._scFallback = true;
                    // Place the fallback track at the top of the queue and start it
                    player.queue.tracks.unshift(fallbackTrack);
                    await player.skip();
                    const channel = await getTextChannel(client, player);
                    if (channel && 'send' in channel) {
                        await channel.send({
                            components: [
                                ComponentsV2.infoContainer('Stream Source Switched', `YouTube blocked playback (*video requires login on datacenter IP*).\n\n` +
                                    `› Automatically switched to **SoundCloud** stream for: **${trackTitle}** 🎵`),
                            ],
                            flags: V2,
                        }).catch(() => undefined);
                    }
                    return;
                }
            }
            catch (fallbackErr) {
                logger.error(`🎵 SoundCloud fallback resolution failed:`, fallbackErr);
            }
        }
        // 2. If fallback failed or wasn't possible, alert channel and skip ahead cleanly
        const channel = await getTextChannel(client, player);
        if (channel && 'send' in channel) {
            await channel.send({
                components: [
                    ComponentsV2.warningContainer('Track Playback Blocked', `Could not stream **${trackTitle || 'this track'}**.\n\n` +
                        `› **Reason:** Provider requires authentication or blocked datacenter IP.\n` +
                        `› **Action:** Skipping to next track in queue.`),
                ],
                flags: V2,
            }).catch(() => undefined);
        }
        player.skip().catch(() => undefined);
    })
        .on('trackStuck', (player) => {
        logger.warn(`🎵 Track stuck in guild ${player.guildId} — skipping.`);
        player.skip().catch(() => undefined);
    });
}
