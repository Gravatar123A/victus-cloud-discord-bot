import { 
    MessageFlags, 
    PermissionFlagsBits, 
    SlashCommandBuilder 
} from 'discord.js';
import type { Command } from '../types/index.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

export const dmCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('dm')
        .setDescription('Send a direct message to a server member (Administrator only)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => 
            opt.setName('user')
                .setDescription('The user to message')
                .setRequired(true)
        )
        .addStringOption(opt => 
            opt.setName('message')
                .setDescription('The message content to send')
                .setRequired(true)
        ),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user', true);
        const messageText = interaction.options.getString('message', true);

        if (targetUser.bot) {
            await interaction.reply({ content: '❌ You cannot send DMs to other bots.', flags: EPH });
            return;
        }

        await interaction.deferReply({ flags: EPH });

        try {
            const dmContainer = ComponentsV2.baseContainer(ComponentsV2.Accents.purple);
            dmContainer.addTextDisplayComponents(
                ComponentsV2.text(
                    `# 📬 Official Server Message\n` +
                    `You have received an official message from the administration of **${interaction.guild?.name}**:\n\n` +
                    `>>> ${messageText}`
                )
            ).addSeparatorComponents(ComponentsV2.separator());

            await targetUser.send({
                components: [dmContainer],
                flags: V2
            });

            await interaction.editReply({
                components: [ComponentsV2.successContainer('Message Delivered', `Your official DM was successfully sent to <@${targetUser.id}>.`)]
            });
        } catch (error: any) {
            logger.warn(`Failed to send DM to user ${targetUser.id}:`, error);
            await interaction.editReply({
                components: [ComponentsV2.errorContainer('Delivery Failed', `Could not send DM to <@${targetUser.id}>. Their DMs might be closed or they have blocked the bot.`)]
            });
        }
    }
};
