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
} from 'discord.js';
import type { Command } from '../types/index.js';
import { antiNukeSettings, AntiNukeConfig } from '../services/antiNukeSettings.js';
import { whitelistSettings } from '../services/whitelistSettings.js';
import { supabase } from '../services/supabase.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

// Pastel / Ice Aesthetic Palette
const ICE_PALETTE = {
    frost: 0x7dd3fc,      // Soft Sky / Ice Blue
    glacier: 0x38bdf8,    // Vivid Ice
    deepGlacier: 0x0284c7, // Accent Blue
    unauthorized: 0xf87171, // Soft Pastel Red
};

/**
 * Check if the invoking user is authorized to manage Anti-Nuke settings.
 * Checks for Server Owner, Server Administrator, or Bot Application Owner/Staff.
 */
async function isAuthorized(interaction: any): Promise<boolean> {
    const userId = interaction.user.id;
    const guild = interaction.guild;
    if (!guild) return false;

    // 1. Server Owner & Guild Administrator checks
    if (guild.ownerId === userId) return true;
    if (interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return true;

    // 2. Check Discord Application Owner / Team Member (Super Owner)
    try {
        const app = interaction.client.application;
        const application = typeof app?.fetch === 'function' ? await app.fetch().catch(() => app) : app;
        const owner = application?.owner || app?.owner;
        if (owner) {
            if ('id' in owner && owner.id === userId) return true;
            if ('members' in (owner as any) && (owner as any).members?.has?.(userId)) return true;
        }
    } catch (err) {
        logger.debug('[AntiNuke] Error fetching application owner:', err);
    }

    // 3. Evaluate Support Guild permissions / roles
    const supportGuildId = config.bot.supportGuildId || config.discord.guildId;
    if (supportGuildId) {
        const supportGuild = await interaction.client.guilds.fetch(supportGuildId).catch(() => null);
        if (supportGuild) {
            const member = await supportGuild.members.fetch(userId).catch(() => null);
            if (member) {
                if (member.roles.cache.has('1392801771474259989')) return true;
                if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
                
                const settings = await supabase.getBotSettings(supportGuild.id).catch(() => null);
                const adminRoleIds = (settings?.ticket_admin_role_ids || []) as string[];
                if (adminRoleIds.some((roleId) => member.roles.cache.has(roleId))) return true;
            }
        }
    }

    // 4. Supabase Platform Admin check
    try {
        const isPlatformAdmin = await supabase.isUserAdmin(userId).catch(() => false);
        if (isPlatformAdmin) return true;
    } catch (err) {
        logger.debug('[AntiNuke] Error checking Supabase admin:', err);
    }

    return false;
}

/**
 * Generate the Status Display Embed for the control panel.
 */
function buildControlPanelEmbed(config: AntiNukeConfig, cussFilterEnabled: boolean, guildName: string): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(ICE_PALETTE.frost)
        .setTitle('🛡️ Victus Anti-Nuke Control Panel')
        .setDescription(
            `Configure Anti-Nuke security protections for **${guildName}**.\n\n` +
            `Use the interactive switches below to toggle individual security modules.\n\n` +
            `### 🎛️ Master Status\n` +
            `> **System Status:** ${config.enabled ? '🟢 ON' : '⚫ OFF'}\n\n` +
            `### 🔒 Active Shields\n` +
            `› **Anti-Kick:** ${config.anti_kick ? '✅ ON' : '❌ OFF'}\n` +
            `› **Anti-Ban:** ${config.anti_ban ? '✅ ON' : '❌ OFF'}\n` +
            `› **Anti-BanRemove:** ${config.anti_ban_remove ? '✅ ON' : '❌ OFF'}\n` +
            `› **Anti-ChannelCreate:** ${config.anti_channel_create ? '✅ ON' : '❌ OFF'}\n` +
            `› **Anti-ChannelDelete:** ${config.anti_channel_delete ? '✅ ON' : '❌ OFF'}\n` +
            `› **Anti-RoleCreate:** ${config.anti_role_create ? '✅ ON' : '❌ OFF'}\n` +
            `› **Anti-RoleDelete:** ${config.anti_role_delete ? '✅ ON' : '❌ OFF'}\n` +
            `› **Anti-RoleUpdate:** ${config.anti_role_update ? '✅ ON' : '❌ OFF'}\n` +
            `› **Anti-EmojiDelete:** ${config.anti_emoji_delete ? '✅ ON' : '❌ OFF'}\n` +
            `› **Anti-StickerDelete:** ${config.anti_sticker_delete ? '✅ ON' : '❌ OFF'}\n` +
            `› **Anti-GuildUpdate:** ${config.anti_guild_update ? '✅ ON' : '❌ OFF'}\n\n` +
            `### 🤬 Content Filters\n` +
            `› **Cuss Word Filter:** ${cussFilterEnabled ? '✅ ON' : '❌ OFF'}`
        )
        .setFooter({ text: 'Victus Cloud Staff Operations', iconURL: config.enabled ? 'https://victuscloud.com/favicon.png' : undefined })
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
                description: 'Prevent excessive kicking of members',
                default: config.anti_kick,
            },
            {
                label: 'Anti-Ban',
                value: 'anti_ban',
                emoji: '🔨',
                description: 'Prevent excessive banning of members',
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
                description: 'Enable or disable the cuss word filter',
                default: cussFilterEnabled,
            },
        ]);

    const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('antinuke:toggle:enabled')
            .setLabel(`Anti-Nuke: ${config.enabled ? 'ON ✅' : 'OFF ❌'}`)
            .setStyle(config.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('antinuke:save')
            .setLabel('Save & Close 🛡️')
            .setStyle(ButtonStyle.Success)
    );

    return [row1, row2];
}

export const antinukeCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('antinuke')
        .setDescription('Configure server Anti-Nuke protections')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
        const authorized = await isAuthorized(interaction);
        if (!authorized) {
            const unauthorizedEmbed = new EmbedBuilder()
                .setColor(ICE_PALETTE.unauthorized)
                .setTitle('🚫 Not Authorized')
                .setDescription('You do not have permission to run this command. This command is restricted to server administrators.')
                .setFooter({ text: 'Victus Cloud Staff Operations' })
                .setTimestamp();

            await interaction.reply({
                embeds: [unauthorizedEmbed],
                ephemeral: true,
            });
            return;
        }

        const guildId = interaction.guildId!;
        const antinukeConfig = await antiNukeSettings.get(guildId);
        const botSettings = await supabase.getBotSettings(guildId).catch(() => null);
        const cussFilterEnabled = botSettings?.moderation_enabled ?? false;

        const embed = buildControlPanelEmbed(antinukeConfig, cussFilterEnabled, interaction.guild!.name);
        const components = buildControlPanelComponents(antinukeConfig, cussFilterEnabled);

        await interaction.reply({
            embeds: [embed],
            components,
            ephemeral: true,
        });
    },

    async handleButton(interaction: ButtonInteraction) {
        if (!interaction.customId.startsWith('antinuke:toggle:') && interaction.customId !== 'antinuke:save') return;

        const authorized = await isAuthorized(interaction);
        if (!authorized) {
            await interaction.reply({
                content: '❌ You are not authorized to perform this action.',
                ephemeral: true,
            });
            return;
        }

        const guildId = interaction.guildId!;

        if (interaction.customId === 'antinuke:save') {
            const antinukeConfig = await antiNukeSettings.get(guildId);
            const botSettings = await supabase.getBotSettings(guildId).catch(() => null);
            const cussFilterEnabled = botSettings?.moderation_enabled ?? false;

            const finalEmbed = new EmbedBuilder()
                .setColor(ICE_PALETTE.frost)
                .setTitle('🛡️ Victus Anti-Nuke Settings Saved')
                .setDescription(
                    `Anti-Nuke configuration for **${interaction.guild!.name}** has been successfully saved.\n\n` +
                    `### 🎛️ Master Status\n` +
                    `> **System Status:** ${antinukeConfig.enabled ? '🟢 ON' : '⚫ OFF'}\n\n` +
                    `### 🔒 Active Shields\n` +
                    `› **Anti-Kick:** ${antinukeConfig.anti_kick ? '✅ ON' : '❌ OFF'}\n` +
                    `› **Anti-Ban:** ${antinukeConfig.anti_ban ? '✅ ON' : '❌ OFF'}\n` +
                    `› **Anti-BanRemove:** ${antinukeConfig.anti_ban_remove ? '✅ ON' : '❌ OFF'}\n` +
                    `› **Anti-ChannelCreate:** ${antinukeConfig.anti_channel_create ? '✅ ON' : '❌ OFF'}\n` +
                    `› **Anti-ChannelDelete:** ${antinukeConfig.anti_channel_delete ? '✅ ON' : '❌ OFF'}\n` +
                    `› **Anti-RoleCreate:** ${antinukeConfig.anti_role_create ? '✅ ON' : '❌ OFF'}\n` +
                    `› **Anti-RoleDelete:** ${antinukeConfig.anti_role_delete ? '✅ ON' : '❌ OFF'}\n` +
                    `› **Anti-RoleUpdate:** ${antinukeConfig.anti_role_update ? '✅ ON' : '❌ OFF'}\n` +
                    `› **Anti-EmojiDelete:** ${antinukeConfig.anti_emoji_delete ? '✅ ON' : '❌ OFF'}\n` +
                    `› **Anti-StickerDelete:** ${antinukeConfig.anti_sticker_delete ? '✅ ON' : '❌ OFF'}\n` +
                    `› **Anti-GuildUpdate:** ${antinukeConfig.anti_guild_update ? '✅ ON' : '❌ OFF'}\n\n` +
                    `### 🤬 Content Filters\n` +
                    `› **Cuss Word Filter:** ${cussFilterEnabled ? '✅ ON' : '❌ OFF'}`
                )
                .setFooter({ text: 'Victus Cloud Staff Operations', iconURL: antinukeConfig.enabled ? 'https://victuscloud.com/favicon.png' : undefined })
                .setTimestamp();

            await interaction.update({
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
        if (targetToggle === 'cuss_filter') {
            // Toggle moderation_enabled in bot_settings table
            cussFilterEnabled = !cussFilterEnabled;
            await supabase.updateBotSettings(guildId, {
                moderation_enabled: cussFilterEnabled,
            });
        } else {
            // Toggle one of the AntiNukeConfig settings
            const key = targetToggle as keyof AntiNukeConfig;
            if (key in antinukeConfig) {
                const updatedVal = !antinukeConfig[key];
                updatedConfig = await antiNukeSettings.set(guildId, { [key]: updatedVal });
            }
        }

        // Rebuild control panel UI
        const embed = buildControlPanelEmbed(updatedConfig, cussFilterEnabled, interaction.guild!.name);
        const components = buildControlPanelComponents(updatedConfig, cussFilterEnabled);

        await interaction.update({
            embeds: [embed],
            components,
        });
    },

    async handleSelectMenu(interaction: StringSelectMenuInteraction) {
        if (interaction.customId !== 'antinuke:select') return;

        const authorized = await isAuthorized(interaction);
        if (!authorized) {
            await interaction.reply({
                content: '❌ You are not authorized to perform this action.',
                ephemeral: true,
            });
            return;
        }

        const guildId = interaction.guildId!;
        const selectedValues = interaction.values;

        // Set all specific modules based on presence in selectedValues
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

        // Update AntiNukeConfig
        const currentConfig = await antiNukeSettings.set(guildId, updatedConfig);

        // Update Cuss filter setting in supabase
        const cussFilterEnabled = selectedValues.includes('cuss_filter');
        await supabase.updateBotSettings(guildId, {
            moderation_enabled: cussFilterEnabled,
        });

        // Re-render the control panel with the updated config
        const embed = buildControlPanelEmbed(currentConfig, cussFilterEnabled, interaction.guild!.name);
        const components = buildControlPanelComponents(currentConfig, cussFilterEnabled);

        await interaction.update({
            embeds: [embed],
            components,
        });
    }
};

export default antinukeCommand;
