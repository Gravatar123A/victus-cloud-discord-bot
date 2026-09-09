import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { scrapeResourceUrl } from '../services/resourceScraper.js';
import { publishedResourcesStore } from '../services/publishedResourcesStore.js';
import { resourceSettings } from '../services/resourceSettings.js';
import { antigravityPipeline } from '../services/antigravityPipeline.js';
import { supabase } from '../services/supabase.js';
import { logger } from '../utils/logger.js';
import { VICTUS_COLORS } from '../types/index.js';
import { config } from '../config.js';
const PRIMARY_STAFF_ROLE_ID = '1340607428252794973';
const CATEGORIES = ['Maps', 'Builds', 'Lobbies', 'Plugins', 'Mods', 'Bots', 'Codes', 'Other'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Robust staff permission verification:
 * Checks Administrator, ManageGuild, ManageChannels, Primary Staff Role,
 * Antigravity staff roles, and server-configured staff/admin roles.
 */
async function checkIsStaff(interaction) {
    if (!interaction.guildId)
        return false;
    const member = interaction.member ||
        (await interaction.guild?.members.fetch(interaction.user.id).catch(() => null));
    if (!member)
        return false;
    // 1. Antigravity pipeline authorization (server owner, admin, manage guild, staffRoleIds)
    if (antigravityPipeline.isAuthorized(member)) {
        return true;
    }
    // 2. High-level discord permissions
    if (member.permissions.has(PermissionFlagsBits.Administrator) ||
        member.permissions.has(PermissionFlagsBits.ManageGuild) ||
        member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return true;
    }
    // 3. Known staff role IDs
    const settings = await supabase.getBotSettings(interaction.guildId).catch(() => null);
    const staffRoleIds = new Set([
        PRIMARY_STAFF_ROLE_ID,
        ...(config.antigravity.staffRoleIds || []),
        ...(settings?.ticket_staff_role_ids || []),
        ...(settings?.ticket_admin_role_ids || []),
    ]);
    const rolesObj = member.roles;
    if (rolesObj) {
        if (Array.isArray(rolesObj)) {
            if (rolesObj.some((id) => staffRoleIds.has(id)))
                return true;
        }
        else if (rolesObj.cache && typeof rolesObj.cache.has === 'function') {
            for (const id of staffRoleIds) {
                if (rolesObj.cache.has(id))
                    return true;
            }
        }
    }
    return false;
}
/**
 * Parses raw text or JSON file content into normalized RawResourceItem objects.
 */
function parseResourceInput(rawContent) {
    const trimmed = rawContent.trim();
    if (!trimmed) {
        return { items: [], error: 'Input is empty.' };
    }
    // Attempt 1: Parse as JSON
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
            const parsed = JSON.parse(trimmed);
            const array = Array.isArray(parsed) ? parsed : [parsed];
            const items = [];
            for (const entry of array) {
                if (typeof entry !== 'object' || entry === null)
                    continue;
                const sourceUrl = typeof entry.sourceUrl === 'string' ? entry.sourceUrl.trim() : (typeof entry.url === 'string' ? entry.url.trim() : undefined);
                const title = typeof entry.title === 'string' ? entry.title.trim() : undefined;
                const description = typeof entry.description === 'string' ? entry.description.trim() : undefined;
                const category = typeof entry.category === 'string' ? entry.category.trim() : undefined;
                const author = typeof entry.author === 'string' ? entry.author.trim() : (typeof entry.creator === 'string' ? entry.creator.trim() : undefined);
                const tags = Array.isArray(entry.tags) ? entry.tags.map(String).map((t) => t.trim()).filter(Boolean) : [];
                const images = Array.isArray(entry.images) ? entry.images.map(String).map((i) => i.trim()).filter(Boolean) : (typeof entry.image === 'string' ? [entry.image.trim()] : []);
                if (!title && !sourceUrl) {
                    continue; // Skip invalid entries missing both title and sourceUrl
                }
                items.push({
                    title,
                    description,
                    category,
                    tags,
                    author,
                    sourceUrl,
                    images,
                    isUrlOnly: !title && !!sourceUrl,
                });
            }
            if (items.length === 0) {
                return { items: [], error: 'No valid resource objects found in JSON array. Each object should have a title or sourceUrl.' };
            }
            return { items };
        }
        catch (jsonErr) {
            // If it looked like JSON but failed parsing, return error
            return { items: [], error: `JSON Parse error: ${jsonErr?.message || 'Invalid JSON format.'}` };
        }
    }
    // Attempt 2: Parse as plain-text lines (URLs or Title | URL | Category)
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));
    const items = [];
    for (const line of lines) {
        if (line.startsWith('http://') || line.startsWith('https://')) {
            items.push({
                sourceUrl: line,
                isUrlOnly: true,
            });
        }
        else if (line.includes('|')) {
            const parts = line.split('|').map((p) => p.trim());
            const title = parts[0];
            const url = parts.find((p) => p.startsWith('http://') || p.startsWith('https://'));
            const categoryCandidate = parts.find((p) => CATEGORIES.some((c) => c.toLowerCase() === p.toLowerCase()));
            items.push({
                title: title || undefined,
                sourceUrl: url || undefined,
                category: categoryCandidate || undefined,
                isUrlOnly: !title && !!url,
            });
        }
    }
    if (items.length === 0) {
        return { items: [], error: 'Could not extract any valid URLs or resource entries from input text.' };
    }
    return { items };
}
export const massShareResourceCommand = {
    data: new SlashCommandBuilder()
        .setName('mass-share-resource')
        .setDescription('Mass upload and share resources to the community forum channel (Staff only)')
        .setDMPermission(false)
        .addAttachmentOption((opt) => opt
        .setName('file')
        .setDescription('Upload a .json or .txt file containing resource definitions or URLs')
        .setRequired(false))
        .addStringOption((opt) => opt
        .setName('json')
        .setDescription('Paste raw JSON array of resources to upload')
        .setRequired(false))
        .addStringOption((opt) => opt
        .setName('default_category')
        .setDescription('Fallback category if not specified per resource (Default: Other)')
        .setRequired(false)
        .addChoices({ name: 'Maps', value: 'Maps' }, { name: 'Builds', value: 'Builds' }, { name: 'Lobbies', value: 'Lobbies' }, { name: 'Plugins', value: 'Plugins' }, { name: 'Mods', value: 'Mods' }, { name: 'Bots', value: 'Bots' }, { name: 'Codes', value: 'Codes' }, { name: 'Other', value: 'Other' }))
        .addStringOption((opt) => opt
        .setName('default_author')
        .setDescription('Fallback creator/author if not specified (Default: Community)')
        .setRequired(false)),
    cooldown: 5,
    async execute(interaction) {
        if (!interaction.guildId)
            return;
        // 1. Staff permission verification
        const isStaff = await checkIsStaff(interaction);
        if (!isStaff) {
            await interaction.reply({
                components: [
                    ComponentsV2.errorContainer('Access Denied', 'You do not have permission to use `/mass-share-resource`.\n\n' +
                        'This command is restricted to **Authorized Staff Members & Administrators**.'),
                ],
                flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }
        const fileAttachment = interaction.options.getAttachment('file');
        const jsonString = interaction.options.getString('json');
        const defaultCategory = interaction.options.getString('default_category') || 'Other';
        const defaultAuthor = interaction.options.getString('default_author') || 'Community';
        // 2. Validate at least one input source was provided
        if (!fileAttachment && !jsonString) {
            const guideContainer = ComponentsV2.infoContainer('Mass Resource Ingestion Guide', 'Upload multiple resources directly to the forum channel at once!\n\n' +
                '### 📥 Usage Options\n' +
                '› **Option 1: JSON File or String**\n' +
                'Provide an array of resource objects via the `file` or `json` option:\n' +
                '```json\n' +
                '[\n' +
                '  {\n' +
                '    "title": "Sodium Performance Mod",\n' +
                '    "description": "Modern rendering engine replacement.",\n' +
                '    "category": "Mods",\n' +
                '    "tags": ["performance", "fabric"],\n' +
                '    "author": "JellySquid",\n' +
                '    "sourceUrl": "https://modrinth.com/mod/sodium",\n' +
                '    "images": ["https://cdn.example.com/sodium.png"]\n' +
                '  }\n' +
                ']\n' +
                '```\n\n' +
                '› **Option 2: Plain Text File of URLs**\n' +
                'Upload a `.txt` file with one resource link per line (Modrinth, CurseForge, SpigotMC, PlanetMinecraft, GitHub). Metadata will be extracted automatically!\n\n' +
                '### 🏷️ Forum Tag Rule\n' +
                '› **Strict Validation:** Only tags already existing in the forum channel will be applied. Unrecognized tags are automatically filtered out to keep forum taxonomy clean.');
            await interaction.reply({
                components: [guideContainer],
                flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }
        // Defer ephemeral reply
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        // 3. Check guild forum channel configuration
        const guildConfig = await resourceSettings.get(interaction.guildId);
        if (!guildConfig.forumChannelId) {
            await interaction.editReply({
                components: [
                    ComponentsV2.warningContainer('Forum Channel Not Set', 'An admin has not configured the resource forum channel yet.\n\nAsk an admin to run `/admin set-resource-forum #channel`.'),
                ],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }
        // Fetch forum channel
        let channel = interaction.guild?.channels.cache.get(guildConfig.forumChannelId);
        if (!channel) {
            const fetched = await interaction.guild?.channels.fetch(guildConfig.forumChannelId).catch(() => null);
            if (fetched)
                channel = fetched;
        }
        if (!channel || channel.type !== ChannelType.GuildForum) {
            await interaction.editReply({
                components: [
                    ComponentsV2.errorContainer('Invalid Forum Channel', 'The configured resource forum channel is missing or no longer a Forum channel. Please ask an admin to re-configure `/admin set-resource-forum`.'),
                ],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }
        const forumChannel = channel;
        const availableTags = forumChannel.availableTags || [];
        // Build quick lookup map for existing forum tags: lowercase name -> id
        const forumTagMap = new Map();
        for (const tag of availableTags) {
            forumTagMap.set(tag.name.trim().toLowerCase(), { id: tag.id, name: tag.name });
        }
        // 4. Retrieve input content
        let rawContent = '';
        if (fileAttachment) {
            try {
                const response = await fetch(fileAttachment.url);
                if (!response.ok) {
                    throw new Error(`Failed to download attachment (status: ${response.status})`);
                }
                rawContent = await response.text();
            }
            catch (fetchErr) {
                await interaction.editReply({
                    components: [
                        ComponentsV2.errorContainer('File Download Error', `Could not download attached file: ${fetchErr?.message || 'Network error'}`),
                    ],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
                return;
            }
        }
        else if (jsonString) {
            rawContent = jsonString;
        }
        // 5. Parse resources
        const parseResult = parseResourceInput(rawContent);
        if (parseResult.error || parseResult.items.length === 0) {
            await interaction.editReply({
                components: [
                    ComponentsV2.errorContainer('Invalid Resource Input', parseResult.error || 'No valid resource definitions could be found.'),
                ],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }
        const rawItems = parseResult.items;
        const total = rawItems.length;
        // Initial progress container
        const initialBar = ComponentsV2.progressBar(0, 20);
        await interaction.editReply({
            components: [
                ComponentsV2.cleanContainer(ComponentsV2.Accents.primary, 'Starting Mass Resource Ingestion...', `### \`[${initialBar}]\` **0%** (0/${total})\n\n` +
                    `› **Target Forum:** <#${forumChannel.id}>\n` +
                    `› **Items to Ingest:** ${total}\n` +
                    `› **Existing Forum Tags:** ${availableTags.length > 0 ? availableTags.map((t) => `\`${t.name}\``).join(', ') : 'None'}\n\n` +
                    `-# Initializing forum ingestion pipeline...`, 'MASS INGESTION'),
            ],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        const results = [];
        for (let i = 0; i < total; i++) {
            const rawItem = rawItems[i];
            const currentItemNumber = i + 1;
            const percent = Math.round((currentItemNumber / total) * 100);
            let title = rawItem.title || '';
            let description = rawItem.description || '';
            let category = (rawItem.category && CATEGORIES.includes(rawItem.category))
                ? rawItem.category
                : defaultCategory;
            let author = rawItem.author || defaultAuthor;
            let sourceUrl = rawItem.sourceUrl || '';
            let images = rawItem.images || [];
            let itemTags = rawItem.tags || [];
            // If entry is URL-only, scrape it
            if (rawItem.isUrlOnly && sourceUrl) {
                try {
                    const scraped = await scrapeResourceUrl(sourceUrl);
                    title = scraped.title || sourceUrl;
                    description = scraped.description || 'No description provided.';
                    if (scraped.category_hint && CATEGORIES.includes(scraped.category_hint)) {
                        category = scraped.category_hint;
                    }
                    if (scraped.author)
                        author = scraped.author;
                    if (scraped.images && scraped.images.length > 0)
                        images = scraped.images;
                    if (scraped.tags_hint && scraped.tags_hint.length > 0) {
                        itemTags = [...new Set([...itemTags, ...scraped.tags_hint])];
                    }
                }
                catch (scrapeErr) {
                    logger.warn(`Failed to scrape ${sourceUrl}:`, scrapeErr);
                    results.push({
                        title: sourceUrl,
                        success: false,
                        appliedTags: [],
                        error: `Scraping failed: ${scrapeErr?.message || 'Could not fetch metadata'}`,
                    });
                    continue;
                }
            }
            if (!title) {
                results.push({
                    title: sourceUrl || `Item #${currentItemNumber}`,
                    success: false,
                    appliedTags: [],
                    error: 'Resource missing title.',
                });
                continue;
            }
            // Strict tag matching: strictly use ALREADY EXISTING tags in the forum channel
            const candidateTagKeywords = [
                category.toLowerCase(),
                ...(guildConfig.categoryTagMappings[category] || []).map((t) => t.toLowerCase()),
                ...itemTags.map((t) => t.toLowerCase()),
            ];
            const matchedTagIds = [];
            const matchedTagNames = [];
            for (const cand of candidateTagKeywords) {
                const found = forumTagMap.get(cand);
                if (found && !matchedTagIds.includes(found.id)) {
                    matchedTagIds.push(found.id);
                    matchedTagNames.push(found.name);
                }
            }
            // Discord permits a maximum of 5 applied tags per thread
            const appliedTagIds = matchedTagIds.slice(0, 5);
            // Construct rich embed
            const postEmbed = new EmbedBuilder()
                .setColor(VICTUS_COLORS.primary)
                .setTitle(title.slice(0, 256))
                .setDescription((description || '_No description provided._').slice(0, 4000))
                .addFields({ name: '📁 Category', value: category, inline: true }, { name: '👤 Creator', value: author, inline: true }, { name: '🔗 Source Page', value: sourceUrl ? `[View Original Link](${sourceUrl})` : 'N/A', inline: false });
            if (matchedTagNames.length > 0) {
                postEmbed.addFields({
                    name: '🏷️ Tags',
                    value: matchedTagNames.map((t) => `\`${t}\``).join(', '),
                    inline: true,
                });
            }
            if (images.length > 0 && images[0].startsWith('http')) {
                postEmbed.setImage(images[0]);
            }
            postEmbed.setFooter({
                text: `Submitted by Staff ${interaction.user.tag} (${interaction.user.id})`,
                iconURL: interaction.user.displayAvatarURL(),
            }).setTimestamp();
            const postContent = `🚀 **New Resource Shared by Staff <@${interaction.user.id}>!**\n` +
                (sourceUrl ? `🔗 **Link:** ${sourceUrl}` : '');
            const listingId = publishedResourcesStore.generateListingId();
            const likeButton = new ButtonBuilder()
                .setCustomId(`victus_res_btn_like:${listingId}`)
                .setLabel('Like (0)')
                .setEmoji('❤️')
                .setStyle(ButtonStyle.Secondary);
            const postComponents = [
                new ActionRowBuilder().addComponents(likeButton),
            ];
            if (sourceUrl) {
                postComponents[0].addComponents(new ButtonBuilder()
                    .setLabel('Visit Source')
                    .setStyle(ButtonStyle.Link)
                    .setURL(sourceUrl));
            }
            // Create forum thread
            const threadTitle = `[${category}] ${title}`.slice(0, 100);
            try {
                const thread = await forumChannel.threads.create({
                    name: threadTitle,
                    message: {
                        content: postContent,
                        embeds: [postEmbed],
                        components: postComponents,
                    },
                    appliedTags: appliedTagIds,
                });
                // Save listing in published store
                await publishedResourcesStore.addListing({
                    id: listingId,
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    title,
                    description,
                    category,
                    sourceUrl,
                    threadUrl: thread.url,
                    threadId: thread.id,
                    likes: [],
                });
                results.push({
                    title,
                    success: true,
                    threadUrl: thread.url,
                    appliedTags: matchedTagNames,
                });
            }
            catch (postErr) {
                logger.error(`Failed to post resource thread "${title}":`, postErr);
                results.push({
                    title,
                    success: false,
                    appliedTags: [],
                    error: postErr?.message || 'Forum thread creation failed.',
                });
            }
            // Update progress feedback in Discord
            const progressBar = ComponentsV2.progressBar(percent, 20);
            await interaction.editReply({
                components: [
                    ComponentsV2.cleanContainer(ComponentsV2.Accents.primary, 'Ingesting Resources...', `### \`[${progressBar}]\` **${percent}%** (${currentItemNumber}/${total})\n\n` +
                        `› **Recent Item:** \`${title.slice(0, 50)}\`\n` +
                        `› **Target Forum:** <#${forumChannel.id}>\n` +
                        `› **Tags Applied:** ${matchedTagNames.length > 0 ? matchedTagNames.map((t) => `\`${t}\``).join(', ') : 'None'}\n\n` +
                        `-# Creating forum listings with strict existing-tag validation...`, 'MASS INGESTION IN PROGRESS'),
                ],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            }).catch(() => { });
            // Rate limit breathing room between thread creations
            if (i < total - 1) {
                await sleep(1200);
            }
        }
        // 7. Render final summary
        const successful = results.filter((r) => r.success);
        const failed = results.filter((r) => !r.success);
        let summaryBody = `Mass ingestion process finished for **${results.length}** resource item(s).\n\n` +
            `› **Forum Channel:** <#${forumChannel.id}>\n` +
            `› **Successfully Published:** **${successful.length}**\n` +
            `› **Failed / Skipped:** **${failed.length}**\n\n`;
        if (successful.length > 0) {
            summaryBody += `### ✅ Successfully Published Listings\n`;
            const displaySuccess = successful.slice(0, 15);
            summaryBody += displaySuccess.map((s) => `• [${s.title.slice(0, 45)}](${s.threadUrl}) ${s.appliedTags.length > 0 ? `(${s.appliedTags.map((t) => `\`${t}\``).join(', ')})` : ''}`).join('\n') + '\n';
            if (successful.length > 15) {
                summaryBody += `_...and ${successful.length - 15} more listings._\n`;
            }
            summaryBody += '\n';
        }
        if (failed.length > 0) {
            summaryBody += `### ⚠️ Failed Items\n`;
            const displayFailed = failed.slice(0, 8);
            summaryBody += displayFailed.map((f) => `• **${f.title.slice(0, 40)}**: ${f.error}`).join('\n') + '\n';
            if (failed.length > 8) {
                summaryBody += `_...and ${failed.length - 8} more failed._\n`;
            }
        }
        const summaryContainer = ComponentsV2.cleanContainer(failed.length === 0 ? ComponentsV2.Accents.success : ComponentsV2.Accents.warning, 'Mass Ingestion Complete', summaryBody, 'INGESTION REPORT');
        const actionRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setLabel('View Forum Channel')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/channels/${interaction.guildId}/${forumChannel.id}`));
        await interaction.editReply({
            components: [summaryContainer, actionRow],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    },
};
