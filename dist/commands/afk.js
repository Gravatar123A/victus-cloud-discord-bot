import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { afkService } from '../services/afkService.js';
import { logger } from '../utils/logger.js';
export const afkCommand = {
    data: new SlashCommandBuilder()
        .setName('afk')
        .setDescription('Set your status to AFK (Away From Keyboard)')
        .setDMPermission(false)
        .addStringOption((o) => o.setName('reason').setDescription('The reason you are AFK').setRequired(false).setMaxLength(100)),
    async execute(interaction) {
        const reason = interaction.options.getString('reason') || 'AFK';
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        try {
            await afkService.setAfk(guildId, userId, reason);
            const embed = new EmbedBuilder()
                .setColor(0x2b2d31)
                .setTitle('AFK Status Set')
                .setThumbnail(interaction.user.displayAvatarURL())
                .setDescription(`${interaction.user.username} is now AFK.`)
                .addFields({ name: 'Reason', value: reason, inline: false }, { name: 'Since', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }, { name: 'Scope', value: 'Server Only', inline: true })
                .setFooter({ text: 'You will be notified if someone mentions you.' });
            await interaction.reply({ embeds: [embed] });
        }
        catch (error) {
            logger.error('Failed to set AFK status:', error);
            await interaction.reply({ content: '❌ Failed to set your AFK status. Please try again.' });
        }
    }
};
