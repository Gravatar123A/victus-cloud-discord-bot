import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { supabase } from '../services/supabase.js';
import { getLevelProgress, progressBar, TIERS } from '../utils/vccrs.js';
import { config } from '../config.js';
export const rankCommand = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('View your cross-server synchronized Victus Cloud level, rank tier, and COINS rewards')
        .addUserOption((opt) => opt
        .setName('user')
        .setDescription('Check another user\'s level and rank progress')
        .setRequired(false)),
    cooldown: 5,
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const isSelf = targetUser.id === interaction.user.id;
        const linked = await supabase.getLinkedAccount(targetUser.id);
        if (!linked) {
            const msg = isSelf
                ? 'Run `/link account` first to connect your Discord and Victus Cloud accounts and start earning synchronized XP & COINS.'
                : `<@${targetUser.id}> has not linked their Discord account to Victus Cloud yet.`;
            await interaction.editReply({
                components: [ComponentsV2.warningContainer('Account Not Linked', msg)],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }
        const profile = await supabase.getUserProfile(linked.user_id);
        if (!profile)
            throw new Error('Victus profile could not be loaded.');
        const xp = Number(profile.total_xp ?? 0);
        const coins = Number(profile.total_cp ?? 0);
        const info = getLevelProgress(xp);
        // Find next tier if applicable
        const currentTierIndex = TIERS.findIndex((t) => t.name === info.tier.name);
        const nextTier = currentTierIndex >= 0 && currentTierIndex < TIERS.length - 1 ? TIERS[currentTierIndex + 1] : null;
        const nextTierText = nextTier
            ? `> **Next Rank Tier**  ${nextTier.emoji} **${nextTier.name}** (Unlocked at Level ${nextTier.minLevel})\n`
            : `> **Rank Status**  👑 **MAX TIER REACHED**\n`;
        const container = ComponentsV2.baseContainer(info.tier.color).addTextDisplayComponents(ComponentsV2.text(`# ${info.tier.emoji} ${info.tier.name} — Level ${info.level}\n` +
            `**User**: <@${targetUser.id}>  ·  **Victus Rail**: \`SYNCHRONIZED\`\n\n` +
            `> **Current Rank**  ${info.tier.emoji} **${info.tier.name}**\n` +
            `> **Global Level**  Level ${info.level}\n` +
            `> **Total XP**  ${xp.toLocaleString('en-US')} XP\n` +
            `> **Level Progress**  ${progressBar(info.progress, 16)} **${info.progress.toFixed(0)}%**\n` +
            `> **Remaining to Next Level**  ${info.cpToNext.toLocaleString('en-US')} XP\n` +
            nextTierText +
            `> **Victus COINS Balance**  🪙 **${coins.toLocaleString('en-US')} COINS**\n\n` +
            `### Multi-Guild Universal Progression\n` +
            `• **Chat Anywhere**: Earn **+${config.economy.xpPerMessage} XP** per message across any community server.\n` +
            `• **Voice Active**: Earn **+${config.economy.xpPerVoiceMinute} XP** per active voice minute.\n` +
            `• **Level Up Payout**: Earn **+${config.economy.coinsPerLevel} COINS** directly to your wallet every level up.\n` +
            `• **Free Hosting**: Spend earned COINS at [victuscloud.com/free](${config.branding.free}) for free 24/7 Minecraft servers.`));
        await interaction.editReply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
    },
};
