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

export const unbanCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a user from the server')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addStringOption(opt => 
            opt.setName('user_id')
                .setDescription('The Discord ID of the user to unban')
                .setRequired(true)
        )
        .addStringOption(opt => 
            opt.setName('reason')
                .setDescription('Reason for removing the ban')
                .setRequired(false)
        ),

    async execute(interaction) {
        const userId = interaction.options.getString('user_id', true).trim();
        const reason = interaction.options.getString('reason', false) || 'No reason provided';
        const guild = interaction.guild;

        if (!guild) return;

        const isPrefix = interaction.constructor.name === 'PrefixInteraction';

        try {
            // Check if the user is actually banned
            const banInfo = await guild.bans.fetch(userId).catch(() => null);

            if (!banInfo) {
                const err = '❌ This user is not currently banned from this server.';
                if (isPrefix) {
                    await interaction.reply({ content: err });
                } else {
                    await interaction.reply({
                        components: [ComponentsV2.errorContainer('Not Banned', err)],
                        flags: V2 | EPH
                    });
                }
                return;
            }

            await guild.members.unban(userId, reason);

            const successMsg = `Successfully unbanned **${banInfo.user.username}**.\n**Reason:** ${reason}`;

            if (isPrefix) {
                const embed = new EmbedBuilder()
                    .setColor(0x2b2d31)
                    .setTitle('✅ User Unbanned')
                    .setDescription(successMsg);
                await interaction.reply({ embeds: [embed] });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.successContainer('Member Unbanned', successMsg)],
                    flags: V2 | EPH
                });
            }
        } catch (err: any) {
            logger.error('Failed to unban user:', err);
            const errMsg = '❌ Failed to unban user. Make sure you entered a valid Discord ID and that I have ban permissions.';
            if (isPrefix) {
                await interaction.reply({ content: errMsg });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Unban Failed', errMsg)],
                    flags: V2 | EPH
                });
            }
        }
    }
};
