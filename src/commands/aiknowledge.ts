import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types/index.js';
import { verifyStaffOrAdmin } from '../utils/staffAuth.js';
import { addStaffKnowledge, removeStaffKnowledge } from '../services/victusAiContext.js';
import { supabase } from '../services/supabase.js';
import { structureStaffKnowledge } from '../services/staffKnowledge.js';

export const aiKnowledgeCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('aiknowledge')
        .setDescription('Manage private Victus AI guidance (official staff only)')
        .setDMPermission(false)
        .addSubcommand((sub) => sub.setName('add').setDescription('Teach Victus AI in your own words')
            .addStringOption((opt) => opt.setName('note').setDescription('Write the fact or procedure in your own words')
                .setRequired(true).setMaxLength(2000)))
        .addSubcommand((sub) => sub.setName('list').setDescription('List recent staff-added guidance'))
        .addSubcommand((sub) => sub.setName('remove').setDescription('Remove staff-added guidance by ID')
            .addStringOption((opt) => opt.setName('id').setDescription('Knowledge entry ID')
                .setRequired(true)) ) as SlashCommandBuilder,
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!interaction.guildId || !(await verifyStaffOrAdmin(interaction.user, interaction.client)).authorized) {
            await interaction.editReply('Only official Victus Cloud staff can manage AI knowledge.');
            return;
        }
        const action = interaction.options.getSubcommand();
        try {
            if (action === 'add') {
                const note = interaction.options.getString('note', true);
                const entry = await structureStaffKnowledge(note);
                const id = await addStaffKnowledge(interaction.guildId, interaction.user.id, entry);
                await interaction.editReply(`Saved private Victus AI guidance under **${entry.title}**.\n**What AI understood:** ${entry.answer}\nID: \`${id}\``);
            } else if (action === 'remove') {
                const id = interaction.options.getString('id', true).trim();
                if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
                    await interaction.editReply('Enter a valid knowledge entry ID.');
                    return;
                }
                const removed = await removeStaffKnowledge(interaction.guildId, id);
                await interaction.editReply(removed ? 'Guidance removed.' : 'No staff-added guidance with that ID was found.');
            } else {
                const { data, error } = await supabase.client.from('victus_ai_knowledge')
                    .select('id,title,created_at').eq('guild_id', interaction.guildId)
                    .eq('source_type', 'staff_command').order('created_at', { ascending: false }).limit(15);
                if (error) throw new Error(error.message);
                await interaction.editReply(data?.length
                    ? data.map((row: any) => `• ${row.title} — \`${row.id}\``).join('\n').slice(0, 1900)
                    : 'No staff-added guidance yet.');
            }
        } catch (error) {
            await interaction.editReply(`Knowledge operation failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1800));
        }
    },
};
