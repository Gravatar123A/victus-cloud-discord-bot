import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { successEmbed, errorEmbed } from '../embeds/theme.js';
import { requireAdmin } from '../middleware/requireLinked.js';
import { logger } from '../utils/logger.js';
import { VICTUS_COLORS } from '../types/index.js';

function parseDiscordId(raw: string): string | null {
    return (String(raw).match(/\d{15,20}/) || [])[0] || null;
}

async function resolveTarget(
    interaction: any,
    rawTarget: string
): Promise<{ email?: string; userId?: string; discordId?: string; label: string; error?: string }> {
    const cleaned = rawTarget.trim();

    // Email case: contains @
    if (cleaned.includes('@')) {
        const email = cleaned.toLowerCase();
        // Basic email validation
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return { error: `Invalid email format: \`${cleaned}\`` } as any;
        }
        return { email, label: email };
    }

    // Try to extract Discord ID from mention or raw ID
    let discordId = parseDiscordId(cleaned);

    // If not a mention/ID, try to find by username in guild
    if (!discordId && interaction.guild) {
        const usernameLower = cleaned.toLowerCase().replace(/^@/, '');
        // Remove discriminator if present (old style username#1234)
        const baseName = usernameLower.split('#')[0];

        try {
            // Try to fetch all members and find by username/displayName
            // First, try exact username match via guild members
            const members = await interaction.guild.members.fetch({ query: baseName, limit: 10 }).catch(() => null);
            if (members && members.size > 0) {
                // Find exact match
                for (const [, member] of members) {
                    if (
                        member.user.username.toLowerCase() === baseName ||
                        member.user.globalName?.toLowerCase() === baseName ||
                        member.displayName.toLowerCase() === baseName ||
                        member.user.tag.toLowerCase() === usernameLower
                    ) {
                        discordId = member.id;
                        break;
                    }
                }
                // If no exact match, take first result if only one
                if (!discordId && members.size === 1) {
                    discordId = members.first()!.id;
                }
            }
        } catch (e) {
            logger.warn(`Failed to search guild members for ${cleaned}:`, e);
        }

        // Fallback: try to find via client users cache
        if (!discordId) {
            const cachedUser = interaction.client.users.cache.find(
                (u: any) =>
                    u.username.toLowerCase() === baseName ||
                    u.globalName?.toLowerCase() === baseName ||
                    u.tag.toLowerCase() === usernameLower
            );
            if (cachedUser) discordId = cachedUser.id;
        }
    }

    if (!discordId) {
        return {
            error: `Could not find Discord user \`${cleaned}\`. Use their @mention, Discord ID, or email. If using a username, make sure they are in this server and try mentioning them.`,
        } as any;
    }

    // Check if this Discord user is linked
    const linked = await supabase.getLinkedAccount(discordId).catch(() => null);
    if (!linked?.user_id) {
        return {
            error: `Discord user <@${discordId}> has not linked their Victus Cloud account. They need to run \`/link\` first before they can receive coins.`,
            discordId,
            label: `<@${discordId}> (not linked)`,
        } as any;
    }

    // Get their profile to find email
    const profile = await supabase.getUserProfile(linked.user_id).catch(() => null);
    if (!profile?.email) {
        // Fallback: try to use user_id directly if no email
        return {
            userId: linked.user_id,
            discordId,
            label: `<@${discordId}> (ID: ${linked.user_id})`,
        };
    }

    return {
        email: String(profile.email).toLowerCase(),
        userId: linked.user_id,
        discordId,
        label: `${profile.email} (Discord <@${discordId}>)`,
    };
}

export const giveCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('give')
        .setDescription('Admin command to give coins to users')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .addSubcommand((sub) =>
            sub
                .setName('coins')
                .setDescription('Give coins to a user (email or Discord username)')
                .addNumberOption((opt) =>
                    opt
                        .setName('amount')
                        .setDescription('Amount of coins to give')
                        .setMinValue(1)
                        .setMaxValue(100000)
                        .setRequired(true)
                )
                .addStringOption((opt) =>
                    opt
                        .setName('target')
                        .setDescription('User email or Discord username/mention/ID')
                        .setRequired(true)
                )
        ),

    adminOnly: true,
    cooldown: 3,

    async execute(interaction) {
        const isAdmin = await requireAdmin(interaction);
        if (!isAdmin) return;

        const subcommand = interaction.options.getSubcommand();
        if (subcommand !== 'coins') return;

        await interaction.deferReply({ ephemeral: true });

        try {
            const amount = interaction.options.getNumber('amount', true);
            const rawTarget = interaction.options.getString('target', true);

            if (!Number.isFinite(amount) || amount <= 0) {
                await interaction.editReply({
                    embeds: [errorEmbed('Invalid amount', 'Amount must be a positive number.')],
                });
                return;
            }

            const amt = Math.floor(amount);
            if (amt < 1 || amt > 100000) {
                await interaction.editReply({
                    embeds: [errorEmbed('Invalid amount', 'Amount must be between 1 and 100,000 coins.')],
                });
                return;
            }

            // Resolve target
            const resolved = await resolveTarget(interaction, rawTarget);
            if ((resolved as any).error) {
                await interaction.editReply({
                    embeds: [errorEmbed('Target not found', (resolved as any).error)],
                });
                return;
            }

            const email = (resolved as any).email as string | undefined;
            const userId = (resolved as any).userId as string | undefined;
            const label = (resolved as any).label as string;

            // If we have discordId but no email/userId and it's not linked, we already returned error above
            // Now we try to give coins via Paymenter

            const targetEmail = email?.toLowerCase();
            const targetUserId = userId;

            // Double-check: if we only have userId but no email, try to get email
            let finalEmail = targetEmail;
            let finalUserId = targetUserId;
            if (!finalEmail && finalUserId) {
                const profile = await supabase.getUserProfile(finalUserId).catch(() => null);
                if (profile?.email) finalEmail = String(profile.email).toLowerCase();
            }

            if (!finalEmail && !finalUserId) {
                await interaction.editReply({
                    embeds: [errorEmbed('Target not found', `Could not resolve \`${rawTarget}\` to a Victus Cloud account. Use their email or make sure their Discord is linked via \`/link\`.` )],
                });
                return;
            }

            // Generate a unique reference for idempotency
            const reference = `admin_give:${interaction.user.id}:${finalUserId || finalEmail}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
            const description = `Admin /give coins ${amt} to ${label} by ${interaction.user.tag}`;

            let newBalance: number | null = null;
            let success = false;
            let errorMsg: string | null = null;

            try {
                // Use the internal Paymenter coin API via supabase service
                // We need an email - if we only have userId, we must get email first
                let emailForPaymenter = finalEmail;
                if (!emailForPaymenter && finalUserId) {
                    const profile = await supabase.getUserProfile(finalUserId).catch(() => null);
                    if (profile?.email) emailForPaymenter = String(profile.email).toLowerCase();
                }

                if (!emailForPaymenter) {
                    throw new Error('Target user has no email on file. Cannot give coins via Paymenter.');
                }

                // Use mutatePaymenterCoins (positive delta = grant)
                newBalance = await supabase.mutatePaymenterCoins(
                    emailForPaymenter,
                    amt,
                    'admin_give',
                    reference,
                    description
                );

                // Mirror to Supabase profile if we have userId
                if (finalUserId && typeof newBalance === 'number') {
                    await supabase.mirrorProfileCoinsFromPaymenter(finalUserId, newBalance, 'admin_give').catch(() => null);
                } else if (finalEmail && typeof newBalance === 'number') {
                    try {
                        const { data: profile } = await supabase.client
                            .from('profiles')
                            .select('id')
                            .eq('email', emailForPaymenter)
                            .maybeSingle();
                        if (profile?.id) {
                            await supabase.mirrorProfileCoinsFromPaymenter(profile.id, newBalance, 'admin_give').catch(() => null);
                            finalUserId = profile.id;
                        }
                    } catch {}
                }

                success = typeof newBalance === 'number';
            } catch (e: any) {
                errorMsg = e?.message || String(e);
                logger.error('Admin /give coins failed:', e);
            }

            if (!success || newBalance === null) {
                await interaction.editReply({
                    embeds: [
                        errorEmbed(
                            'Failed to give coins',
                            errorMsg
                                ? `Paymenter error: ${errorMsg.slice(0, 1000)}`
                                : `Could not give **${amt.toLocaleString()} coins** to ${label}. The Paymenter account may not exist or the coin service is temporarily unavailable.`
                        ),
                    ],
                });
                return;
            }

            // Success
            const embed = new EmbedBuilder()
                .setColor(VICTUS_COLORS.success)
                .setTitle('✅ Coins Given')
                .setDescription(
                    [
                        `Gave **${amt.toLocaleString()} coins** to ${label}`,
                        ``,
                        `**New balance:** **${Number(newBalance).toLocaleString()} coins**`,
                        `**Reference:** \`${reference.slice(0, 40)}\``,
                    ].join('\n')
                )
                .setFooter({
                    text: `Given by ${interaction.user.tag}`,
                    iconURL: interaction.user.displayAvatarURL(),
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

            // Log audit
            await supabase.logAudit(
                interaction.user.id,
                interaction.user.tag,
                'admin_give_coins',
                'paymenter_user',
                String(finalUserId || finalEmail || rawTarget),
                {
                    target: rawTarget,
                    resolved,
                    amount: amt,
                    newBalance,
                    reference,
                }
            ).catch(() => null);

            // Also try to DM the recipient if we have their Discord ID
            const targetDiscordId = (resolved as any).discordId as string | undefined;
            if (targetDiscordId) {
                try {
                    const targetUser = await interaction.client.users.fetch(targetDiscordId).catch(() => null);
                    if (targetUser) {
                        const dmEmbed = new EmbedBuilder()
                            .setColor(VICTUS_COLORS.success)
                            .setTitle('💰 You received coins!')
                            .setDescription(
                                `You just received **${amt.toLocaleString()} coins** from the Victus Cloud staff!\n\n` +
                                `**New balance:** **${Number(newBalance).toLocaleString()} coins**\n\n` +
                                `Check your balance with \`/economy\` or on the panel at https://control.victuscloud.com/coins`
                            )
                            .setTimestamp();
                        await targetUser.send({ embeds: [dmEmbed] }).catch(() => null);
                    }
                } catch {}
            }
        } catch (error) {
            logger.error('Give coins command error:', error);
            const message = error instanceof Error ? error.message : 'An error occurred while processing the command.';
            try {
                await interaction.editReply({
                    embeds: [errorEmbed('Error', message.slice(0, 3500))],
                });
            } catch {}
        }
    },
};
