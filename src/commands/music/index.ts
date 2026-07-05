/**
 * Victus Cloud music commands (Lavalink).
 *
 * Top-level slash commands so members can either type `/play`, `/skip`, … or use
 * the buttons on the live Now Playing panel. All control buttons (`music:*`) are
 * handled by `playCommand.handleButton` — the interaction dispatcher walks every
 * command's handleButton until one acknowledges, so a single handler is enough.
 */
import {
    ChannelType,
    GuildMember,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    StringSelectMenuInteraction,
    VoiceBasedChannel,
} from 'discord.js';
import type { Player } from 'lavalink-client';

// The search result union (resolved tracks or lazily-resolved tracks).
type SearchOutcome = Awaited<ReturnType<Player['search']>>;
import type { Command } from '../../types/index.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { ComponentsV2 } from '../../embeds/componentsV2.js';
import {
    addedContainer,
    musicIdleContainer,
    nowPlayingContainer,
    queueContainer,
} from '../../embeds/music.js';
import { refreshNowPlaying } from '../../services/music.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

// ── shared helpers ──────────────────────────────────────────────────────────

type VoiceCtx = { member: GuildMember; voice: VoiceBasedChannel };

/** Resolve the caller's voice channel and validate the bot can use it. */
async function requireVoice(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    deferred = true,
): Promise<VoiceCtx | null> {
    const member = interaction.member as GuildMember | null;
    const voice = member?.voice?.channel ?? null;

    const fail = async (title: string, body: string) => {
        const payload = { components: [ComponentsV2.warningContainer(title, body)], flags: EPH | V2 };
        if (deferred && interaction.isChatInputCommand()) await interaction.editReply(payload);
        else await interaction.reply(payload);
    };

    if (!interaction.guild || !member) {
        await fail('Server only', 'Music commands only work inside a server.');
        return null;
    }
    if (!voice) {
        await fail('Join a voice channel', 'Hop into a voice channel first, then try again.');
        return null;
    }
    const me = interaction.guild.members.me;
    const perms = me ? voice.permissionsFor(me) : null;
    if (!perms?.has(PermissionFlagsBits.Connect) || !perms?.has(PermissionFlagsBits.Speak)) {
        await fail('Missing permissions', `I need **Connect** and **Speak** permission in **${voice.name}**.`);
        return null;
    }
    if (voice.type === ChannelType.GuildStageVoice && !perms.has(PermissionFlagsBits.MuteMembers)) {
        await fail('Stage channel', 'I need permission to speak on stage (Mute Members) to play here.');
        return null;
    }
    return { member, voice };
}

/** Fetch the active player and ensure the caller shares its voice channel. */
async function requirePlayer(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    deferred = true,
): Promise<Player | null> {
    const player = interaction.client.lavalink.getPlayer(interaction.guildId!);
    const reply = async (title: string, body: string) => {
        const payload = { components: [ComponentsV2.warningContainer(title, body)], flags: EPH | V2 };
        if (deferred && interaction.isChatInputCommand()) await interaction.editReply(payload);
        else await interaction.reply(payload);
    };
    if (!player || !player.queue.current) {
        await reply('Nothing is playing', 'There is nothing playing right now. Start something with `/play`.');
        return null;
    }
    const member = interaction.member as GuildMember | null;
    if (member?.voice?.channelId !== player.voiceChannelId) {
        await reply('Wrong voice channel', 'Join my voice channel to control playback.');
        return null;
    }
    return player;
}

function ok(title: string, body: string) {
    return { components: [ComponentsV2.successContainer(title, body)], flags: V2 } as const;
}
function info(title: string, body: string) {
    return { components: [ComponentsV2.infoContainer(title, body)], flags: V2 } as const;
}

// ── /play ────────────────────────────────────────────────────────────────────

export const playCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or playlist (YouTube, Spotify, SoundCloud, or a direct link)')
        .setDMPermission(false)
        .addStringOption((o) =>
            o.setName('query').setDescription('Song name, Spotify/YouTube/SoundCloud URL, or playlist link').setRequired(true).setMaxLength(500),
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();
        const ctx = await requireVoice(interaction);
        if (!ctx) return;

        const query = interaction.options.getString('query', true).trim();
        const lavalink = interaction.client.lavalink;

        let player = lavalink.getPlayer(interaction.guildId!);
        if (player && player.voiceChannelId && player.voiceChannelId !== ctx.voice.id) {
            await interaction.editReply({
                components: [ComponentsV2.warningContainer('Already in use', `I'm already playing in another voice channel. Join it to add songs.`)],
                flags: V2,
            });
            return;
        }
        if (!player) {
            player = lavalink.createPlayer({
                guildId: interaction.guildId!,
                voiceChannelId: ctx.voice.id,
                textChannelId: interaction.channelId,
                selfDeaf: true,
                selfMute: false,
                volume: config.lavalink.defaultVolume,
            });
        }
        if (!player.connected) await player.connect();

        // Detect streaming service URLs — pass them raw so LavaSrc resolves them.
        // Plain text queries get the configured default search platform prefix.
        const isUrl = /^https?:\/\//i.test(query);
        const isSpotify = /open\.spotify\.com/i.test(query);

        let res: SearchOutcome;
        try {
            // For URLs, pass as-is so Lavalink/LavaSrc resolves them directly.
            // For plain text, use the configured default search source.
            const searchQuery = isUrl
                ? { query }
                : { query, source: config.lavalink.defaultSource as any };
            res = await player.search(searchQuery, interaction.user);

            // Fallback: if a Spotify URL failed (LavaSrc not configured), try spsearch:
            if (isSpotify && (!res || !res.tracks?.length || res.loadType === 'empty' || res.loadType === 'error')) {
                logger.warn('🎵 Spotify direct URL load failed, trying spsearch fallback...');
                res = await player.search({ query, source: 'spsearch' as any }, interaction.user);
            }
        } catch (error) {
            logger.error('🎵 Lavalink search failed:', error);
            await interaction.editReply({
                components: [ComponentsV2.errorContainer('Search failed', 'Could not reach the music server. Please try again in a moment.')],
                flags: V2,
            });
            return;
        }

        if (!res || !res.tracks?.length || res.loadType === 'empty' || res.loadType === 'error') {
            const hint = isSpotify
                ? ' Make sure the Lavalink server has LavaSrc configured for Spotify.'
                : ' Try a different search or a direct link.';
            await interaction.editReply({
                components: [ComponentsV2.warningContainer('No results', `Nothing found for **${query.slice(0, 120)}**.${hint}`)],
                flags: V2,
            });
            if (!player.queue.current && !player.queue.tracks.length) await player.destroy().catch(() => undefined);
            return;
        }

        const isPlaylist = res.loadType === 'playlist';
        const toAdd = isPlaylist ? res.tracks : [res.tracks[0]];
        const playlistName = isPlaylist
            ? ((res.playlist as { name?: string; title?: string } | null)?.name ??
               (res.playlist as { name?: string; title?: string } | null)?.title ??
               'Playlist')
            : null;
        const positionBefore = player.queue.tracks.length + (player.queue.current ? 1 : 0);
        await player.queue.add(toAdd);

        if (!player.playing && !player.paused) {
            await player.play();
        }

        await interaction.editReply({
            components: [addedContainer(toAdd, playlistName, positionBefore)],
            flags: V2,
        });
    },

    // All music controls are now routed through the select menu.
    async handleButton(interaction: ButtonInteraction) {
        // No more music buttons — all controls go through the select menu.
        return;
    },

    // Unified music select menu handler.
    async handleSelectMenu(interaction: StringSelectMenuInteraction) {
        if (interaction.customId !== 'music:controls' && interaction.customId !== 'music:select') return;

        const player = interaction.client.lavalink.getPlayer(interaction.guildId!);
        if (!player) {
            await interaction.reply({ components: [ComponentsV2.warningContainer('Nothing is playing', 'This panel is no longer active. Use `/play` to start again.')], flags: EPH | V2 });
            return;
        }
        const member = interaction.member as GuildMember | null;
        if (member?.voice?.channelId !== player.voiceChannelId) {
            await interaction.reply({ components: [ComponentsV2.warningContainer('Wrong voice channel', 'Join my voice channel to control playback.')], flags: EPH | V2 });
            return;
        }

        const action = interaction.values[0] ?? '';

        switch (action) {
            case 'pause': {
                if (player.paused) await player.resume();
                else await player.pause();
                break;
            }
            case 'skip': {
                if (!player.queue.tracks.length) {
                    await interaction.reply({ ...info('Skipped', 'That was the last track — stopping playback.'), flags: EPH | V2 });
                    await player.destroy().catch(() => undefined);
                    return;
                }
                await player.skip();
                await interaction.reply({ ...info('Skipped', 'Skipped to the next track.'), flags: EPH | V2 });
                return;
            }
            case 'stop': {
                await player.destroy();
                await interaction.update({ components: [ComponentsV2.infoContainer('Stopped', 'Playback stopped and the queue was cleared. 👋')], flags: V2 });
                return;
            }
            case 'restart': {
                await player.seek(0);
                break;
            }
            case 'previous': {
                const prev = player.queue.previous?.[0];
                if (!prev) {
                    await interaction.reply({ ...info('No previous track', 'There is no track to go back to.'), flags: EPH | V2 });
                    return;
                }
                await player.play({ clientTrack: prev });
                await interaction.reply({ ...info('Previous track', 'Playing the previous track again.'), flags: EPH | V2 });
                return;
            }
            case 'seekback':
            case 'seekfwd': {
                if (player.queue.current?.info.isStream) {
                    await interaction.reply({ ...info('Live stream', 'You can not seek within a live stream.'), flags: EPH | V2 });
                    return;
                }
                const delta = action === 'seekfwd' ? 10_000 : -10_000;
                const target = Math.max(0, (player.position || 0) + delta);
                await player.seek(target);
                break;
            }
            case 'voldown': {
                await player.setVolume(Math.max(0, player.volume - 10));
                break;
            }
            case 'volup': {
                await player.setVolume(Math.min(150, player.volume + 10));
                break;
            }
            case 'loop': {
                const next = player.repeatMode === 'off' ? 'track' : player.repeatMode === 'track' ? 'queue' : 'off';
                await player.setRepeatMode(next);
                break;
            }
            case 'shuffle': {
                if (player.queue.tracks.length < 2) {
                    await interaction.reply({ ...info('Not enough tracks', 'Add at least two tracks to shuffle.'), flags: EPH | V2 });
                    return;
                }
                await player.queue.shuffle();
                break;
            }
            case 'refresh': {
                break;
            }
            case 'queue': {
                await interaction.reply({ components: [queueContainer(player, 0)], flags: EPH | V2 });
                return;
            }
            case 'clear': {
                if (!player.queue.tracks.length) {
                    await interaction.reply({ ...info('Queue already empty', 'There are no upcoming tracks to clear.'), flags: EPH | V2 });
                    return;
                }
                const removed = player.queue.tracks.length;
                await player.queue.splice(0, player.queue.tracks.length);

                const clearPayload = await nowPlayingContainer(player);
                await interaction.update({ components: [clearPayload.container], files: clearPayload.files, flags: V2 });
                await interaction.followUp({ ...info('Queue cleared', `Removed **${removed}** upcoming track${removed === 1 ? '' : 's'}.`), flags: EPH | V2 });
                return;
            }
            default:
                await interaction.reply({ content: 'Unknown control.', flags: EPH });
                return;
        }

        const payload = await nowPlayingContainer(player);
        await interaction.update({ components: [payload.container], files: payload.files, flags: V2 });
    },
};

// ── /skip ──────────────────────────────────────────────────────────────────

export const skipCommand: Command = {
    data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current track').setDMPermission(false),
    async execute(interaction) {
        await interaction.deferReply();
        const player = await requirePlayer(interaction);
        if (!player) return;
        const title = player.queue.current?.info?.title ?? 'the current track';
        if (!player.queue.tracks.length) {
            await player.destroy().catch(() => undefined);
            await interaction.editReply(info('Skipped', `Skipped **${title}** — that was the last track, so I stopped.`));
            return;
        }
        await player.skip();
        await interaction.editReply(info('Skipped', `Skipped **${title}**.`));
    },
};

// ── /stop ──────────────────────────────────────────────────────────────────

export const stopCommand: Command = {
    data: new SlashCommandBuilder().setName('stop').setDescription('Stop playback, clear the queue and leave').setDMPermission(false),
    async execute(interaction) {
        await interaction.deferReply();
        const player = await requirePlayer(interaction);
        if (!player) return;
        await player.destroy();
        await interaction.editReply(info('Stopped', 'Playback stopped, queue cleared, and I left the voice channel. 👋'));
    },
};

// ── /pause ─────────────────────────────────────────────────────────────────

export const pauseCommand: Command = {
    data: new SlashCommandBuilder().setName('pause').setDescription('Pause the current track').setDMPermission(false),
    async execute(interaction) {
        await interaction.deferReply();
        const player = await requirePlayer(interaction);
        if (!player) return;
        if (player.paused) {
            await interaction.editReply(info('Already paused', 'Playback is already paused — use `/resume` to continue.'));
            return;
        }
        await player.pause();
        await refreshNowPlaying(player);
        await interaction.editReply(ok('Paused', 'Playback paused. Use `/resume` to continue.'));
    },
};

// ── /resume ────────────────────────────────────────────────────────────────

export const resumeCommand: Command = {
    data: new SlashCommandBuilder().setName('resume').setDescription('Resume a paused track').setDMPermission(false),
    async execute(interaction) {
        await interaction.deferReply();
        const player = await requirePlayer(interaction);
        if (!player) return;
        if (!player.paused) {
            await interaction.editReply(info('Already playing', 'Playback is not paused.'));
            return;
        }
        await player.resume();
        await refreshNowPlaying(player);
        await interaction.editReply(ok('Resumed', 'Playback resumed. ▶️'));
    },
};

// ── /queue ─────────────────────────────────────────────────────────────────

export const queueCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show the music queue')
        .setDMPermission(false)
        .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1)),
    async execute(interaction) {
        await interaction.deferReply();
        const player = interaction.client.lavalink.getPlayer(interaction.guildId!);
        if (!player || (!player.queue.current && !player.queue.tracks.length)) {
            await interaction.editReply(info('Queue empty', 'Nothing is queued. Add a song with `/play`.'));
            return;
        }
        const page = (interaction.options.getInteger('page') ?? 1) - 1;
        await interaction.editReply({ components: [queueContainer(player, page)], flags: V2 });
    },
};

// ── /nowplaying ──────────────────────────────────────────────────────────────

export const nowplayingCommand: Command = {
    data: new SlashCommandBuilder().setName('nowplaying').setDescription('Show the currently playing track').setDMPermission(false),
    async execute(interaction) {
        await interaction.deferReply();
        const player = interaction.client.lavalink.getPlayer(interaction.guildId!);
        if (!player || !player.queue.current) {
            await interaction.editReply(info('Nothing is playing', 'Start a track with `/play`.'));
            return;
        }
        const payload = await nowPlayingContainer(player);
        await interaction.editReply({ components: [payload.container], files: payload.files, flags: V2 });
        // Re-anchor the live panel to this fresh message.
        const sent = await interaction.fetchReply().catch(() => null);
        if (sent) player.set('npMessage', sent);
    },
};

// ── /volume ──────────────────────────────────────────────────────────────────

export const volumeCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Set or view the playback volume (0–150)')
        .setDMPermission(false)
        .addIntegerOption((o) => o.setName('level').setDescription('Volume percent (0–150)').setMinValue(0).setMaxValue(150)),
    async execute(interaction) {
        await interaction.deferReply();
        const player = await requirePlayer(interaction);
        if (!player) return;
        const level = interaction.options.getInteger('level');
        if (level === null) {
            await interaction.editReply(info('Volume', `Current volume is **${player.volume}%**. Pass a level (0–150) to change it.`));
            return;
        }
        await player.setVolume(level);
        await refreshNowPlaying(player);
        await interaction.editReply(ok('Volume updated', `Volume set to **${level}%**. 🔊`));
    },
};

// ── /loop ────────────────────────────────────────────────────────────────────

export const loopCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('loop')
        .setDescription('Set the loop mode')
        .setDMPermission(false)
        .addStringOption((o) =>
            o.setName('mode').setDescription('Loop mode').setRequired(true).addChoices(
                { name: 'Off', value: 'off' },
                { name: 'Current track', value: 'track' },
                { name: 'Whole queue', value: 'queue' },
            ),
        ),
    async execute(interaction) {
        await interaction.deferReply();
        const player = await requirePlayer(interaction);
        if (!player) return;
        const mode = interaction.options.getString('mode', true) as 'off' | 'track' | 'queue';
        await player.setRepeatMode(mode);
        await refreshNowPlaying(player);
        const label = mode === 'off' ? 'disabled' : mode === 'track' ? 'looping the current track 🔂' : 'looping the whole queue 🔁';
        await interaction.editReply(ok('Loop updated', `Loop is now ${label}.`));
    },
};

// ── /shuffle ─────────────────────────────────────────────────────────────────

export const shuffleCommand: Command = {
    data: new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the queue').setDMPermission(false),
    async execute(interaction) {
        await interaction.deferReply();
        const player = await requirePlayer(interaction);
        if (!player) return;
        if (player.queue.tracks.length < 2) {
            await interaction.editReply(info('Not enough tracks', 'Add at least two tracks to the queue to shuffle.'));
            return;
        }
        await player.queue.shuffle();
        await interaction.editReply(ok('Shuffled', `Shuffled **${player.queue.tracks.length}** tracks in the queue. 🔀`));
    },
};

// ── /disconnect ──────────────────────────────────────────────────────────────

export const disconnectCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('disconnect')
        .setDescription('Disconnect the bot from the voice channel')
        .setDMPermission(false),
    async execute(interaction) {
        await interaction.deferReply();
        const player = interaction.client.lavalink.getPlayer(interaction.guildId!);
        if (!player) {
            await interaction.editReply(info('Not connected', 'I am not in a voice channel.'));
            return;
        }
        const member = interaction.member as GuildMember | null;
        if (member?.voice?.channelId !== player.voiceChannelId) {
            await interaction.editReply({ components: [ComponentsV2.warningContainer('Wrong voice channel', 'Join my voice channel to disconnect me.')], flags: V2 });
            return;
        }
        await player.destroy();
        await interaction.editReply(info('Disconnected', 'Left the voice channel and cleared the queue. 👋'));
    },
};

// ── /music (control panel) ───────────────────────────────────────────────────

export const musicCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('music')
        .setDescription('Open the live music control panel')
        .setDMPermission(false),
    async execute(interaction) {
        await interaction.deferReply();
        const player = interaction.client.lavalink.getPlayer(interaction.guildId!);
        if (!player || !player.queue.current) {
            await interaction.editReply({ components: [musicIdleContainer()], flags: V2 });
            return;
        }
        const payload = await nowPlayingContainer(player);
        await interaction.editReply({ components: [payload.container], files: payload.files, flags: V2 });
        // Re-anchor the live panel to this fresh message so controls keep updating it.
        const sent = await interaction.fetchReply().catch(() => null);
        if (sent) player.set('npMessage', sent);
    },
};

export const musicCommands: Command[] = [
    musicCommand,
    playCommand,
    skipCommand,
    stopCommand,
    pauseCommand,
    resumeCommand,
    queueCommand,
    nowplayingCommand,
    volumeCommand,
    loopCommand,
    shuffleCommand,
    disconnectCommand,
];
