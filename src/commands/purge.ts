import { 
    MessageFlags, 
    PermissionFlagsBits, 
    SlashCommandBuilder, 
    EmbedBuilder 
} from 'discord.js';
import type { Command } from '../types/index.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

export const purgeCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Bulk-delete messages from this channel')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(opt => 
            opt.setName('count')
                .setDescription('Number of messages to delete (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)
        )
        .addUserOption(opt => 
            opt.setName('user')
                .setDescription('Filter messages to only delete from this user')
                .setRequired(false)
        ),

    async execute(interaction) {
        const count = interaction.options.getInteger('count', true);
        const targetUser = interaction.options.getUser('user', false);
        const channel = interaction.channel;

        if (!channel || !channel.isTextBased()) {
            const err = '❌ This command can only be used in text channels.';
            if (interaction.constructor.name === 'PrefixInteraction') {
                await interaction.reply({ content: err });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Invalid Channel', err)],
                    flags: V2 | EPH
                });
            }
            return;
        }

        const isPrefix = interaction.constructor.name === 'PrefixInteraction';

        try {
            let deletedCount = 0;

            if (targetUser) {
                // Fetch messages, filter by user, delete
                const messages = await channel.messages.fetch({ limit: 100 });
                const userMessages = [...messages.values()]
                    .filter(m => m.author.id === targetUser.id)
                    .slice(0, count);

                if (userMessages.length > 0) {
                    const deleted = await (channel as any).bulkDelete(userMessages, true);
                    deletedCount = deleted.size;
                }
            } else {
                const deleted = await (channel as any).bulkDelete(count, true);
                deletedCount = deleted.size;
            }

            const successMsg = `Successfully deleted **${deletedCount}** message${deletedCount === 1 ? '' : 's'}${targetUser ? ` from <@${targetUser.id}>` : ''}.`;

            if (isPrefix) {
                const embed = new EmbedBuilder()
                    .setColor(0x2b2d31)
                    .setTitle('✅ Messages Purged')
                    .setDescription(successMsg);
                await interaction.reply({ embeds: [embed] });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.successContainer('Purged Messages', successMsg)],
                    flags: V2 | EPH
                });
            }
        } catch (err: any) {
            logger.error('Failed to purge messages:', err);
            const errMsg = '❌ Failed to purge messages. Note: Discord does not allow bulk deletion of messages older than 14 days.';
            if (isPrefix) {
                await interaction.reply({ content: errMsg });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Purge Failed', errMsg)],
                    flags: V2 | EPH
                });
            }
        }
    }
};
