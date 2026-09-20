import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, } from 'discord.js';
import { reactRolesSettings, } from '../services/reactRolesSettings.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';
const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;
function renderPanelManager(config) {
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
    let text = `# 🎭 Reaction Roles Manager\n` +
        `Create self-assignable role panels and emoji reaction roles for your members.\n\n`;
    if (config.panels.length === 0 && config.reactionRoles.length === 0) {
        text += `*No reaction roles or panels configured yet.*\n` +
            `• Use \`/reactroles add\` to attach reaction roles to any message.\n` +
            `• Or click the button below to build an interactive button/menu panel.`;
    }
    else {
        if (config.panels.length > 0) {
            text += `### 📋 Active Interactive Panels:\n`;
            config.panels.forEach((p) => {
                text += `• **${p.title}** (\`${p.id}\`) — Style: \`${p.style}\` | Roles: \`${p.mappings.length}\`\n`;
            });
            text += '\n';
        }
        if (config.reactionRoles.length > 0) {
            text += `### ⚡ Emoji Reaction Roles: **${config.reactionRoles.length}** configured.\n`;
        }
    }
    c.addTextDisplayComponents(ComponentsV2.text(text))
        .addSeparatorComponents(ComponentsV2.separator());
    const btnRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId('rr_wiz:create')
        .setLabel('Create New Panel ➕')
        .setStyle(ButtonStyle.Success));
    c.addActionRowComponents(btnRow);
    if (config.panels.length > 0) {
        const selectMenu = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId('rr_wiz:edit_select')
            .setPlaceholder('Select a panel to edit...')
            .addOptions(config.panels.slice(0, 25).map((p) => ({
            label: p.title.slice(0, 100),
            value: p.id,
            description: `${p.mappings.length} roles configured`,
        }))));
        c.addActionRowComponents(selectMenu);
    }
    return c;
}
function renderPanelEditor(panel) {
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.info);
    const mappingsList = panel.mappings.length > 0
        ? panel.mappings.map((m, idx) => `\`${idx + 1}.\` ${m.emoji} **${m.label}** → <@&${m.roleId}>`).join('\n')
        : '_No roles mapped yet_';
    const text = `# ⚙️ Panel Editor: ${panel.title}\n` +
        `› **Description:** *${panel.description}*\n` +
        `› **Style:** \`${panel.style.toUpperCase()}\`\n` +
        `› **Panel ID:** \`${panel.id}\`\n\n` +
        `### Configured Roles:\n${mappingsList}`;
    c.addTextDisplayComponents(ComponentsV2.text(text))
        .addSeparatorComponents(ComponentsV2.separator());
    const editRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId(`rr_wiz:add_role:${panel.id}`)
        .setLabel('Add Role 🎭')
        .setStyle(ButtonStyle.Success), new ButtonBuilder()
        .setCustomId(`rr_wiz:edit_details:${panel.id}`)
        .setLabel('Edit Info 📝')
        .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId(`rr_wiz:toggle_style:${panel.id}`)
        .setLabel(`Style: ${panel.style === 'buttons' ? 'Menu ⬇️' : 'Buttons ⏹️'}`)
        .setStyle(ButtonStyle.Secondary));
    const actionRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId('rr_wiz:back_list')
        .setLabel('⬅️ Back to List')
        .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId(`rr_wiz:publish:${panel.id}`)
        .setLabel('Publish Panel 📣')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(panel.mappings.length === 0), new ButtonBuilder()
        .setCustomId(`rr_wiz:delete:${panel.id}`)
        .setLabel('Delete Panel 🗑️')
        .setStyle(ButtonStyle.Danger));
    c.addActionRowComponents(editRow);
    c.addActionRowComponents(actionRow);
    return c;
}
export function buildPublishedPanelPayload(panel) {
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.purple);
    c.addTextDisplayComponents(ComponentsV2.text(`# ${panel.title}\n\n${panel.description}`));
    if (panel.mappings.length === 0)
        return c;
    if (panel.style === 'buttons') {
        const rows = [];
        let currentRow = new ActionRowBuilder();
        panel.mappings.forEach((m, idx) => {
            if (currentRow.components.length >= 5) {
                rows.push(currentRow);
                currentRow = new ActionRowBuilder();
            }
            const btn = new ButtonBuilder()
                .setCustomId(`rr_btn:${panel.id}:${idx}`)
                .setLabel(m.label.slice(0, 80))
                .setStyle(ButtonStyle.Secondary);
            if (m.emoji) {
                try {
                    btn.setEmoji(m.emoji);
                }
                catch { }
            }
            currentRow.addComponents(btn);
        });
        if (currentRow.components.length > 0) {
            rows.push(currentRow);
        }
        rows.forEach((row) => c.addActionRowComponents(row));
    }
    else {
        const select = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(`rr_select:${panel.id}`)
            .setPlaceholder('Choose a role to assign/remove...')
            .addOptions(panel.mappings.slice(0, 25).map((m, idx) => {
            const opt = {
                label: m.label.slice(0, 100),
                value: String(idx),
            };
            if (m.emoji) {
                try {
                    opt.emoji = m.emoji;
                }
                catch { }
            }
            return opt;
        })));
        c.addActionRowComponents(select);
    }
    return c;
}
export const reactRolesCommand = {
    data: new SlashCommandBuilder()
        .setName('reactroles')
        .setDescription('Create and manage reaction roles and self-assignable role panels')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand((sub) => sub
        .setName('add')
        .setDescription('Attach an emoji reaction role to an existing message')
        .addStringOption((opt) => opt
        .setName('message_id')
        .setDescription('The ID of the message to attach the reaction role to')
        .setRequired(true))
        .addStringOption((opt) => opt
        .setName('emoji')
        .setDescription('The emoji users click to get the role (e.g. 🔔, 🎮, ⭐)')
        .setRequired(true))
        .addRoleOption((opt) => opt
        .setName('role')
        .setDescription('The role to assign/remove when users react')
        .setRequired(true))
        .addChannelOption((opt) => opt
        .setName('channel')
        .setDescription('Channel where the message is located (defaults to current channel)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)))
        .addSubcommand((sub) => sub
        .setName('remove')
        .setDescription('Remove reaction role mapping from a message')
        .addStringOption((opt) => opt
        .setName('message_id')
        .setDescription('The ID of the message')
        .setRequired(true))
        .addStringOption((opt) => opt
        .setName('emoji')
        .setDescription('Specific emoji to remove (leave empty to remove all roles on this message)')
        .setRequired(false)))
        .addSubcommand((sub) => sub
        .setName('list')
        .setDescription('List all active reaction roles and panels in this server'))
        .addSubcommand((sub) => sub
        .setName('setup')
        .setDescription('Open the visual reaction roles panel builder dashboard')),
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({ content: '❌ This command can only be used in a server.', flags: EPH });
            return;
        }
        const subcommand = interaction.options.getSubcommand(true);
        // 1. SUBCOMMAND: ADD (Emoji Reaction Role on Message)
        if (subcommand === 'add') {
            await interaction.deferReply({ flags: EPH });
            const messageId = interaction.options.getString('message_id', true).trim();
            const rawEmoji = interaction.options.getString('emoji', true).trim();
            const role = interaction.options.getRole('role', true);
            const channel = interaction.options.getChannel('channel')
                ?? interaction.channel;
            if (!channel || !channel.isTextBased()) {
                await interaction.editReply({ content: '❌ Could not find the specified text channel.' });
                return;
            }
            // Check role hierarchy
            const botMember = interaction.guild.members.me;
            if (botMember && role.position >= botMember.roles.highest.position) {
                await interaction.editReply({
                    content: `⚠️ **Role Hierarchy Warning:** I cannot manage the role <@&${role.id}> because it is higher than or equal to my highest role. Please drag my bot role above <@&${role.id}> in Server Settings -> Roles!`,
                });
                return;
            }
            // Fetch the target message
            const targetMessage = await channel.messages.fetch(messageId).catch(() => null);
            if (!targetMessage) {
                await interaction.editReply({
                    content: `❌ Could not find message \`${messageId}\` in <#${channel.id}>. Make sure the ID and channel are correct.`,
                });
                return;
            }
            // Try to react to the target message with the emoji
            let reactSuccess = false;
            try {
                await targetMessage.react(rawEmoji);
                reactSuccess = true;
            }
            catch (err) {
                logger.warn(`[ReactRoles] Failed to react with emoji "${rawEmoji}":`, err);
            }
            // Save mapping to Supabase
            const mapping = {
                messageId: targetMessage.id,
                channelId: channel.id,
                emoji: rawEmoji,
                roleId: role.id,
            };
            await reactRolesSettings.addReactionRole(interaction.guild.id, mapping);
            const embed = new EmbedBuilder()
                .setColor(0x10b981) // Emerald Green
                .setTitle('✅ Reaction Role Added!')
                .setDescription(`Successfully linked **${rawEmoji}** to role <@&${role.id}> on [Target Message](${targetMessage.url})!\n\n` +
                `• **Channel:** <#${channel.id}>\n` +
                `• **Emoji:** ${rawEmoji}\n` +
                `• **Role:** <@&${role.id}>\n` +
                `• **Reaction Added by Bot:** ${reactSuccess ? '✅ Yes' : '⚠️ Please add the reaction to the message manually'}`)
                .setFooter({ text: 'Victus Cloud Reaction Roles' })
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
            return;
        }
        // 2. SUBCOMMAND: REMOVE
        if (subcommand === 'remove') {
            await interaction.deferReply({ flags: EPH });
            const messageId = interaction.options.getString('message_id', true).trim();
            const emoji = interaction.options.getString('emoji')?.trim();
            const res = await reactRolesSettings.removeReactionRole(interaction.guild.id, messageId, emoji);
            if (res.removedCount > 0) {
                await interaction.editReply({
                    content: `✅ Successfully removed **${res.removedCount}** reaction role mapping${res.removedCount === 1 ? '' : 's'} from message \`${messageId}\`.`,
                });
            }
            else {
                await interaction.editReply({
                    content: `ℹ️ No reaction role mappings found for message \`${messageId}\`${emoji ? ` with emoji ${emoji}` : ''}.`,
                });
            }
            return;
        }
        // 3. SUBCOMMAND: LIST
        if (subcommand === 'list') {
            await interaction.deferReply({ flags: EPH });
            const config = await reactRolesSettings.get(interaction.guild.id);
            const embed = new EmbedBuilder()
                .setColor(0x8b5cf6)
                .setTitle('🎭 Server Reaction Roles & Panels')
                .setTimestamp();
            let desc = '';
            if (config.reactionRoles && config.reactionRoles.length > 0) {
                desc += `### ⚡ Emoji Reaction Roles (${config.reactionRoles.length}):\n`;
                config.reactionRoles.forEach((rr, idx) => {
                    const jumpUrl = `https://discord.com/channels/${interaction.guild.id}/${rr.channelId}/${rr.messageId}`;
                    desc += `\`${idx + 1}.\` ${rr.emoji} → <@&${rr.roleId}> in <#${rr.channelId}> ([Jump](${jumpUrl}))\n`;
                });
                desc += '\n';
            }
            else {
                desc += `### ⚡ Emoji Reaction Roles: *None configured. Use \`/reactroles add\` to create one.*\n\n`;
            }
            if (config.panels && config.panels.length > 0) {
                desc += `### 📋 Interactive Button/Select Panels (${config.panels.length}):\n`;
                config.panels.forEach((p, idx) => {
                    desc += `\`${idx + 1}.\` **${p.title}** (\`${p.id}\`) — Style: \`${p.style}\` | Roles: \`${p.mappings.length}\`\n`;
                });
            }
            else {
                desc += `### 📋 Interactive Panels: *None created. Use \`/reactroles setup\` to build one.*\n`;
            }
            embed.setDescription(desc.slice(0, 4000));
            await interaction.editReply({ embeds: [embed] });
            return;
        }
        // 4. SUBCOMMAND: SETUP (Interactive Dashboard)
        if (subcommand === 'setup') {
            const config = await reactRolesSettings.get(interaction.guild.id);
            const dashboard = renderPanelManager(config);
            await interaction.reply({
                components: [dashboard],
                flags: V2 | EPH,
            });
            return;
        }
    },
    async handleButton(interaction) {
        if (!interaction.guild)
            return;
        const guildId = interaction.guild.id;
        const config = await reactRolesSettings.get(guildId);
        // --- Wizard Creation / Editor Routers ---
        if (interaction.customId.startsWith('rr_wiz:')) {
            const action = interaction.customId.split(':')[1];
            if (action === 'create') {
                const modal = new ModalBuilder()
                    .setCustomId('rr_wiz_modal:create')
                    .setTitle('Create Reaction Roles Panel');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
                    .setCustomId('title')
                    .setLabel('Panel Title')
                    .setPlaceholder('Get Roles Here!')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder()
                    .setCustomId('description')
                    .setLabel('Panel Description')
                    .setPlaceholder('Click the buttons below to assign yourself roles.')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)));
                await interaction.showModal(modal);
            }
            else if (action === 'back_list') {
                await interaction.update({
                    components: [renderPanelManager(config)],
                    embeds: [],
                });
            }
            else if (action === 'toggle_style') {
                const panelId = interaction.customId.split(':')[2];
                const panel = config.panels.find((p) => p.id === panelId);
                if (panel) {
                    panel.style = panel.style === 'buttons' ? 'select' : 'buttons';
                    await reactRolesSettings.set(guildId, config);
                    await interaction.update({
                        components: [renderPanelEditor(panel)],
                        embeds: [],
                    });
                }
            }
            else if (action === 'delete') {
                const panelId = interaction.customId.split(':')[2];
                const updatedPanels = config.panels.filter((p) => p.id !== panelId);
                await reactRolesSettings.set(guildId, { panels: updatedPanels });
                const newConfig = await reactRolesSettings.get(guildId);
                await interaction.update({
                    components: [renderPanelManager(newConfig)],
                    embeds: [],
                });
            }
            else if (action === 'add_role') {
                const panelId = interaction.customId.split(':')[2];
                const modal = new ModalBuilder()
                    .setCustomId(`rr_wiz_modal:add_role:${panelId}`)
                    .setTitle('Add Self-Assignable Role');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
                    .setCustomId('label')
                    .setLabel('Role Display Label')
                    .setPlaceholder('Announcements Ping')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder()
                    .setCustomId('roleId')
                    .setLabel('Discord Role ID (Right-click role -> Copy ID)')
                    .setPlaceholder('123456789012345678')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder()
                    .setCustomId('emoji')
                    .setLabel('Emoji (e.g. 📢, ⭐, 🎮)')
                    .setPlaceholder('📢')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)));
                await interaction.showModal(modal);
            }
            else if (action === 'edit_details') {
                const panelId = interaction.customId.split(':')[2];
                const panel = config.panels.find((p) => p.id === panelId);
                if (panel) {
                    const modal = new ModalBuilder()
                        .setCustomId(`rr_wiz_modal:edit_details:${panelId}`)
                        .setTitle('Edit Panel Info');
                    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
                        .setCustomId('title')
                        .setLabel('Panel Title')
                        .setValue(panel.title)
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder()
                        .setCustomId('description')
                        .setLabel('Panel Description')
                        .setValue(panel.description)
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)));
                    await interaction.showModal(modal);
                }
            }
            else if (action === 'publish') {
                const panelId = interaction.customId.split(':')[2];
                const panel = config.panels.find((p) => p.id === panelId);
                if (panel && interaction.channel) {
                    const payload = buildPublishedPanelPayload(panel);
                    const postedMsg = await interaction.channel.send({
                        components: [payload],
                        flags: V2,
                    }).catch(() => null);
                    if (postedMsg) {
                        panel.messageId = postedMsg.id;
                        panel.channelId = interaction.channelId;
                        await reactRolesSettings.set(guildId, config);
                        await interaction.update({
                            components: [
                                ComponentsV2.successContainer('Panel Published!', `The role assignment panel has been published to <#${interaction.channelId}>.`),
                            ],
                            embeds: [],
                        });
                    }
                    else {
                        await interaction.reply({
                            content: '❌ Failed to send panel. Make sure I have permission to send messages and embed links here.',
                            flags: EPH,
                        });
                    }
                }
            }
        }
        // --- Published Panel Button Click Router ---
        else if (interaction.customId.startsWith('rr_btn:')) {
            const [, panelId, optIdxStr] = interaction.customId.split(':');
            const optIdx = parseInt(optIdxStr, 10);
            const panel = config.panels.find((p) => p.id === panelId);
            if (!panel) {
                await interaction.reply({ content: '❌ Role panel not found.', flags: EPH });
                return;
            }
            const mapping = panel.mappings[optIdx];
            if (!mapping)
                return;
            const member = interaction.member;
            if (!member)
                return;
            const targetRole = interaction.guild.roles.cache.get(mapping.roleId);
            if (!targetRole) {
                await interaction.reply({ content: '❌ Target role no longer exists.', flags: EPH });
                return;
            }
            const botMember = interaction.guild.members.me;
            if (botMember && targetRole.position >= botMember.roles.highest.position) {
                await interaction.reply({
                    content: `⚠️ I cannot manage <@&${targetRole.id}> because it is higher than my highest role in the server role list.`,
                    flags: EPH,
                });
                return;
            }
            try {
                const roles = member.roles;
                const hasRole = roles.cache ? roles.cache.has(mapping.roleId) : Array.isArray(roles) && roles.includes(mapping.roleId);
                if (hasRole) {
                    await member.roles.remove(mapping.roleId);
                    await interaction.reply({
                        content: `❌ Removed the **@${targetRole.name}** role from you.`,
                        flags: EPH,
                    });
                }
                else {
                    await member.roles.add(mapping.roleId);
                    await interaction.reply({
                        content: `✅ Added the **@${targetRole.name}** role to you!`,
                        flags: EPH,
                    });
                }
            }
            catch (err) {
                logger.error('[ReactRoles] Failed to toggle role:', err);
                await interaction.reply({
                    content: '❌ Failed to toggle role. Ensure the bot has Manage Roles permission and is positioned above this role.',
                    flags: EPH,
                });
            }
        }
    },
    async handleSelectMenu(interaction) {
        if (!interaction.guild)
            return;
        const guildId = interaction.guild.id;
        const config = await reactRolesSettings.get(guildId);
        if (interaction.customId === 'rr_wiz:edit_select') {
            const panelId = interaction.values[0];
            const panel = config.panels.find((p) => p.id === panelId);
            if (panel) {
                await interaction.update({
                    components: [renderPanelEditor(panel)],
                    embeds: [],
                });
            }
        }
        // Published Panel Dropdown Selection Router
        else if (interaction.customId.startsWith('rr_select:')) {
            const panelId = interaction.customId.split(':')[1];
            const panel = config.panels.find((p) => p.id === panelId);
            if (!panel) {
                await interaction.reply({ content: '❌ Role panel not found.', flags: EPH });
                return;
            }
            const optIdx = parseInt(interaction.values[0], 10);
            const mapping = panel.mappings[optIdx];
            if (!mapping)
                return;
            const member = interaction.member;
            if (!member)
                return;
            const targetRole = interaction.guild.roles.cache.get(mapping.roleId);
            if (!targetRole) {
                await interaction.reply({ content: '❌ Target role no longer exists.', flags: EPH });
                return;
            }
            const botMember = interaction.guild.members.me;
            if (botMember && targetRole.position >= botMember.roles.highest.position) {
                await interaction.reply({
                    content: `⚠️ I cannot manage <@&${targetRole.id}> because it is higher than my highest role in the server role list.`,
                    flags: EPH,
                });
                return;
            }
            try {
                const roles = member.roles;
                const hasRole = roles.cache ? roles.cache.has(mapping.roleId) : Array.isArray(roles) && roles.includes(mapping.roleId);
                if (hasRole) {
                    await member.roles.remove(mapping.roleId);
                    await interaction.reply({
                        content: `❌ Removed the **@${targetRole.name}** role from you.`,
                        flags: EPH,
                    });
                }
                else {
                    await member.roles.add(mapping.roleId);
                    await interaction.reply({
                        content: `✅ Added the **@${targetRole.name}** role to you!`,
                        flags: EPH,
                    });
                }
            }
            catch (err) {
                logger.error('[ReactRoles] Failed to toggle role via select:', err);
                await interaction.reply({
                    content: '❌ Failed to toggle role. Ensure the bot has Manage Roles permission and is higher in role hierarchy.',
                    flags: EPH,
                });
            }
        }
    },
    async handleModal(interaction) {
        if (!interaction.guild)
            return;
        const guildId = interaction.guild.id;
        const config = await reactRolesSettings.get(guildId);
        if (interaction.customId === 'rr_wiz_modal:create') {
            const title = interaction.fields.getTextInputValue('title').trim();
            const description = interaction.fields.getTextInputValue('description').trim();
            const panelId = Math.random().toString(36).substring(2, 10);
            const newPanel = {
                id: panelId,
                title,
                description,
                style: 'buttons',
                mappings: [],
            };
            config.panels.push(newPanel);
            await reactRolesSettings.set(guildId, config);
            // Using deferUpdate + editReply fixes the Discord.js modal update crash
            await interaction.deferUpdate();
            await interaction.editReply({
                components: [renderPanelEditor(newPanel)],
                embeds: [],
            });
        }
        else if (interaction.customId.startsWith('rr_wiz_modal:add_role:')) {
            const panelId = interaction.customId.split(':')[2];
            const label = interaction.fields.getTextInputValue('label').trim();
            const roleId = interaction.fields.getTextInputValue('roleId').trim();
            const emoji = interaction.fields.getTextInputValue('emoji')?.trim() || '🎭';
            const panel = config.panels.find((p) => p.id === panelId);
            if (panel) {
                panel.mappings.push({ label, roleId, emoji });
                await reactRolesSettings.set(guildId, config);
                await interaction.deferUpdate();
                await interaction.editReply({
                    components: [renderPanelEditor(panel)],
                    embeds: [],
                });
            }
        }
        else if (interaction.customId.startsWith('rr_wiz_modal:edit_details:')) {
            const panelId = interaction.customId.split(':')[2];
            const title = interaction.fields.getTextInputValue('title').trim();
            const description = interaction.fields.getTextInputValue('description').trim();
            const panel = config.panels.find((p) => p.id === panelId);
            if (panel) {
                panel.title = title;
                panel.description = description;
                await reactRolesSettings.set(guildId, config);
                await interaction.deferUpdate();
                await interaction.editReply({
                    components: [renderPanelEditor(panel)],
                    embeds: [],
                });
            }
        }
    },
};
export default reactRolesCommand;
