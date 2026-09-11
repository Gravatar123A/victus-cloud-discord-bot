import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, } from 'discord.js';
import { antiNukeSettings } from '../services/antiNukeSettings.js';
import { supabase } from '../services/supabase.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
// Pastel / Ice Aesthetic Palette
const ICE_PALETTE = {
    frost: 0x7dd3fc, // Soft Sky / Ice Blue
    glacier: 0x38bdf8, // Vivid Ice
    deepGlacier: 0x0284c7, // Accent Blue
    unauthorized: 0xf87171, // Soft Pastel Red
};
/**
 * Check if the invoking user is authorized to manage Anti-Nuke settings.
 * Checks for Server Owner, Server Administrator, or Bot Application Owner/Staff.
 */
async function isAuthorized(interaction) {
    const userId = interaction.user.id;
    const guild = interaction.guild;
    if (!guild)
        return false;
    // 1. Server Owner & Guild Administrator checks
    if (guild.ownerId === userId)
        return true;
    if (interaction.member?.permissions?.has(PermissionFlagsBits.Administrator))
        return true;
    // 2. Check Discord Application Owner / Team Member (Super Owner)
    try {
        const app = interaction.client.application;
        const application = typeof app?.fetch === 'function' ? await app.fetch().catch(() => app) : app;
        const owner = application?.owner || app?.owner;
        if (owner) {
            if ('id' in owner && owner.id === userId)
                return true;
            if ('members' in owner && owner.members?.has?.(userId))
                return true;
        }
    }
    catch (err) {
        logger.debug('[AntiNuke] Error fetching application owner:', err);
    }
    // 3. Evaluate Support Guild permissions / roles
    const supportGuildId = config.bot.supportGuildId || config.discord.guildId;
    if (supportGuildId) {
        const supportGuild = await interaction.client.guilds.fetch(supportGuildId).catch(() => null);
        if (supportGuild) {
            const member = await supportGuild.members.fetch(userId).catch(() => null);
            if (member) {
                if (member.roles.cache.has('1392801771474259989'))
                    return true;
                if (member.permissions.has(PermissionFlagsBits.Administrator))
                    return true;
                const settings = await supabase.getBotSettings(supportGuild.id).catch(() => null);
                const adminRoleIds = (settings?.ticket_admin_role_ids || []);
                if (adminRoleIds.some((roleId) => member.roles.cache.has(roleId)))
                    return true;
            }
        }
    }
    // 4. Supabase Platform Admin check
    try {
        const isPlatformAdmin = await supabase.isUserAdmin(userId).catch(() => false);
        if (isPlatformAdmin)
            return true;
    }
    catch (err) {
        logger.debug('[AntiNuke] Error checking Supabase admin:', err);
    }
    return false;
}
/**
 * Generate the Status Display Embed for the control panel.
 */
function buildControlPanelEmbed(config, cussFilterEnabled, guildName) {
    return new EmbedBuilder()
        .setColor(ICE_PALETTE.frost)
        .setTitle('🛡️ Victus Anti-Nuke Control Panel')
        .setDescription(`Configure Anti-Nuke security protections for **${guildName}**.\n\n` +
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
        `› **Cuss Word Filter:** ${cussFilterEnabled ? '✅ ON' : '❌ OFF'}`)
        .setFooter({ text: 'Victus Cloud Staff Operations', iconURL: config.enabled ? 'https://victuscloud.com/favicon.png' : undefined })
        .setTimestamp();
}
/**
 * Generate Action Rows with Green ON / Gray OFF styled buttons.
 */
function buildControlPanelButtons(config, cussFilterEnabled) {
    const row1 = new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId('antinuke:toggle:master')
        .setLabel(`Anti-Nuke: ${config.enabled ? 'ON ✅' : 'OFF ❌'}`)
        .setStyle(config.enabled ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId('antinuke:toggle:cuss_filter')
        .setLabel(`Cuss Filter: ${cussFilterEnabled ? 'ON ✅' : 'OFF ❌'}`)
        .setStyle(cussFilterEnabled ? ButtonStyle.Success : ButtonStyle.Secondary));
    const row2 = new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId('antinuke:toggle:anti_kick')
        .setLabel(`Kick: ${config.anti_kick ? 'ON ✅' : 'OFF ❌'}`)
        .setStyle(config.anti_kick ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId('antinuke:toggle:anti_ban')
        .setLabel(`Ban: ${config.anti_ban ? 'ON ✅' : 'OFF ❌'}`)
        .setStyle(config.anti_ban ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId('antinuke:toggle:anti_ban_remove')
        .setLabel(`Unban: ${config.anti_ban_remove ? 'ON ✅' : 'OFF ❌'}`)
        .setStyle(config.anti_ban_remove ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId('antinuke:toggle:anti_channel_create')
        .setLabel(`Chan Create: ${config.anti_channel_create ? 'ON ✅' : 'OFF ❌'}`)
        .setStyle(config.anti_channel_create ? ButtonStyle.Success : ButtonStyle.Secondary));
    const row3 = new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId('antinuke:toggle:anti_channel_delete')
        .setLabel(`Chan Delete: ${config.anti_channel_delete ? 'ON ✅' : 'OFF ❌'}`)
        .setStyle(config.anti_channel_delete ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId('antinuke:toggle:anti_role_create')
        .setLabel(`Role Create: ${config.anti_role_create ? 'ON ✅' : 'OFF ❌'}`)
        .setStyle(config.anti_role_create ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId('antinuke:toggle:anti_role_delete')
        .setLabel(`Role Delete: ${config.anti_role_delete ? 'ON ✅' : 'OFF ❌'}`)
        .setStyle(config.anti_role_delete ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId('antinuke:toggle:anti_role_update')
        .setLabel(`Role Update: ${config.anti_role_update ? 'ON ✅' : 'OFF ❌'}`)
        .setStyle(config.anti_role_update ? ButtonStyle.Success : ButtonStyle.Secondary));
    const row4 = new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId('antinuke:toggle:anti_emoji_delete')
        .setLabel(`Emoji Del: ${config.anti_emoji_delete ? 'ON ✅' : 'OFF ❌'}`)
        .setStyle(config.anti_emoji_delete ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId('antinuke:toggle:anti_sticker_delete')
        .setLabel(`Sticker Del: ${config.anti_sticker_delete ? 'ON ✅' : 'OFF ❌'}`)
        .setStyle(config.anti_sticker_delete ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId('antinuke:toggle:anti_guild_update')
        .setLabel(`Guild Update: ${config.anti_guild_update ? 'ON ✅' : 'OFF ❌'}`)
        .setStyle(config.anti_guild_update ? ButtonStyle.Success : ButtonStyle.Secondary));
    return [row1, row2, row3, row4];
}
export const antinukeCommand = {
    data: new SlashCommandBuilder()
        .setName('antinuke')
        .setDescription('Configure server Anti-Nuke protections')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
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
        const guildId = interaction.guildId;
        const antinukeConfig = await antiNukeSettings.get(guildId);
        const botSettings = await supabase.getBotSettings(guildId).catch(() => null);
        const cussFilterEnabled = botSettings?.moderation_enabled ?? false;
        const embed = buildControlPanelEmbed(antinukeConfig, cussFilterEnabled, interaction.guild.name);
        const components = buildControlPanelButtons(antinukeConfig, cussFilterEnabled);
        await interaction.reply({
            embeds: [embed],
            components,
            ephemeral: true,
        });
    },
    async handleButton(interaction) {
        if (!interaction.customId.startsWith('antinuke:toggle:'))
            return;
        const authorized = await isAuthorized(interaction);
        if (!authorized) {
            await interaction.reply({
                content: '❌ You are not authorized to perform this action.',
                ephemeral: true,
            });
            return;
        }
        const guildId = interaction.guildId;
        const targetToggle = interaction.customId.split(':')[2];
        const antinukeConfig = await antiNukeSettings.get(guildId);
        const botSettings = await supabase.getBotSettings(guildId).catch(() => null);
        let cussFilterEnabled = botSettings?.moderation_enabled ?? false;
        if (targetToggle === 'cuss_filter') {
            // Toggle moderation_enabled in bot_settings table
            cussFilterEnabled = !cussFilterEnabled;
            await supabase.updateBotSettings(guildId, {
                moderation_enabled: cussFilterEnabled,
            });
        }
        else {
            // Toggle one of the AntiNukeConfig settings
            const key = targetToggle;
            if (key in antinukeConfig) {
                const updatedVal = !antinukeConfig[key];
                await antiNukeSettings.set(guildId, { [key]: updatedVal });
                antinukeConfig[key] = updatedVal; // reflect locally
            }
        }
        // Rebuild control panel UI
        const updatedConfig = await antiNukeSettings.get(guildId);
        const embed = buildControlPanelEmbed(updatedConfig, cussFilterEnabled, interaction.guild.name);
        const components = buildControlPanelButtons(updatedConfig, cussFilterEnabled);
        await interaction.update({
            embeds: [embed],
            components,
        });
    }
};
export default antinukeCommand;
