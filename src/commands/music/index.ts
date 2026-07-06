/**
 * Victus Cloud music commands (Lavalink).
 *
 * Top-level slash commands so members can either type `/play`, `/skip`, … or use
 * the buttons on the live Now Playing panel. All control buttons (`music:*`) are
 * handled by `playCommand.handleButton`.
 */
import {
    ChannelType,
    GuildMember,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    StringSelectMenuInteraction,
    VoiceBasedChannel,
    ModalSubmitInteraction,
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
    musicControlsContainer,
    escapeMd,
} from '../../embeds/music.js';
import { refreshNowPlaying } from '../../services/music.js';
import { supabase } from '../../services/supabase.js';
import { playlistService } from '../../services/playlistSettings.js';

const EPH = MessageFlags.Ephemeral;
const V2 = ComponentsV2.IS_COMPONENTS_V2;

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
        const container = ComponentsV2.warningContainer(title, body);
        if (deferred && interaction.isChatInputCommand()) {
            await interaction.editReply({ components: [container], flags: V2 });
        } else {
            await interaction.reply({ components: [container], flags: V2 });
        }
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
        const container = ComponentsV2.warningContainer(title, body);
        if (deferred && interaction.isChatInputCommand()) {
            await interaction.editReply({ components: [container], flags: V2 });
        } else {
            await interaction.reply({ components: [container], flags: V2 });
        }
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
    const container = ComponentsV2.successContainer(title, body);
    return { components: [container] } as const;
}
function info(title: string, body: string) {
    const container = ComponentsV2.infoContainer(title, body);
    return { components: [container] } as const;
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
        await interaction.deferReply({ flags: V2 });
        const ctx = await requireVoice(interaction);
        if (!ctx) return;

        const query = interaction.options.getString('query', true).trim();
        const lavalink = interaction.client.lavalink;

        let player = lavalink.getPlayer(interaction.guildId!);
        if (player && player.voiceChannelId && player.voiceChannelId !== ctx.voice.id) {
            const container = ComponentsV2.warningContainer('Already in use', "I'm already playing in another voice channel. Join it to add songs.");
            await interaction.editReply({ components: [container], flags: V2 });
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
            const container = ComponentsV2.errorContainer('Search failed', 'Could not reach the music server. Please try again in a moment.');
            await interaction.editReply({ components: [container], flags: V2 });
            return;
        }

        if (!res || !res.tracks?.length || res.loadType === 'empty' || res.loadType === 'error') {
            const hint = isSpotify
                ? ' Make sure the Lavalink server has LavaSrc configured for Spotify.'
                : ' Try a different search or a direct link.';
            const container = ComponentsV2.warningContainer('No results', `Nothing found for **${query.slice(0, 120)}**.${hint}`);
            await interaction.editReply({ components: [container], flags: V2 });
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

        const addedEmbed = addedContainer(toAdd, playlistName, positionBefore);
        await interaction.editReply({ components: [addedEmbed], flags: V2 });
    },

    // Handle transport controls and ephemeral control panel button clicks
    async handleButton(interaction: ButtonInteraction) {
        if (!interaction.customId.startsWith('music:')) return;
        
        const player = interaction.client.lavalink.getPlayer(interaction.guildId!);
        if (!player) {
            await interaction.reply({ content: '❌ Nothing is playing right now.', ephemeral: true });
            return;
        }

        const member = interaction.member as GuildMember | null;
        if (member?.voice?.channelId !== player.voiceChannelId) {
            await interaction.reply({ content: '❌ Join my voice channel to control playback.', ephemeral: true });
            return;
        }

        const action = interaction.customId.split(':')[1];

        switch (action) {
            case 'open_controls': {
                const controls = musicControlsContainer(player);
                await interaction.reply({ embeds: [], components: controls.components, flags: EPH | V2 });
                return;
            }
            case 'like': {
                const track = player.queue.current;
                if (track) {
                    try {
                        const embed = await supabase.getCustomEmbed(interaction.guildId!, `_music_favorites_${interaction.user.id}`);
                        let favorites: any[] = [];
                        if (embed?.description) {
                            favorites = JSON.parse(embed.description);
                        }
                        const trackInfoRecord = {
                            title: track.info.title,
                            uri: track.info.uri,
                            author: track.info.author,
                            duration: track.info.duration
                        };
                        if (!favorites.some(f => f.uri === track.info.uri)) {
                            favorites.push(trackInfoRecord);
                            await supabase.saveCustomEmbed(interaction.guildId!, `_music_favorites_${interaction.user.id}`, {
                                description: JSON.stringify(favorites)
                            });
                        }
                        await interaction.reply({ content: `❤️ Added **${escapeMd(track.info.title)}** to your favorites!`, ephemeral: true });
                    } catch (error) {
                        logger.error('Failed to save music favorite:', error);
                        await interaction.reply({ content: '❌ Failed to add to favorites.', ephemeral: true });
                    }
                }
                return;
            }
            case 'pause': {
                if (player.paused) await player.resume();
                else await player.pause();
                break;
            }
            case 'skip': {
                if (!player.queue.tracks.length) {
                    await interaction.reply({ content: '⏭️ That was the last track — stopping playback.', ephemeral: true });
                    await player.destroy().catch(() => undefined);
                    return;
                }
                await player.skip();
                await interaction.reply({ content: '⏭️ Skipped to the next track.', ephemeral: true });
                return;
            }
            case 'previous': {
                const prev = player.queue.previous?.[0];
                if (!prev) {
                    await interaction.reply({ content: '⏮️ There is no track to go back to.', ephemeral: true });
                    return;
                }
                await player.play({ clientTrack: prev });
                await interaction.reply({ content: '⏮️ Playing the previous track.', ephemeral: true });
                return;
            }
            case 'stop': {
                await player.destroy();
                await interaction.reply({ content: '⏹️ Playback stopped and connection closed.', ephemeral: true });
                return;
            }
            case 'loop': {
                const next = player.repeatMode === 'off' ? 'track' : player.repeatMode === 'track' ? 'queue' : 'off';
                await player.setRepeatMode(next);
                break;
            }
            case 'queue': {
                const embed = queueContainer(player, 0);
                await interaction.reply({ embeds: [], components: [embed], flags: EPH | V2 });
                return;
            }
            case 'volume': {
                const modal = new ModalBuilder()
                    .setCustomId('music:volume_modal')
                    .setTitle('Adjust Volume');

                const volInput = new TextInputBuilder()
                    .setCustomId('volume_level')
                    .setLabel('Volume Level (0-150)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Enter a number from 0 to 150')
                    .setValue(String(player.volume))
                    .setRequired(true)
                    .setMinLength(1)
                    .setMaxLength(3);

                modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(volInput));
                await interaction.showModal(modal);
                return;
            }
            case 'history': {
                const prev = player.queue.previous;
                if (!prev || prev.length === 0) {
                    await interaction.reply({ content: '🕒 No history found.', ephemeral: true });
                    return;
                }
                const historyList = prev.slice(0, 10).map((t, idx) => `${idx + 1}. **${escapeMd(t.info.title)}**`).join('\n');
                await interaction.reply({ content: `🕒 **Recent History:**\n${historyList}`, ephemeral: true });
                return;
            }
            case 'library_playlists': {
                const playlists = await playlistService.getAll(interaction.guildId!, interaction.user.id);
                if (playlists.length === 0) {
                    await interaction.reply({ content: '📁 You have no playlists. Use `/playlist create` to make one!', ephemeral: true });
                    return;
                }
                const list = playlists.map(p => `• **${escapeMd(p.name)}** (${p.tracks.length} tracks)`).join('\n');
                await interaction.reply({ content: `📁 **Your Playlists:**\n${list}`, ephemeral: true });
                return;
            }
            default: {
                await interaction.reply({ content: '🔧 Feature coming soon!', ephemeral: true });
                return;
            }
        }

        await refreshNowPlaying(player);

        if (interaction.message.flags.has(MessageFlags.Ephemeral)) {
            const controls = musicControlsContainer(player);
            await interaction.update({ embeds: [], components: controls.components });
        } else {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.deferUpdate().catch(() => undefined);
            }
        }
    },

    async handleSelectMenu(interaction: StringSelectMenuInteraction) {
        if (interaction.customId !== 'music:controls') return;

        const player = interaction.client.lavalink.getPlayer(interaction.guildId!);
        if (!player) {
            const container = ComponentsV2.warningContainer('Nothing is playing', 'This panel is no longer active. Use `/play` to start again.');
            await interaction.reply({ components: [container], flags: V2 });
            return;
        }
        const member = interaction.member as GuildMember | null;
        if (member?.voice?.channelId !== player.voiceChannelId) {
            const container = ComponentsV2.warningContainer('Wrong voice channel', 'Join my voice channel to control playback.');
            await interaction.reply({ components: [container], flags: V2 });
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
                    await interaction.reply({ ...info('Skipped', 'That was the last track — stopping playback.'), ephemeral: false });
                    await player.destroy().catch(() => undefined);
                    return;
                }
                await player.skip();
                await interaction.reply({ ...info('Skipped', 'Skipped to the next track.'), ephemeral: false });
                return;
            }
            case 'stop': {
                await player.destroy();
                const embed = new EmbedBuilder()
                    .setColor(0x2b2d31)
                    .setTitle('⏹ Stopped')
                    .setDescription('Playback stopped and the queue was cleared. 👋');
                await interaction.update({ embeds: [embed], components: [] });
                return;
            }
            case 'previous': {
                const prev = player.queue.previous?.[0];
                if (!prev) {
                    await interaction.reply({ ...info('No previous track', 'There is no track to go back to.'), ephemeral: false });
                    return;
                }
                await player.play({ clientTrack: prev });
                await interaction.reply({ ...info('Previous track', 'Playing the previous track again.'), ephemeral: false });
                return;
            }
            case 'loop': {
                const next = player.repeatMode === 'off' ? 'track' : player.repeatMode === 'track' ? 'queue' : 'off';
                await player.setRepeatMode(next);
                break;
            }
            case 'restart': {
                await player.seek(0);
                break;
            }
            case 'seekback': {
                if (player.queue.current?.info.isStream) {
                    await interaction.reply({ ...info('Live stream', 'You cannot seek within a live stream.'), ephemeral: false });
                    return;
                }
                const target = Math.max(0, (player.position || 0) - 10000);
                await player.seek(target);
                break;
            }
            case 'seekfwd': {
                if (player.queue.current?.info.isStream) {
                    await interaction.reply({ ...info('Live stream', 'You cannot seek within a live stream.'), ephemeral: false });
                    return;
                }
                const target = Math.min(player.queue.current?.info.duration || 0, (player.position || 0) + 10000);
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
            case 'shuffle': {
                if (player.queue.tracks.length < 2) {
                    await interaction.reply({ ...info('Not enough tracks', 'Add at least two tracks to shuffle.'), ephemeral: false });
                    return;
                }
                await player.queue.shuffle();
                break;
            }
            case 'queue': {
                const embed = queueContainer(player, 0);
                await interaction.reply({ embeds: [], components: [embed], flags: V2 });
                return;
            }
            case 'clear': {
                if (!player.queue.tracks.length) {
                    await interaction.reply({ ...info('Queue empty', 'The queue is already empty.'), ephemeral: false });
                    return;
                }
                const count = player.queue.tracks.length;
                await player.queue.splice(0, count);
                break;
            }
            case 'refresh': {
                break;
            }
            default:
                await interaction.reply({ content: 'Unknown control.', ephemeral: false });
                return;
        }

        const payload = await nowPlayingContainer(player, interaction.guild);
        await interaction.update({ embeds: payload.embeds, components: payload.components, files: payload.files });
    },

    async handleModal(interaction: ModalSubmitInteraction) {
        if (interaction.customId !== 'music:volume_modal') return;

        const player = interaction.client.lavalink.getPlayer(interaction.guildId!);
        if (!player) {
            await interaction.reply({ content: '❌ Nothing is playing right now.', ephemeral: true });
            return;
        }

        const member = interaction.member as GuildMember | null;
        if (member?.voice?.channelId !== player.voiceChannelId) {
            await interaction.reply({ content: '❌ Join my voice channel to control playback.', ephemeral: true });
            return;
        }

        const input = interaction.fields.getTextInputValue('volume_level').trim();
        const level = parseInt(input, 10);
        if (isNaN(level) || level < 0 || level > 150) {
            await interaction.reply({ content: '❌ Invalid volume. Please enter a number between 0 and 150.', ephemeral: true });
            return;
        }

        await player.setVolume(level);
        await refreshNowPlaying(player);

        if (interaction.message?.flags.has(MessageFlags.Ephemeral)) {
            const controls = musicControlsContainer(player);
            await (interaction as any).update({ embeds: [], components: controls.components });
        } else {
            await interaction.reply({ content: `🔊 Volume set to **${level}%**.`, ephemeral: true });
        }
    }
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
        .setDescription('Manage the music queue')
        .setDMPermission(false)
        .addSubcommand((sub) =>
            sub.setName('list')
                .setDescription('Show the music queue')
                .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1))
        )
        .addSubcommand((sub) =>
            sub.setName('edit')
                .setDescription('Edit the queue (remove or re-position tracks)')
                .addIntegerOption((o) => o.setName('remove_position').setDescription('The position of the track to remove').setMinValue(1))
                .addIntegerOption((o) => o.setName('move_from').setDescription('The current position of the track to move').setMinValue(1))
                .addIntegerOption((o) => o.setName('move_to').setDescription('The target position to move the track to').setMinValue(1))
        ),
    async execute(interaction) {
        await interaction.deferReply({ flags: V2 });
        const player = interaction.client.lavalink.getPlayer(interaction.guildId!);
        if (!player || (!player.queue.current && !player.queue.tracks.length)) {
            await interaction.editReply(info('Queue empty', 'Nothing is queued. Add a song with `/play`.'));
            return;
        }

        const sub = interaction.options.getSubcommand(false) || 'list';

        if (sub === 'list') {
            const page = (interaction.options.getInteger('page') ?? 1) - 1;
            const embed = queueContainer(player, page);
            await interaction.editReply({ components: [embed], flags: V2 });
            return;
        }

        if (sub === 'edit') {
            const removePos = interaction.options.getInteger('remove_position');
            const moveFrom = interaction.options.getInteger('move_from');
            const moveTo = interaction.options.getInteger('move_to');

            if (!removePos && (!moveFrom || !moveTo)) {
                await interaction.editReply(info('Missing Options', 'Please specify either a track position to remove, or both "move_from" and "move_to" positions.'));
                return;
            }

            if (removePos) {
                const index = removePos - 1;
                if (index < 0 || index >= player.queue.tracks.length) {
                    await interaction.editReply(info('Invalid Position', `Please specify a position between 1 and ${player.queue.tracks.length}.`));
                    return;
                }
                const track = player.queue.tracks[index];
                await player.queue.splice(index, 1);
                await interaction.editReply(ok('Track Removed', `Removed **${track.info.title}** from position \`${removePos}\`.`));
                return;
            }

            if (moveFrom && moveTo) {
                const fromIndex = moveFrom - 1;
                const toIndex = moveTo - 1;
                const queueLength = player.queue.tracks.length;

                if (fromIndex < 0 || fromIndex >= queueLength || toIndex < 0 || toIndex >= queueLength) {
                    await interaction.editReply(info('Invalid Positions', `Please specify positions between 1 and ${queueLength}.`));
                    return;
                }

                const tracks = [...player.queue.tracks];
                const [movedTrack] = tracks.splice(fromIndex, 1);
                if (movedTrack) {
                    tracks.splice(toIndex, 0, movedTrack);
                    await player.queue.splice(0, player.queue.tracks.length, ...tracks);
                    await interaction.editReply(ok('Track Re-positioned', `Moved **${movedTrack.info.title}** from position \`${moveFrom}\` to \`${moveTo}\`.`));
                } else {
                    await interaction.editReply(info('Action Failed', 'Could not move track.'));
                }
                return;
            }
        }
    },
};

// ── /nowplaying ──────────────────────────────────────────────────────────────

export const nowplayingCommand: Command = {
    data: new SlashCommandBuilder().setName('nowplaying').setDescription('Show the currently playing track').setDMPermission(false),
    async execute(interaction) {
        await interaction.deferReply({ flags: V2 });
        const player = interaction.client.lavalink.getPlayer(interaction.guildId!);
        if (!player || !player.queue.current) {
            await interaction.editReply(info('Nothing is playing', 'Start a track with `/play`.'));
            return;
        }
        const payload = await nowPlayingContainer(player, interaction.guild);
        await interaction.editReply({ embeds: [], components: payload.components, files: payload.files, flags: V2 });
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
        await interaction.deferReply({ flags: V2 });
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
        await interaction.deferReply({ flags: V2 });
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
        await interaction.deferReply({ flags: V2 });
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
        await interaction.deferReply({ flags: V2 });
        const player = interaction.client.lavalink.getPlayer(interaction.guildId!);
        if (!player) {
            await interaction.editReply(info('Not connected', 'I am not in a voice channel.'));
            return;
        }
        const member = interaction.member as GuildMember | null;
        if (member?.voice?.channelId !== player.voiceChannelId) {
            const container = ComponentsV2.warningContainer('Wrong voice channel', 'Join my voice channel to disconnect me.');
            await interaction.editReply({ components: [container], flags: V2 });
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
        await interaction.deferReply({ flags: V2 });
        const player = interaction.client.lavalink.getPlayer(interaction.guildId!);
        if (!player || !player.queue.current) {
            const embed = musicIdleContainer();
            await interaction.editReply({ components: [embed], flags: V2 });
            return;
        }
        const payload = await nowPlayingContainer(player, interaction.guild);
        await interaction.editReply({ embeds: [], components: payload.components, files: payload.files, flags: V2 });
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
