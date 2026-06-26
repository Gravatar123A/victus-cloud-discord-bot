/**
 * Lavalink (music) integration for the Victus Cloud bot.
 *
 * Connects to the dedicated Victus Cloud Lavalink node (DE-1) and wires the
 * player lifecycle to Discord: a single live "Now Playing" panel per guild that
 * is posted on track start, refreshed as state changes, and cleaned up when the
 * queue ends or the player is destroyed.
 */
import type { Client, Message, TextBasedChannel } from 'discord.js';
import { LavalinkManager, type Player, type SearchPlatform } from 'lavalink-client';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { nowPlayingContainer } from '../embeds/music.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;

/**
 * Build the Lavalink manager, attach it to the client (`client.lavalink`) and
 * forward Discord's raw voice packets so voice connections can be established.
 */
export function createLavalinkManager(client: Client): LavalinkManager {
    const manager = new LavalinkManager({
        nodes: [
            {
                id: config.lavalink.id,
                host: config.lavalink.host,
                port: config.lavalink.port,
                authorization: config.lavalink.password,
                secure: config.lavalink.secure,
                retryAmount: 1000,
                retryDelay: 10_000,
            },
        ],
        sendToShard: (guildId, payload) =>
            client.guilds.cache.get(guildId)?.shard?.send(payload),
        client: {
            id: config.discord.clientId,
            username: config.branding.name,
        },
        autoSkip: true,
        playerOptions: {
            defaultSearchPlatform: config.lavalink.defaultSource as SearchPlatform,
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

function attachNodeListeners(manager: LavalinkManager): void {
    manager.nodeManager
        .on('connect', (node) => logger.info(`🎵 Lavalink node "${node.id}" connected`))
        .on('reconnecting', (node) => logger.warn(`🎵 Lavalink node "${node.id}" reconnecting...`))
        .on('disconnect', (node, reason) =>
            logger.warn(`🎵 Lavalink node "${node.id}" disconnected: ${JSON.stringify(reason)}`))
        .on('error', (node, error) =>
            logger.error(`🎵 Lavalink node "${node.id}" error:`, error?.message || error));
}

async function getTextChannel(client: Client, player: Player): Promise<TextBasedChannel | null> {
    if (!player.textChannelId) return null;
    const channel =
        client.channels.cache.get(player.textChannelId) ||
        (await client.channels.fetch(player.textChannelId).catch(() => null));
    return channel && channel.isTextBased() ? (channel as TextBasedChannel) : null;
}

/** Delete the previous Now Playing panel for a player, if any. */
async function clearNowPlaying(client: Client, player: Player): Promise<void> {
    const msg = player.get('npMessage') as Message | undefined;
    if (msg) {
        await msg.delete().catch(() => undefined);
        player.set('npMessage', undefined);
    }
}

/** Post a fresh Now Playing panel, replacing any previous one. */
export async function postNowPlaying(client: Client, player: Player): Promise<void> {
    const channel = await getTextChannel(client, player);
    if (!channel || !('send' in channel)) return;
    await clearNowPlaying(client, player);
    const sent = await channel
        .send({ components: [nowPlayingContainer(player)], flags: V2 })
        .catch(() => null);
    if (sent) player.set('npMessage', sent);
}

/** Refresh the existing Now Playing panel in place (e.g. after pause/loop). */
export async function refreshNowPlaying(player: Player): Promise<void> {
    const msg = player.get('npMessage') as Message | undefined;
    if (!msg) return;
    await msg.edit({ components: [nowPlayingContainer(player)], flags: V2 }).catch(() => undefined);
}

function attachPlayerListeners(client: Client, manager: LavalinkManager): void {
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
                            ComponentsV2.infoContainer(
                                'Queue Finished',
                                'That was the last track. Add more with `/play` — I will leave the voice channel if the queue stays empty.',
                            ),
                        ],
                        flags: V2,
                    })
                    .catch(() => undefined);
            }
        })
        .on('playerDestroy', async (player) => {
            await clearNowPlaying(client, player);
        })
        .on('trackError', (player, track, payload) => {
            logger.warn(`🎵 Track error in guild ${player.guildId}: ${JSON.stringify(payload?.exception ?? payload)}`);
        })
        .on('trackStuck', (player) => {
            logger.warn(`🎵 Track stuck in guild ${player.guildId} — skipping.`);
            player.skip().catch(() => undefined);
        });
}
