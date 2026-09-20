import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    ChatInputCommandInteraction,
    ButtonInteraction,
    Guild,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { antiNukeSettings, AntiNukeConfig } from '../services/antiNukeSettings.js';
import { extraOwnerSettings } from '../services/extraOwnerSettings.js';
import { canManageSecurity } from '../utils/securityAuth.js';
import { supabase } from '../services/supabase.js';
import { logger } from '../utils/logger.js';

// Pastel / Ice Aesthetic Palette
const ICE_PALETTE = {
    frost: 0x00d2ff,      // Vivid Cyan
    glacier: 0x38bdf8,    // Vivid Ice
    deepGlacier: 0x0284c7, // Accent Blue
    unauthorized: 0xef4444, // Vivid Red
};

/**
 * Generate the high-tech cybersecurity Status Display Embed for the control panel.
 */
async function buildControlPanelEmbed(config: AntiNukeConfig, cussFilterEnabled: boolean, guild: Guild, isGravUser: boolean): Promise<EmbedBuilder> {
    const extraOwners = await extraOwnerSettings.get(guild.id);
    const activeCount = [
        config.anti_kick,
        config.anti_ban,
        config.anti_ban_remove,
        config.anti_channel_create,
        config.anti_channel_delete,
        config.anti_role_create,
        config.anti_role_delete,
        config.anti_role_update,
        config.anti_emoji_delete,
        config.anti_sticker_delete,
        config.anti_guild_update,
    ].filter(Boolean).length;

    const extraOwnerSummary = `${extraOwners.users.length} Users · ${extraOwners.roles.length} Roles`;

    return new EmbedBuilder()
        .setColor(config.enabled ? 0x00d2ff : 0x64748b)
        .setTitle('🛡️ VICTUS ANTI-NUKE DEFENSE CONSOLE')
        .setDescription(
            `Autonomous server protection system for **${guild.name}**.\n\n` +
            `### 🎛️ Master Defense\n` +
            `> **System Status:** ${config.enabled ? '🟢 **ONLINE & ARMED**' : '🔴 **OFFLINE (DISABLED)**'}\n` +
            `> **Shield Capacity:** \`${activeCount}/11 Modules Armed\`\n` +
            `> **Extra Owners:** \`${extraOwnerSummary}\` *(Manage with \`/extraowner\`)*\n` +
            `> **Access Tier:** ${isGravUser ? '👑 **Primary Owner (Grav)**' : '🛡️ **Authorized Extra Owner**'}\n\n` +
            `### 🔒 Security Shield Modules\n` +
            `› **Anti-Kick:** ${config.anti_kick ? '🛡️ `ACTIVE`' : '⚫ `INACTIVE`'}\n` +
            `› **Anti-Ban:** ${config.anti_ban ? '🔨 `ACTIVE`' : '⚫ `INACTIVE`'}\n` +
            `› **Anti-BanRemove:** ${config.anti_ban_remove ? '🔓 `ACTIVE`' : '⚫ `INACTIVE`'}\n` +
            `› **Anti-ChannelCreate:** ${config.anti_channel_create ? '➕ `ACTIVE`' : '⚫ `INACTIVE`'}\n` +
            `› **Anti-ChannelDelete:** ${config.anti_channel_delete ? '❌ `ACTIVE`' : '⚫ `INACTIVE`'}\n` +
            `› **Anti-RoleCreate:** ${config.anti_role_create ? '🎭 `ACTIVE`' : '⚫ `INACTIVE`'}\n` +
            `› **Anti-RoleDelete:** ${config.anti_role_delete ? '🗑️ `ACTIVE`' : '⚫ `INACTIVE`'}\n` +
            `› **Anti-RoleUpdate:** ${config.anti_role_update ? '📝 `ACTIVE`' : '⚫ `INACTIVE`'}\n` +
            `› **Anti-EmojiDelete:** ${config.anti_emoji_delete ? '😀 `ACTIVE`' : '⚫ `INACTIVE`'}\n` +
            `› **Anti-StickerDelete:** ${config.anti_sticker_delete ? '🏷️ `ACTIVE`' : '⚫ `INACTIVE`'}\n` +
            `› **Anti-GuildUpdate:** ${config.anti_guild_update ? '🌐 `ACTIVE`' : '⚫ `INACTIVE`'}\n\n` +
            `### 🤬 Content Moderation\n` +
            `› **Cuss Word Filter:** ${cussFilterEnabled ? '🛡️ `ACTIVE (Multilingual DB)`' : '⚫ `INACTIVE`'}\n\n` +
            `-# 🔒 Restricted to Grav & Extra Owners • Configure extra owners with \`/extraowner\``
        )
        .setFooter({ text: 'Victus Cloud Advanced Guild Defense System', iconURL: 'https://victuscloud.com/favicon.png' })
        .setTimestamp();
}

/**
 * Generate components layout with a multi-select dropdown menu and control buttons.
 */
function buildControlPanelComponents(config: AntiNukeConfig, cussFilterEnabled: boolean): ActionRowBuilder<any>[] {
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('antinuke:select')
        .setPlaceholder('Select protections to assign...')
        .setMinValues(0)
        .setMaxValues(12)
        .addOptions([
            {
                label: 'Anti-Kick',
                value: 'anti_kick',
                emoji: '👢',
                description: 'Prevent unauthorized kicking of members',
                default: config.anti_kick,
            },
            {
                label: 'Anti-Ban',
                value: 'anti_ban',
                emoji: '🔨',
                description: 'Prevent unauthorized banning of members',
                default: config.anti_ban,
            },
            {
                label: 'Anti-BanRemove',
                value: 'anti_ban_remove',
                emoji: '🔓',
                description: 'Prevent unauthorized unbanning of members',
                default: config.anti_ban_remove,
            },
            {
                label: 'Anti-ChannelCreate',
                value: 'anti_channel_create',
                emoji: '➕',
                description: 'Prevent unauthorized channel creation',
                default: config.anti_channel_create,
            },
            {
                label: 'Anti-ChannelDelete',
                value: 'anti_channel_delete',
                emoji: '❌',
                description: 'Prevent unauthorized channel deletion',
                default: config.anti_channel_delete,
            },
            {
                label: 'Anti-RoleCreate',
                value: 'anti_role_create',
                emoji: '🎭',
                description: 'Prevent unauthorized role creation',
                default: config.anti_role_create,
            },
            {
                label: 'Anti-RoleDelete',
                value: 'anti_role_delete',
                emoji: '🗑️',
                description: 'Prevent unauthorized role deletion',
                default: config.anti_role_delete,
            },
            {
                label: 'Anti-RoleUpdate',
                value: 'anti_role_update',
                emoji: '📝',
                description: 'Prevent unauthorized role modifications',
                default: config.anti_role_update,
            },
            {
                label: 'Anti-EmojiDelete',
                value: 'anti_emoji_delete',
                emoji: '😀',
                description: 'Prevent unauthorized emoji deletion',
                default: config.anti_emoji_delete,
            },
            {
                label: 'Anti-StickerDelete',
                value: 'anti_sticker_delete',
                emoji: '🏷️',
                description: 'Prevent unauthorized sticker deletion',
                default: config.anti_sticker_delete,
            },
            {
                label: 'Anti-GuildUpdate',
                value: 'anti_guild_update',
                emoji: '🌐',
                description: 'Prevent unauthorized server modification',
                default: config.anti_guild_update,
            },
            {
                label: 'Cuss Word Filter',
                value: 'cuss_filter',
                emoji: '🤬',
                description: 'Enable or disable multilingual bad-word filter',
                default: cussFilterEnabled,
            },
        ]);

    const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('antinuke:toggle:enabled')
            .setLabel(`Master Shield: ${config.enabled ? 'ONLINE ✅' : 'OFFLINE ❌'}`)
            .setStyle(config.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('antinuke:save')
            .setLabel('Save & Close 🛡️')
            .setStyle(ButtonStyle.Primary)
    );

    return [row1, row2];
}

export const antinukeCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('antinuke')
        .setDescription('Configure server Anti-Nuke protections (Grav & Extra Owners only)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guild) {
            await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const member = interaction.guild.members.cache.get(interaction.user.id) || null;
        const auth = await canManageSecurity(interaction.user, interaction.client, interaction.guild, member);

        if (!auth.authorized) {
            const unauthorizedEmbed = new EmbedBuilder()
                .setColor(ICE_PALETTE.unauthorized)
                .setTitle('🚫 Access Denied — Grav / Extra Owner Restricted')
                .setDescription(
                    `You do not have permission to access the Anti-Nuke console.\n\n` +
                    `> **Security Policy:** Only **Grav** (Primary Owner) or designated **Extra Owners** can configure Anti-Nuke protections.\n\n` +
                    `-# If you should have access, ask Grav to designate you or your staff role using \`/extraowner add\`.`
                )
                .setFooter({ text: 'Victus Cloud Security Gateway' })
                .setTimestamp();

            await interaction.editReply({
                embeds: [unauthorizedEmbed],
            });
            return;
        }

        const guildId = interaction.guildId!;
        const antinukeConfig = await antiNukeSettings.get(guildId);
        const botSettings = await supabase.getBotSettings(guildId).catch(() => null);
        const cussFilterEnabled = botSettings?.moderation_enabled ?? false;

        const embed = await buildControlPanelEmbed(antinukeConfig, cussFilterEnabled, interaction.guild, auth.isGrav);
        const components = buildControlPanelComponents(antinukeConfig, cussFilterEnabled);

        await interaction.editReply({
            embeds: [embed],
            components,
        });
    },

    async handleButton(interaction: ButtonInteraction) {
        if (!interaction.customId.startsWith('antinuke:toggle:') && interaction.customId !== 'antinuke:save') return;
        if (!interaction.guild) return;

        await interaction.deferUpdate();

        const member = interaction.guild.members.cache.get(interaction.user.id) || null;
        const auth = await canManageSecurity(interaction.user, interaction.client, interaction.guild, member);

        if (!auth.authorized) {
            await interaction.followUp({
                content: '❌ Access Denied: Only Grav and designated Extra Owners can modify Anti-Nuke settings.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const guildId = interaction.guildId!;

        if (interaction.customId === 'antinuke:save') {
            const antinukeConfig = await antiNukeSettings.get(guildId);
            const botSettings = await supabase.getBotSettings(guildId).catch(() => null);
            const cussFilterEnabled = botSettings?.moderation_enabled ?? false;

            const finalEmbed = await buildControlPanelEmbed(antinukeConfig, cussFilterEnabled, interaction.guild, auth.isGrav);
            finalEmbed.setTitle('🛡️ VICTUS ANTI-NUKE SETTINGS SAVED & ARMED');

            await interaction.editReply({
                embeds: [finalEmbed],
                components: [],
            });
            return;
        }

        const targetToggle = interaction.customId.split(':')[2];

        const antinukeConfig = await antiNukeSettings.get(guildId);
        const botSettings = await supabase.getBotSettings(guildId).catch(() => null);
        let cussFilterEnabled = botSettings?.moderation_enabled ?? false;

        let updatedConfig = antinukeConfig;
        if (targetToggle === 'enabled') {
            updatedConfig = await antiNukeSettings.set(guildId, { enabled: !antinukeConfig.enabled });
        } else if (targetToggle === 'cuss_filter') {
            cussFilterEnabled = !cussFilterEnabled;
            await supabase.updateBotSettings(guildId, {
                moderation_enabled: cussFilterEnabled,
            });
        } else {
            const key = targetToggle as keyof AntiNukeConfig;
            if (key in antinukeConfig) {
                const updatedVal = !antinukeConfig[key];
                updatedConfig = await antiNukeSettings.set(guildId, { [key]: updatedVal });
            }
        }

        const embed = await buildControlPanelEmbed(updatedConfig, cussFilterEnabled, interaction.guild, auth.isGrav);
        const components = buildControlPanelComponents(updatedConfig, cussFilterEnabled);

        await interaction.editReply({
            embeds: [embed],
            components,
        });
    },

    async handleSelectMenu(interaction: StringSelectMenuInteraction) {
        if (interaction.customId !== 'antinuke:select') return;
        if (!interaction.guild) return;

        await interaction.deferUpdate();

        const member = interaction.guild.members.cache.get(interaction.user.id) || null;
        const auth = await canManageSecurity(interaction.user, interaction.client, interaction.guild, member);

        if (!auth.authorized) {
            await interaction.followUp({
                content: '❌ Access Denied: Only Grav and designated Extra Owners can modify Anti-Nuke settings.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const guildId = interaction.guildId!;
        const selectedValues = interaction.values;

        const updatedConfig: Partial<AntiNukeConfig> = {
            anti_kick: selectedValues.includes('anti_kick'),
            anti_ban: selectedValues.includes('anti_ban'),
            anti_ban_remove: selectedValues.includes('anti_ban_remove'),
            anti_channel_create: selectedValues.includes('anti_channel_create'),
            anti_channel_delete: selectedValues.includes('anti_channel_delete'),
            anti_role_create: selectedValues.includes('anti_role_create'),
            anti_role_delete: selectedValues.includes('anti_role_delete'),
            anti_role_update: selectedValues.includes('anti_role_update'),
            anti_emoji_delete: selectedValues.includes('anti_emoji_delete'),
            anti_sticker_delete: selectedValues.includes('anti_sticker_delete'),
            anti_guild_update: selectedValues.includes('anti_guild_update'),
        };

        const currentConfig = await antiNukeSettings.set(guildId, updatedConfig);

        const cussFilterEnabled = selectedValues.includes('cuss_filter');
        await supabase.updateBotSettings(guildId, {
            moderation_enabled: cussFilterEnabled,
        });

        const embed = await buildControlPanelEmbed(currentConfig, cussFilterEnabled, interaction.guild, auth.isGrav);
        const components = buildControlPanelComponents(currentConfig, cussFilterEnabled);

        await interaction.editReply({
            embeds: [embed],
            components,
        });
    }
};

export default antinukeCommand;
