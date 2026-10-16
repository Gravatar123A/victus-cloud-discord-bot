import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { memberHasTicketStaffAccess } from './ticket.js';

export const ticketAiCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('ticketai')
        .setDescription('Staff controls for AI replies in this Discord ticket')
        .setDMPermission(false)
        .addStringOption((option) => option
            .setName('action')
            .setDescription('Pause, resume, or inspect ticket AI')
            .setRequired(true)
            .addChoices(
                { name: 'Pause AI', value: 'off' },
                { name: 'Resume AI', value: 'on' },
                { name: 'Status', value: 'status' }
            )),
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const ticket = await supabase.getTicketByChannel(interaction.channelId);
        if (!ticket || ticket.guild_id !== interaction.guildId || ticket.status === 'closed') {
            await interaction.editReply('Use this command inside an active Discord ticket.');
            return;
        }
        const settings = await supabase.getBotSettings(ticket.guild_id).catch(() => null);
        if (!memberHasTicketStaffAccess(interaction, settings, ticket.category)) {
            await interaction.editReply('Only configured ticket staff can manage AI replies.');
            return;
        }
        const action = interaction.options.getString('action', true);
        if (action === 'status') {
            const state = await supabase.getDiscordTicketAiState(ticket.id);
            await interaction.editReply(state ? `AI replies are **${state.enabled ? 'enabled' : 'paused'}** in this ticket.` : 'AI state is unavailable. Replies are paused until it recovers.');
            return;
        }
        const enabled = action === 'on';
        const saved = await supabase.setDiscordTicketAiEnabled(ticket.id, enabled, interaction.user.id);
        if (!saved) {
            await interaction.editReply('Could not update AI state. Please retry.');
            return;
        }
        await (interaction.channel as any)?.send({
            content: `${enabled ? '▶️ AI replies resumed' : '⏸️ AI replies paused'} by <@${interaction.user.id}>.`,
            allowedMentions: { users: [interaction.user.id] },
        }).catch(() => undefined);
        await interaction.editReply(`AI replies are now **${enabled ? 'enabled' : 'paused'}**.`);
    },
};
