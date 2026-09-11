import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { levelSettings } from '../services/levelSettings.js';
import { logger } from '../utils/logger.js';
import { isVictusStaffOrAdmin } from '../utils/staffAuth.js';
export const levelChannelCommand = {
    data: new SlashCommandBuilder()
        .setName('levelchannel')
        .setDescription('Configure the channel for level-up and rank-up announcements')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand((sub) => sub
        .setName('set')
        .setDescription('Set the level-up announcements channel')
        .addChannelOption((opt) => opt
        .setName('channel')
        .setDescription('Target announcement channel')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)))
        .addSubcommand((sub) => sub
        .setName('view')
        .setDescription('View the current level-up announcements channel')),
    async execute(interaction) {
        if (!interaction.guildId)
            return;
        const memberPermissions = interaction.memberPermissions;
        const isGuildManager = memberPermissions?.has(PermissionFlagsBits.ManageGuild) || memberPermissions?.has(PermissionFlagsBits.Administrator);
        const isPlatformAdmin = await isVictusStaffOrAdmin(interaction.user, interaction.client);
        if (!isGuildManager && !isPlatformAdmin) {
            await interaction.reply({
                content: '⛔ You must have Manage Server or Administrator permissions in this server to configure the level-up channel.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });
        const subcommand = interaction.options.getSubcommand();
        try {
            if (subcommand === 'view') {
                const currentChannelId = await levelSettings.getChannelId(interaction.guildId);
                const container = ComponentsV2.infoContainer('Level Announcements Channel', `Level-up and rank-up notifications are currently broadcast in <#${currentChannelId}>.\n\n` +
                    `Use \`/levelchannel set channel:<#channel>\` or \`!levelchannel <#channel>\` to update.`);
                await interaction.editReply({
                    components: [container],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
                return;
            }
            if (subcommand === 'set') {
                const channel = interaction.options.getChannel('channel', true);
                await levelSettings.setChannelId(interaction.guildId, channel.id);
                const container = ComponentsV2.successContainer('Level Announcements Channel Updated', `Level-up and rank-up announcements will now be sent to <#${channel.id}>.`);
                await interaction.editReply({
                    components: [container],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
            }
        }
        catch (error) {
            logger.error('Error executing levelchannel command:', error);
            await interaction.editReply({
                components: [ComponentsV2.errorContainer('Error', 'Failed to update level announcement channel.')],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        }
    },
};
