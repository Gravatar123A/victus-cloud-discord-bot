import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
    UserSelectMenuBuilder,
    StringSelectMenuBuilder,
    ChatInputCommandInteraction,
    ButtonInteraction,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { whitelistSettings } from '../services/whitelistSettings.js';
import { config } from '../config.js';
import { supabase } from '../services/supabase.js';
import { logger } from '../utils/logger.js';

// Pastel / Ice Aesthetic Palette
const ICE_PALETTE = {
    frost: 0x7dd3fc,      // Soft Sky / Ice Blue
    glacier: 0x38bdf8,    // Vivid Ice
    deepGlacier: 0x0284c7, // Accent Blue
    unauthorized: 0xf87171, // Soft Pastel Red
};

/**
 * Authorize the invoking user using the bot's permission architecture:
 * 1. Specific Role: 1392801771474259989 in the home guild
 * 2. Super Owner: Bot Application Owner / Team Member or Support Guild Owner
 * 3. Added Owners: Support Guild Administrators, Supabase platform admins, or ticket_admin roles
 */
async function isAuthorized(interaction: any): Promise<boolean> {
    const userId = interaction.user.id;

    // 1. Check Discord Application Owner / Team Member (Super Owner)
    try {
        const app = interaction.client.application;
        const application = typeof app?.fetch === 'function' ? await app.fetch().catch(() => app) : app;
        const owner = application?.owner || app?.owner;
        if (owner) {
            if ('id' in owner && owner.id === userId) return true;
            if ('members' in (owner as any) && (owner as any).members?.has?.(userId)) return true;
        }
    } catch (err) {
        logger.debug('[Whitelist] Error fetching application owner:', err);
    }

    // Evaluate Support Guild permissions / roles
    const supportGuildId = config.bot.supportGuildId || config.discord.guildId;
    if (supportGuildId) {
        const guild = await interaction.client.guilds.fetch(supportGuildId).catch(() => null);
        if (guild) {
            // Support Guild Owner
            if (guild.ownerId === userId) return true;

            const member = await guild.members.fetch(userId).catch(() => null);
            if (member) {
                // Specific role ID requested by user
                if (member.roles.cache.has('1392801771474259989')) return true;

                // Guild Administrator (Added Owner)
                if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

                // Check Database Bot Settings for Staff & Admin Roles
                const settings = await supabase.getBotSettings(guild.id).catch(() => null);
                const adminRoleIds = (settings?.ticket_admin_role_ids || []) as string[];
                if (adminRoleIds.some((roleId) => member.roles.cache.has(roleId))) return true;
            }
        }
    }

    // Supabase Platform Admin check (Added Owner)
    try {
        const isPlatformAdmin = await supabase.isUserAdmin(userId).catch(() => false);
        if (isPlatformAdmin) return true;
    } catch (err) {
        logger.debug('[Whitelist] Error checking Supabase admin:', err);
    }

    return false;
}

/**
 * Generate a beautifully styled, high-info Whitelist Editor Embed card.
 */
function buildEditorEmbed(selectedUserId: string, username: string, categories: string[]): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(ICE_PALETTE.frost)
        .setTitle('❄️ Whitelist Config Editor')
        .setDescription(
            `Configure and edit filter bypass immunities for this user.\n\n` +
            `### 👤 User Information\n` +
            `› **User:** <@${selectedUserId}> (${username})\n` +
            `› **ID:** \`${selectedUserId}\`\n\n` +
            `### 🛡️ Active Immunities\n` +
            `› **Cuss Word Bypass:** ${categories.includes('cuss') ? '✅ Enabled' : '❌ Disabled'}\n` +
            `› **Link Filter Bypass:** ${categories.includes('link') ? '✅ Enabled' : '❌ Disabled'}\n` +
            `› **Spam Filter Bypass:** ${categories.includes('spam') ? '✅ Enabled' : '❌ Disabled'}\n` +
            `› **Caps Filter Bypass:** ${categories.includes('caps') ? '✅ Enabled' : '❌ Disabled'}\n\n` +
            `Toggle permissions via the dropdown menu below and click **Save Settings** to finalize, or **Remove Whitelist** to completely clear this user's record.`
        )
        .setFooter({ text: 'Victus Cloud Staff Operations', iconURL: config.branding.logo })
        .setTimestamp();
}

export const whitelistCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('whitelist')
        .setDescription('Manage bypass permissions and filters for users')
        .setDMPermission(true),

    async execute(interaction: ChatInputCommandInteraction) {
        const authorized = await isAuthorized(interaction);
        if (!authorized) {
            const unauthorizedEmbed = new EmbedBuilder()
                .setColor(ICE_PALETTE.unauthorized)
                .setTitle('🚫 Not Authorized')
                .setDescription('You do not have permission to run this command. This command is restricted to authorized staff.')
                .setFooter({ text: 'Victus Cloud Staff Operations', iconURL: config.branding.logo })
                .setTimestamp();

            await interaction.reply({
                embeds: [unauthorizedEmbed],
                ephemeral: true,
            });
            return;
        }

        const initialEmbed = new EmbedBuilder()
            .setColor(ICE_PALETTE.frost)
            .setTitle('❄️ Whitelist Configuration')
            .setDescription('Select a user using the dropdown menu below to configure or view their bypass permissions.')
            .setFooter({ text: 'Victus Cloud Staff Operations', iconURL: config.branding.logo })
            .setTimestamp();

        const userSelectRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId('whitelist:user-select')
                .setPlaceholder('Select a user to whitelist')
                .setMinValues(1)
                .setMaxValues(1)
        );

        await interaction.reply({
            embeds: [initialEmbed],
            components: [userSelectRow],
            ephemeral: true,
        });
    },

    async handleButton(interaction: ButtonInteraction) {
        const authorized = await isAuthorized(interaction);
        if (!authorized) {
            await interaction.reply({
                content: '❌ You are not authorized to perform this action.',
                ephemeral: true
            });
            return;
        }

        const selectedUserId = interaction.customId.split(':')[2];
        const selectedUser = await interaction.client.users.fetch(selectedUserId).catch(() => null);
        const homeGuildId = config.bot.supportGuildId || config.discord.guildId || '';
        const whitelistConfig = await whitelistSettings.get(homeGuildId);

        if (interaction.customId.startsWith('whitelist:save-perms:')) {
            const record = whitelistConfig.users.find(u => u.userId === selectedUserId) || {
                userId: selectedUserId,
                userName: selectedUser?.username || 'Unknown',
                categories: [] as string[]
            };

            const finalEmbed = new EmbedBuilder()
                .setColor(ICE_PALETTE.glacier)
                .setTitle('❄️ Whitelist Configuration Finalized')
                .setDescription(
                    `Bypass permissions for <@${selectedUserId}> have been successfully updated.\n\n` +
                    `### 👤 User Info\n` +
                    `› **User:** <@${selectedUserId}> (${selectedUser?.username || 'Unknown'})\n` +
                    `› **ID:** \`${selectedUserId}\`\n\n` +
                    `### 📋 Saved Bypass Status\n` +
                    `${record.categories.includes('cuss') ? '✅' : '❌'} 🤬 Cuss Word Filter Bypass\n` +
                    `${record.categories.includes('link') ? '✅' : '❌'} 🔗 Link Filter Bypass\n` +
                    `${record.categories.includes('spam') ? '✅' : '❌'} 📨 Spam Filter Bypass\n` +
                    `${record.categories.includes('caps') ? '✅' : '❌'} 🔠 Caps Filter Bypass`
                )
                .setFooter({ text: 'Victus Cloud Staff Operations', iconURL: config.branding.logo })
                .setTimestamp();

            await interaction.update({
                embeds: [finalEmbed],
                components: []
            });
        }
        else if (interaction.customId.startsWith('whitelist:remove:')) {
            // Remove the user from the whitelist settings
            whitelistConfig.users = whitelistConfig.users.filter(u => u.userId !== selectedUserId);
            await whitelistSettings.set(homeGuildId, whitelistConfig);

            const removalEmbed = new EmbedBuilder()
                .setColor(0xef4444) // Soft red
                .setTitle('🗑️ Whitelist Entry Removed')
                .setDescription(
                    `Bypass immunities for <@${selectedUserId}> have been completely cleared.\n\n` +
                    `**User:** <@${selectedUserId}> (${selectedUser?.username || 'Unknown'})\n` +
                    `**ID:** \`${selectedUserId}\`\n\n` +
                    `This user is no longer on the whitelist and will no longer bypass any active server filters or anti-nuke protections.`
                )
                .setFooter({ text: 'Victus Cloud Staff Operations', iconURL: config.branding.logo })
                .setTimestamp();

            await interaction.update({
                embeds: [removalEmbed],
                components: []
            });
        }
    },

    async handleSelectMenu(interaction: any) {
        const authorized = await isAuthorized(interaction);
        if (!authorized) {
            await interaction.reply({
                content: '❌ You are not authorized to perform this action.',
                ephemeral: true
            });
            return;
        }

        const homeGuildId = config.bot.supportGuildId || config.discord.guildId || '';

        if (interaction.customId === 'whitelist:user-select') {
            const selectedUserId = interaction.values[0];
            const selectedUser = await interaction.client.users.fetch(selectedUserId).catch(() => null);

            if (!selectedUser) {
                await interaction.reply({
                    content: '❌ Could not find the selected user.',
                    ephemeral: true
                });
                return;
            }

            const whitelistConfig = await whitelistSettings.get(homeGuildId);
            const record = whitelistConfig.users.find(u => u.userId === selectedUserId) || {
                userId: selectedUserId,
                userName: selectedUser.username,
                categories: [] as string[],
                addedBy: interaction.user.id,
                timestamp: new Date().toISOString()
            };

            const permsEmbed = buildEditorEmbed(selectedUserId, selectedUser.username, record.categories);

            const permsSelectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`whitelist:perms-select:${selectedUserId}`)
                    .setPlaceholder('Select bypass permissions...')
                    .setMinValues(0)
                    .setMaxValues(4)
                    .addOptions([
                        {
                            label: 'Cuss Word Filter Bypass',
                            value: 'cuss',
                            emoji: '🤬',
                            description: 'Bypass the auto-delete cuss word filter',
                            default: record.categories.includes('cuss')
                        },
                        {
                            label: 'Link Filter Bypass',
                            value: 'link',
                            emoji: '🔗',
                            description: 'Bypass the link filter',
                            default: record.categories.includes('link')
                        },
                        {
                            label: 'Spam Filter Bypass',
                            value: 'spam',
                            emoji: '📨',
                            description: 'Bypass the spam filter',
                            default: record.categories.includes('spam')
                        },
                        {
                            label: 'Caps Filter Bypass',
                            value: 'caps',
                            emoji: '🔠',
                            description: 'Bypass the caps filter',
                            default: record.categories.includes('caps')
                        }
                    ])
            );

            const saveButtonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`whitelist:save-perms:${selectedUserId}`)
                    .setLabel('Save Settings ✅')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`whitelist:remove:${selectedUserId}`)
                    .setLabel('Remove Whitelist 🗑️')
                    .setStyle(ButtonStyle.Danger)
            );

            await interaction.update({
                embeds: [permsEmbed],
                components: [permsSelectRow, saveButtonRow]
            });
        }
        else if (interaction.customId.startsWith('whitelist:perms-select:')) {
            const selectedUserId = interaction.customId.split(':')[2];
            const selectedUser = await interaction.client.users.fetch(selectedUserId).catch(() => null);
            if (!selectedUser) {
                await interaction.reply({
                    content: '❌ Could not find the selected user.',
                    ephemeral: true
                });
                return;
            }

            const selectedValues = interaction.values;
            const whitelistConfig = await whitelistSettings.get(homeGuildId);
            let record = whitelistConfig.users.find(u => u.userId === selectedUserId);

            if (!record) {
                record = {
                    userId: selectedUserId,
                    userName: selectedUser.username,
                    categories: selectedValues,
                    addedBy: interaction.user.id,
                    timestamp: new Date().toISOString()
                };
                whitelistConfig.users.push(record);
            } else {
                // Keep non-bypass immunities if any, then merge selected values
                const preservedCategories = record.categories.filter(c => !['cuss', 'link', 'spam', 'caps'].includes(c));
                record.categories = [...preservedCategories, ...selectedValues];
            }

            await whitelistSettings.set(homeGuildId, whitelistConfig);

            const permsEmbed = buildEditorEmbed(selectedUserId, selectedUser.username, record.categories);

            const permsSelectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`whitelist:perms-select:${selectedUserId}`)
                    .setPlaceholder('Select bypass permissions...')
                    .setMinValues(0)
                    .setMaxValues(4)
                    .addOptions([
                        {
                            label: 'Cuss Word Filter Bypass',
                            value: 'cuss',
                            emoji: '🤬',
                            description: 'Bypass the auto-delete cuss word filter',
                            default: record.categories.includes('cuss')
                        },
                        {
                            label: 'Link Filter Bypass',
                            value: 'link',
                            emoji: '🔗',
                            description: 'Bypass the link filter',
                            default: record.categories.includes('link')
                        },
                        {
                            label: 'Spam Filter Bypass',
                            value: 'spam',
                            emoji: '📨',
                            description: 'Bypass the spam filter',
                            default: record.categories.includes('spam')
                        },
                        {
                            label: 'Caps Filter Bypass',
                            value: 'caps',
                            emoji: '🔠',
                            description: 'Bypass the caps filter',
                            default: record.categories.includes('caps')
                        }
                    ])
            );

            const saveButtonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`whitelist:save-perms:${selectedUserId}`)
                    .setLabel('Save Settings ✅')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`whitelist:remove:${selectedUserId}`)
                    .setLabel('Remove Whitelist 🗑️')
                    .setStyle(ButtonStyle.Danger)
            );

            await interaction.update({
                embeds: [permsEmbed],
                components: [permsSelectRow, saveButtonRow]
            });
        }
    }
};

export default whitelistCommand;
