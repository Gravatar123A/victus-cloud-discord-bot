import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ChannelType,
} from 'discord.js';
import type { Command } from '../../types/index.js';
import { supabase } from '../../services/supabase.js';
import { config } from '../../config.js';
import {
    BOT_BANNER_URL,
    createEmbed,
    successEmbed,
    errorEmbed,
    warningEmbed,
} from '../../embeds/theme.js';
import { requireAdmin } from '../../middleware/requireLinked.js';
import { createPagination } from '../../utils/pagination.js';
import { logger } from '../../utils/logger.js';
import { VICTUS_COLORS } from '../../types/index.js';

export const adminCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Admin-only commands for managing the platform')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand((sub) =>
            sub
                .setName('search')
                .setDescription('Search for users across the platform')
                .addStringOption((opt) =>
                    opt
                        .setName('query')
                        .setDescription('Search by email, username, or Discord ID')
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('announce')
                .setDescription('Broadcast an announcement')
                .addStringOption((opt) =>
                    opt
                        .setName('title')
                        .setDescription('Announcement title')
                        .setRequired(true)
                )
                .addStringOption((opt) =>
                    opt
                        .setName('message')
                        .setDescription('Announcement message')
                        .setRequired(true)
                )
                .addStringOption((opt) =>
                    opt
                        .setName('type')
                        .setDescription('Announcement type')
                        .addChoices(
                            { name: '📘 Info', value: 'info' },
                            { name: '✅ Success', value: 'success' },
                            { name: '⚠️ Warning', value: 'warning' },
                            { name: '❌ Error', value: 'error' }
                        )
                )
                .addChannelOption((opt) =>
                    opt
                        .setName('channel')
                        .setDescription('Channel to post announcement (optional)')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('link')
                .setDescription('Force link a Discord account to a Victus Cloud user')
                .addUserOption((opt) =>
                    opt
                        .setName('discord_user')
                        .setDescription('Discord user to link')
                        .setRequired(true)
                )
                .addStringOption((opt) =>
                    opt
                        .setName('user_id')
                        .setDescription('Victus Cloud user ID (UUID)')
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('unlink')
                .setDescription('Force unlink a Discord account')
                .addUserOption((opt) =>
                    opt
                        .setName('discord_user')
                        .setDescription('Discord user to unlink')
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('servers')
                .setDescription('View all servers across the platform')
        )
        .addSubcommand((sub) =>
            sub
                .setName('stats')
                .setDescription('View platform statistics')
        ),

    adminOnly: true,
    cooldown: 3,

    async execute(interaction) {
        const isAdmin = await requireAdmin(interaction);
        if (!isAdmin) return;

        const subcommand = interaction.options.getSubcommand();
        await interaction.deferReply({ ephemeral: true });

        try {
            switch (subcommand) {
                case 'search':
                    await handleSearch(interaction);
                    break;
                case 'announce':
                    await handleAnnounce(interaction);
                    break;
                case 'link':
                    await handleForceLink(interaction);
                    break;
                case 'unlink':
                    await handleForceUnlink(interaction);
                    break;
                case 'servers':
                    await handleServers(interaction);
                    break;
                case 'stats':
                    await handleStats(interaction);
                    break;
            }
        } catch (error) {
            logger.error('Admin command error:', error);
            await interaction.editReply({
                embeds: [errorEmbed('Error', 'An error occurred while processing the command.')],
            });
        }
    },
};

async function handleSearch(interaction: any) {
    const query = interaction.options.getString('query', true);

    // Search billing users
    const billingUsers = await supabase.getBillingUsers();
    const results = billingUsers.filter((u: any) =>
        u.email?.toLowerCase().includes(query.toLowerCase()) ||
        u.name?.toLowerCase().includes(query.toLowerCase()) ||
        String(u.id).includes(query)
    );

    if (results.length === 0) {
        await interaction.editReply({
            embeds: [
                createEmbed({
                    title: '🔍 Search Results',
                    description: `No users found matching \`${query}\``,
                    color: 'neutral',
                }),
            ],
        });
        return;
    }

    await createPagination(interaction, {
        items: results,
        itemsPerPage: 5,
        embedBuilder: (items, page, totalPages) => {
            return new EmbedBuilder()
                .setColor(VICTUS_COLORS.primary)
                .setTitle(`🔍 Search Results for "${query}"`)
                .setDescription(
                    items
                        .map((u: any) =>
                            `**${u.name || 'Unknown'}** (ID: ${u.id})\n` +
                            `╰ Email: ${u.email || 'N/A'}\n` +
                            `╰ Created: <t:${Math.floor(new Date(u.created_at).getTime() / 1000)}:R>`
                        )
                        .join('\n\n')
                )
                .setFooter({
                    text: `Page ${page + 1}/${totalPages} • ${results.length} result${results.length !== 1 ? 's' : ''}`,
                    iconURL: config.branding.logo,
                });
        },
    });
}

async function handleAnnounce(interaction: any) {
    const title = interaction.options.getString('title', true);
    const message = interaction.options.getString('message', true);
    const type = interaction.options.getString('type') || 'info';
    const channel = interaction.options.getChannel('channel');

    const typeEmojis = {
        info: '📘',
        success: '✅',
        warning: '⚠️',
        error: '❌',
    };

    const typeColors = {
        info: VICTUS_COLORS.info,
        success: VICTUS_COLORS.success,
        warning: VICTUS_COLORS.warning,
        error: VICTUS_COLORS.error,
    };

    const embed = new EmbedBuilder()
        .setColor(typeColors[type as keyof typeof typeColors])
        .setImage(BOT_BANNER_URL)
        .setAuthor({
            name: 'Victus Cloud Announcement',
            iconURL: config.branding.logo,
        })
        .setTitle(`${typeEmojis[type as keyof typeof typeEmojis]} ${title}`)
        .setDescription(message)
        .setFooter({
            text: `Posted by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL(),
        })
        .setTimestamp();

    // Post to channel if specified
    if (channel) {
        try {
            await channel.send({ embeds: [embed] });

            // Also save to database
            await supabase.createDiscordAnnouncement({
                guild_id: interaction.guildId!,
                title,
                content: message,
                type: type as 'info' | 'warning' | 'success' | 'error',
                target: 'channel',
                channel_id: channel.id,
                created_by: interaction.user.id,
                created_by_name: interaction.user.tag,
            });

            await interaction.editReply({
                embeds: [
                    successEmbed(
                        'Announcement Posted',
                        `Announcement has been posted to ${channel}.`
                    ),
                ],
            });

            // Log audit
            await supabase.logAudit(
                interaction.user.id,
                interaction.user.tag,
                'announcement_created',
                'announcement',
                title,
                { title, message, type, channel_id: channel.id }
            );
        } catch (error) {
            await interaction.editReply({
                embeds: [errorEmbed('Error', 'Failed to post announcement to channel.')],
            });
        }
    } else {
        // Just preview
        await interaction.editReply({
            content: '**Preview (not posted yet):**',
            embeds: [embed],
        });
    }
}

async function handleForceLink(interaction: any) {
    const discordUser = interaction.options.getUser('discord_user', true);
    const userId = interaction.options.getString('user_id', true);

    // TODO: Implement force link via Supabase direct insert

    await interaction.editReply({
        embeds: [
            successEmbed(
                'Account Linked',
                `Linked <@${discordUser.id}> to Victus Cloud user \`${userId}\``
            ),
        ],
    });

    await supabase.logAudit(
        interaction.user.id,
        interaction.user.tag,
        'force_link',
        'user',
        discordUser.id,
        { discord_id: discordUser.id, user_id: userId }
    );
}

async function handleForceUnlink(interaction: any) {
    const discordUser = interaction.options.getUser('discord_user', true);

    const success = await supabase.unlinkAccount(discordUser.id);

    if (success) {
        await interaction.editReply({
            embeds: [
                successEmbed(
                    'Account Unlinked',
                    `Unlinked <@${discordUser.id}> from Victus Cloud.`
                ),
            ],
        });

        await supabase.logAudit(
            interaction.user.id,
            interaction.user.tag,
            'force_unlink',
            'user',
            discordUser.id,
            { discord_id: discordUser.id }
        );
    } else {
        await interaction.editReply({
            embeds: [warningEmbed('Not Linked', 'This user does not have a linked account.')],
        });
    }
}

async function handleServers(interaction: any) {
    const servers = await supabase.getServers();

    await createPagination(interaction, {
        items: servers,
        itemsPerPage: 10,
        embedBuilder: (items, page, totalPages) => {
            return new EmbedBuilder()
                .setColor(VICTUS_COLORS.primary)
                .setTitle('🎮 All Platform Servers')
                .setDescription(
                    items.length > 0
                        ? items
                            .map((s: any) => `• **${s.name}** (\`${s.identifier}\`) - Node #${s.node}`)
                            .join('\n')
                        : 'No servers found.'
                )
                .setFooter({
                    text: `Page ${page + 1}/${totalPages} • ${servers.length} total servers`,
                    iconURL: config.branding.logo,
                });
        },
    });
}

async function handleStats(interaction: any) {
    const servers = await supabase.getServers();
    const nodes = await supabase.getNodes();
    const billingUsers = await supabase.getBillingUsers();
    const invoices = await supabase.getInvoices();

    const paidInvoices = invoices.filter((i: any) => i.status === 'paid');
    const totalRevenue = paidInvoices.reduce((sum: number, i: any) => sum + (i.total || 0), 0);

    const embed = new EmbedBuilder()
        .setColor(VICTUS_COLORS.primary)
        .setImage(BOT_BANNER_URL)
        .setAuthor({
            name: 'Platform Statistics',
            iconURL: config.branding.logo,
        })
        .setTitle('📊 Victus Cloud Stats')
        .addFields(
            { name: '🎮 Servers', value: `${servers.length}`, inline: true },
            { name: '🖥️ Nodes', value: `${nodes.length}`, inline: true },
            { name: '👥 Users', value: `${billingUsers.length}`, inline: true },
            { name: '🧾 Invoices', value: `${invoices.length}`, inline: true },
            { name: '💰 Revenue', value: `$${totalRevenue.toFixed(2)}`, inline: true },
            { name: '✅ Paid', value: `${paidInvoices.length}`, inline: true }
        )
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}
