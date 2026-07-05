import { 
    EmbedBuilder,
    MessageFlags, 
    PermissionFlagsBits, 
    SlashCommandBuilder 
} from 'discord.js';
import type { Command } from '../types/index.js';
import { logger } from '../utils/logger.js';

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
            const dmEmbed = new EmbedBuilder()
                .setColor(0x8b5cf6) // Purple
                .setTitle('📬 Official Server Message')
                .setDescription(`You have received an official message from the administration of **${interaction.guild?.name}**:\n\n>>> ${messageText}`)
                .setFooter({ text: 'Victus Cloud • Official administration broadcast' })
                .setTimestamp();

            await targetUser.send({ embeds: [dmEmbed] });

            const successEmbed = new EmbedBuilder()
                .setColor(0x10b981) // Green
                .setTitle('✅ Message Delivered')
                .setDescription(`Your official DM was successfully sent to <@${targetUser.id}>.`);

            await interaction.editReply({ embeds: [successEmbed] });
        } catch (error: any) {
            logger.warn(`Failed to send DM to user ${targetUser.id}:`, error);
            const errorEmbed = new EmbedBuilder()
                .setColor(0xef4444) // Red
                .setTitle('⛔ Delivery Failed')
                .setDescription(`Could not send DM to <@${targetUser.id}>. Their DMs might be closed or they have blocked the bot.`);

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
};
