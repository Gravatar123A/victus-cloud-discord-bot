import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { supabase } from '../services/supabase.js';
import { getLevelProgress, progressBar } from '../utils/vccrs.js';
import { config } from '../config.js';
export const levelCommand = {
    data: new SlashCommandBuilder()
        .setName('level')
        .setDescription('View your synchronized Victus Community level, rank, and COINS balance')
        .addUserOption((opt) => opt
        .setName('user')
        .setDescription('View another user\'s level and rank')
        .setRequired(false)),
    cooldown: 5,
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const isSelf = targetUser.id === interaction.user.id;
        const linked = await supabase.getLinkedAccount(targetUser.id);
        if (!linked) {
            const warningText = isSelf
                ? 'Run `/link account` first so Discord and Victus Cloud can share your XP, level, and COINS rewards.'
                : `<@${targetUser.id}> has not linked their Discord account to Victus Cloud yet.`;
            await interaction.editReply({
                components: [ComponentsV2.warningContainer('Account not linked', warningText)],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }
        const profile = await supabase.getUserProfile(linked.user_id);
        if (!profile)
            throw new Error('Your linked Victus profile could not be loaded.');
        const xp = Number(profile.total_xp ?? 0);
        const coins = Number(profile.total_cp ?? 0);
        const info = getLevelProgress(xp);
        const container = ComponentsV2.baseContainer(info.tier.color).addTextDisplayComponents(ComponentsV2.text(`# ${info.tier.emoji} ${info.tier.name} — Level ${info.level}\n` +
            `**User**: <@${targetUser.id}>  ·  **Multi-Guild Synced**\n\n` +
            `> **Total XP**  ${xp.toLocaleString('en-US')}\n` +
            `> **Current level**  ${info.cpIntoLevel.toLocaleString('en-US')} / ${info.cpForLevel.toLocaleString('en-US')} XP\n` +
            `> **Progress**  ${progressBar(info.progress)} ${info.progress.toFixed(0)}%\n` +
            `> **Next level**  ${info.cpToNext.toLocaleString('en-US')} XP remaining\n` +
            `> **Victus COINS**  🪙 **${coins.toLocaleString('en-US')} COINS**\n\n` +
            `Earn **+${config.economy.xpPerMessage} XP** per message, **+${config.economy.xpPerVoiceMinute} XP** per voice minute in any server, and **+${config.economy.coinsPerLevel} COINS** every level up!`));
        await interaction.editReply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
    },
};
