import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, } from 'discord.js';
import { whitelistSettings } from '../services/whitelistSettings.js';
import { canManageSecurity } from '../utils/securityAuth.js';
// Vivid Cyber Ice Palette
const ICE_PALETTE = {
    frost: 0x00d2ff, // Vivid Cyan
    glacier: 0x38bdf8, // Vivid Ice
    deepGlacier: 0x0284c7, // Accent Blue
    unauthorized: 0xef4444, // Vivid Red
};
/**
 * Generate a beautifully styled, high-info Whitelist Editor Embed card.
 */
function buildEditorEmbed(selectedUserId, username, categories, addedBy) {
    const activeList = [];
    if (categories.includes('ban'))
        activeList.push('• 🔨 **Ban Immunity** *(Cannot be banned by anti-nuke or auto-mod)*');
    if (categories.includes('kick'))
        activeList.push('• 👢 **Kick Immunity** *(Cannot be kicked)*');
    if (categories.includes('timeout'))
        activeList.push('• ⏳ **Timeout/Mute Immunity** *(Cannot be timed out)*');
    if (categories.includes('warn'))
        activeList.push('• ⚠️ **Warning Immunity** *(Bypasses warnings)*');
    const activeText = activeList.length > 0 ? activeList.join('\n') : '• *No active immunities assigned.*';
    return new EmbedBuilder()
        .setColor(ICE_PALETTE.frost)
        .setTitle(`🛡️ WHITELIST EDITOR: @${username}`)
        .setDescription(`Configure bypass immunities and security exemptions for this member.\n\n` +
        `### 👤 Member Details\n` +
        `> **Target:** <@${selectedUserId}>\n` +
        `> **ID:** \`${selectedUserId}\`\n` +
        `> **Authorized By:** <@${addedBy}>\n\n` +
        `### 🛡️ Active Immunities\n` +
        `${activeText}\n\n` +
        `-# 🔒 Whitelist permissions managed by Grav & Extra Owners`)
        .setFooter({ text: 'Victus Cloud Security Gateway', iconURL: 'https://victuscloud.com/favicon.png' })
        .setTimestamp();
}
export const whitelistCommand = {
    data: new SlashCommandBuilder()
        .setName('whitelist')
        .setDescription('Manage bypass immunities and filters for users (Grav & Extra Owners only)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.deferReply({ ephemeral: true });
        const member = interaction.guild.members.cache.get(interaction.user.id) || null;
        const auth = await canManageSecurity(interaction.user, interaction.client, interaction.guild, member);
        if (!auth.authorized) {
            const unauthorizedEmbed = new EmbedBuilder()
                .setColor(ICE_PALETTE.unauthorized)
                .setTitle('🚫 Access Denied — Grav / Extra Owner Restricted')
                .setDescription(`You do not have permission to manage the Whitelist.\n\n` +
                `> **Security Policy:** Only **Grav** (Primary Owner) or designated **Extra Owners** can configure Whitelist immunities.\n\n` +
                `-# If you should have access, ask Grav to designate you or your staff role using \`/extraowner add\`.`)
                .setFooter({ text: 'Victus Cloud Security Gateway' })
                .setTimestamp();
            await interaction.editReply({
                embeds: [unauthorizedEmbed],
            });
            return;
        }
        const initialEmbed = new EmbedBuilder()
            .setColor(ICE_PALETTE.frost)
            .setTitle('🛡️ VICTUS WHITELIST SECURITY CONSOLE')
            .setDescription(`Select a member using the dropdown menu below to configure or view their bypass immunities.\n\n` +
            `> **Authorized User:** <@${interaction.user.id}> (${auth.isGrav ? '👑 Primary Owner' : '🛡️ Extra Owner'})\n` +
            `> **Scope:** Guild Security Exemptions\n\n` +
            `Whitelisted users are exempt from anti-nuke kick/ban thresholds and chat moderation filters.`)
            .setFooter({ text: 'Victus Cloud Security Operations', iconURL: 'https://victuscloud.com/favicon.png' })
            .setTimestamp();
        const userSelectRow = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder()
            .setCustomId('whitelist:user-select')
            .setPlaceholder('Select a member to configure whitelist...')
            .setMinValues(1)
            .setMaxValues(1));
        await interaction.editReply({
            embeds: [initialEmbed],
            components: [userSelectRow],
        });
    },
    async handleButton(interaction) {
        if (!interaction.customId.startsWith('whitelist:'))
            return;
        if (!interaction.guild)
            return;
        await interaction.deferUpdate();
        const member = interaction.guild.members.cache.get(interaction.user.id) || null;
        const auth = await canManageSecurity(interaction.user, interaction.client, interaction.guild, member);
        if (!auth.authorized) {
            await interaction.followUp({
                content: '❌ Access Denied: Only Grav and designated Extra Owners can modify Whitelist settings.',
                ephemeral: true,
            });
            return;
        }
        const selectedUserId = interaction.customId.split(':')[2];
        const selectedUser = await interaction.client.users.fetch(selectedUserId).catch(() => null);
        const guildId = interaction.guild.id;
        const whitelistConfig = await whitelistSettings.get(guildId);
        if (interaction.customId.startsWith('whitelist:save-perms:')) {
            const record = whitelistConfig.users.find((u) => u.userId === selectedUserId) || {
                userId: selectedUserId,
                userName: selectedUser?.username || 'Unknown',
                categories: [],
            };
            const finalEmbed = new EmbedBuilder()
                .setColor(ICE_PALETTE.glacier)
                .setTitle('🛡️ Whitelist Settings Saved')
                .setDescription(`Bypass immunities for <@${selectedUserId}> have been successfully updated.\n\n` +
                `### 👤 Member Details\n` +
                `› **User:** <@${selectedUserId}> (${selectedUser?.username || 'Unknown'})\n` +
                `› **ID:** \`${selectedUserId}\`\n\n` +
                `### 📋 Active Immunities\n` +
                `${record.categories.includes('ban') ? '✅' : '❌'} Ban Immunity\n` +
                `${record.categories.includes('kick') ? '✅' : '❌'} Kick Immunity\n` +
                `${record.categories.includes('timeout') ? '✅' : '❌'} Timeout/Mute Immunity\n` +
                `${record.categories.includes('warn') ? '✅' : '❌'} Warning Immunity\n\n` +
                `-# Changes active immediately across all server channels.`)
                .setFooter({ text: 'Victus Cloud Security Gateway', iconURL: 'https://victuscloud.com/favicon.png' })
                .setTimestamp();
            await interaction.editReply({
                embeds: [finalEmbed],
                components: [],
            });
        }
        else if (interaction.customId.startsWith('whitelist:remove:')) {
            whitelistConfig.users = whitelistConfig.users.filter((u) => u.userId !== selectedUserId);
            await whitelistSettings.set(guildId, whitelistConfig);
            const removalEmbed = new EmbedBuilder()
                .setColor(0xef4444)
                .setTitle('🗑️ Whitelist Entry Cleared')
                .setDescription(`Bypass immunities for <@${selectedUserId}> have been completely removed.\n\n` +
                `› **User:** <@${selectedUserId}> (${selectedUser?.username || 'Unknown'})\n` +
                `› **ID:** \`${selectedUserId}\`\n\n` +
                `This user is no longer on the whitelist and is now fully subject to all Anti-Nuke protections and moderation rules.`)
                .setFooter({ text: 'Victus Cloud Security Gateway', iconURL: 'https://victuscloud.com/favicon.png' })
                .setTimestamp();
            await interaction.editReply({
                embeds: [removalEmbed],
                components: [],
            });
        }
    },
    async handleSelectMenu(interaction) {
        if (!interaction.customId.startsWith('whitelist:'))
            return;
        if (!interaction.guild)
            return;
        await interaction.deferUpdate();
        const member = interaction.guild.members.cache.get(interaction.user.id) || null;
        const auth = await canManageSecurity(interaction.user, interaction.client, interaction.guild, member);
        if (!auth.authorized) {
            await interaction.followUp({
                content: '❌ Access Denied: Only Grav and designated Extra Owners can modify Whitelist settings.',
                ephemeral: true,
            });
            return;
        }
        const guildId = interaction.guild.id;
        if (interaction.customId === 'whitelist:user-select') {
            const selectedUserId = interaction.values[0];
            const selectedUser = await interaction.client.users.fetch(selectedUserId).catch(() => null);
            if (!selectedUser) {
                await interaction.followUp({
                    content: '❌ Could not find the selected user.',
                    ephemeral: true,
                });
                return;
            }
            const whitelistConfig = await whitelistSettings.get(guildId);
            const record = whitelistConfig.users.find((u) => u.userId === selectedUserId) || {
                userId: selectedUserId,
                userName: selectedUser.username,
                categories: [],
                addedBy: interaction.user.id,
                timestamp: new Date().toISOString(),
            };
            const permsEmbed = buildEditorEmbed(selectedUserId, selectedUser.username, record.categories, record.addedBy || interaction.user.id);
            const permsSelectRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
                .setCustomId(`whitelist:perms-select:${selectedUserId}`)
                .setPlaceholder('Select immunities to assign...')
                .setMinValues(1)
                .setMaxValues(4)
                .addOptions([
                {
                    label: 'Ban Immunity',
                    value: 'ban',
                    emoji: '🔨',
                    description: 'Prevent user from being banned by anti-nuke',
                    default: record.categories.includes('ban'),
                },
                {
                    label: 'Kick Immunity',
                    value: 'kick',
                    emoji: '👢',
                    description: 'Prevent user from being kicked',
                    default: record.categories.includes('kick'),
                },
                {
                    label: 'Timeout/Mute Immunity',
                    value: 'timeout',
                    emoji: '⏳',
                    description: 'Prevent user from being timed out',
                    default: record.categories.includes('timeout'),
                },
                {
                    label: 'Warning Immunity',
                    value: 'warn',
                    emoji: '⚠️',
                    description: 'Prevent user from receiving warnings',
                    default: record.categories.includes('warn'),
                },
            ]));
            const saveButtonRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
                .setCustomId(`whitelist:save-perms:${selectedUserId}`)
                .setLabel('Save Settings ✅')
                .setStyle(ButtonStyle.Success), new ButtonBuilder()
                .setCustomId(`whitelist:remove:${selectedUserId}`)
                .setLabel('Remove Whitelist 🗑️')
                .setStyle(ButtonStyle.Danger));
            await interaction.editReply({
                embeds: [permsEmbed],
                components: [permsSelectRow, saveButtonRow],
            });
        }
        else if (interaction.customId.startsWith('whitelist:perms-select:')) {
            const selectedUserId = interaction.customId.split(':')[2];
            const selectedUser = await interaction.client.users.fetch(selectedUserId).catch(() => null);
            if (!selectedUser) {
                await interaction.followUp({
                    content: '❌ Could not find the selected user.',
                    ephemeral: true,
                });
                return;
            }
            const selectedValues = interaction.values;
            const whitelistConfig = await whitelistSettings.get(guildId);
            let record = whitelistConfig.users.find((u) => u.userId === selectedUserId);
            if (!record) {
                record = {
                    userId: selectedUserId,
                    userName: selectedUser.username,
                    categories: selectedValues,
                    addedBy: interaction.user.id,
                    timestamp: new Date().toISOString(),
                };
                whitelistConfig.users.push(record);
            }
            else {
                const preservedCategories = record.categories.filter((c) => !['ban', 'kick', 'timeout', 'warn'].includes(c));
                record.categories = [...preservedCategories, ...selectedValues];
            }
            await whitelistSettings.set(guildId, whitelistConfig);
            const permsEmbed = buildEditorEmbed(selectedUserId, selectedUser.username, record.categories, record.addedBy || interaction.user.id);
            const permsSelectRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
                .setCustomId(`whitelist:perms-select:${selectedUserId}`)
                .setPlaceholder('Select immunities to assign...')
                .setMinValues(1)
                .setMaxValues(4)
                .addOptions([
                {
                    label: 'Ban Immunity',
                    value: 'ban',
                    emoji: '🔨',
                    description: 'Prevent user from being banned by anti-nuke',
                    default: record.categories.includes('ban'),
                },
                {
                    label: 'Kick Immunity',
                    value: 'kick',
                    emoji: '👢',
                    description: 'Prevent user from being kicked',
                    default: record.categories.includes('kick'),
                },
                {
                    label: 'Timeout/Mute Immunity',
                    value: 'timeout',
                    emoji: '⏳',
                    description: 'Prevent user from being timed out',
                    default: record.categories.includes('timeout'),
                },
                {
                    label: 'Warning Immunity',
                    value: 'warn',
                    emoji: '⚠️',
                    description: 'Prevent user from receiving warnings',
                    default: record.categories.includes('warn'),
                },
            ]));
            const saveButtonRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
                .setCustomId(`whitelist:save-perms:${selectedUserId}`)
                .setLabel('Save Settings ✅')
                .setStyle(ButtonStyle.Success), new ButtonBuilder()
                .setCustomId(`whitelist:remove:${selectedUserId}`)
                .setLabel('Remove Whitelist 🗑️')
                .setStyle(ButtonStyle.Danger));
            await interaction.editReply({
                embeds: [permsEmbed],
                components: [permsSelectRow, saveButtonRow],
            });
        }
    },
};
export default whitelistCommand;
