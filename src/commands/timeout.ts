import { 
    MessageFlags, 
    PermissionFlagsBits, 
    SlashCommandBuilder, 
    EmbedBuilder 
} from 'discord.js';
import type { Command } from '../types/index.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';
import { whitelistSettings } from '../services/whitelistSettings.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

function parseDuration(str: string): number | null {
    const match = str.toLowerCase().match(/^(\d+)(s|m|h|d)$/);
    if (!match) return null;

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
        case 's': return value * 1000;
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return null;
    }
}

export const timeoutCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Temporarily timeout/mute a server member')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(opt => 
            opt.setName('user')
                .setDescription('The user to timeout')
                .setRequired(true)
        )
        .addStringOption(opt => 
            opt.setName('duration')
                .setDescription('Timeout duration (e.g. 10m, 1h, 1d, 30s)')
                .setRequired(true)
        )
        .addStringOption(opt => 
            opt.setName('reason')
                .setDescription('Reason for the timeout')
                .setRequired(false)
        ),

    async execute(interaction) {
        const user = interaction.options.getUser('user', true);
        const durationStr = interaction.options.getString('duration', true);
        const reason = interaction.options.getString('reason', false) || 'No reason provided';
        const guild = interaction.guild;

        if (!guild) return;

        const isPrefix = interaction.constructor.name === 'PrefixInteraction';

        if (user.id === interaction.user.id) {
            const err = '❌ You cannot timeout yourself.';
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

        const isWhitelisted = await whitelistSettings.isImmune(guild.id, user.id, 'timeout');
        if (isWhitelisted) {
            const err = '❌ This user is whitelisted and immune to timeouts.';
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

        const durationMs = parseDuration(durationStr);
        if (!durationMs || durationMs <= 0) {
            const err = '❌ Invalid duration format. Use formats like `10m` (minutes), `2h` (hours), `1d` (days), or `30s` (seconds).';
            if (isPrefix) {
                await interaction.reply({ content: err });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Invalid Duration', err)],
                    flags: V2 | EPH
                });
            }
            return;
        }

        // Discord limit is 28 days
        const maxDuration = 28 * 24 * 60 * 60 * 1000;
        if (durationMs > maxDuration) {
            const err = '❌ Max timeout duration is 28 days.';
            if (isPrefix) {
                await interaction.reply({ content: err });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Duration Limit Exceeded', err)],
                    flags: V2 | EPH
                });
            }
            return;
        }

        // Hierarchy check
        const selfMember = guild.members.me;
        if (selfMember && targetMember.roles.highest.position >= selfMember.roles.highest.position) {
            const err = '❌ I cannot timeout this user because their highest role is equal to or higher than mine.';
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
            const err = '❌ You cannot timeout the server owner.';
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
            .setColor(0xf59e0b)
            .setTitle(`🔇 Timed out in ${guild.name}`)
            .setDescription(`You have been placed in timeout in **${guild.name}** for **${durationStr}**.\n\n**Reason:** ${reason}`)
            .setTimestamp();

        await user.send({ embeds: [dmEmbed] }).catch(() => {
            logger.debug(`Could not send Timeout DM to ${user.tag}`);
        });

        try {
            await targetMember.timeout(durationMs, reason);

            const successMsg = `Successfully timed out **${user.username}** for **${durationStr}**.\n**Reason:** ${reason}`;

            if (isPrefix) {
                const embed = new EmbedBuilder()
                    .setColor(0x2b2d31)
                    .setTitle('✅ User Timed Out')
                    .setDescription(successMsg);
                await interaction.reply({ embeds: [embed] });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.successContainer('Member Muted', successMsg)],
                    flags: V2 | EPH
                });
            }
        } catch (err: any) {
            logger.error('Failed to timeout member:', err);
            const errMsg = '❌ Failed to timeout user. Make sure I have appropriate administrative/timeout permissions.';
            if (isPrefix) {
                await interaction.reply({ content: errMsg });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Timeout Failed', errMsg)],
                    flags: V2 | EPH
                });
            }
        }
    }
};
