/**
 * Victus Cloud — Announcement Setup & Send V2 Wizard
 * Admin-only command with interactive wizard and custom target channel routing.
 */

import {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    ThumbnailBuilder,
    ChannelType,
    MessageFlags,
    TextChannel,
    SectionBuilder,
} from 'discord.js';
import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    StringSelectMenuInteraction,
    ModalSubmitInteraction,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { requireAdmin } from '../middleware/requireLinked.js';
import { logger } from '../utils/logger.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

interface AnncDraft {
    channelId: string;
    title?: string;
    content?: string;
    color?: string;
    imageUrl?: string;
    thumbnailUrl?: string;
    footerText?: string;
}

// In-memory store for active creation drafts
const pendingDrafts = new Map<string, AnncDraft>();

function renderSetupDashboard(channels: string[]): ContainerBuilder {
    const container = new ContainerBuilder();
    
    const body = `### 📢 Announcement Setup Dashboard\n` +
        `Authorize channels where administrators are allowed to post announcements using \`/annc send\`.\n\n` +
        `› **Authorized Channels:** ${channels.length > 0 ? channels.map(id => `<#${id}>`).join(', ') : '_None configured_'}`;

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(body)
    ).addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    const selectMenu = new ChannelSelectMenuBuilder()
        .setCustomId('annc:setup_channel_select')
        .setPlaceholder('Choose authorized channels...')
        .setMinValues(0)
        .setMaxValues(10)
        .addChannelTypes(ChannelType.GuildText);

    container.addActionRowComponents(
        new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(selectMenu)
    );
    
    return container;
}

/** Render the Announcement Manager Dashboard */
function renderDashboard(draft: AnncDraft): ContainerBuilder {
    const container = new ContainerBuilder();
    
    const body = `### 📢 Announcement Configuration Dashboard\n` +
        `Configure your announcement details below. Once ready, click **Preview** to review or **Send** to dispatch it.\n\n` +
        `› **Target Channel:** <#${draft.channelId}>\n` +
        `› **Title:** ${draft.title ? `**${draft.title}**` : '_Not set_'}\n` +
        `› **Content:** ${draft.content ? `\`${draft.content.slice(0, 100)}${draft.content.length > 100 ? '...' : ''}\`` : '_Not set (Required)_'}\n` +
        `› **Hex Color:** \`${draft.color || '#2b2d31'}\`\n` +
        `› **Thumbnail:** ${draft.thumbnailUrl ? `[View thumbnail](${draft.thumbnailUrl})` : '_Not set_'}\n` +
        `› **Image:** ${draft.imageUrl ? `[View image](${draft.imageUrl})` : '_Not set_'}\n` +
        `› **Footer Text:** ${draft.footerText ? `\`${draft.footerText}\`` : '_Not set_'}`;

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(body)
    );

    const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('annc:edit_text').setLabel('Edit Text').setStyle(ButtonStyle.Secondary).setEmoji('📝'),
        new ButtonBuilder().setCustomId('annc:edit_design').setLabel('Edit Design').setStyle(ButtonStyle.Secondary).setEmoji('🎨'),
        new ButtonBuilder().setCustomId('annc:preview').setLabel('Preview').setStyle(ButtonStyle.Secondary).setEmoji('👁️'),
        new ButtonBuilder().setCustomId('annc:send_dispatch').setLabel('Send').setStyle(ButtonStyle.Success).setEmoji('🚀'),
        new ButtonBuilder().setCustomId('annc:cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger).setEmoji('❌')
    );

    container.addActionRowComponents(btnRow);
    return container;
}

/** Construct the V2 Layout Container from the draft configuration */
function buildAnnouncementContainer(draft: AnncDraft): ContainerBuilder {
    const container = new ContainerBuilder();
    
    let description = '';
    if (draft.title) {
        description += `# ${draft.title}\n\n`;
    }
    description += draft.content || '';

    if (draft.thumbnailUrl) {
        const section = new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(description))
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(draft.thumbnailUrl));
        container.addSectionComponents(section);
    } else {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(description)
        );
    }

    if (draft.imageUrl) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(draft.imageUrl)
            )
        );
    }

    if (draft.footerText) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# ${draft.footerText}`)
        );
    }

    return container;
}

export const anncCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('annc')
        .setDescription('Interactive announcement wizard (Admin only)')
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub
                .setName('setup')
                .setDescription('Configure target channels for announcements')
        )
        .addSubcommand(sub =>
            sub
                .setName('send')
                .setDescription('Launch the interactive announcement composer')
        ),

    adminOnly: true,
    cooldown: 5,

    async execute(interaction: ChatInputCommandInteraction) {
        const isAdmin = await requireAdmin(interaction);
        if (!isAdmin) return;

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'setup') {
            await interaction.deferReply({ flags: EPH | V2 });
            const guildId = interaction.guildId!;
            const embed = await supabase.getCustomEmbed(guildId, '_annc_settings');
            let channels: string[] = [];
            if (embed?.description) {
                try {
                    const parsed = JSON.parse(embed.description);
                    if (Array.isArray(parsed)) channels = parsed;
                } catch {
                    channels = [];
                }
            }

            const dashboard = renderSetupDashboard(channels);
            await interaction.editReply({ components: [dashboard], flags: V2 });
            return;
        }

        if (subcommand === 'send') {
            await interaction.deferReply({ flags: EPH | V2 });
            const guildId = interaction.guildId!;
            const embed = await supabase.getCustomEmbed(guildId, '_annc_settings');
            let channels: string[] = [];
            if (embed?.description) {
                try {
                    const parsed = JSON.parse(embed.description);
                    if (Array.isArray(parsed)) channels = parsed;
                } catch {
                    channels = [];
                }
            }

            if (channels.length === 0) {
                const warnContainer = ComponentsV2.warningContainer(
                    'No Channels Set',
                    'You have not configured any announcement channels yet.\n\nUse \`/annc setup\` to add some first!'
                );
                await interaction.editReply({ components: [warnContainer], flags: V2 });
                return;
            }

            // Retrieve channels and construct select options
            const selectOptions: { label: string; value: string }[] = [];
            for (const id of channels) {
                const chan = interaction.guild?.channels.cache.get(id);
                if (chan) {
                    selectOptions.push({
                        label: `#${chan.name}`,
                        value: id
                    });
                }
            }

            if (selectOptions.length === 0) {
                const warnContainer = ComponentsV2.warningContainer(
                    'Invalid Channels',
                    'None of your configured announcement channels could be found in this server.'
                );
                await interaction.editReply({ components: [warnContainer], flags: V2 });
                return;
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('annc:select_channel')
                .setPlaceholder('Choose target channel...')
                .addOptions(selectOptions.map(opt => ({
                    label: opt.label,
                    value: opt.value
                })));

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `### 📢 Announcement Sender\n` +
                        `Select the target channel where you wish to post this announcement.`
                    )
                )
                .addActionRowComponents(
                    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)
                );

            await interaction.editReply({ components: [container], flags: V2 });
        }
    },

    async handleSelectMenu(interaction: StringSelectMenuInteraction) {
        if (interaction.customId === 'annc:setup_channel_select') {
            const guildId = interaction.guildId!;
            const selectedChannels = interaction.values;
            
            await supabase.saveCustomEmbed(guildId, '_annc_settings', {
                description: JSON.stringify(selectedChannels)
            });
            
            const dashboard = renderSetupDashboard(selectedChannels);
            await interaction.update({ components: [dashboard] });
            return;
        }

        if (interaction.customId !== 'annc:select_channel') return;

        const channelId = interaction.values[0];
        pendingDrafts.set(interaction.user.id, {
            channelId,
            color: '#2b2d31'
        });

        const draft = pendingDrafts.get(interaction.user.id)!;
        const dashboard = renderDashboard(draft);

        await (interaction as any).update({ components: [dashboard] });
    },

    async handleButton(interaction: ButtonInteraction) {
        if (!interaction.customId.startsWith('annc:')) return;

        const draft = pendingDrafts.get(interaction.user.id);
        if (!draft) {
            await interaction.reply({
                content: '❌ No active announcement session. Use `/annc send` to start again.',
                ephemeral: true
            });
            return;
        }

        const action = interaction.customId.split(':')[1];

        if (action === 'cancel') {
            pendingDrafts.delete(interaction.user.id);
            const container = ComponentsV2.warningContainer('Cancelled', 'Announcement composer closed.');
            await (interaction as any).update({ components: [container] });
            return;
        }

        if (action === 'edit_text') {
            const modal = new ModalBuilder()
                .setCustomId('annc:modal_text')
                .setTitle('Announcement Text Details');

            const titleInput = new TextInputBuilder()
                .setCustomId('title')
                .setLabel('Title (Optional)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Enter announcement title...')
                .setValue(draft.title || '')
                .setRequired(false)
                .setMaxLength(256);

            const contentInput = new TextInputBuilder()
                .setCustomId('content')
                .setLabel('Content / Description (Required)')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Enter announcement content...')
                .setValue(draft.content || '')
                .setRequired(true)
                .setMaxLength(4000);

            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput)
            );

            await interaction.showModal(modal);
            return;
        }

        if (action === 'edit_design') {
            const modal = new ModalBuilder()
                .setCustomId('annc:modal_design')
                .setTitle('Announcement Design & Media');

            const colorInput = new TextInputBuilder()
                .setCustomId('color')
                .setLabel('Hex Color (Optional)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('#2b2d31')
                .setValue(draft.color || '#2b2d31')
                .setRequired(false)
                .setMaxLength(7);

            const thumbInput = new TextInputBuilder()
                .setCustomId('thumbnail')
                .setLabel('Thumbnail URL (Optional)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('https://example.com/logo.png')
                .setValue(draft.thumbnailUrl || '')
                .setRequired(false);

            const imageInput = new TextInputBuilder()
                .setCustomId('image')
                .setLabel('Image URL (Optional)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('https://example.com/banner.png')
                .setValue(draft.imageUrl || '')
                .setRequired(false);

            const footerInput = new TextInputBuilder()
                .setCustomId('footer')
                .setLabel('Footer Text (Optional)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Victus Cloud • Announcements')
                .setValue(draft.footerText || '')
                .setRequired(false)
                .setMaxLength(2048);

            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(colorInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(thumbInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(imageInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(footerInput)
            );

            await interaction.showModal(modal);
            return;
        }

        if (action === 'preview') {
            if (!draft.content) {
                await interaction.reply({
                    content: '❌ Content is required to preview the announcement.',
                    ephemeral: true
                });
                return;
            }

            const preview = buildAnnouncementContainer(draft);
            await interaction.reply({
                components: [preview],
                flags: EPH | V2
            });
            return;
        }

        if (action === 'send_dispatch') {
            if (!draft.content) {
                await interaction.reply({
                    content: '❌ Content is required before sending the announcement.',
                    ephemeral: true
                });
                return;
            }

            const channel = interaction.guild?.channels.cache.get(draft.channelId) as TextChannel | undefined;
            if (!channel) {
                await interaction.reply({
                    content: '❌ Target channel not found. Make sure I have access to it.',
                    ephemeral: true
                });
                return;
            }

            try {
                const anncEmbed = buildAnnouncementContainer(draft);
                await channel.send({
                    components: [anncEmbed],
                    flags: V2
                });

                pendingDrafts.delete(interaction.user.id);
                const success = ComponentsV2.successContainer(
                    'Announcement Dispatched',
                    `Successfully posted the announcement to <#${channel.id}>.`
                );

                await (interaction as any).update({ components: [success] });
            } catch (err) {
                logger.error('Failed to dispatch announcement:', err);
                await interaction.reply({
                    content: '❌ Failed to send announcement. Verify my permissions in the target channel.',
                    ephemeral: true
                });
            }
        }
    },

    async handleModal(interaction: ModalSubmitInteraction) {
        if (!interaction.customId.startsWith('annc:modal_')) return;

        const draft = pendingDrafts.get(interaction.user.id);
        if (!draft) {
            await interaction.reply({
                content: '❌ Active session not found. Please try `/annc send` again.',
                ephemeral: true
            });
            return;
        }

        const type = interaction.customId.split('_')[1];

        if (type === 'text') {
            draft.title = interaction.fields.getTextInputValue('title').trim() || undefined;
            draft.content = interaction.fields.getTextInputValue('content').trim() || undefined;
        } else if (type === 'design') {
            draft.color = interaction.fields.getTextInputValue('color').trim() || undefined;
            draft.thumbnailUrl = interaction.fields.getTextInputValue('thumbnail').trim() || undefined;
            draft.imageUrl = interaction.fields.getTextInputValue('image').trim() || undefined;
            draft.footerText = interaction.fields.getTextInputValue('footer').trim() || undefined;
        }

        pendingDrafts.set(interaction.user.id, draft);
        const dashboard = renderDashboard(draft);

        await (interaction as any).update({ components: [dashboard] });
    }
};
