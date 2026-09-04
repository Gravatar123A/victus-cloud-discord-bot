import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    ForumChannel,
    MessageFlags,
    ModalBuilder,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { scrapeResourceUrl } from '../services/resourceScraper.js';
import { resourceSessionStore, ResourceSession } from '../services/resourceSessionStore.js';
import { resourceSettings } from '../services/resourceSettings.js';
import { logger } from '../utils/logger.js';
import { VICTUS_COLORS } from '../types/index.js';
import { config } from '../config.js';

const CATEGORIES = ['Maps', 'Builds', 'Lobbies', 'Plugins', 'Mods', 'Bots', 'Codes', 'Other'];

/**
 * Builds the interactive preview embed / V2 layout for a draft resource session.
 */
function buildResourcePreviewComponents(session: ResourceSession) {
    const embed = new EmbedBuilder()
        .setColor(VICTUS_COLORS.primary)
        .setTitle(`📌 Resource Preview: ${session.title || 'Untitled Resource'}`)
        .setDescription(session.description ? session.description.slice(0, 2000) : '_No description provided._')
        .addFields(
            { name: '📁 Category', value: session.category || 'Other', inline: true },
            { name: '🏷️ Tags', value: session.tags.length > 0 ? session.tags.join(', ') : 'None', inline: true },
            { name: '👤 Creator/Author', value: session.author || 'Unknown / Community', inline: true },
            { name: '🔗 Primary Source Link', value: session.sourceUrl ? `[View Source Page](${session.sourceUrl})` : 'None', inline: false }
        );

    if (session.links && session.links.length > 0) {
        embed.addFields({
            name: '🌐 Additional Links',
            value: session.links.map((l, i) => `[Link ${i + 1}](${l})`).join(' • '),
            inline: false,
        });
    }

    if (session.images && session.images.length > 0) {
        embed.setThumbnail(session.images[0]);
    }

    embed.setFooter({
        text: 'Victus Cloud Resource Sharing • Ephemeral Preview Session',
        iconURL: config.branding.logo,
    });

    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('victus_res_btn_edit')
            .setLabel('Edit Details')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('victus_res_btn_category')
            .setLabel('Change Category')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('victus_res_btn_tags_links')
            .setLabel('Edit Tags & Links')
            .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('victus_res_btn_submit')
            .setLabel('Submit & Post to Forum')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('victus_res_btn_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
    );

    return { embeds: [embed], components: [row1, row2] };
}

export const shareResourceCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('share-resource')
        .setDescription('Share a Minecraft map, plugin, mod, bot, build, or custom resource to the community forum')
        .setDMPermission(false),

    cooldown: 5,

    async execute(interaction) {
        if (!interaction.guildId) return;

        const container = ComponentsV2.infoContainer(
            'Share a Resource',
            'Welcome to the Victus Cloud Resource Hub! Choose how you would like to share your resource:\n\n' +
            '› **From Link**: Paste a URL from Modrinth, CurseForge, SpigotMC, Planet Minecraft, GitHub, or any website. We auto-extract titles, images, and descriptions.\n' +
            '› **Manual Entry**: Enter all title, description, category, tags, and link details yourself.'
        );

        const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('victus_res_btn_from_link')
                .setLabel('From Link')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('victus_res_btn_manual')
                .setLabel('Manual')
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
            components: [container, buttons],
            flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2,
        });
    },

    async handleButton(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('victus_res_btn_')) return;
        if (!interaction.guildId) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;

        // 1. From Link button -> Open URL Modal
        if (customId === 'victus_res_btn_from_link') {
            const modal = new ModalBuilder()
                .setCustomId('victus_res_modal_url')
                .setTitle('Share Resource - From Link');

            const urlInput = new TextInputBuilder()
                .setCustomId('url_input')
                .setLabel('Resource Page URL')
                .setPlaceholder('https://modrinth.com/mod/sodium or CurseForge, Spigot, GitHub...')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(urlInput));
            await interaction.showModal(modal);
            return;
        }

        // 2. Manual button -> Open Manual Details Modal
        if (customId === 'victus_res_btn_manual') {
            const modal = new ModalBuilder()
                .setCustomId('victus_res_modal_manual')
                .setTitle('Share Resource - Manual Entry');

            const titleInput = new TextInputBuilder()
                .setCustomId('title_input')
                .setLabel('Resource Title')
                .setPlaceholder('e.g. Medieval Spawn Map / Advanced Economy Plugin')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100);

            const descInput = new TextInputBuilder()
                .setCustomId('desc_input')
                .setLabel('Description')
                .setPlaceholder('Provide details, features, installation notes, or requirements...')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(3000);

            const linkInput = new TextInputBuilder()
                .setCustomId('link_input')
                .setLabel('Source / Download Link')
                .setPlaceholder('https://example.com/resource')
                .setStyle(TextInputStyle.Short)
                .setRequired(false);

            const authorInput = new TextInputBuilder()
                .setCustomId('author_input')
                .setLabel('Creator / Author')
                .setPlaceholder('Creator name')
                .setStyle(TextInputStyle.Short)
                .setRequired(false);

            const tagsInput = new TextInputBuilder()
                .setCustomId('tags_input')
                .setLabel('Tags (comma-separated)')
                .setPlaceholder('maps, 1.20, survival, plugin')
                .setStyle(TextInputStyle.Short)
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(descInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(linkInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(authorInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(tagsInput)
            );

            await interaction.showModal(modal);
            return;
        }

        // Check for existing session
        const session = resourceSessionStore.getSession(userId, guildId);
        if (!session) {
            await interaction.reply({
                components: [
                    ComponentsV2.warningContainer(
                        'Session Expired',
                        'Your resource sharing session has expired. Please run `/share-resource` again.'
                    ),
                ],
                flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }

        // 3. Edit Details Button
        if (customId === 'victus_res_btn_edit') {
            const modal = new ModalBuilder()
                .setCustomId('victus_res_modal_edit')
                .setTitle('Edit Resource Details');

            const titleInput = new TextInputBuilder()
                .setCustomId('title_input')
                .setLabel('Title')
                .setValue(session.title || '')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100);

            const descInput = new TextInputBuilder()
                .setCustomId('desc_input')
                .setLabel('Description')
                .setValue(session.description ? session.description.slice(0, 3000) : '')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(3000);

            const authorInput = new TextInputBuilder()
                .setCustomId('author_input')
                .setLabel('Creator / Author')
                .setValue(session.author || '')
                .setStyle(TextInputStyle.Short)
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(descInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(authorInput)
            );

            await interaction.showModal(modal);
            return;
        }

        // 4. Change Category Button
        if (customId === 'victus_res_btn_category') {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('victus_res_select_category')
                .setPlaceholder(`Current Category: ${session.category}`)
                .addOptions(
                    CATEGORIES.map((cat) => ({
                        label: cat,
                        value: cat,
                        description: `Categorize as ${cat}`,
                        default: cat === session.category,
                    }))
                );

            const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
            await interaction.reply({
                content: 'Select the primary category for this resource:',
                components: [row],
                ephemeral: true,
            });
            return;
        }

        // 5. Edit Tags & Links Button
        if (customId === 'victus_res_btn_tags_links') {
            const modal = new ModalBuilder()
                .setCustomId('victus_res_modal_tags_links')
                .setTitle('Edit Tags & Image Links');

            const sourceUrlInput = new TextInputBuilder()
                .setCustomId('source_url_input')
                .setLabel('Primary Source URL')
                .setValue(session.sourceUrl || '')
                .setStyle(TextInputStyle.Short)
                .setRequired(false);

            const tagsInput = new TextInputBuilder()
                .setCustomId('tags_input')
                .setLabel('Tags (comma-separated)')
                .setValue(session.tags.join(', '))
                .setStyle(TextInputStyle.Short)
                .setRequired(false);

            const imageInput = new TextInputBuilder()
                .setCustomId('image_input')
                .setLabel('Thumbnail / Image URL')
                .setValue(session.images[0] || '')
                .setStyle(TextInputStyle.Short)
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(sourceUrlInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(tagsInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(imageInput)
            );

            await interaction.showModal(modal);
            return;
        }

        // 6. Cancel Button
        if (customId === 'victus_res_btn_cancel') {
            resourceSessionStore.deleteSession(userId, guildId);
            await interaction.update({
                components: [
                    ComponentsV2.infoContainer(
                        'Resource Sharing Cancelled',
                        'The draft resource sharing session has been cancelled.'
                    ),
                ],
                flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }

        // 7. Submit Resource Button -> Create Forum Post
        if (customId === 'victus_res_btn_submit') {
            await interaction.deferUpdate();

            const guildConfig = await resourceSettings.get(guildId);
            if (!guildConfig.forumChannelId) {
                await interaction.followUp({
                    components: [
                        ComponentsV2.warningContainer(
                            'Forum Channel Not Set',
                            'An admin has not configured the resource forum channel yet.\n\nAsk an admin to run `/admin set-resource-forum #channel`.'
                        ),
                    ],
                    flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2,
                });
                return;
            }

            // Fetch forum channel
            let channel = interaction.guild?.channels.cache.get(guildConfig.forumChannelId);
            if (!channel) {
                const fetched = await interaction.guild?.channels.fetch(guildConfig.forumChannelId).catch(() => null);
                if (fetched) channel = fetched;
            }

            if (!channel || channel.type !== ChannelType.GuildForum) {
                await interaction.followUp({
                    components: [
                        ComponentsV2.errorContainer(
                            'Invalid Forum Channel',
                            'The configured resource forum channel is missing or no longer a Forum channel. Please ask an admin to re-configure `/admin set-resource-forum`.'
                        ),
                    ],
                    flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2,
                });
                return;
            }

            const forumChannel = channel as ForumChannel;

            // Match tags with forumChannel.availableTags
            const availableTags = forumChannel.availableTags || [];
            const matchedTagIds: string[] = [];

            // Match mapped tags for the category
            const mappedTagKeywords = [
                session.category.toLowerCase(),
                ...(guildConfig.categoryTagMappings[session.category] || []),
                ...session.tags.map((t) => t.toLowerCase()),
            ];

            for (const forumTag of availableTags) {
                const tagLower = forumTag.name.toLowerCase();
                if (mappedTagKeywords.some((kw) => kw === tagLower || kw.includes(tagLower) || tagLower.includes(kw))) {
                    if (!matchedTagIds.includes(forumTag.id)) {
                        matchedTagIds.push(forumTag.id);
                    }
                }
            }

            // Discord thread title max length is 100 characters
            const threadTitle = `[${session.category}] ${session.title}`.slice(0, 100);

            // Construct rich embed for the forum post
            const postEmbed = new EmbedBuilder()
                .setColor(VICTUS_COLORS.primary)
                .setTitle(session.title)
                .setDescription(session.description.slice(0, 4000))
                .addFields(
                    { name: '📁 Category', value: session.category, inline: true },
                    { name: '👤 Creator', value: session.author || 'Community', inline: true },
                    { name: '🔗 Source Page', value: session.sourceUrl ? `[View Original Link](${session.sourceUrl})` : 'N/A', inline: false }
                );

            if (session.tags.length > 0) {
                postEmbed.addFields({ name: '🏷️ Tags', value: session.tags.join(', '), inline: true });
            }

            if (session.images && session.images.length > 0) {
                postEmbed.setImage(session.images[0]);
            }

            postEmbed.setFooter({
                text: `Submitted by ${interaction.user.tag} (${interaction.user.id})`,
                iconURL: interaction.user.displayAvatarURL(),
            }).setTimestamp();

            const postContent = `🚀 **New Resource Shared by <@${interaction.user.id}>!**\n` +
                (session.sourceUrl ? `🔗 **Link:** ${session.sourceUrl}` : '');

            try {
                const thread = await forumChannel.threads.create({
                    name: threadTitle,
                    message: {
                        content: postContent,
                        embeds: [postEmbed],
                    },
                    appliedTags: matchedTagIds.slice(0, 5), // Discord max 5 applied tags
                });

                // Clear session
                resourceSessionStore.deleteSession(userId, guildId);

                await interaction.editReply({
                    embeds: [],
                    components: [
                        ComponentsV2.successContainer(
                            'Resource Published!',
                            `Your resource **${session.title}** has been successfully published to the forum!\n\n` +
                            `👉 [Click here to view your forum post](${thread.url})`
                        ),
                    ],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
            } catch (error: any) {
                logger.error('Failed to create forum thread post:', error);
                await interaction.editReply({
                    components: [
                        ComponentsV2.errorContainer(
                            'Posting Failed',
                            `Failed to create forum post: ${error?.message || 'Check bot permissions for the forum channel.'}`
                        ),
                    ],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
            }
        }
    },

    async handleSelectMenu(interaction) {
        if (interaction.customId !== 'victus_res_select_category') return;
        if (!interaction.guildId) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const selectedCategory = interaction.values[0];

        const session = resourceSessionStore.updateSession(userId, guildId, { category: selectedCategory });
        if (!session) {
            await interaction.reply({
                content: '⚠️ Session expired. Please run `/share-resource` again.',
                ephemeral: true,
            });
            return;
        }

        // Acknowledge select menu update
        await interaction.update({
            content: `✅ Category updated to **${selectedCategory}**. You can now click **Submit & Post to Forum**.`,
            components: [],
        });
    },

    async handleModal(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('victus_res_modal_')) return;
        if (!interaction.guildId) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;

        // 1. From Link Modal Submit
        if (customId === 'victus_res_modal_url') {
            await interaction.deferUpdate();

            const rawUrl = interaction.fields.getTextInputValue('url_input');

            try {
                const scraped = await scrapeResourceUrl(rawUrl);

                // Map category hint
                let category = 'Other';
                if (scraped.category_hint && CATEGORIES.includes(scraped.category_hint)) {
                    category = scraped.category_hint;
                }

                const session = resourceSessionStore.createSession(userId, guildId, 'link', {
                    title: scraped.title,
                    description: scraped.description,
                    category,
                    tags: scraped.tags_hint || [],
                    images: scraped.images,
                    author: scraped.author,
                    sourceUrl: scraped.source_url,
                });

                const preview = buildResourcePreviewComponents(session);
                await interaction.editReply(preview as any);
            } catch (error: any) {
                logger.error('Resource scraping failed:', error);
                await interaction.editReply({
                    components: [
                        ComponentsV2.errorContainer(
                            'Link Scraping Failed',
                            `Could not fetch metadata from URL: ${error?.message || 'Invalid or unreachable link.'}\n\nYou can still use **Manual Entry** to fill in the details.`
                        ),
                    ],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
            }
            return;
        }

        // 2. Manual Modal Submit
        if (customId === 'victus_res_modal_manual') {
            await interaction.deferUpdate();

            const title = interaction.fields.getTextInputValue('title_input');
            const description = interaction.fields.getTextInputValue('desc_input');
            const link = interaction.fields.getTextInputValue('link_input') || '';
            const author = interaction.fields.getTextInputValue('author_input') || '';
            const tagsRaw = interaction.fields.getTextInputValue('tags_input') || '';
            const tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);

            const session = resourceSessionStore.createSession(userId, guildId, 'manual', {
                title,
                description,
                category: 'Other',
                tags,
                author,
                sourceUrl: link,
            });

            const preview = buildResourcePreviewComponents(session);
            await interaction.editReply(preview as any);
            return;
        }

        // 3. Edit Details Modal Submit
        if (customId === 'victus_res_modal_edit') {
            await interaction.deferUpdate();

            const title = interaction.fields.getTextInputValue('title_input');
            const description = interaction.fields.getTextInputValue('desc_input');
            const author = interaction.fields.getTextInputValue('author_input') || '';

            const session = resourceSessionStore.updateSession(userId, guildId, {
                title,
                description,
                author,
            });

            if (session) {
                const preview = buildResourcePreviewComponents(session);
                await interaction.editReply(preview as any);
            }
            return;
        }

        // 4. Edit Tags & Links Modal Submit
        if (customId === 'victus_res_modal_tags_links') {
            await interaction.deferUpdate();

            const sourceUrl = interaction.fields.getTextInputValue('source_url_input') || '';
            const tagsRaw = interaction.fields.getTextInputValue('tags_input') || '';
            const imageUrl = interaction.fields.getTextInputValue('image_input') || '';
            const tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);

            const session = resourceSessionStore.updateSession(userId, guildId, {
                sourceUrl,
                tags,
                images: imageUrl ? [imageUrl] : [],
            });

            if (session) {
                const preview = buildResourcePreviewComponents(session);
                await interaction.editReply(preview as any);
            }
            return;
        }
    },
};
