import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, } from 'discord.js';
import { reactRolesSettings, } from '../services/reactRolesSettings.js';
import { logger } from '../utils/logger.js';
const EPH = MessageFlags.Ephemeral;
export const ROLE_TEMPLATES = {
    pings: {
        id: 'pings',
        name: '🔔 Server Notification Pings',
        title: 'Reaction Roles!',
        description: 'Take your roles to be notified faster and never miss anything important.',
        color: 0x8b5cf6, // Vibrant Purple
        roles: [
            { name: 'Newz Ping', emoji: '🌍', color: '#3b82f6' },
            { name: 'Events Ping', emoji: '🐳', color: '#06b6d4' },
            { name: 'Updates Ping', emoji: '🍁', color: '#ef4444' },
            { name: 'Giveaway Ping', emoji: '🦖', color: '#10b981' },
            { name: 'Resource Ping', emoji: '🐲', color: '#84cc16' },
            { name: 'Minigames Ping', emoji: '🎃', color: '#f97316' },
        ],
    },
    gaming: {
        id: 'gaming',
        name: '🎮 Community Gaming Roles',
        title: 'Gaming & Squad Roles',
        description: 'Select the games you play to find teammates and get pinged for community matches.',
        color: 0x06b6d4, // Neon Cyan
        roles: [
            { name: 'Minecraft', emoji: '⛏️', color: '#10b981' },
            { name: 'Valorant', emoji: '🎯', color: '#f43f5e' },
            { name: 'GTA / FiveM', emoji: '🚗', color: '#eab308' },
            { name: 'Roblox', emoji: '🧱', color: '#ef4444' },
            { name: 'FPS Games', emoji: '🔫', color: '#6366f1' },
            { name: 'Party Games', emoji: '🎲', color: '#a855f7' },
        ],
    },
    regions: {
        id: 'regions',
        name: '🌐 Regional & Timezone Roles',
        title: 'Regional Roles',
        description: 'Select your region so members know your timezone for server events and games.',
        color: 0x10b981, // Emerald Green
        roles: [
            { name: 'North America', emoji: '🌎', color: '#3b82f6' },
            { name: 'Europe', emoji: '🌍', color: '#10b981' },
            { name: 'Asia', emoji: '🌏', color: '#f59e0b' },
            { name: 'Oceania', emoji: '🦘', color: '#06b6d4' },
            { name: 'South America', emoji: '🌎', color: '#ec4899' },
        ],
    },
    platforms: {
        id: 'platforms',
        name: '💻 Gaming Platform Roles',
        title: 'Gaming Platforms',
        description: 'Select the platforms and devices you game on.',
        color: 0xf59e0b, // Amber Gold
        roles: [
            { name: 'PC Gamer', emoji: '💻', color: '#8b5cf6' },
            { name: 'Mobile Gamer', emoji: '📱', color: '#10b981' },
            { name: 'Console Gamer', emoji: '🎮', color: '#3b82f6' },
        ],
    },
};
/**
 * Distribute buttons equally across rows to avoid awkward single buttons.
 * e.g. 6 buttons -> 3 and 3 (instead of 4 and 2 or 5 and 1)
 */
function chunkButtonsEqually(items, maxPerRow = 5) {
    const total = items.length;
    if (total === 0)
        return [];
    if (total <= maxPerRow)
        return [items];
    const numRows = Math.ceil(total / maxPerRow);
    const perRow = Math.ceil(total / numRows);
    const rows = [];
    for (let i = 0; i < total; i += perRow) {
        rows.push(items.slice(i, i + perRow));
    }
    return rows;
}
/**
 * Build the ultra-stylish, high-impact public reaction role panel payload.
 */
export function buildPublishedPanelPayload(panel, guild) {
    const embed = new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle(`✨ ${panel.title}`)
        .setDescription(`> ${panel.description}\n\n` +
        `### 📋 Available Roles\n` +
        panel.mappings.map((m) => `> ${m.emoji} **${m.label}** ── <@&${m.roleId}>`).join('\n') +
        `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `-# 💡 *React with an emoji or click a button below to toggle your roles!*`)
        .setTimestamp();
    if (guild) {
        const icon = guild.iconURL({ forceStatic: false });
        if (icon)
            embed.setThumbnail(icon);
        embed.setFooter({ text: `${guild.name} • Self-Assignable Roles`, iconURL: icon || undefined });
    }
    // Build balanced buttons / select menu
    if (panel.style === 'buttons') {
        const chunks = chunkButtonsEqually(panel.mappings, 5);
        const rows = [];
        let globalIdx = 0;
        for (const chunk of chunks) {
            const row = new ActionRowBuilder();
            for (const m of chunk) {
                const btn = new ButtonBuilder()
                    .setCustomId(`rr_btn:${panel.id}:${globalIdx}`)
                    .setLabel(m.label.slice(0, 80))
                    .setStyle(ButtonStyle.Secondary);
                if (m.emoji) {
                    try {
                        btn.setEmoji(m.emoji);
                    }
                    catch { }
                }
                row.addComponents(btn);
                globalIdx++;
            }
            rows.push(row);
        }
        return { embeds: [embed], components: rows };
    }
    else {
        const select = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(`rr_select:${panel.id}`)
            .setPlaceholder('Click to choose your roles...')
            .addOptions(panel.mappings.slice(0, 25).map((m, idx) => {
            const opt = {
                label: m.label.slice(0, 100),
                value: String(idx),
                description: `Toggle @${m.label}`,
            };
            if (m.emoji) {
                try {
                    opt.emoji = m.emoji;
                }
                catch { }
            }
            return opt;
        })));
        return { embeds: [embed], components: [select] };
    }
}
/**
 * Render visual dashboard embed and controls for /reactroles setup.
 */
function renderDashboardEmbed(config, guildName) {
    const embed = new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle('🎭 Reaction Roles & Panels Manager')
        .setDescription(`Configure self-assignable role panels and emoji reaction roles for **${guildName}**.\n\n` +
        `• Click **Deploy Template ⚡** to instantly launch pre-configured notification or gaming panels.\n` +
        `• Click **Create Panel ➕** to build a custom interactive role panel from scratch.\n` +
        `• Use \`/reactroles add\` to attach emoji reaction roles to any existing message.`)
        .setTimestamp();
    if (config.panels.length > 0) {
        const panelList = config.panels
            .slice(0, 10)
            .map((p, idx) => `\`${idx + 1}.\` **${p.title}** (\`${p.id}\`) — ${p.style} style | ${p.mappings.length} roles`)
            .join('\n');
        embed.addFields({ name: `📋 Active Interactive Panels (${config.panels.length})`, value: panelList });
    }
    if (config.reactionRoles.length > 0) {
        embed.addFields({
            name: '⚡ Emoji Reaction Roles',
            value: `**${config.reactionRoles.length}** reaction role mappings active on server messages. (View with \`/reactroles list\`)`,
        });
    }
    const btnRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId('rr_wiz:create')
        .setLabel('Create Custom Panel ➕')
        .setStyle(ButtonStyle.Success), new ButtonBuilder()
        .setCustomId('rr_wiz:tpl_pings')
        .setLabel('Deploy Pings Template 🔔')
        .setStyle(ButtonStyle.Primary));
    const rows = [btnRow];
    if (config.panels.length > 0) {
        const selectMenu = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId('rr_wiz:edit_select')
            .setPlaceholder('Select an existing panel to edit or publish...')
            .addOptions(config.panels.slice(0, 25).map((p) => ({
            label: p.title.slice(0, 100),
            value: p.id,
            description: `${p.mappings.length} roles • ID: ${p.id}`,
        }))));
        rows.push(selectMenu);
    }
    return { embed, components: rows };
}
function renderPanelEditorEmbed(panel) {
    const mappingsList = panel.mappings.length > 0
        ? panel.mappings.map((m, idx) => `\`${idx + 1}.\` ${m.emoji} **${m.label}** ── <@&${m.roleId}>`).join('\n')
        : '_No roles added yet. Click "Add Role" below to add roles!_';
    const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle(`⚙️ Panel Editor: ${panel.title}`)
        .setDescription(`**Description:** *${panel.description}*\n` +
        `**Style:** \`${panel.style.toUpperCase()}\`\n` +
        `**Panel ID:** \`${panel.id}\`\n\n` +
        `### Configured Roles:\n${mappingsList}`)
        .setFooter({ text: 'Victus Cloud Reaction Roles Editor' });
    const editRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId(`rr_wiz:add_role:${panel.id}`)
        .setLabel('Add Role 🎭')
        .setStyle(ButtonStyle.Success), new ButtonBuilder()
        .setCustomId(`rr_wiz:edit_details:${panel.id}`)
        .setLabel('Edit Info 📝')
        .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId(`rr_wiz:toggle_style:${panel.id}`)
        .setLabel(`Style: ${panel.style === 'buttons' ? 'Select Menu ⬇️' : 'Buttons ⏹️'}`)
        .setStyle(ButtonStyle.Secondary));
    const actionRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId('rr_wiz:back_list')
        .setLabel('⬅️ Back to Dashboard')
        .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId(`rr_wiz:publish:${panel.id}`)
        .setLabel('Publish Panel 📣')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(panel.mappings.length === 0), new ButtonBuilder()
        .setCustomId(`rr_wiz:delete:${panel.id}`)
        .setLabel('Delete Panel 🗑️')
        .setStyle(ButtonStyle.Danger));
    return { embed, components: [editRow, actionRow] };
}
export const reactRolesCommand = {
    data: new SlashCommandBuilder()
        .setName('reactroles')
        .setDescription('Create and manage reaction roles and self-assignable role panels')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand((sub) => sub
        .setName('template')
        .setDescription('Deploy a ready-to-use reaction roles panel template with one click')
        .addStringOption((opt) => opt
        .setName('template')
        .setDescription('The template to deploy')
        .setRequired(true)
        .addChoices({ name: '🔔 Notification Pings (News, Events, Updates, Giveaways, Resources, Minigames)', value: 'pings' }, { name: '🎮 Community Gaming Roles (Minecraft, Valorant, GTA, Roblox...)', value: 'gaming' }, { name: '🌐 Regional Roles (North America, Europe, Asia, Oceania...)', value: 'regions' }, { name: '💻 Platform Roles (PC, Mobile, Console)', value: 'platforms' }))
        .addChannelOption((opt) => opt
        .setName('channel')
        .setDescription('Channel to post the role panel in (defaults to current channel)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false))
        .addBooleanOption((opt) => opt
        .setName('auto_create_roles')
        .setDescription('Automatically create server roles if they do not exist (default: True)')
        .setRequired(false))
        .addStringOption((opt) => opt
        .setName('style')
        .setDescription('Display style for the role selector')
        .setRequired(false)
        .addChoices({ name: 'Buttons (Clean modern grid)', value: 'buttons' }, { name: 'Dropdown Menu (Select menu)', value: 'select' })))
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
        // 1. SUBCOMMAND: TEMPLATE
        if (subcommand === 'template') {
            await interaction.deferReply({ flags: EPH });
            const templateKey = interaction.options.getString('template', true);
            const template = ROLE_TEMPLATES[templateKey];
            if (!template) {
                await interaction.editReply({ content: '❌ Unknown template selected.' });
                return;
            }
            const targetChannel = interaction.options.getChannel('channel')
                ?? interaction.channel;
            if (!targetChannel || !targetChannel.isTextBased()) {
                await interaction.editReply({ content: '❌ Target text channel not found.' });
                return;
            }
            const autoCreate = interaction.options.getBoolean('auto_create_roles') ?? true;
            const style = interaction.options.getString('style') ?? 'buttons';
            // Resolve or create roles
            const mappings = [];
            const botMember = interaction.guild.members.me;
            for (const item of template.roles) {
                let role = interaction.guild.roles.cache.find((r) => r.name.toLowerCase() === item.name.toLowerCase());
                if (!role && autoCreate) {
                    if (botMember && !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                        await interaction.editReply({
                            content: '❌ I require the **Manage Roles** permission to automatically create roles.',
                        });
                        return;
                    }
                    try {
                        role = await interaction.guild.roles.create({
                            name: item.name,
                            color: item.color,
                            reason: `Reaction Roles: Auto-created for ${template.name}`,
                        });
                    }
                    catch (err) {
                        logger.error(`[ReactRoles] Failed to auto-create role ${item.name}:`, err);
                    }
                }
                if (role) {
                    mappings.push({
                        label: item.name,
                        emoji: item.emoji,
                        roleId: role.id,
                    });
                }
            }
            if (mappings.length === 0) {
                await interaction.editReply({
                    content: '❌ No roles could be resolved or created for this template. Check bot permissions.',
                });
                return;
            }
            const panelId = Math.random().toString(36).substring(2, 10);
            const panel = {
                id: panelId,
                title: template.title,
                description: template.description,
                style,
                mappings,
                channelId: targetChannel.id,
            };
            const payload = buildPublishedPanelPayload(panel, interaction.guild);
            const postedMsg = await targetChannel.send(payload).catch((err) => {
                logger.error('[ReactRoles] Failed to send published template panel:', err);
                return null;
            });
            if (!postedMsg) {
                await interaction.editReply({
                    content: `❌ Failed to send the panel into <#${targetChannel.id}>. Check my channel permissions.`,
                });
                return;
            }
            panel.messageId = postedMsg.id;
            // Automatically react with each emoji on the panel message
            for (const m of mappings) {
                if (m.emoji) {
                    await postedMsg.react(m.emoji).catch(() => { });
                }
            }
            // Save panel to guild config
            const config = await reactRolesSettings.get(interaction.guild.id);
            config.panels.push(panel);
            await reactRolesSettings.set(interaction.guild.id, config);
            const successEmbed = new EmbedBuilder()
                .setColor(0x10b981)
                .setTitle('🎉 Template Reaction Roles Panel Deployed!')
                .setDescription(`Successfully posted **${template.name}** into <#${targetChannel.id}>!\n\n` +
                `• **Roles Configured:** ${mappings.length}\n` +
                `• **Style:** ${style === 'buttons' ? 'Balanced Button Grid ⏹️' : 'Dropdown Menu ⬇️'}\n` +
                `• **Jump to Panel:** [View in Channel](${postedMsg.url})\n\n` +
                `Members can now immediately click to self-assign their roles!`)
                .setFooter({ text: 'Victus Cloud Reaction Roles' })
                .setTimestamp();
            await interaction.editReply({ embeds: [successEmbed] });
            return;
        }
        // 2. SUBCOMMAND: ADD (Emoji Reaction Role on Message)
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
            const botMember = interaction.guild.members.me;
            if (botMember && role.position >= botMember.roles.highest.position) {
                await interaction.editReply({
                    content: `⚠️ **Role Hierarchy Warning:** I cannot manage the role <@&${role.id}> because it is higher than or equal to my highest role. Please drag my bot role above <@&${role.id}> in Server Settings -> Roles!`,
                });
                return;
            }
            const targetMessage = await channel.messages.fetch(messageId).catch(() => null);
            if (!targetMessage) {
                await interaction.editReply({
                    content: `❌ Could not find message \`${messageId}\` in <#${channel.id}>. Make sure the ID and channel are correct.`,
                });
                return;
            }
            let reactSuccess = false;
            try {
                await targetMessage.react(rawEmoji);
                reactSuccess = true;
            }
            catch (err) {
                logger.warn(`[ReactRoles] Failed to react with emoji "${rawEmoji}":`, err);
            }
            const mapping = {
                messageId: targetMessage.id,
                channelId: channel.id,
                emoji: rawEmoji,
                roleId: role.id,
            };
            await reactRolesSettings.addReactionRole(interaction.guild.id, mapping);
            const embed = new EmbedBuilder()
                .setColor(0x10b981)
                .setTitle('✅ Reaction Role Added!')
                .setDescription(`Successfully linked **${rawEmoji}** to role <@&${role.id}> on [Target Message](${targetMessage.url})!\n\n` +
                `• **Channel:** <#${channel.id}>\n` +
                `• **Emoji:** ${rawEmoji}\n` +
                `• **Role:** <@&${role.id}>\n` +
                `• **Reaction Added by Bot:** ${reactSuccess ? '✅ Yes' : '⚠️ Please add the emoji reaction manually'}`)
                .setFooter({ text: 'Victus Cloud Reaction Roles' })
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
            return;
        }
        // 3. SUBCOMMAND: REMOVE
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
        // 4. SUBCOMMAND: LIST
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
                desc += `### 📋 Interactive Panels: *None created. Use \`/reactroles template\` or \`/reactroles setup\` to build one.*\n`;
            }
            embed.setDescription(desc.slice(0, 4000));
            await interaction.editReply({ embeds: [embed] });
            return;
        }
        // 5. SUBCOMMAND: SETUP (Interactive Dashboard)
        if (subcommand === 'setup') {
            const config = await reactRolesSettings.get(interaction.guild.id);
            const { embed, components } = renderDashboardEmbed(config, interaction.guild.name);
            await interaction.reply({
                embeds: [embed],
                components,
                flags: EPH,
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
            if (action === 'tpl_pings') {
                // Quick Deploy Pings Template
                await interaction.deferUpdate();
                const template = ROLE_TEMPLATES.pings;
                const mappings = [];
                for (const item of template.roles) {
                    let role = interaction.guild.roles.cache.find((r) => r.name.toLowerCase() === item.name.toLowerCase());
                    if (!role) {
                        try {
                            role = await interaction.guild.roles.create({
                                name: item.name,
                                color: item.color,
                                reason: 'Reaction Roles: Quick deploy template',
                            });
                        }
                        catch { }
                    }
                    if (role) {
                        mappings.push({ label: item.name, emoji: item.emoji, roleId: role.id });
                    }
                }
                const panelId = Math.random().toString(36).substring(2, 10);
                const panel = {
                    id: panelId,
                    title: template.title,
                    description: template.description,
                    style: 'buttons',
                    mappings,
                    channelId: interaction.channelId,
                };
                const payload = buildPublishedPanelPayload(panel, interaction.guild);
                const posted = await interaction.channel.send(payload).catch(() => null);
                if (posted) {
                    panel.messageId = posted.id;
                    config.panels.push(panel);
                    await reactRolesSettings.set(guildId, config);
                    // Automatically react with each emoji on the panel message
                    for (const m of mappings) {
                        if (m.emoji) {
                            await posted.react(m.emoji).catch(() => { });
                        }
                    }
                    const { embed, components } = renderDashboardEmbed(config, interaction.guild.name);
                    await interaction.editReply({
                        embeds: [embed],
                        components,
                    });
                }
                return;
            }
            if (action === 'create') {
                const modal = new ModalBuilder()
                    .setCustomId('rr_wiz_modal:create')
                    .setTitle('Create Reaction Roles Panel');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
                    .setCustomId('title')
                    .setLabel('Panel Title')
                    .setPlaceholder('Reaction Roles!')
                    .setValue('Reaction Roles!')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder()
                    .setCustomId('description')
                    .setLabel('Panel Description')
                    .setPlaceholder('Take your roles to be notified faster and never miss anything important.')
                    .setValue('Take your roles to be notified faster and never miss anything important.')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)));
                await interaction.showModal(modal);
            }
            else if (action === 'back_list') {
                await interaction.deferUpdate();
                const { embed, components } = renderDashboardEmbed(config, interaction.guild.name);
                await interaction.editReply({
                    embeds: [embed],
                    components,
                });
            }
            else if (action === 'toggle_style') {
                const panelId = interaction.customId.split(':')[2];
                const panel = config.panels.find((p) => p.id === panelId);
                if (panel) {
                    panel.style = panel.style === 'buttons' ? 'select' : 'buttons';
                    await reactRolesSettings.set(guildId, config);
                    await interaction.deferUpdate();
                    const { embed, components } = renderPanelEditorEmbed(panel);
                    await interaction.editReply({
                        embeds: [embed],
                        components,
                    });
                }
            }
            else if (action === 'delete') {
                const panelId = interaction.customId.split(':')[2];
                const updatedPanels = config.panels.filter((p) => p.id !== panelId);
                await reactRolesSettings.set(guildId, { panels: updatedPanels });
                const newConfig = await reactRolesSettings.get(guildId);
                await interaction.deferUpdate();
                const { embed, components } = renderDashboardEmbed(newConfig, interaction.guild.name);
                await interaction.editReply({
                    embeds: [embed],
                    components,
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
                    .setPlaceholder('Newz Ping')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder()
                    .setCustomId('roleId')
                    .setLabel('Discord Role ID (Right-click role -> Copy ID)')
                    .setPlaceholder('123456789012345678')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder()
                    .setCustomId('emoji')
                    .setLabel('Emoji (e.g. 🌍, 🐳, 🍁, 🦖)')
                    .setPlaceholder('🌍')
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
                    await interaction.deferUpdate();
                    const payload = buildPublishedPanelPayload(panel, interaction.guild);
                    const postedMsg = await interaction.channel.send(payload).catch(() => null);
                    if (postedMsg) {
                        panel.messageId = postedMsg.id;
                        panel.channelId = interaction.channelId;
                        await reactRolesSettings.set(guildId, config);
                        // Automatically react with each emoji on the panel message
                        for (const m of panel.mappings) {
                            if (m.emoji) {
                                await postedMsg.react(m.emoji).catch(() => { });
                            }
                        }
                        const confirmEmbed = new EmbedBuilder()
                            .setColor(0x10b981)
                            .setTitle('✅ Role Panel Published!')
                            .setDescription(`The role panel has been published into <#${interaction.channelId}>! [View Panel](${postedMsg.url})`);
                        await interaction.editReply({
                            embeds: [confirmEmbed],
                            components: [],
                        });
                    }
                    else {
                        await interaction.followUp({
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
            const member = interaction.guild.members.cache.get(interaction.user.id)
                || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
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
                const hasRole = member.roles.cache.has(mapping.roleId);
                if (hasRole) {
                    await member.roles.remove(mapping.roleId, 'Reaction Role: Self-unassigned');
                    await interaction.reply({
                        content: `❌ Removed the **@${targetRole.name}** role from you.`,
                        flags: EPH,
                    });
                }
                else {
                    await member.roles.add(mapping.roleId, 'Reaction Role: Self-assigned');
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
                await interaction.deferUpdate();
                const { embed, components } = renderPanelEditorEmbed(panel);
                await interaction.editReply({
                    embeds: [embed],
                    components,
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
            const member = interaction.guild.members.cache.get(interaction.user.id)
                || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
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
                const hasRole = member.roles.cache.has(mapping.roleId);
                if (hasRole) {
                    await member.roles.remove(mapping.roleId, 'Reaction Role: Self-unassigned');
                    await interaction.reply({
                        content: `❌ Removed the **@${targetRole.name}** role from you.`,
                        flags: EPH,
                    });
                }
                else {
                    await member.roles.add(mapping.roleId, 'Reaction Role: Self-assigned');
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
            await interaction.deferUpdate();
            const { embed, components } = renderPanelEditorEmbed(newPanel);
            await interaction.editReply({
                embeds: [embed],
                components,
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
                const { embed, components } = renderPanelEditorEmbed(panel);
                await interaction.editReply({
                    embeds: [embed],
                    components,
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
                const { embed, components } = renderPanelEditorEmbed(panel);
                await interaction.editReply({
                    embeds: [embed],
                    components,
                });
            }
        }
    },
};
export default reactRolesCommand;
