import { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType, 
    MessageFlags, 
    ModalBuilder, 
    PermissionFlagsBits, 
    SlashCommandBuilder, 
    StringSelectMenuBuilder, 
    TextInputBuilder, 
    TextInputStyle 
} from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';
import { AttachmentBuilder } from 'discord.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

// Cache to store active wizard sessions
// Key: userId-guildId
const wizards = new Map<string, any>();
const editors = new Map<string, any>();

function getSessionKey(userId: string, guildId: string): string {
    return `${userId}-${guildId}`;
}

const PRESET_COLORS: Record<string, number> = {
    purple: 0x8b5cf6,
    blue: 0x3b82f6,
    green: 0x10b981,
    red: 0xef4444,
    orange: 0xf97316,
    white: 0xffffff,
    black: 0x000000,
};

function renderEditorDashboard(session: any): any {
    const accent = session.color ? (PRESET_COLORS[session.color.toLowerCase()] || parseInt(session.color.replace('#', ''), 16) || ComponentsV2.Accents.primary) : ComponentsV2.Accents.primary;
    const container = ComponentsV2.baseContainer(accent);
    
    const body = `# 📝 Embed Editor: **\`${session.originalName}\`**\n` +
        `Modify the configuration fields below. Once finished, click **Save & Publish** to save the changes.\n\n` +
        `› **Title:** ${session.title ? `"${session.title}"` : '_Not set_'}\n` +
        `› **Description:** ${session.description ? `_Provided (${session.description.length} chars)_` : '_Not set_'}\n` +
        `› **HEX Color:** \`${session.color}\`\n` +
        `› **Thumbnail:** ${session.thumbnailUrl ? `[Link](${session.thumbnailUrl})` : '_None_'}\n` +
        `› **Image Banner:** ${session.imageUrl ? `[Link](${session.imageUrl})` : '_None_'}\n` +
        `› **Footer:** ${session.footerText ? `"${session.footerText}"` : '_None_'}\n` +
        `› **Author:** ${session.authorName ? `"${session.authorName}"` : '_None_'}`;
        
    container.addTextDisplayComponents(ComponentsV2.text(body));
    
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('embed_edit:select_field')
        .setPlaceholder('Choose a section to modify...')
        .addOptions([
            { label: '📝 Edit Title & Description', value: 'field:basic', description: 'Modify the embed header text and description body' },
            { label: '👤 Edit Author Information', value: 'field:author', description: 'Modify the author name, icon URL, and hyperlink' },
            { label: '🖼️ Edit Thumbnail & Image Banner', value: 'field:media', description: 'Modify thumbnail and main image URLs' },
            { label: '🔤 Edit Footer Info', value: 'field:footer', description: 'Modify footer text and footer icon URL' },
            { label: '🎨 Edit Theme Color', value: 'field:color', description: 'Select a preset color or set a custom HEX value' }
        ]);
        
    const buttonsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('embed_edit:save').setLabel('Save & Publish').setStyle(ButtonStyle.Success).setEmoji('💾'),
        new ButtonBuilder().setCustomId('embed_edit:cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger).setEmoji('❌')
    );
    
    container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu));
    container.addActionRowComponents(buttonsRow);
    
    return container;
}

function renderEditorColorPage(session: any): any {
    const container = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
    
    const body = `# 🎨 Select Theme Color\n` +
        `Choose a preset color below or enter a custom HEX value.\n\n` +
        `› **Current Color:** \`${session.color}\``;
        
    container.addTextDisplayComponents(ComponentsV2.text(body));
    
    const colorSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('embed_edit:select_color_preset')
            .setPlaceholder('Choose a preset color')
            .addOptions([
                { label: 'Purple', value: 'purple' },
                { label: 'Blue', value: 'blue' },
                { label: 'Green', value: 'green' },
                { label: 'Red', value: 'red' },
                { label: 'Orange', value: 'orange' },
                { label: 'White', value: 'white' },
                { label: 'Black', value: 'black' }
            ])
    );
    
    const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('embed_edit:modal_hex_trigger').setLabel('Enter Custom HEX').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('embed_edit:back_to_dashboard').setLabel('⬅️ Back to Editor').setStyle(ButtonStyle.Primary)
    );
    
    container.addActionRowComponents(colorSelect).addActionRowComponents(btnRow);
    return container;
}

function renderWizardPage(session: any): any {
    const page = session.page;
    const accent = session.color ? (PRESET_COLORS[session.color.toLowerCase()] || parseInt(session.color.replace('#', ''), 16) || ComponentsV2.Accents.primary) : ComponentsV2.Accents.primary;
    const container = ComponentsV2.baseContainer(accent);

    let title = `Embed Builder • Page ${page}/7`;
    let desc = '';

    const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`embed_wiz:prev:${page}`).setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
        new ButtonBuilder().setCustomId(`embed_wiz:next:${page}`).setLabel('Next ➡️').setStyle(ButtonStyle.Primary).setDisabled(page === 7),
        new ButtonBuilder().setCustomId(`embed_wiz:cancel`).setLabel('Cancel ❌').setStyle(ButtonStyle.Danger)
    );

    const actionRows: any[] = [];

    switch (page) {
        case 1:
            desc = `### Page 1: Basic Information\n` +
                `Define the core identifier, title, and body description of your embed.\n\n` +
                `› **Embed Name:** \`${session.name || 'Not set (Required)'}\` (Unique key, e.g., "rules")\n` +
                `› **Title:** ${session.title ? `"${session.title}"` : '*None*'}\n` +
                `› **Description:** ${session.description ? `_Provided_` : '*None*'}\n\n` +
                `Press the button below to edit these parameters.`;
            
            actionRows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('embed_wiz:modal:basic').setLabel('Edit Basic Info').setStyle(ButtonStyle.Secondary)
            ));
            break;

        case 2:
            desc = `### Page 2: Media Assets & Footer\n` +
                `Configure thumbnail icons, main image banners, and footer text.\n\n` +
                `› **Thumbnail URL:** ${session.thumbnailUrl ? `\`${session.thumbnailUrl.slice(0, 40)}...\`` : '*None*'}\n` +
                `› **Image URL:** ${session.imageUrl ? `\`${session.imageUrl.slice(0, 40)}...\`` : '*None*'}\n` +
                `› **Footer:** ${session.footerText ? `"${session.footerText}"` : '*None*'}\n` +
                `› **Footer Icon:** ${session.footerIconUrl ? `\`${session.footerIconUrl.slice(0, 40)}...\`` : '*None*'}\n\n` +
                `Press the button below to edit these links.`;

            actionRows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('embed_wiz:modal:media').setLabel('Edit Media URLs').setStyle(ButtonStyle.Secondary)
            ));
            break;

        case 3:
            desc = `### Page 3: Accent Colors\n` +
                `Select from preset themes or enter a custom HEX accent.\n\n` +
                `› **Active Accent:** **\`${session.color || 'Purple (Default)'}\`**\n\n` +
                `Choose a preset color below or enter a custom HEX.`;

            const colorSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('embed_wiz:select:color')
                    .setPlaceholder('Choose a preset color')
                    .addOptions([
                        { label: 'Purple', value: 'purple' },
                        { label: 'Blue', value: 'blue' },
                        { label: 'Green', value: 'green' },
                        { label: 'Red', value: 'red' },
                        { label: 'Orange', value: 'orange' },
                        { label: 'White', value: 'white' },
                        { label: 'Black', value: 'black' }
                    ])
            );
            actionRows.push(colorSelect);
            actionRows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('embed_wiz:modal:color').setLabel('Enter HEX Color').setStyle(ButtonStyle.Secondary)
            ));
            break;

        case 4:
            desc = `### Page 4: Author Parameters\n` +
                `Set author branding info appearing at the top of the card.\n\n` +
                `› **Author Name:** ${session.authorName ? `"${session.authorName}"` : '*None*'}\n` +
                `› **Author Icon URL:** ${session.authorIconUrl ? `\`${session.authorIconUrl.slice(0, 40)}...\`` : '*None*'}\n` +
                `› **Author Link URL:** ${session.authorUrl ? `\`${session.authorUrl.slice(0, 40)}...\`` : '*None*'}\n\n` +
                `Press the button below to edit these parameters.`;

            actionRows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('embed_wiz:modal:author').setLabel('Edit Author Info').setStyle(ButtonStyle.Secondary)
            ));
            break;

        case 5:
            desc = `### Page 5: Custom Action Buttons\n` +
                `Add interactive buttons below your embed. Supports links or navigations.\n\n` +
                `› **Active Buttons:** **${session.buttons.length}** / 5\n` +
                (session.buttons.length > 0 ? session.buttons.map((b: any, i: number) => `  \`${i+1}.\` **${b.label}** (${b.style === 5 ? 'Link' : 'Action'})`).join('\n') : '  _No buttons defined._') +
                `\n\nChoose a button type below to add one.`;

            const buttonSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('embed_wiz:select:button_style')
                    .setPlaceholder('Choose a button style to add')
                    .addOptions([
                        { label: 'Primary (Blue)', value: '1' },
                        { label: 'Secondary (Gray)', value: '2' },
                        { label: 'Success (Green)', value: '3' },
                        { label: 'Danger (Red)', value: '4' },
                        { label: 'Link (URL Link)', value: '5' }
                    ])
            );
            actionRows.push(buttonSelect);
            actionRows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('embed_wiz:clear_buttons').setLabel('Clear Buttons').setStyle(ButtonStyle.Danger).setDisabled(session.buttons.length === 0)
            ));
            break;

        case 6:
            desc = `### Page 6: String Select Menu\n` +
                `Add a dropdown menu below the embed. Users can select options to route actions.\n\n` +
                `› **Select Menu:** ${session.selectMenu ? `**${session.selectMenu.options.length} options**` : '*None*'}\n` +
                (session.selectMenu ? `  Placeholder: "${session.selectMenu.placeholder}"\n` + session.selectMenu.options.map((o: any, i: number) => `  \`${i+1}.\` **${o.label}** (${o.value})`).join('\n') : '') +
                `\n\nPress the button below to define or clear the select menu.`;

            actionRows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('embed_wiz:modal:select_menu').setLabel('Set Select Menu').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('embed_wiz:clear_select').setLabel('Clear Menu').setStyle(ButtonStyle.Danger).setDisabled(!session.selectMenu)
            ));
            break;

        case 7:
            desc = `### Page 7: Review & Save\n` +
                `Inspect your visual draft. If satisfied, save it to the dashboard.\n\n` +
                `› **Embed Identifier Name:** \`${session.name || 'Missing name!'}\`\n\n` +
                `Press **Save Draft** to record in database. You can publish from there.`;

            actionRows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('embed_wiz:save').setLabel('Save Draft ✅').setStyle(ButtonStyle.Success).setDisabled(!session.name),
                new ButtonBuilder().setCustomId('embed_wiz:test_preview').setLabel('Test Preview 👁️').setStyle(ButtonStyle.Secondary)
            ));
            break;
    }

    container.addTextDisplayComponents(ComponentsV2.text(`# ${title}\n\n${desc}`))
        .addSeparatorComponents(ComponentsV2.separator());

    actionRows.forEach(row => container.addActionRowComponents(row));
    container.addActionRowComponents(navRow);

    return container;
}

export function buildFinalEmbedPayload(session: any): any {
    const color = session.color;
    const accent = color ? (PRESET_COLORS[color.toLowerCase()] || parseInt(color.replace('#', ''), 16) || ComponentsV2.Accents.primary) : ComponentsV2.Accents.primary;
    const c = ComponentsV2.baseContainer(accent);

    const imageUrl = session.imageUrl || session.image_url;
    if (imageUrl && typeof imageUrl === 'string' && (imageUrl.trim().startsWith('http') || imageUrl.trim().startsWith('attachment://'))) {
        c.addMediaGalleryComponents(ComponentsV2.mediaGallery(imageUrl.trim()));
    }
    // Thumbnails are not supported by ContainerBuilder directly. Image URL is displayed as a media gallery component if provided.

    let textBody = '';
    const authorName = session.authorName || session.author_name;
    const authorIconUrl = session.authorIconUrl || session.author_icon_url;
    const authorUrl = session.authorUrl || session.author_url;
    const title = session.title;
    const description = session.description;
    const footerText = session.footerText || session.footer_text;
    const selectMenu = session.selectMenu || session.select_menu;

    if (authorName) {
        textBody += `-# ${authorIconUrl ? '💠 ' : ''}${authorName}${authorUrl ? ` • [Link](${authorUrl})` : ''}\n`;
    }
    if (title) {
        textBody += `# ${title}\n\n`;
    }
    if (description) {
        textBody += `${description}\n`;
    }

    c.addTextDisplayComponents(ComponentsV2.text(textBody || ' '));

    if (footerText) {
        c.addTextDisplayComponents(ComponentsV2.text(`-# ${footerText}`));
    }

    // Add buttons
    if (session.buttons && session.buttons.length > 0) {
        const row = new ActionRowBuilder<ButtonBuilder>();
        session.buttons.forEach((b: any, index: number) => {
            const btn = new ButtonBuilder()
                .setLabel(b.label)
                .setStyle(b.style || ButtonStyle.Primary);

            if (b.style === 5 && b.url) {
                btn.setURL(b.url);
            } else {
                // If it's a normal custom action button, name it with our embed link router ID
                btn.setCustomId(b.url ? `embed_link:${b.url}` : `embed_action:${session.name}:${index}`);
            }

            if (b.disabled) btn.setDisabled(true);
            row.addComponents(btn);
        });
        c.addActionRowComponents(row);
    }

    // Add select menu
    if (selectMenu) {
        const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>();
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`embed_select:${session.name}`)
            .setPlaceholder(selectMenu.placeholder || 'Select an option...');

        selectMenu.options.forEach((o: any) => {
            menu.addOptions({
                label: o.label,
                description: o.description || undefined,
                value: o.value.startsWith('embed_link:') ? o.value : `embed_select_val:${session.name}:${o.value}`
            });
        });
        selectRow.addComponents(menu);
        c.addActionRowComponents(selectRow);
    }

    return c;
}

export const embedCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('embed')
        .setDescription('Create, inspect, delete, and settings for custom bot embeds')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('create').setDescription('Open the premium interactive wizard')
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('View and search custom embeds')
                .addStringOption(o => o.setName('search').setDescription('Search embeds by name').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('delete')
                .setDescription('Remove a custom embed')
                .addStringOption(o => o.setName('name').setDescription('Embed name').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('link')
                .setDescription('Link a button or dropdown option of an embed to load another child embed')
                .addStringOption(o => o.setName('parent').setDescription('Parent embed name').setRequired(true))
                .addStringOption(o => o.setName('child').setDescription('Child embed name').setRequired(true))
                .addStringOption(o => o.setName('trigger_label').setDescription('Button label or Dropdown option label').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('settings')
                .setDescription('Configure default settings for custom embeds')
        )
        .addSubcommand(sub =>
            sub.setName('edit')
                .setDescription('Edit an existing custom embed')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand(true);

        if (sub === 'create') {
            const key = getSessionKey(interaction.user.id, interaction.guildId!);
            wizards.set(key, {
                page: 1,
                name: '',
                title: '',
                description: '',
                thumbnailUrl: '',
                imageUrl: '',
                footerText: '',
                footerIconUrl: '',
                color: 'purple',
                authorName: '',
                authorIconUrl: '',
                authorUrl: '',
                buttons: [],
                selectMenu: null
            });

            const container = renderWizardPage(wizards.get(key));
            await interaction.reply({
                components: [container],
                flags: V2 | EPH
            });
        } 
        else if (sub === 'edit') {
            await interaction.deferReply({ flags: EPH });
            const list = await supabase.listCustomEmbeds(interaction.guildId!);
            
            if (list.length === 0) {
                await interaction.editReply({
                    components: [ComponentsV2.warningContainer('No Custom Embeds Found', 'Use `/embed create` to build a new template.')],
                    flags: V2
                });
                return;
            }
            
            const selectMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('embed_edit:select_embed')
                    .setPlaceholder('Choose an embed to edit...')
                    .addOptions(list.slice(0, 25).map(e => ({
                        label: e.name,
                        description: `Edit fields of "${e.name}"`,
                        value: e.name
                    })))
            );
            
            const container = ComponentsV2.baseContainer(ComponentsV2.Accents.primary)
                .addTextDisplayComponents(ComponentsV2.text('# 📝 Edit Custom Embed\nSelect the custom embed you would like to edit from the dropdown below.'))
                .addActionRowComponents(selectMenu);
                
            await interaction.editReply({
                components: [container],
                flags: V2
            });
        }
        else if (sub === 'list') {
            await interaction.deferReply({ flags: EPH });
            const search = interaction.options.getString('search') || '';
            const list = await supabase.listCustomEmbeds(interaction.guildId!);

            const filtered = list.filter(e => e.name.toLowerCase().includes(search.toLowerCase()));

            if (filtered.length === 0) {
                await interaction.editReply({
                    components: [ComponentsV2.warningContainer('No Custom Embeds Found', 'Use `/embed create` to build a new template.')],
                    flags: V2
                });
                return;
            }

            let textContent = `# 📂 Custom Embeds Fleet\nDisplaying all custom layouts configured for this guild.\n\n`;
            filtered.forEach((e, i) => {
                textContent += `### \`#${i+1}\` Embed Name: **\`${e.name}\`**\n` +
                    `› **Title:** ${e.title ? `"${e.title}"` : '_None_'}\n` +
                    `› **Buttons:** ${e.buttons?.length || 0} | **Dropdowns:** ${e.select_menu ? '1' : '0'}\n` +
                    `› **Created:** <t:${Math.floor(new Date(e.created_at).getTime() / 1000)}:R>\n\n`;
            });

            const listContainer = ComponentsV2.baseContainer(ComponentsV2.Accents.primary)
                .addTextDisplayComponents(ComponentsV2.text(textContent));

            // Select menu to execute actions
            const actionSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('embed_list:action')
                    .setPlaceholder('Select an embed to publish / delete...')
                    .addOptions(filtered.slice(0, 25).map(e => ({
                        label: e.name,
                        description: `Publish or delete this embed`,
                        value: `list_act:${e.name}`
                    })))
            );
            listContainer.addActionRowComponents(actionSelect);

            await interaction.editReply({
                components: [listContainer],
                flags: V2
            });
        }
        else if (sub === 'delete') {
            await interaction.deferReply({ flags: EPH });
            const name = interaction.options.getString('name', true).trim();
            const embed = await supabase.getCustomEmbed(interaction.guildId!, name);

            if (!embed) {
                await interaction.editReply({
                    components: [ComponentsV2.errorContainer('Not Found', `No custom embed with the name \`${name}\` exists in this server.`)],
                    flags: V2
                });
                return;
            }

            const confirmContainer = ComponentsV2.baseContainer(ComponentsV2.Accents.danger)
                .addTextDisplayComponents(ComponentsV2.text(`# ⚠️ Confirm Delete\nAre you sure you want to permanently delete custom embed **\`${name}\`**?`))
                .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId(`embed_act_del:confirm:${name}`).setLabel('Confirm Delete').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(`embed_act_del:cancel`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                ));

            await interaction.editReply({
                components: [confirmContainer],
                flags: V2
            });
        }
        else if (sub === 'link') {
            await interaction.deferReply({ flags: EPH });
            const parentName = interaction.options.getString('parent', true).trim();
            const childName = interaction.options.getString('child', true).trim();
            const label = interaction.options.getString('trigger_label', true).trim();

            const parent = await supabase.getCustomEmbed(interaction.guildId!, parentName);
            const child = await supabase.getCustomEmbed(interaction.guildId!, childName);

            if (!parent || !child) {
                await interaction.editReply({
                    components: [ComponentsV2.errorContainer('Configuration Error', 'Make sure both parent and child custom embeds exist.')],
                    flags: V2
                });
                return;
            }

            // Find either the button with label or select menu option with label on parent, and set its target url/value to embed_link:childName
            let updated = false;

            // Check buttons
            if (parent.buttons) {
                parent.buttons.forEach((b: any) => {
                    if (b.label.toLowerCase() === label.toLowerCase()) {
                        b.style = b.style === 5 ? 5 : b.style; // Keep link if already link, otherwise keep same style but set action value
                        b.url = `embed_link:${childName}`;
                        updated = true;
                    }
                });
            }

            // Check select menu options
            if (parent.select_menu && parent.select_menu.options) {
                parent.select_menu.options.forEach((o: any) => {
                    if (o.label.toLowerCase() === label.toLowerCase()) {
                        o.value = `embed_link:${childName}`;
                        updated = true;
                    }
                });
            }

            if (!updated) {
                await interaction.editReply({
                    components: [ComponentsV2.errorContainer('Trigger Not Found', `Could not find a button or select menu option named "${label}" on parent embed "${parentName}".`)],
                    flags: V2
                });
                return;
            }

            await supabase.saveCustomEmbed(interaction.guildId!, parentName, {
                buttons: parent.buttons,
                select_menu: parent.select_menu
            });

            await interaction.editReply({
                components: [ComponentsV2.successContainer('Linked Successfully', `Linked parent trigger **"${label}"** directly to child embed **\`${childName}\`**.`)],
                flags: V2
            });
        }
        else if (sub === 'settings') {
            await interaction.deferReply({ flags: EPH });
            let settings = await supabase.getEmbedSettings(interaction.guildId!);
            if (!settings) {
                settings = {
                    guild_id: interaction.guildId!,
                    default_color: 'purple',
                    default_footer: 'Victus Cloud',
                    default_author: null,
                    default_thumbnail: null,
                    allowed_roles: [],
                    allowed_channels: [],
                    logging_channel_id: null,
                    updated_at: new Date().toISOString()
                };
                await supabase.updateEmbedSettings(interaction.guildId!, settings);
            }

            const settingsModalBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('embed_settings:edit').setLabel('Edit Default Configs').setStyle(ButtonStyle.Primary)
            );

            const container = ComponentsV2.baseContainer(ComponentsV2.Accents.primary)
                .addTextDisplayComponents(ComponentsV2.text(
                    `# ⚙️ Embed Settings\nConfigure default values applied to new embeds.\n\n` +
                    `› **Default Accent Color:** \`${settings.default_color || 'purple'}\`\n` +
                    `› **Default Footer:** "${settings.default_footer || 'None'}"\n` +
                    `› **Default Author:** "${settings.default_author || 'None'}"\n` +
                    `› **Default Thumbnail:** \`${settings.default_thumbnail || 'None'}\``
                ))
                .addActionRowComponents(settingsModalBtn);

            await interaction.editReply({
                components: [container],
                flags: V2
            });
        }
    },

    async handleButton(interaction) {
        if (!interaction.customId.startsWith('embed_wiz:') && !interaction.customId.startsWith('embed_act_del:') && !interaction.customId.startsWith('embed_settings:') && !interaction.customId.startsWith('embed_edit:')) return;

        const key = getSessionKey(interaction.user.id, interaction.guildId!);

        if (interaction.customId.startsWith('embed_edit:')) {
            const session = editors.get(key);
            
            if (interaction.customId === 'embed_edit:cancel') {
                editors.delete(key);
                await interaction.update({
                    components: [ComponentsV2.warningContainer('Cancelled', 'Embed editor session closed without saving.')],
                    embeds: [],
                    files: []
                });
                return;
            }
            
            if (!session) {
                await interaction.reply({ content: '❌ Session expired.', flags: EPH });
                return;
            }
            
            const action = interaction.customId.split(':')[1];
            
            if (action === 'back_to_dashboard') {
                const container = renderEditorDashboard(session);
                await interaction.update({ components: [container], embeds: [] });
            }
            else if (action === 'modal_hex_trigger') {
                const modal = new ModalBuilder().setCustomId('embed_edit_modal:color').setTitle('Custom HEX Color');
                modal.addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(
                        new TextInputBuilder()
                            .setCustomId('color')
                            .setLabel('HEX Color Code')
                            .setPlaceholder('#8b5cf6')
                            .setValue(session.color)
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    )
                );
                await interaction.showModal(modal);
            }
            else if (action === 'save') {
                try {
                    await supabase.saveCustomEmbed(interaction.guildId!, session.name, {
                        title: session.title || null,
                        description: session.description || null,
                        thumbnail_url: session.thumbnailUrl || null,
                        image_url: session.imageUrl || null,
                        footer_text: session.footerText || null,
                        footer_icon_url: session.footerIconUrl || null,
                        color: session.color || null,
                        author_name: session.authorName || null,
                        author_icon_url: session.authorIconUrl || null,
                        author_url: session.authorUrl || null,
                        buttons: session.buttons,
                        select_menu: session.selectMenu
                    });
                    
                    editors.delete(key);
                    
                    const successContainer = ComponentsV2.successContainer('Embed Updated', `Successfully updated and saved changes to custom embed **\`${session.name}\`**.`);
                    await interaction.update({ components: [successContainer], embeds: [], files: [] });
                } catch (err) {
                    logger.error('Failed to update custom embed:', err);
                    await interaction.reply({ content: '❌ Failed to save embed changes to database.', flags: EPH });
                }
            }
            return;
        }

        const session = wizards.get(key);

        if (interaction.customId.startsWith('embed_wiz:')) {
            if (!session) {
                await interaction.reply({ content: '❌ Wizard session expired. Use `/embed create` to open a new session.', flags: EPH });
                return;
            }

            const action = interaction.customId.split(':')[1];

            if (action === 'cancel') {
                wizards.delete(key);
                await interaction.update({
                    components: [ComponentsV2.warningContainer('Cancelled', 'Embed builder wizard session cancelled.')],
                    embeds: [],
                    files: []
                });
                return;
            }

            if (action === 'prev') {
                session.page = Math.max(1, session.page - 1);
                const container = renderWizardPage(session);
                await interaction.update({ components: [container], embeds: [] });
            } 
            else if (action === 'next') {
                session.page = Math.min(7, session.page + 1);
                const container = renderWizardPage(session);
                await interaction.update({ components: [container], embeds: [] });
            }
            else if (action === 'modal') {
                const subModal = interaction.customId.split(':')[2];
                if (subModal === 'basic') {
                    const modal = new ModalBuilder().setCustomId('embed_wiz_modal:basic').setTitle('Page 1: Basic Information');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Embed Name (Unique Key)').setPlaceholder('rules').setValue(session.name).setStyle(TextInputStyle.Short).setRequired(true)),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Embed Title').setPlaceholder('Server Rules').setValue(session.title).setStyle(TextInputStyle.Short).setRequired(false)),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Embed Description').setPlaceholder('Enter description text...').setValue(session.description).setStyle(TextInputStyle.Paragraph).setRequired(false))
                    );
                    await interaction.showModal(modal);
                } 
                else if (subModal === 'media') {
                    const modal = new ModalBuilder().setCustomId('embed_wiz_modal:media').setTitle('Page 2: Media Assets');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('thumbnailUrl').setLabel('Thumbnail Image URL').setPlaceholder('https://example.com/logo.png').setValue(session.thumbnailUrl).setStyle(TextInputStyle.Short).setRequired(false)),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('imageUrl').setLabel('Main Image URL').setPlaceholder('https://example.com/banner.png').setValue(session.imageUrl).setStyle(TextInputStyle.Short).setRequired(false)),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('footerText').setLabel('Footer Text').setPlaceholder('Victus Cloud hosting').setValue(session.footerText).setStyle(TextInputStyle.Short).setRequired(false)),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('footerIconUrl').setLabel('Footer Icon URL').setPlaceholder('https://example.com/icon.png').setValue(session.footerIconUrl).setStyle(TextInputStyle.Short).setRequired(false))
                    );
                    await interaction.showModal(modal);
                }
                else if (subModal === 'color') {
                    const modal = new ModalBuilder().setCustomId('embed_wiz_modal:color').setTitle('Page 3: HEX Color');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('color').setLabel('Custom Color HEX').setPlaceholder('#6366f1').setValue(session.color).setStyle(TextInputStyle.Short).setRequired(true))
                    );
                    await interaction.showModal(modal);
                }
                else if (subModal === 'author') {
                    const modal = new ModalBuilder().setCustomId('embed_wiz_modal:author').setTitle('Page 4: Author Parameters');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('authorName').setLabel('Author Name').setPlaceholder('Victus Support Guild').setValue(session.authorName).setStyle(TextInputStyle.Short).setRequired(false)),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('authorIconUrl').setLabel('Author Icon URL').setPlaceholder('https://example.com/author.png').setValue(session.authorIconUrl).setStyle(TextInputStyle.Short).setRequired(false)),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('authorUrl').setLabel('Author Link URL').setPlaceholder('https://victuscloud.com').setValue(session.authorUrl).setStyle(TextInputStyle.Short).setRequired(false))
                    );
                    await interaction.showModal(modal);
                }
                else if (subModal === 'select_menu') {
                    const modal = new ModalBuilder().setCustomId('embed_wiz_modal:select_menu').setTitle('Page 6: Dropdown Options');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('placeholder').setLabel('Menu Placeholder').setPlaceholder('Select a category...').setValue(session.selectMenu?.placeholder || '').setStyle(TextInputStyle.Short).setRequired(true)),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('options').setLabel('Options (CSV: Label:Value,Label:Value)').setPlaceholder('Rules:rules,FAQ:faq,Support:support').setValue(session.selectMenu?.options ? session.selectMenu.options.map((o: any) => `${o.label}:${o.value.replace('embed_link:', '')}`).join(',') : '').setStyle(TextInputStyle.Paragraph).setRequired(true))
                    );
                    await interaction.showModal(modal);
                }
            }
            else if (action === 'clear_buttons') {
                session.buttons = [];
                const container = renderWizardPage(session);
                await interaction.update({ components: [container], embeds: [] });
            }
            else if (action === 'clear_select') {
                session.selectMenu = null;
                const container = renderWizardPage(session);
                await interaction.update({ components: [container], embeds: [] });
            }
            else if (action === 'test_preview') {
                const previewPayload = buildFinalEmbedPayload(session);
                await interaction.reply({
                    content: '👁️ **Live Template Preview:**',
                    components: [previewPayload],
                    flags: V2 | EPH
                });
            }
            else if (action === 'save') {
                try {
                    await supabase.saveCustomEmbed(interaction.guildId!, session.name, {
                        title: session.title || null,
                        description: session.description || null,
                        thumbnail_url: session.thumbnailUrl || null,
                        image_url: session.imageUrl || null,
                        footer_text: session.footerText || null,
                        footer_icon_url: session.footerIconUrl || null,
                        color: session.color || null,
                        author_name: session.authorName || null,
                        author_icon_url: session.authorIconUrl || null,
                        author_url: session.authorUrl || null,
                        buttons: session.buttons,
                        select_menu: session.selectMenu
                    });

                    wizards.delete(key);

                    await interaction.update({
                        components: [ComponentsV2.successContainer('Embed Saved Successfully', `Custom embed template **\`${session.name}\`** has been written to the database!`)],
                        embeds: [],
                        files: []
                    });
                } catch (error) {
                    logger.error('Failed to save custom embed draft:', error);
                    await interaction.reply({ content: '❌ System error saving embed draft.', flags: EPH });
                }
            }
        }
        else if (interaction.customId.startsWith('embed_act_del:')) {
            const action = interaction.customId.split(':')[1];
            if (action === 'cancel') {
                await interaction.update({
                    components: [ComponentsV2.warningContainer('Cancelled', 'Deletion cancelled.')],
                    embeds: []
                });
            } else {
                const name = interaction.customId.split(':')[2];
                await supabase.deleteCustomEmbed(interaction.guildId!, name);
                await interaction.update({
                    components: [ComponentsV2.successContainer('Deleted', `Custom embed template \`${name}\` has been permanently deleted.`)],
                    embeds: []
                });
            }
        }
        else if (interaction.customId === 'embed_settings:edit') {
            const settings = await supabase.getEmbedSettings(interaction.guildId!);
            const modal = new ModalBuilder().setCustomId('embed_settings_modal:edit').setTitle('Configure Default Embeds');
            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('color').setLabel('Default Color HEX').setPlaceholder('#6366f1').setValue(settings?.default_color || '').setStyle(TextInputStyle.Short).setRequired(false)),
                new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('footer').setLabel('Default Footer Text').setPlaceholder('Victus Cloud').setValue(settings?.default_footer || '').setStyle(TextInputStyle.Short).setRequired(false)),
                new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('author').setLabel('Default Author Name').setPlaceholder('Victus Cloud').setValue(settings?.default_author || '').setStyle(TextInputStyle.Short).setRequired(false)),
                new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('thumbnail').setLabel('Default Thumbnail URL').setPlaceholder('https://victuscloud.com/logo.png').setValue(settings?.default_thumbnail || '').setStyle(TextInputStyle.Short).setRequired(false))
            );
            await interaction.showModal(modal);
        }
    },

    async handleSelectMenu(interaction) {
        if (!interaction.customId.startsWith('embed_wiz:') && !interaction.customId.startsWith('embed_list:') && !interaction.customId.startsWith('embed_link:') && !interaction.customId.startsWith('embed_edit:')) return;

        const key = getSessionKey(interaction.user.id, interaction.guildId!);

        if (interaction.customId.startsWith('embed_edit:')) {
            if (interaction.customId === 'embed_edit:select_embed') {
                const embedName = interaction.values[0];
                const embed = await supabase.getCustomEmbed(interaction.guildId!, embedName);
                if (!embed) {
                    await interaction.reply({ content: '❌ Custom embed not found.', flags: EPH });
                    return;
                }
                
                editors.set(key, {
                    originalName: embed.name,
                    name: embed.name,
                    title: embed.title || '',
                    description: embed.description || '',
                    thumbnailUrl: embed.thumbnail_url || '',
                    imageUrl: embed.image_url || '',
                    footerText: embed.footer_text || '',
                    footerIconUrl: embed.footer_icon_url || '',
                    color: embed.color || 'purple',
                    authorName: embed.author_name || '',
                    authorIconUrl: embed.author_icon_url || '',
                    authorUrl: embed.author_url || '',
                    buttons: embed.buttons || [],
                    selectMenu: embed.select_menu || null
                });
                
                const container = renderEditorDashboard(editors.get(key));
                await interaction.update({ components: [container], embeds: [] });
                return;
            }
            
            const session = editors.get(key);
            if (!session) {
                await interaction.reply({ content: '❌ Session expired.', flags: EPH });
                return;
            }
            
            if (interaction.customId === 'embed_edit:select_color_preset') {
                session.color = interaction.values[0];
                const container = renderEditorColorPage(session);
                await interaction.update({ components: [container], embeds: [] });
            }
            else if (interaction.customId === 'embed_edit:select_field') {
                const choice = interaction.values[0];
                
                if (choice === 'field:color') {
                    const container = renderEditorColorPage(session);
                    await interaction.update({ components: [container], embeds: [] });
                }
                else if (choice === 'field:basic') {
                    const modal = new ModalBuilder().setCustomId('embed_edit_modal:basic').setTitle('Edit Basic Info');
                    const titleInput = new TextInputBuilder().setCustomId('title').setLabel('Title').setValue(session.title || '').setStyle(TextInputStyle.Short).setRequired(false);
                    const descInput = new TextInputBuilder().setCustomId('description').setLabel('Description').setValue(session.description || '').setStyle(TextInputStyle.Paragraph).setRequired(false);
                    
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(descInput)
                    );
                    await interaction.showModal(modal);
                }
                else if (choice === 'field:author') {
                    const modal = new ModalBuilder().setCustomId('embed_edit_modal:author').setTitle('Edit Author Info');
                    const nameInput = new TextInputBuilder().setCustomId('authorName').setLabel('Author Name').setValue(session.authorName || '').setStyle(TextInputStyle.Short).setRequired(false);
                    const iconInput = new TextInputBuilder().setCustomId('authorIconUrl').setLabel('Author Icon URL').setValue(session.authorIconUrl || '').setStyle(TextInputStyle.Short).setRequired(false);
                    const urlInput = new TextInputBuilder().setCustomId('authorUrl').setLabel('Author Link URL').setValue(session.authorUrl || '').setStyle(TextInputStyle.Short).setRequired(false);
                    
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(iconInput),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(urlInput)
                    );
                    await interaction.showModal(modal);
                }
                else if (choice === 'field:media') {
                    const modal = new ModalBuilder().setCustomId('embed_edit_modal:media').setTitle('Edit Media Assets');
                    const thumbInput = new TextInputBuilder().setCustomId('thumbnailUrl').setLabel('Thumbnail URL').setValue(session.thumbnailUrl || '').setStyle(TextInputStyle.Short).setRequired(false);
                    const imgInput = new TextInputBuilder().setCustomId('imageUrl').setLabel('Main Image URL').setValue(session.imageUrl || '').setStyle(TextInputStyle.Short).setRequired(false);
                    
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(thumbInput),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(imgInput)
                    );
                    await interaction.showModal(modal);
                }
                else if (choice === 'field:footer') {
                    const modal = new ModalBuilder().setCustomId('embed_edit_modal:footer').setTitle('Edit Footer Info');
                    const textInput = new TextInputBuilder().setCustomId('footerText').setLabel('Footer Text').setValue(session.footerText || '').setStyle(TextInputStyle.Short).setRequired(false);
                    const iconInput = new TextInputBuilder().setCustomId('footerIconUrl').setLabel('Footer Icon URL').setValue(session.footerIconUrl || '').setStyle(TextInputStyle.Short).setRequired(false);
                    
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(textInput),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(iconInput)
                    );
                    await interaction.showModal(modal);
                }
            }
            return;
        }

        const session = wizards.get(key);

        if (interaction.customId === 'embed_wiz:select:color') {
            if (!session) return;
            session.color = interaction.values[0];
            const container = renderWizardPage(session);
            await interaction.update({ components: [container], embeds: [] });
        }
        else if (interaction.customId === 'embed_wiz:select:button_style') {
            if (!session) return;
            const style = parseInt(interaction.values[0], 10);
            
            wizards.set(key + '-btnStyle', style);

            // Open modal to get label and URL/action for this button
            const modal = new ModalBuilder().setCustomId('embed_wiz_modal:add_button').setTitle('Configure Button Parameters');
            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('label').setLabel('Button Label').setPlaceholder('Click Here').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji Name/Icon (Optional)').setPlaceholder('🔥').setStyle(TextInputStyle.Short).setRequired(false)),
                new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('url').setLabel(style === 5 ? 'URL Link (Link style requires URL)' : 'Linked Child Embed Name / CustomId').setPlaceholder(style === 5 ? 'https://example.com' : 'support').setStyle(TextInputStyle.Short).setRequired(style === 5))
            );
            await interaction.showModal(modal);
        }
        else if (interaction.customId === 'embed_list:action') {
            const name = interaction.values[0].split(':')[1];
            const embed = await supabase.getCustomEmbed(interaction.guildId!, name);

            if (!embed) return;

            const actionContainer = ComponentsV2.baseContainer(ComponentsV2.Accents.primary)
                .addTextDisplayComponents(ComponentsV2.text(`# 🛠️ Embed Dashboard: \`${name}\`\nSelect an action to perform on this template.`))
                .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId(`embed_wiz_list_act:publish:${name}`).setLabel('Publish to Channel').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`embed_wiz_list_act:duplicate:${name}`).setLabel('Duplicate').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`embed_act_del:confirm:${name}`).setLabel('Delete').setStyle(ButtonStyle.Danger)
                ));

            await interaction.update({
                components: [actionContainer],
                embeds: []
            });
        }
    },

    async handleModal(interaction) {
        if (!interaction.customId.startsWith('embed_wiz_modal:') && !interaction.customId.startsWith('embed_settings_modal:') && !interaction.customId.startsWith('embed_edit_modal:')) return;

        const key = getSessionKey(interaction.user.id, interaction.guildId!);

        if (interaction.customId.startsWith('embed_edit_modal:')) {
            const session = editors.get(key);
            if (!session) {
                await interaction.reply({ content: '❌ Session expired.', flags: EPH });
                return;
            }

            const modalType = interaction.customId.split(':')[1];

            if (modalType === 'basic') {
                session.title = interaction.fields.getTextInputValue('title').trim();
                session.description = interaction.fields.getTextInputValue('description').trim();
            }
            else if (modalType === 'author') {
                session.authorName = interaction.fields.getTextInputValue('authorName').trim();
                session.authorIconUrl = interaction.fields.getTextInputValue('authorIconUrl').trim();
                session.authorUrl = interaction.fields.getTextInputValue('authorUrl').trim();
            }
            else if (modalType === 'media') {
                session.thumbnailUrl = interaction.fields.getTextInputValue('thumbnailUrl').trim();
                session.imageUrl = interaction.fields.getTextInputValue('imageUrl').trim();
            }
            else if (modalType === 'footer') {
                session.footerText = interaction.fields.getTextInputValue('footerText').trim();
                session.footerIconUrl = interaction.fields.getTextInputValue('footerIconUrl').trim();
            }
            else if (modalType === 'color') {
                const hex = interaction.fields.getTextInputValue('color').trim();
                session.color = hex.startsWith('#') ? hex : `#${hex}`;
                const container = renderEditorColorPage(session);
                await (interaction as any).update({ components: [container], embeds: [], flags: V2 });
                return;
            }

            const container = renderEditorDashboard(session);
            await (interaction as any).update({ components: [container], embeds: [], flags: V2 });
            return;
        }

        const session = wizards.get(key);

        if (interaction.customId.startsWith('embed_wiz_modal:')) {
            if (!session) {
                await interaction.reply({ content: '❌ Session expired.', flags: EPH });
                return;
            }

            const modalType = interaction.customId.split(':')[1];

            if (modalType === 'basic') {
                session.name = interaction.fields.getTextInputValue('name').trim().toLowerCase().replace(/\s+/g, '_');
                session.title = interaction.fields.getTextInputValue('title').trim();
                session.description = interaction.fields.getTextInputValue('description').trim();
            } 
            else if (modalType === 'media') {
                session.thumbnailUrl = interaction.fields.getTextInputValue('thumbnailUrl').trim();
                session.imageUrl = interaction.fields.getTextInputValue('imageUrl').trim();
                session.footerText = interaction.fields.getTextInputValue('footerText').trim();
                session.footerIconUrl = interaction.fields.getTextInputValue('footerIconUrl').trim();
            }
            else if (modalType === 'color') {
                const hex = interaction.fields.getTextInputValue('color').trim();
                session.color = hex.startsWith('#') ? hex : `#${hex}`;
            }
            else if (modalType === 'author') {
                session.authorName = interaction.fields.getTextInputValue('authorName').trim();
                session.authorIconUrl = interaction.fields.getTextInputValue('authorIconUrl').trim();
                session.authorUrl = interaction.fields.getTextInputValue('authorUrl').trim();
            }
            else if (modalType === 'add_button') {
                const style = wizards.get(key + '-btnStyle') || 1;
                wizards.delete(key + '-btnStyle');

                const label = interaction.fields.getTextInputValue('label').trim();
                const emoji = interaction.fields.getTextInputValue('emoji').trim();
                const url = interaction.fields.getTextInputValue('url').trim();

                session.buttons.push({
                    label,
                    emoji: emoji || undefined,
                    style,
                    url: url || undefined
                });
            }
            else if (modalType === 'select_menu') {
                const placeholder = interaction.fields.getTextInputValue('placeholder').trim();
                const optionsCSV = interaction.fields.getTextInputValue('options').trim();

                const optionsList = optionsCSV.split(',').map(pair => {
                    const parts = pair.split(':');
                    const label = parts[0]?.trim();
                    const value = parts[1]?.trim() || label?.toLowerCase();
                    return {
                        label,
                        value: value.startsWith('embed_link:') ? value : value
                    };
                }).filter(o => o.label);

                session.selectMenu = {
                    placeholder,
                    options: optionsList
                };
            }

            const container = renderWizardPage(session);
            await (interaction as any).update({ components: [container], embeds: [], flags: V2 });
        }
        else if (interaction.customId === 'embed_settings_modal:edit') {
            const default_color = interaction.fields.getTextInputValue('color').trim();
            const default_footer = interaction.fields.getTextInputValue('footer').trim();
            const default_author = interaction.fields.getTextInputValue('author').trim();
            const default_thumbnail = interaction.fields.getTextInputValue('thumbnail').trim();

            await supabase.updateEmbedSettings(interaction.guildId!, {
                default_color: default_color || null,
                default_footer: default_footer || null,
                default_author: default_author || null,
                default_thumbnail: default_thumbnail || null
            });

            await (interaction as any).update({
                components: [ComponentsV2.successContainer('Settings Updated', 'Default embed creators configurations updated.')],
                embeds: [],
                flags: V2
            });
        }
    }
};

// Publisher Action Button Triggers
export const embedListActionButtons: Command = {
    data: new SlashCommandBuilder().setName('_embed_act_internal').setDescription('internal'),
    async execute() {},
    async handleButton(interaction) {
        if (!interaction.customId.startsWith('embed_wiz_list_act:')) return;

        const name = interaction.customId.split(':')[2];
        const action = interaction.customId.split(':')[1];

        if (action === 'publish') {
            // Select channel to publish to
            const listContainer = ComponentsV2.baseContainer(ComponentsV2.Accents.primary)
                .addTextDisplayComponents(ComponentsV2.text(`# 🌐 Select Target Channel\nChoose a text channel to send custom embed **\`${name}\`**.`));

            // Generate channels menu
            const channelsList = interaction.guild?.channels.cache.filter(c => c.type === ChannelType.GuildText);
            const channels = channelsList ? Array.from(channelsList.values()).slice(0, 25) : [];
            if (channels.length === 0) {
                await interaction.reply({ content: '❌ No text channels found.', flags: EPH });
                return;
            }

            const channelSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`embed_pub_target:${name}`)
                    .setPlaceholder('Select target text channel...')
                    .addOptions(channels.map((c: any) => ({
                        label: c.name,
                        value: c.id
                    })))
            );
            listContainer.addActionRowComponents(channelSelect);

            await interaction.update({
                components: [listContainer],
                embeds: []
            });
        }
        else if (action === 'duplicate') {
            const embed = await supabase.getCustomEmbed(interaction.guildId!, name);
            if (!embed) return;

            const duplicateName = `${name}_copy`;
            await supabase.saveCustomEmbed(interaction.guildId!, duplicateName, {
                title: embed.title,
                description: embed.description,
                thumbnail_url: embed.thumbnail_url,
                image_url: embed.image_url,
                footer_text: embed.footer_text,
                footer_icon_url: embed.footer_icon_url,
                color: embed.color,
                author_name: embed.author_name,
                author_icon_url: embed.author_icon_url,
                author_url: embed.author_url,
                buttons: embed.buttons,
                select_menu: embed.select_menu
            });

            await interaction.update({
                components: [ComponentsV2.successContainer('Duplicated', `Duplicated custom embed template as **\`${duplicateName}\`**.`)],
                embeds: []
            });
        }
    },

    async handleSelectMenu(interaction) {
        if (!interaction.customId.startsWith('embed_pub_target:')) return;

        const name = interaction.customId.split(':')[1];
        const channelId = interaction.values[0];
        const embed = await supabase.getCustomEmbed(interaction.guildId!, name);

        if (!embed) {
            await interaction.reply({ content: '❌ Embed template not found.', flags: EPH });
            return;
        }

        const channel = interaction.guild?.channels.cache.get(channelId);
        if (!channel || channel.type !== ChannelType.GuildText) {
            await interaction.reply({ content: '❌ Target is not a text channel.', flags: EPH });
            return;
        }

        const payload = buildFinalEmbedPayload(embed);
        await channel.send({
            components: [payload],
            flags: V2
        }).catch((err) => {
            logger.error('Failed to publish embed:', err);
        });

        await interaction.update({
            components: [ComponentsV2.successContainer('Published Successfully', `Custom embed **\`${name}\`** has been published to <#${channelId}>.`)],
            embeds: []
        });
    }
};

// Direct links interceptor handler
export const embedLinksRouter: Command = {
    data: new SlashCommandBuilder().setName('_embed_router_internal').setDescription('internal'),
    async execute() {},
    async handleButton(interaction) {
        if (!interaction.customId.startsWith('embed_link:')) return;

        await interaction.deferUpdate().catch(() => {});

        const targetName = interaction.customId.split(':')[1];
        const embed = await supabase.getCustomEmbed(interaction.guildId!, targetName);

        if (!embed) {
            await interaction.followUp({
                content: `❌ Linked embed template **\`${targetName}\`** not found in the database.`,
                flags: EPH
            });
            return;
        }

        const payload = buildFinalEmbedPayload(embed);
        await interaction.editReply({
            components: [payload],
            flags: V2
        }).catch(() => {});
    },

    async handleSelectMenu(interaction) {
        // Intercept dropdown navigation if selection value starts with embed_link:
        const val = interaction.values[0] || '';
        if (!val.startsWith('embed_link:')) return;

        await interaction.deferUpdate().catch(() => {});

        const targetName = val.split(':')[1];
        const embed = await supabase.getCustomEmbed(interaction.guildId!, targetName);

        if (!embed) {
            await interaction.followUp({
                content: `❌ Linked child embed template **\`${targetName}\`** not found in the database.`,
                flags: EPH
            });
            return;
        }

        const payload = buildFinalEmbedPayload(embed);
        await interaction.editReply({
            components: [payload],
            flags: V2
        }).catch(() => {});
    }
};
