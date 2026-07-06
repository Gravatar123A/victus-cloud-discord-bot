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

export const banCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a member from the server')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addUserOption(opt => 
            opt.setName('user')
                .setDescription('The user to ban')
                .setRequired(true)
        )
        .addStringOption(opt => 
            opt.setName('reason')
                .setDescription('Reason for the ban')
                .setRequired(false)
        )
        .addIntegerOption(opt =>
            opt.setName('delete_days')
                .setDescription('Delete messages from this user (0-7 days)')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(7)
        ),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason', false) || 'No reason provided';
        const deleteDays = interaction.options.getInteger('delete_days', false) || 0;
        const guild = interaction.guild;

        if (!guild) return;

        const isPrefix = interaction.constructor.name === 'PrefixInteraction';
        const targetMember = await guild.members.fetch(user.id).catch(() => null);

        if (targetMember) {
            // Hierarchy check
            const selfMember = guild.members.me;
            if (selfMember && targetMember.roles.highest.position >= selfMember.roles.highest.position) {
                const err = '❌ I cannot ban this user because their highest role is equal to or higher than mine.';
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

            if (targetMember.id === guild.ownerId) {
                const err = '❌ You cannot ban the server owner.';
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
        }

        // Try to DM the user
        const dmEmbed = new EmbedBuilder()
            .setColor(0xdc2626)
            .setTitle(`🔨 Banned from ${guild.name}`)
            .setDescription(`You have been permanently banned from **${guild.name}**.\n\n**Reason:** ${reason}`)
            .setTimestamp();

        await user.send({ embeds: [dmEmbed] }).catch(() => {
            logger.debug(`Could not send Ban DM to ${user.tag}`);
        });

        try {
            await guild.members.ban(user.id, {
                reason: reason,
                deleteMessageSeconds: deleteDays * 24 * 60 * 60
            });

            const successMsg = `Successfully banned **${user.username}**.\n**Reason:** ${reason}${deleteDays > 0 ? `\n**Cleared messages:** last ${deleteDays} days` : ''}`;

            if (isPrefix) {
                const embed = new EmbedBuilder()
                    .setColor(0x2b2d31)
                    .setTitle('✅ User Banned')
                    .setDescription(successMsg);
                await interaction.reply({ embeds: [embed] });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.successContainer('Member Banned', successMsg)],
                    flags: V2 | EPH
                });
            }
        } catch (err: any) {
            logger.error('Failed to ban member:', err);
            const errMsg = '❌ Failed to ban user. Make sure I have appropriate administrative/ban permissions.';
            if (isPrefix) {
                await interaction.reply({ content: errMsg });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Ban Failed', errMsg)],
                    flags: V2 | EPH
                });
            }
        }
    }
};
