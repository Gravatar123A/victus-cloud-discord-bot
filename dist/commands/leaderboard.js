import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, } from 'discord.js';
import { leaderboardService } from '../services/leaderboardService.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';
export const leaderboardCommand = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Victus Cloud Live Leaderboards (Coins, XP, Messages, Voice)')
        .addSubcommand((sub) => sub
        .setName('set-channel')
        .setDescription('Configure a channel for the auto-updating (1-minute) leaderboard (Admin only)')
        .addChannelOption((opt) => opt
        .setName('channel')
        .setDescription('The text channel to post the live leaderboard')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)))
        .addSubcommand((sub) => sub
        .setName('remove')
        .setDescription('Disable and remove the live auto-updating leaderboard (Admin only)'))
        .addSubcommand((sub) => sub
        .setName('refresh')
        .setDescription('Force an immediate refresh of the live leaderboard (Admin only)'))
        .addSubcommand((sub) => sub
        .setName('view')
        .setDescription('View the community leaderboard on demand')
        .addStringOption((opt) => opt
        .setName('category')
        .setDescription('Category to display')
        .setRequired(false)
        .addChoices({ name: '🏆 Overview (Top 3 of all categories)', value: 'overview' }, { name: '🪙 Top Coins', value: 'coins' }, { name: '⚡ Top XP & Tiers', value: 'xp' }, { name: '💬 Top Messages', value: 'messages' }, { name: '🎙️ Top Voice Minutes', value: 'voice' }))),
    cooldown: 5,
    async execute(interaction) {
        if (!interaction.inGuild() || !interaction.guild) {
            await interaction.reply({
                content: '⚠️ This command can only be used inside a server.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        // 1. View (Public)
        if (subcommand === 'view') {
            await interaction.deferReply({
                flags: ComponentsV2.IS_COMPONENTS_V2 | MessageFlags.Ephemeral,
            });
            const category = interaction.options.getString('category') || 'overview';
            const container = await leaderboardService.buildLeaderboardContainer(guildId, category);
            await interaction.editReply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }
        // Admin-only subcommands check
        const member = interaction.member;
        const isAdmin = member?.permissions?.has?.(PermissionFlagsBits.Administrator) ||
            member?.permissions?.has?.(PermissionFlagsBits.ManageGuild);
        if (!isAdmin) {
            await interaction.reply({
                content: '⛔ You must have Administrator or Manage Server permissions to configure the leaderboard.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        // 2. Set Channel
        if (subcommand === 'set-channel') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const targetChannel = interaction.options.getChannel('channel', true);
            // Check permissions in target channel
            const botMember = interaction.guild.members.me;
            if (botMember && !targetChannel.permissionsFor(botMember).has(['ViewChannel', 'SendMessages'])) {
                await interaction.editReply({
                    content: `❌ I do not have permission to view or send messages in ${targetChannel}.`,
                });
                return;
            }
            // Generate board container
            const container = await leaderboardService.buildLeaderboardContainer(guildId, 'overview');
            // Send persistent message to the target channel
            const sentMessage = await targetChannel.send({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            // Save configuration
            await leaderboardService.setConfig(guildId, {
                channelId: targetChannel.id,
                messageId: sentMessage.id,
                view: 'overview',
                lastUpdated: Date.now(),
            });
            await interaction.editReply({
                content: `✅ **Leaderboard configured successfully!**\nLive auto-updating board posted in ${targetChannel}.\nIt will refresh automatically **every 1 minute** with top Coins, XP, Messages, and Voice airtime.`,
            });
            return;
        }
        // 3. Remove
        if (subcommand === 'remove') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const config = await leaderboardService.getConfig(guildId);
            if (config.channelId && config.messageId) {
                const channel = interaction.guild.channels.cache.get(config.channelId);
                if (channel) {
                    const msg = await channel.messages.fetch(config.messageId).catch(() => null);
                    if (msg) {
                        await msg.delete().catch(() => null);
                    }
                }
            }
            await leaderboardService.setConfig(guildId, {
                channelId: null,
                messageId: null,
                lastUpdated: 0,
            });
            await interaction.editReply({
                content: '🗑️ Live leaderboard disabled and removed for this server.',
            });
            return;
        }
        // 4. Refresh
        if (subcommand === 'refresh') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const success = await leaderboardService.updateGuildLeaderboard(interaction.client, guildId);
            if (success) {
                await interaction.editReply({
                    content: '🔄 Live leaderboard has been refreshed immediately!',
                });
            }
            else {
                await interaction.editReply({
                    content: '⚠️ Failed to refresh. Please ensure a leaderboard channel is configured using `/leaderboard set-channel`.',
                });
            }
        }
    },
    /**
     * Handle Button Interactions on the Leaderboard Board
     */
    async handleButton(interaction) {
        const customId = interaction.customId;
        // Tab category switch: lb_tab:<view>:<guildId>
        if (customId.startsWith('lb_tab:')) {
            const [, view, guildId] = customId.split(':');
            const targetCategory = view;
            try {
                const container = await leaderboardService.buildLeaderboardContainer(guildId, targetCategory);
                await interaction.update({
                    components: [container],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
                await leaderboardService.setConfig(guildId, { view: targetCategory });
            }
            catch (error) {
                logger.error('Failed to handle leaderboard tab button:', error);
            }
            return;
        }
        // Force refresh button: lb_refresh:<guildId>
        if (customId.startsWith('lb_refresh:')) {
            const [, guildId] = customId.split(':');
            try {
                const config = await leaderboardService.getConfig(guildId);
                const container = await leaderboardService.buildLeaderboardContainer(guildId, config.view || 'overview');
                await interaction.update({
                    components: [container],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
            }
            catch (error) {
                logger.error('Failed to handle leaderboard refresh button:', error);
            }
        }
    },
};
