import { 
    ActionRowBuilder, 
    EmbedBuilder,
    GuildMember,
    MessageFlags, 
    PermissionFlagsBits, 
    SlashCommandBuilder, 
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import type { ChatInputCommandInteraction, StringSelectMenuInteraction, ModalSubmitInteraction } from 'discord.js';
import type { Command } from '../types/index.js';
import { playlistService, PlaylistTrack } from '../services/playlistSettings.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { escapeMd, formatDuration } from '../embeds/music.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = undefined as any;

export const playlistCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('playlist')
        .setDescription('Manage your custom music playlists')
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Create a new empty playlist')
                .addStringOption(opt => opt.setName('name').setDescription('Name of the playlist').setRequired(true).setMaxLength(32))
        )
        .addSubcommand(sub =>
            sub.setName('delete')
                .setDescription('Delete a playlist')
                .addStringOption(opt => opt.setName('name').setDescription('Name of the playlist to delete').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('rename')
                .setDescription('Rename a playlist')
                .addStringOption(opt => opt.setName('name').setDescription('Current name of the playlist').setRequired(true))
                .addStringOption(opt => opt.setName('new_name').setDescription('New name for the playlist').setRequired(true).setMaxLength(32))
        )
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Add a song to a playlist')
                .addStringOption(opt => opt.setName('name').setDescription('Name of the playlist').setRequired(true))
                .addStringOption(opt => opt.setName('query').setDescription('Song name or URL to add').setRequired(true).setMaxLength(500))
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove a song from a playlist by its position')
                .addStringOption(opt => opt.setName('name').setDescription('Name of the playlist').setRequired(true))
                .addIntegerOption(opt => opt.setName('position').setDescription('Track number to remove (e.g. 1)').setRequired(true).setMinValue(1))
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List all your playlists')
        )
        .addSubcommand(sub =>
            sub.setName('play')
                .setDescription('Queue and play a playlist')
                .addStringOption(opt => opt.setName('name').setDescription('Name of the playlist to play').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('edit')
                .setDescription('Open the interactive playlist editor dashboard')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand(true);
        const guildId = interaction.guildId!;
        const userId = interaction.user.id;
        const isPrefix = interaction.constructor.name === 'PrefixInteraction';

        try {
            if (sub === 'create') {
                const name = interaction.options.getString('name', true).trim();
                await playlistService.create(guildId, userId, name);
                
                const embed = new EmbedBuilder()
                    .setColor(0x10b981)
                    .setTitle('☑️ Playlist Created')
                    .setDescription(`Created playlist **${escapeMd(name)}** successfully. Use \`/playlist add\` to add tracks.`);
                await interaction.reply({ embeds: [embed], flags: EPH });
            }
            else if (sub === 'delete') {
                const name = interaction.options.getString('name', true).trim();
                const deleted = await playlistService.delete(guildId, userId, name);
                
                if (!deleted) {
                    await interaction.reply({ content: `❌ Playlist **${escapeMd(name)}** not found.`, flags: EPH });
                    return;
                }

                const embed = new EmbedBuilder()
                    .setColor(0x10b981)
                    .setTitle('🗑️ Playlist Deleted')
                    .setDescription(`Deleted playlist **${escapeMd(name)}** successfully.`);
                await interaction.reply({ embeds: [embed], flags: EPH });
            }
            else if (sub === 'rename') {
                const name = interaction.options.getString('name', true).trim();
                const newName = interaction.options.getString('new_name', true).trim();
                await playlistService.rename(guildId, userId, name, newName);

                const embed = new EmbedBuilder()
                    .setColor(0x10b981)
                    .setTitle('✏️ Playlist Renamed')
                    .setDescription(`Renamed playlist **${escapeMd(name)}** to **${escapeMd(newName)}** successfully.`);
                await interaction.reply({ embeds: [embed], flags: EPH });
            }
            else if (sub === 'add') {
                if (!isPrefix) await interaction.deferReply({ flags: EPH });
                else await interaction.deferReply();

                const name = interaction.options.getString('name', true).trim();
                const query = interaction.options.getString('query', true).trim();

                const playlist = await playlistService.get(guildId, userId, name);
                if (!playlist) {
                    await interaction.editReply({ content: `❌ Playlist **${escapeMd(name)}** not found.` });
                    return;
                }

                const lavalink = interaction.client.lavalink;
                const node = lavalink.nodeManager.leastUsedNodes()[0];
                if (!node) {
                    await interaction.editReply({ content: '❌ No active music servers available to search.' });
                    return;
                }

                const isUrl = /^https?:\/\//i.test(query);
                const isSpotify = /open\.spotify\.com/i.test(query);

                let res: any;
                try {
                    const searchQuery = isUrl ? { query } : { query, source: config.lavalink.defaultSource as any };
                    res = await node.search(searchQuery, interaction.user);

                    if (isSpotify && (!res || !res.tracks?.length || res.loadType === 'empty' || res.loadType === 'error')) {
                        res = await node.search({ query, source: 'spsearch' as any }, interaction.user);
                    }
                } catch (err) {
                    logger.error('Playlist search failed:', err);
                    await interaction.editReply({ content: '❌ Search failed. Could not reach the music server.' });
                    return;
                }

                if (!res || !res.tracks?.length || res.loadType === 'empty' || res.loadType === 'error') {
                    await interaction.editReply({ content: `❌ No results found for **${query.slice(0, 100)}**.` });
                    return;
                }

                const isPlaylist = res.loadType === 'playlist';
                const tracksToAdd = isPlaylist ? res.tracks : [res.tracks[0]];

                for (const track of tracksToAdd) {
                    const trackRecord: PlaylistTrack = {
                        title: track.info.title,
                        uri: track.info.uri,
                        author: track.info.author,
                        duration: track.info.duration,
                        source: track.info.sourceName || 'unknown'
                    };
                    await playlistService.addTrack(guildId, userId, name, trackRecord);
                }

                const successEmbed = new EmbedBuilder()
                    .setColor(0x10b981)
                    .setTitle('✅ Added to Playlist')
                    .setDescription(
                        isPlaylist 
                            ? `Added **${tracksToAdd.length}** tracks from playlist **${escapeMd(res.playlist?.name || 'Playlist')}** to **${escapeMd(playlist.name)}**.`
                            : `Added **[${escapeMd(tracksToAdd[0].info.title)}](${tracksToAdd[0].info.uri})** to **${escapeMd(playlist.name)}**.`
                    );

                await interaction.editReply({ embeds: [successEmbed] });
            }
            else if (sub === 'remove') {
                const name = interaction.options.getString('name', true).trim();
                const pos = interaction.options.getInteger('position', true);

                const playlist = await playlistService.get(guildId, userId, name);
                if (!playlist) {
                    await interaction.reply({ content: `❌ Playlist **${escapeMd(name)}** not found.`, flags: EPH });
                    return;
                }

                const index = pos - 1;
                if (index < 0 || index >= playlist.tracks.length) {
                    await interaction.reply({ content: `❌ Invalid track position. Choose a number between 1 and ${playlist.tracks.length}.`, flags: EPH });
                    return;
                }

                const removedTrack = playlist.tracks[index];
                await playlistService.removeTrack(guildId, userId, name, index);

                const embed = new EmbedBuilder()
                    .setColor(0x10b981)
                    .setTitle('☑️ Track Removed')
                    .setDescription(`Removed **${escapeMd(removedTrack.title)}** from playlist **${escapeMd(playlist.name)}** successfully.`);
                await interaction.reply({ embeds: [embed], flags: EPH });
            }
            else if (sub === 'list') {
                const playlists = await playlistService.getAll(guildId, userId);
                if (playlists.length === 0) {
                    const embed = new EmbedBuilder()
                        .setColor(0x3b82f6)
                        .setTitle('ℹ️ No Playlists')
                        .setDescription('You have not created any custom playlists yet. Use \`/playlist create <name>\` to start.');
                    await interaction.reply({ embeds: [embed], flags: EPH });
                    return;
                }

                const listEmbed = new EmbedBuilder()
                    .setColor(0x3b82f6)
                    .setTitle('🎶 Your Music Playlists')
                    .setDescription('────────────────────────');

                playlists.forEach((p) => {
                    const totalDuration = p.tracks.reduce((sum, t) => sum + t.duration, 0);
                    listEmbed.addFields({
                        name: `📂 ${p.name}`,
                        value: `› Tracks: \`${p.tracks.length}\` | Duration: \`${formatDuration(totalDuration)}\`\n› Updated: <t:${Math.floor(new Date(p.updatedAt).getTime() / 1000)}:R>`
                    });
                });

                await interaction.reply({ embeds: [listEmbed], flags: EPH });
            }
            else if (sub === 'play') {
                if (!isPrefix) await interaction.deferReply({ flags: EPH });
                else await interaction.deferReply();

                const name = interaction.options.getString('name', true).trim();
                const playlist = await playlistService.get(guildId, userId, name);
                if (!playlist) {
                    await interaction.editReply({ content: `❌ Playlist **${escapeMd(name)}** not found.` });
                    return;
                }

                if (playlist.tracks.length === 0) {
                    await interaction.editReply({ content: `❌ Playlist **${escapeMd(playlist.name)}** is empty. Add songs first using \`/playlist add\`.` });
                    return;
                }

                const member = interaction.member as GuildMember;
                const voice = member.voice.channel;
                if (!voice) {
                    await interaction.editReply({ content: '❌ You must join a voice channel first to play music.' });
                    return;
                }

                const lavalink = interaction.client.lavalink;
                let player = lavalink.getPlayer(guildId);
                
                if (player && player.voiceChannelId && player.voiceChannelId !== voice.id) {
                    await interaction.editReply({ content: '❌ I am already playing in another voice channel.' });
                    return;
                }

                if (!player) {
                    player = lavalink.createPlayer({
                        guildId,
                        voiceChannelId: voice.id,
                        textChannelId: interaction.channelId,
                        selfDeaf: true,
                        selfMute: false,
                        volume: config.lavalink.defaultVolume,
                    });
                }

                if (!player.connected) await player.connect();

                let addedCount = 0;
                for (const t of playlist.tracks) {
                    try {
                        let searchRes = await player.search({ query: t.uri }, interaction.user);
                        
                        // Fallback 1: Try spsearch if it's a Spotify track and direct load failed
                        if ((!searchRes || !searchRes.tracks?.length || searchRes.loadType === 'empty' || searchRes.loadType === 'error') && t.source === 'spotify') {
                            searchRes = await player.search({ query: t.uri, source: 'spsearch' as any }, interaction.user);
                        }

                        // Fallback 2: Search by title + author if both failed
                        if (!searchRes || !searchRes.tracks?.length || searchRes.loadType === 'empty' || searchRes.loadType === 'error') {
                            const fallbackQuery = `${t.title} ${t.author}`;
                            searchRes = await player.search({ query: fallbackQuery, source: config.lavalink.defaultSource as any }, interaction.user);
                        }

                        if (searchRes.tracks?.length) {
                            await player.queue.add(searchRes.tracks[0]);
                            addedCount++;
                        }
                    } catch (err) {
                        logger.error(`Failed to load track ${t.title} from playlist:`, err);
                    }
                }

                if (addedCount === 0) {
                    await interaction.editReply({ content: '❌ Failed to load any tracks from the playlist.' });
                    return;
                }

                if (!player.playing && !player.paused) await player.play();

                const successEmbed = new EmbedBuilder()
                    .setColor(0x10b981)
                    .setTitle('🎶 Playlist Queued')
                    .setDescription(`Successfully queued and loaded **${addedCount}** tracks from playlist **${escapeMd(playlist.name)}**.`);
                await interaction.editReply({ embeds: [successEmbed] });
            }
            else if (sub === 'edit') {
                const playlists = await playlistService.getAll(guildId, userId);
                if (playlists.length === 0) {
                    await interaction.reply({ content: '❌ You have no playlists to edit. Create one using `/playlist create`.', flags: EPH });
                    return;
                }

                const selectMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('playlist_edit:select_playlist')
                        .setPlaceholder('Select a playlist to edit...')
                        .addOptions(playlists.map(p => ({
                            label: p.name,
                            value: p.name,
                            description: `${p.tracks.length} tracks`
                        })))
                );

                await interaction.reply({
                    content: '🛠️ **Playlist Editor**\nChoose a playlist from the dropdown menu below to edit its name, delete it, or remove tracks.',
                    components: [selectMenu],
                    flags: EPH
                });
            }
        } catch (error: any) {
            logger.error('Playlist subcommand execution failed:', error);
            const msg = error?.message || 'An unexpected error occurred.';
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ content: `❌ Error: ${msg}` }).catch(() => {});
            } else {
                await interaction.reply({ content: `❌ Error: ${msg}`, flags: EPH }).catch(() => {});
            }
        }
    },

    async handleSelectMenu(interaction) {
        const guildId = interaction.guildId!;
        const userId = interaction.user.id;

        if (interaction.customId === 'playlist_edit:select_playlist') {
            const playlistName = interaction.values[0];
            const playlist = await playlistService.get(guildId, userId, playlistName);
            
            if (!playlist) {
                await interaction.update({ content: '❌ Playlist not found.', components: [] });
                return;
            }

            const actionMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`playlist_edit:actions:${playlist.name}`)
                    .setPlaceholder('Select editing action...')
                    .addOptions([
                        { label: '✏️ Rename Playlist', value: 'rename', description: 'Change the playlist name' },
                        { label: '🗑️ Delete Playlist', value: 'delete', description: 'Permanently remove the playlist' },
                        { label: '❌ Remove Track', value: 'remove_track', description: 'Remove a specific track from the playlist' }
                    ])
            );

            await interaction.update({
                content: `📂 **Editing Playlist: ${escapeMd(playlist.name)}**\nTracks: \`${playlist.tracks.length}\`\nChoose an action below:`,
                components: [actionMenu]
            });
        }
        else if (interaction.customId.startsWith('playlist_edit:actions:')) {
            const playlistName = interaction.customId.split(':')[2];
            const action = interaction.values[0];
            const playlist = await playlistService.get(guildId, userId, playlistName);
            
            if (!playlist) {
                await interaction.update({ content: '❌ Playlist not found.', components: [] });
                return;
            }

            if (action === 'delete') {
                await playlistService.delete(guildId, userId, playlist.name);
                await interaction.update({
                    content: `🗑️ **Playlist "${escapeMd(playlist.name)}" has been deleted.**`,
                    components: []
                });
            }
            else if (action === 'rename') {
                const modal = new ModalBuilder()
                    .setCustomId(`playlist_edit:modal_rename:${playlist.name}`)
                    .setTitle('Rename Playlist');
                
                modal.addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(
                        new TextInputBuilder()
                            .setCustomId('newName')
                            .setLabel('New Playlist Name')
                            .setValue(playlist.name)
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setMaxLength(32)
                    )
                );

                await interaction.showModal(modal);
            }
            else if (action === 'remove_track') {
                if (playlist.tracks.length === 0) {
                    await interaction.update({
                        content: `❌ Playlist **${escapeMd(playlist.name)}** has no tracks to remove.`,
                        components: []
                    });
                    return;
                }

                // Show a dropdown of tracks (max 25 allowed in StringSelectMenuBuilder)
                const tracksToSelect = playlist.tracks.slice(0, 25);
                const trackSelectMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(`playlist_edit:do_remove_track:${playlist.name}`)
                        .setPlaceholder('Select track to remove...')
                        .addOptions(tracksToSelect.map((t, idx) => ({
                            label: `${idx + 1}. ${t.title.slice(0, 50)}`,
                            value: String(idx),
                            description: t.author.slice(0, 50)
                        })))
                );

                await interaction.update({
                    content: `❌ **Select a track to remove from "${escapeMd(playlist.name)}"**:`,
                    components: [trackSelectMenu]
                });
            }
        }
        else if (interaction.customId.startsWith('playlist_edit:do_remove_track:')) {
            const playlistName = interaction.customId.split(':')[2];
            const trackIdx = parseInt(interaction.values[0], 10);
            
            const playlist = await playlistService.get(guildId, userId, playlistName);
            if (!playlist) {
                await interaction.update({ content: '❌ Playlist not found.', components: [] });
                return;
            }

            const removedTrack = playlist.tracks[trackIdx];
            await playlistService.removeTrack(guildId, userId, playlistName, trackIdx);

            await interaction.update({
                content: `✅ Removed **${escapeMd(removedTrack.title)}** from playlist **${escapeMd(playlist.name)}** successfully.`,
                components: []
            });
        }
    },

    async handleModal(interaction) {
        const guildId = interaction.guildId!;
        const userId = interaction.user.id;

        if (interaction.customId.startsWith('playlist_edit:modal_rename:')) {
            const oldName = interaction.customId.split(':')[2];
            const newName = (interaction as any).fields.getTextInputValue('newName').trim();

            try {
                await playlistService.rename(guildId, userId, oldName, newName);
                await (interaction as any).update({
                    content: `✏️ Playlist **${escapeMd(oldName)}** has been renamed to **${escapeMd(newName)}** successfully.`,
                    components: []
                });
            } catch (err: any) {
                await (interaction as any).update({
                    content: `❌ Error: ${err.message || 'Failed to rename playlist.'}`,
                    components: []
                });
            }
        }
    }
};
