import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types/index.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { supabase } from '../services/supabase.js';
import { getLevelProgress, progressBar } from '../utils/vccrs.js';

export const levelCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('level')
        .setDescription('View your synchronized Victus Community level and rank'),
    cooldown: 5,
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });
        const linked = await supabase.getLinkedAccount(interaction.user.id);
        if (!linked) {
            await interaction.editReply({
                components: [ComponentsV2.warningContainer('Account not linked', 'Run `/link account` first so Discord and Victus Community can share your XP, level, and rank.')],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }
        const profile = await supabase.getUserProfile(linked.user_id);
        if (!profile) throw new Error('Your linked Victus profile could not be loaded.');

        const xp = Number(profile.total_xp ?? 0);
        const info = getLevelProgress(xp);
        const container = ComponentsV2.baseContainer(info.tier.color).addTextDisplayComponents(
            ComponentsV2.text(
                `# ${info.tier.emoji} ${info.tier.name} — Level ${info.level}\n` +
                `Your Discord and community.victuscloud.com progression use the same XP balance.\n\n` +
                `> **Total XP**  ${xp.toLocaleString('en-US')}\n` +
                `> **Current level**  ${info.cpIntoLevel.toLocaleString('en-US')} / ${info.cpForLevel.toLocaleString('en-US')} XP\n` +
                `> **Progress**  ${progressBar(info.progress)} ${info.progress.toFixed(0)}%\n` +
                `> **Next level**  ${info.cpToNext.toLocaleString('en-US')} XP remaining\n\n` +
                `Earn **10 XP** per Discord message and **15 XP** per active voice minute.`,
            ),
        );
        await interaction.editReply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
    },
};
