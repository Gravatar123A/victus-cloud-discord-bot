import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { verifyStaffOrAdmin } from '../utils/staffAuth.js';
import { addStaffKnowledge, removeStaffKnowledge } from '../services/victusAiContext.js';
import { supabase } from '../services/supabase.js';
export const aiKnowledgeCommand = {
    data: new SlashCommandBuilder()
        .setName('aiknowledge')
        .setDescription('Manage private Victus AI guidance (official staff only)')
        .setDMPermission(false)
        .addSubcommand((sub) => sub.setName('add').setDescription('Teach Victus AI verified guidance')
        .addStringOption((opt) => opt.setName('topic').setDescription('Searchable topic or question')
        .setRequired(true).setMaxLength(160))
        .addStringOption((opt) => opt.setName('guidance').setDescription('Verified answer or procedure')
        .setRequired(true).setMaxLength(1400)))
        .addSubcommand((sub) => sub.setName('list').setDescription('List recent staff-added guidance'))
        .addSubcommand((sub) => sub.setName('remove').setDescription('Remove staff-added guidance by ID')
        .addStringOption((opt) => opt.setName('id').setDescription('Knowledge entry ID')
        .setRequired(true))),
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!interaction.guildId || !(await verifyStaffOrAdmin(interaction.user, interaction.client)).authorized) {
            await interaction.editReply('Only official Victus Cloud staff can manage AI knowledge.');
            return;
        }
        const action = interaction.options.getSubcommand();
        try {
            if (action === 'add') {
                const topic = interaction.options.getString('topic', true).trim();
                const guidance = interaction.options.getString('guidance', true).trim();
                if (topic.length < 4 || guidance.length < 20) {
                    await interaction.editReply('Use a topic of at least 4 characters and guidance of at least 20 characters.');
                    return;
                }
                const id = await addStaffKnowledge(interaction.guildId, interaction.user.id, topic, guidance);
                await interaction.editReply(`Saved private Victus AI guidance. ID: \`${id}\``);
            }
            else if (action === 'remove') {
                const id = interaction.options.getString('id', true).trim();
                if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
                    await interaction.editReply('Enter a valid knowledge entry ID.');
                    return;
                }
                const removed = await removeStaffKnowledge(interaction.guildId, id);
                await interaction.editReply(removed ? 'Guidance removed.' : 'No staff-added guidance with that ID was found.');
            }
            else {
                const { data, error } = await supabase.client.from('victus_ai_knowledge')
                    .select('id,title,created_at').eq('guild_id', interaction.guildId)
                    .eq('source_type', 'staff_command').order('created_at', { ascending: false }).limit(15);
                if (error)
                    throw new Error(error.message);
                await interaction.editReply(data?.length
                    ? data.map((row) => `• ${row.title} — \`${row.id}\``).join('\n').slice(0, 1900)
                    : 'No staff-added guidance yet.');
            }
        }
        catch (error) {
            await interaction.editReply(`Knowledge operation failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1800));
        }
    },
};
