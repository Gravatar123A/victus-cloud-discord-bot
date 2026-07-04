import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import {
    summonChannel,
    dismissChannel,
    SUMMON_DEFAULT_MINUTES,
    SUMMON_MIN_MINUTES,
    SUMMON_MAX_MINUTES,
} from '../services/summonedChannels.js';
import { logger } from '../utils/logger.js';

function memberRoleIds(interaction: ChatInputCommandInteraction): string[] {
    const member = interaction.member as unknown as { roles?: unknown };
    if (!member) return [];
    const roles = member.roles as { cache?: { keys?: () => Iterable<string> } } | string[] | undefined;
    if (Array.isArray(roles)) return roles;
    const keys = roles?.cache?.keys;
    if (typeof keys === 'function') return [...keys.call(roles!.cache)];
    return [];
}

async function isStaff(interaction: ChatInputCommandInteraction): Promise<boolean> {
    const perms = interaction.memberPermissions;
    if (perms && (
        perms.has(PermissionFlagsBits.Administrator) ||
        perms.has(PermissionFlagsBits.ManageChannels) ||
        perms.has(PermissionFlagsBits.ManageMessages)
    )) {
        return true;
    }

    const settings = await supabase.getBotSettings(interaction.guildId as string).catch(() => null);
    const staffRoleIds = [
        ...((settings as { ticket_staff_role_ids?: string[] } | null)?.ticket_staff_role_ids || []),
        ...((settings as { ticket_admin_role_ids?: string[] } | null)?.ticket_admin_role_ids || []),
    ];
    if (!staffRoleIds.length) return false;

    const mine = memberRoleIds(interaction);
    return staffRoleIds.some((id) => mine.includes(id));
}

export const summonCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('summon')
        .setDescription('Summon the Victus AI to answer everyone in a channel (staff)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false)
        .addSubcommand((sub) =>
            sub
                .setName('here')
                .setDescription('Let the Victus AI answer every message in this channel')
                .addIntegerOption((opt) =>
                    opt
                        .setName('minutes')
                        .setDescription(`How long to stay active (default ${SUMMON_DEFAULT_MINUTES}, max ${SUMMON_MAX_MINUTES})`)
                        .setMinValue(SUMMON_MIN_MINUTES)
                        .setMaxValue(SUMMON_MAX_MINUTES)
                        .setRequired(false)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('dismiss')
                .setDescription('Stop the Victus AI from answering everyone in this channel')
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.inGuild()) {
            await interaction.reply({ content: 'Use this inside a server channel.', flags: MessageFlags.Ephemeral });
            return;
        }

        if (!(await isStaff(interaction))) {
            await interaction.reply({
                content: 'Only staff can summon or dismiss the Victus AI.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const sub = interaction.options.getSubcommand();
        const channelId = interaction.channelId;

        if (sub === 'dismiss') {
            const wasActive = dismissChannel(channelId);
            await interaction.reply({
                content: wasActive
                    ? '✅ **Victus AI dismissed.** I will stop answering everyone in this channel.'
                    : 'Victus AI was not active in this channel.',
            });
            return;
        }

        const minutes = interaction.options.getInteger('minutes') ?? SUMMON_DEFAULT_MINUTES;
        const expiresAt = summonChannel(channelId, minutes * 60_000);
        const unix = Math.floor(expiresAt / 1000);

        logger.info(`Victus AI summoned in channel ${channelId} for ${minutes}m by ${interaction.user.tag}`);

        await interaction.reply({
            content:
                `🔮 **Victus AI summoned.** I'll answer questions from everyone in this channel until <t:${unix}:t> (<t:${unix}:R>).\n` +
                'Staff can stop me early with `/summon dismiss`.',
        });
    },
};
