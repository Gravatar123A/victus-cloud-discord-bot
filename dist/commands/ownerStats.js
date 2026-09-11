import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { viralExpansionStore } from '../services/viralExpansionStore.js';
import { CoinTransactionLock } from '../services/coinTransactionLock.js';
export const ownerStatsCommand = {
    data: new SlashCommandBuilder()
        .setName('owner-stats')
        .setDescription('View server bot engagement, referral conversions, and earned owner COINS'),
    cooldown: 5,
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({
                content: 'This command can only be used inside a Discord server.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const member = interaction.member;
        const isOwner = interaction.guild.ownerId === interaction.user.id;
        const isAdmin = member?.permissions?.has('Administrator');
        if (!isOwner && !isAdmin) {
            await interaction.reply({
                content: '⚠️ Only the server owner or server administrators can view `/owner-stats`.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });
        const guildId = interaction.guild.id;
        const botGuild = await viralExpansionStore.getGuild(guildId, interaction.guild.ownerId);
        const referralStats = await viralExpansionStore.getGuildReferralStats(guildId);
        const ownerVictus = await CoinTransactionLock.resolveLinkedUser(interaction.guild.ownerId);
        let ownerBalance = 0;
        if (ownerVictus) {
            ownerBalance = await CoinTransactionLock.getCoinsBalance(ownerVictus.email);
        }
        const container = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
        let body = `# 📊 Server Monetization & Bot Analytics\n\n` +
            `Real-time metrics for **${interaction.guild.name}** powered by the Victus Cloud Network.\n\n` +
            `### 👑 Server Owner Overview\n` +
            `› **Owner:** <@${interaction.guild.ownerId}>\n` +
            `› **Victus Account:** ${ownerVictus ? `\`${ownerVictus.email}\` (Linked ✅)` : '⚠️ *Unlinked — run `/link` to receive payouts!*'}\n` +
            `› **Current Owner Balance:** **${ownerBalance.toLocaleString()} COINS**\n\n` +
            `### 💰 Referral & Viral Earnings\n` +
            `› **Unique First-Command Bonuse(s):** **+5 COINS** per new unique user\n` +
            `› **Total Signups via Referral Code:** \`${referralStats.total}\`\n` +
            `› **Verified Signups (+30 COINS ea):** \`${referralStats.verified}\`\n` +
            `› **Total Referral Earnings:** **+${referralStats.coinsEarned.toLocaleString()} COINS**\n\n` +
            `### 🎖️ Server Battle Pass Progress\n` +
            `› **Guild Level:** **Level ${botGuild.guild_level}**\n` +
            `› **Total Guild XP:** \`${botGuild.guild_xp.toLocaleString()} XP\`\n` +
            `› **Level 5 Milestone (+1GB RAM):** ${botGuild.ram_bonus_claimed ? '✅ Unlocked' : '⏳ In Progress'}\n` +
            `› **Level 10 Milestone (Subdomain):** ${botGuild.subdomain_unlocked ? '✅ Unlocked (`mysmp.victus.gg`)' : '⏳ In Progress'}\n\n` +
            `-# Promote your server using \`/host\` to share your automated referral link!`;
        container.addTextDisplayComponents(ComponentsV2.text(body));
        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    },
};
