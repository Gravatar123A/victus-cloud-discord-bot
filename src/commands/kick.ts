import { 
    MessageFlags, 
    PermissionFlagsBits, 
    SlashCommandBuilder, 
    EmbedBuilder,
    GuildMember
} from 'discord.js';
import type { Command } from '../types/index.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';
import { whitelistSettings } from '../services/whitelistSettings.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

export const kickCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a member from the server')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
        .addUserOption(opt => 
            opt.setName('user')
                .setDescription('The user to kick')
                .setRequired(true)
        )
        .addStringOption(opt => 
            opt.setName('reason')
                .setDescription('Reason for the kick')
                .setRequired(false)
        ),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason', false) || 'No reason provided';
        const guild = interaction.guild;

        if (!guild) return;

        const isPrefix = interaction.constructor.name === 'PrefixInteraction';

        if (user.id === interaction.user.id) {
            const err = '❌ You cannot kick yourself.';
            if (isPrefix) {
                await interaction.reply({ content: err });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Invalid Target', err)],
                    flags: V2 | EPH
                });
            }
            return;
        }

        const isWhitelisted = await whitelistSettings.isImmune(guild.id, user.id, 'kick');
        if (isWhitelisted) {
            const err = '❌ This user is whitelisted and immune to kicks.';
            if (isPrefix) {
                await interaction.reply({ content: err });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Action Blocked', err)],
                    flags: V2 | EPH
                });
            }
            return;
        }

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

        // Hierarchy check
        const selfMember = guild.members.me;
        if (selfMember && targetMember.roles.highest.position >= selfMember.roles.highest.position) {
            const err = '❌ I cannot kick this user because their highest role is equal to or higher than mine.';
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
            const err = '❌ You cannot kick the server owner.';
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
            .setColor(0xef4444)
            .setTitle(`👢 Kicked from ${guild.name}`)
            .setDescription(`You have been kicked from **${guild.name}**.\n\n**Reason:** ${reason}`)
            .setTimestamp();

        await user.send({ embeds: [dmEmbed] }).catch(() => {
            logger.debug(`Could not send Kick DM to ${user.tag}`);
        });

        try {
            await targetMember.kick(reason);

            const successMsg = `Successfully kicked **${user.username}**.\n**Reason:** ${reason}`;

            if (isPrefix) {
                const embed = new EmbedBuilder()
                    .setColor(0x2b2d31)
                    .setTitle('✅ User Kicked')
                    .setDescription(successMsg);
                await interaction.reply({ embeds: [embed] });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.successContainer('Member Kicked', successMsg)],
                    flags: V2 | EPH
                });
            }
        } catch (err: any) {
            logger.error('Failed to kick member:', err);
            const errMsg = '❌ Failed to kick user. Make sure I have appropriate administrative/kick permissions.';
            if (isPrefix) {
                await interaction.reply({ content: errMsg });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Kick Failed', errMsg)],
                    flags: V2 | EPH
                });
            }
        }
    }
};
