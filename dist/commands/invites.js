import { MessageFlags, SlashCommandBuilder, } from 'discord.js';
import { inviteService } from '../services/inviteService.js';
import { InviteEmbeds } from '../embeds/inviteEmbeds.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';
export const invitesCommand = {
    data: new SlashCommandBuilder()
        .setName('invites')
        .setDescription('Track server invites, view retention analytics, and browse the top inviters leaderboard')
        .addSubcommand((sub) => sub
        .setName('check')
        .setDescription("Check your or another member's invite counts, retention, and active codes")
        .addUserOption((opt) => opt
        .setName('user')
        .setDescription('The member whose invites you want to check (defaults to yourself)')
        .setRequired(false)))
        .addSubcommand((sub) => sub
        .setName('leaderboard')
        .setDescription('View the server invite leaderboard and top inviters')
        .addIntegerOption((opt) => opt
        .setName('page')
        .setDescription('Page number to inspect')
        .setMinValue(1)
        .setRequired(false))),
    cooldown: 5,
    async execute(interaction) {
        if (!interaction.inGuild() || !interaction.guild) {
            await interaction.reply({
                content: '⚠️ The `/invites` command can only be used inside a server.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const subcommand = interaction.options.getSubcommand(false) || 'check';
        const guild = interaction.guild;
        const requester = interaction.user;
        // 1. /invites check [user]
        if (subcommand === 'check') {
            await interaction.deferReply({
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            const targetUser = interaction.options.getUser('user') || requester;
            const stats = await inviteService.getUserStats(guild, targetUser.id);
            const { container, actionRows } = InviteEmbeds.buildUserInvitesCard(stats, guild, targetUser, requester.id);
            await interaction.editReply({
                components: [container, ...actionRows],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }
        // 2. /invites leaderboard [page]
        if (subcommand === 'leaderboard') {
            await interaction.deferReply({
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            const page = interaction.options.getInteger('page') || 1;
            const [lbData, userStats] = await Promise.all([
                inviteService.getLeaderboardPage(guild, page, 10),
                inviteService.getUserStats(guild, requester.id),
            ]);
            const { container, actionRows } = InviteEmbeds.buildLeaderboardCard(lbData, guild, requester.id, userStats);
            await interaction.editReply({
                components: [container, ...actionRows],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }
    },
    async handleButton(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('inv:'))
            return;
        if (!interaction.inGuild() || !interaction.guild) {
            await interaction.reply({
                content: '⚠️ This action can only be executed in a server.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const parts = customId.split(':');
        const action = parts[1];
        const guild = interaction.guild;
        try {
            // Action 1: inv:check:<targetUserId>:<requesterId>
            if (action === 'check') {
                const targetUserId = parts[2] || interaction.user.id;
                await interaction.deferUpdate();
                const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => interaction.user);
                const stats = await inviteService.getUserStats(guild, targetUser.id);
                const { container, actionRows } = InviteEmbeds.buildUserInvitesCard(stats, guild, targetUser, interaction.user.id);
                await interaction.editReply({
                    components: [container, ...actionRows],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
                return;
            }
            // Action 2: inv:lb:<page>:<requesterId> OR inv:page:<page>:<requesterId>
            if (action === 'lb' || action === 'page') {
                const page = parseInt(parts[2], 10) || 1;
                await interaction.deferUpdate();
                const [lbData, userStats] = await Promise.all([
                    inviteService.getLeaderboardPage(guild, page, 10),
                    inviteService.getUserStats(guild, interaction.user.id),
                ]);
                const { container, actionRows } = InviteEmbeds.buildLeaderboardCard(lbData, guild, interaction.user.id, userStats);
                await interaction.editReply({
                    components: [container, ...actionRows],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
                return;
            }
            // Action 3: inv:refresh:<targetUserId>:<requesterId>
            if (action === 'refresh') {
                const targetUserId = parts[2] || interaction.user.id;
                await interaction.deferUpdate();
                inviteService.invalidateCache(guild.id);
                const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => interaction.user);
                const stats = await inviteService.getUserStats(guild, targetUser.id, true);
                const { container, actionRows } = InviteEmbeds.buildUserInvitesCard(stats, guild, targetUser, interaction.user.id);
                await interaction.editReply({
                    components: [container, ...actionRows],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
                return;
            }
            // Action 4: inv:refresh_lb:<page>:<requesterId>
            if (action === 'refresh_lb') {
                const page = parseInt(parts[2], 10) || 1;
                await interaction.deferUpdate();
                inviteService.invalidateCache(guild.id);
                const [lbData, userStats] = await Promise.all([
                    inviteService.getLeaderboardPage(guild, page, 10, true),
                    inviteService.getUserStats(guild, interaction.user.id, true),
                ]);
                const { container, actionRows } = InviteEmbeds.buildLeaderboardCard(lbData, guild, interaction.user.id, userStats);
                await interaction.editReply({
                    components: [container, ...actionRows],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
                return;
            }
            // Action 5: inv:create:<targetUserId>:<requesterId>
            if (action === 'create') {
                const created = await inviteService.createInvite(guild, interaction.user, interaction.channelId);
                if (!created) {
                    await interaction.reply({
                        content: '❌ Failed to create an invite link. Ensure the bot has the **Create Invite** permission.',
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
                await interaction.reply({
                    content: `🎉 **New Permanent Invite Link Created:**\n\`${created.url}\`\n\nShare this link with your friends to track your invites and earn synchronized COINS!`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
        }
        catch (error) {
            logger.error(`[invitesCommand] Button execution failed for ${customId}:`, error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '⚠️ Failed to process invite interaction.',
                    flags: MessageFlags.Ephemeral,
                }).catch(() => { });
            }
        }
    },
};
export default invitesCommand;
