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

export const untimeoutCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('untimeout')
        .setDescription('Remove timeout/mute from a server member')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(opt => 
            opt.setName('user')
                .setDescription('The user to untimeout')
                .setRequired(true)
        )
        .addStringOption(opt => 
            opt.setName('reason')
                .setDescription('Reason for removing the timeout')
                .setRequired(false)
        ),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason', false) || 'No reason provided';
        const guild = interaction.guild;

        if (!guild) return;

        const isPrefix = interaction.constructor.name === 'PrefixInteraction';
        const targetMember = await guild.members.fetch(user.id).catch(() => null);

        if (!targetMember) {
            const err = '❌ User is not a member of this server.';
            if (isPrefix) {
                await interaction.reply({ content: err });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Not Found', err)],
                    flags: V2 | EPH
                });
            }
            return;
        }

        if (!targetMember.communicationDisabledUntilTimestamp) {
            const err = '❌ This user is not currently in a timeout.';
            if (isPrefix) {
                await interaction.reply({ content: err });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Not Muted', err)],
                    flags: V2 | EPH
                });
            }
            return;
        }

        // Hierarchy check
        const selfMember = guild.members.me;
        if (selfMember && targetMember.roles.highest.position >= selfMember.roles.highest.position) {
            const err = '❌ I cannot remove the timeout for this user because their highest role is equal to or higher than mine.';
            if (isPrefix) {
                await interaction.reply({ content: err });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Permission Denied', err)],
                    flags: V2 | EPH
                });
            }
            return;
        }

        // Try to DM the user
        const dmEmbed = new EmbedBuilder()
            .setColor(0x10b981)
            .setTitle(`🔊 Timeout Removed in ${guild.name}`)
            .setDescription(`Your timeout has been removed in **${guild.name}**.\n\n**Reason:** ${reason}`)
            .setTimestamp();

        await user.send({ embeds: [dmEmbed] }).catch(() => {
            logger.debug(`Could not send Untimeout DM to ${user.tag}`);
        });

        try {
            await targetMember.timeout(null, reason);

            const successMsg = `Successfully removed timeout for **${user.username}**.\n**Reason:** ${reason}`;

            if (isPrefix) {
                const embed = new EmbedBuilder()
                    .setColor(0x2b2d31)
                    .setTitle('✅ Timeout Removed')
                    .setDescription(successMsg);
                await interaction.reply({ embeds: [embed] });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.successContainer('Timeout Removed', successMsg)],
                    flags: V2 | EPH
                });
            }
        } catch (err: any) {
            logger.error('Failed to remove timeout:', err);
            const errMsg = '❌ Failed to remove timeout. Make sure I have appropriate administrative/timeout permissions.';
            if (isPrefix) {
                await interaction.reply({ content: errMsg });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Action Failed', errMsg)],
                    flags: V2 | EPH
                });
            }
        }
    }
};
