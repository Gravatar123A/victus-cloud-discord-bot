/**
 * Victus Cloud — Announcement System Command
 * Admin-only mass announcement and DM system with rate limiting
 */

import {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ContainerBuilder,
    ChannelType,
    MessageFlags,
    TextChannel,
} from 'discord.js';
import type { Command, Announcement } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { config } from '../config.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { requireAdmin } from '../middleware/requireLinked.js';
import { logger } from '../utils/logger.js';

// Rate limiting configuration
const DM_RATE_LIMIT = {
    messagesPerMinute: 30,
    delayBetweenMs: 2000,
    maxRetries: 3,
    backoffMultiplier: 2,
    abortThreshold: 0.1, // Abort if >10% failures
    cooldownMinutes: 5,
};

// Active sending jobs - status type includes all possible states
type JobStatus = 'running' | 'paused' | 'completed' | 'aborted';
interface SendJob {
    status: JobStatus;
    sent: number;
    failed: number;
    total: number;
    abortController?: AbortController;
}
const activeSends = new Map<string, SendJob>();

// Custom IDs
const CUSTOM_IDS = {
    CREATE_MODAL: 'announce_create_modal',
    TYPE_SELECT: 'announce_type_select',
    TARGET_SELECT: 'announce_target_select',
    CATEGORY_SELECT: 'announce_category_select',
    CONFIRM_SEND: 'announce_confirm_send',
    CANCEL: 'announce_cancel',
    PREVIEW: 'announce_preview',
    ABORT: 'announce_abort',
} as const;

// Pending announcements (in-memory)
const pendingAnnouncements = new Map<string, {
    title: string;
    content: string;
    type: 'info' | 'warning' | 'success' | 'error';
    target: 'channel' | 'dm' | 'both';
    dmCategory?: 'maintenance' | 'billing' | 'security' | 'promotions';
    channelId?: string;
}>();

export const announceCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Send announcements (Admin only)')
        .addSubcommand(sub =>
            sub
                .setName('create')
                .setDescription('Create a new announcement')
        )
        .addSubcommand(sub =>
            sub
                .setName('history')
                .setDescription('View recent announcements')
        )
        .addSubcommand(sub =>
            sub
                .setName('abort')
                .setDescription('Abort an in-progress announcement')
                .addStringOption(opt =>
                    opt
                        .setName('id')
                        .setDescription('Announcement ID to abort')
                        .setRequired(true)
                )
        ),

    adminOnly: true,
    cooldown: 10,

    async execute(interaction) {
        const isAdmin = await requireAdmin(interaction);
        if (!isAdmin) return;

        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'create':
                    await handleCreate(interaction);
                    break;
                case 'history':
                    await handleHistory(interaction);
                    break;
                case 'abort':
                    await handleAbort(interaction);
                    break;
            }
        } catch (error) {
            logger.error('Announce command error:', error);
            const container = ComponentsV2.errorContainer(
                'Error',
                'Failed to process announcement command.'
            );
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    components: [container],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
            } else {
                await interaction.reply({
                    components: [container],
                    flags: ComponentsV2.IS_COMPONENTS_V2 | MessageFlags.Ephemeral,
                });
            }
        }
    },

    async handleButton(interaction) {
        const customId = interaction.customId;

        try {
            if (customId === CUSTOM_IDS.CONFIRM_SEND) {
                await handleConfirmSend(interaction);
                return;
            }

            if (customId === CUSTOM_IDS.CANCEL) {
                pendingAnnouncements.delete(interaction.user.id);
                const container = ComponentsV2.infoContainer(
                    'Cancelled',
                    'Announcement has been cancelled.'
                );
                await interaction.update({
                    components: [container],
                });
                return;
            }

            if (customId.startsWith('announce_abort_')) {
                const announcementId = customId.split('_')[2];
                const job = activeSends.get(announcementId);
                if (job) {
                    job.status = 'aborted';
                    job.abortController?.abort();
                }
                const container = ComponentsV2.warningContainer(
                    'Aborted',
                    'Announcement sending has been aborted.'
                );
                await interaction.update({
                    components: [container],
                });
                return;
            }
        } catch (error) {
            logger.error('Button handler error:', error);
        }
    },

    async handleSelectMenu(interaction) {
        const customId = interaction.customId;

        try {
            if (customId === CUSTOM_IDS.TYPE_SELECT) {
                const pending = pendingAnnouncements.get(interaction.user.id) || {} as any;
                pending.type = interaction.values[0] as any;
                pendingAnnouncements.set(interaction.user.id, pending);
                await showTargetSelect(interaction);
                return;
            }

            if (customId === CUSTOM_IDS.TARGET_SELECT) {
                const pending = pendingAnnouncements.get(interaction.user.id)!;
                pending.target = interaction.values[0] as any;

                if (pending.target === 'dm' || pending.target === 'both') {
                    await showCategorySelect(interaction);
                } else {
                    await showPreview(interaction);
                }
                return;
            }

            if (customId === CUSTOM_IDS.CATEGORY_SELECT) {
                const pending = pendingAnnouncements.get(interaction.user.id)!;
                pending.dmCategory = interaction.values[0] as any;
                await showPreview(interaction);
                return;
            }
        } catch (error) {
            logger.error('Select menu handler error:', error);
        }
    },

    async handleModal(interaction) {
        const customId = interaction.customId;

        try {
            if (customId === CUSTOM_IDS.CREATE_MODAL) {
                await handleModalSubmit(interaction);
                return;
            }
        } catch (error) {
            logger.error('Modal handler error:', error);
        }
    },
};

// ============================================
// Command Handlers
// ============================================

async function handleCreate(interaction: any) {
    const modal = new ModalBuilder()
        .setCustomId(CUSTOM_IDS.CREATE_MODAL)
        .setTitle('Create Announcement');

    const titleInput = new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Announcement Title')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., Server Maintenance Notice')
        .setRequired(true)
        .setMaxLength(100);

    const contentInput = new TextInputBuilder()
        .setCustomId('content')
        .setLabel('Announcement Content')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('The full announcement message...')
        .setRequired(true)
        .setMaxLength(2000);

    modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput)
    );

    await interaction.showModal(modal);
}

async function handleModalSubmit(interaction: any) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

    const title = interaction.fields.getTextInputValue('title');
    const content = interaction.fields.getTextInputValue('content');

    pendingAnnouncements.set(interaction.user.id, {
        title,
        content,
        type: 'info',
        target: 'channel',
    });

    // Show type selection
    const container = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.info)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# 📢 Create Announcement\n\n` +
                `**Title:** ${title}\n\n` +
                `Select the announcement type:\n` +
                `━━━━━━━━━━━━━━━━━━`
            )
        );

    const typeSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(CUSTOM_IDS.TYPE_SELECT)
            .setPlaceholder('Select type...')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('Info').setValue('info').setEmoji('ℹ️').setDescription('General information'),
                new StringSelectMenuOptionBuilder().setLabel('Warning').setValue('warning').setEmoji('⚠️').setDescription('Warning notice'),
                new StringSelectMenuOptionBuilder().setLabel('Success').setValue('success').setEmoji('✅').setDescription('Positive news'),
                new StringSelectMenuOptionBuilder().setLabel('Error').setValue('error').setEmoji('❌').setDescription('Critical alert')
            )
    );

    const cancelButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(CUSTOM_IDS.CANCEL)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('❌')
    );

    container.addActionRowComponents(typeSelect);
    container.addActionRowComponents(cancelButton);

    await interaction.editReply({
        components: [container],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });
}

async function showTargetSelect(interaction: any) {
    const pending = pendingAnnouncements.get(interaction.user.id)!;

    const container = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.info)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# 📢 Create Announcement\n\n` +
                `**Title:** ${pending.title}\n` +
                `**Type:** ${getTypeEmoji(pending.type)} ${pending.type}\n\n` +
                `Select the target audience:\n` +
                `━━━━━━━━━━━━━━━━━━`
            )
        );

    const targetSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(CUSTOM_IDS.TARGET_SELECT)
            .setPlaceholder('Select target...')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('Channel Only').setValue('channel').setEmoji('💬').setDescription('Post in current channel'),
                new StringSelectMenuOptionBuilder().setLabel('DM Only').setValue('dm').setEmoji('📬').setDescription('Send to opted-in users via DM'),
                new StringSelectMenuOptionBuilder().setLabel('Both').setValue('both').setEmoji('📡').setDescription('Channel + DM to opted-in users')
            )
    );

    container.addActionRowComponents(targetSelect);

    await interaction.update({
        components: [container],
    });
}

async function showCategorySelect(interaction: any) {
    const pending = pendingAnnouncements.get(interaction.user.id)!;

    const container = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.info)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# 📢 Create Announcement\n\n` +
                `**Title:** ${pending.title}\n` +
                `**Type:** ${getTypeEmoji(pending.type)} ${pending.type}\n` +
                `**Target:** ${pending.target}\n\n` +
                `Select the DM category (only users opted into this category will receive DMs):\n` +
                `━━━━━━━━━━━━━━━━━━\n\n` +
                `> ⚠️ **Rate Limiting:** DMs are sent at ${DM_RATE_LIMIT.messagesPerMinute}/min to comply with Discord rules.`
            )
        );

    const categorySelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(CUSTOM_IDS.CATEGORY_SELECT)
            .setPlaceholder('Select DM category...')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('Maintenance').setValue('maintenance').setEmoji('🔧'),
                new StringSelectMenuOptionBuilder().setLabel('Billing').setValue('billing').setEmoji('💳'),
                new StringSelectMenuOptionBuilder().setLabel('Security').setValue('security').setEmoji('🔐'),
                new StringSelectMenuOptionBuilder().setLabel('Promotions').setValue('promotions').setEmoji('🎁')
            )
    );

    container.addActionRowComponents(categorySelect);

    await interaction.update({
        components: [container],
    });
}

async function showPreview(interaction: any) {
    const pending = pendingAnnouncements.get(interaction.user.id)!;

    // Get DM recipient count if applicable
    let dmCount = 0;
    if (pending.dmCategory && (pending.target === 'dm' || pending.target === 'both')) {
        const optedIn = await supabase.getUsersOptedInForDM(pending.dmCategory);
        dmCount = optedIn.length;
    }

    const container = new ContainerBuilder()
        .setAccentColor(getTypeAccent(pending.type))
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# 📢 Announcement Preview\n\n` +
                `Review your announcement before sending.\n\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `### ${getTypeEmoji(pending.type)} ${pending.title}\n\n` +
                `${pending.content.substring(0, 500)}${pending.content.length > 500 ? '...' : ''}\n` +
                `━━━━━━━━━━━━━━━━━━\n\n` +
                `**Type:** ${getTypeEmoji(pending.type)} ${pending.type}\n` +
                `**Target:** ${pending.target}\n` +
                (pending.dmCategory ? `**DM Category:** ${pending.dmCategory}\n` : '') +
                (dmCount > 0 ? `**DM Recipients:** ${dmCount} users\n` : '') +
                (dmCount > 0 ? `**Est. Time:** ~${Math.ceil(dmCount / DM_RATE_LIMIT.messagesPerMinute)} minutes\n` : '')
            )
        );

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(CUSTOM_IDS.CONFIRM_SEND)
            .setLabel('Send Announcement')
            .setStyle(ButtonStyle.Success)
            .setEmoji('📤'),
        new ButtonBuilder()
            .setCustomId(CUSTOM_IDS.CANCEL)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌')
    );

    container.addActionRowComponents(buttons);

    await interaction.update({
        components: [container],
    });
}

async function handleConfirmSend(interaction: any) {
    const pending = pendingAnnouncements.get(interaction.user.id);
    if (!pending) {
        const container = ComponentsV2.errorContainer(
            'Session Expired',
            'Please start the announcement creation again.'
        );
        await interaction.update({
            components: [container],
        });
        return;
    }

    await interaction.deferUpdate();

    // Save announcement to database
    const announcement = await supabase.createDiscordAnnouncement({
        guild_id: interaction.guildId!,
        title: pending.title,
        content: pending.content,
        type: pending.type,
        target: pending.target,
        dm_category: pending.dmCategory,
        channel_id: interaction.channelId,
        created_by: interaction.user.id,
        created_by_name: interaction.user.tag,
    });

    if (!announcement) {
        const container = ComponentsV2.errorContainer(
            'Error',
            'Failed to save announcement. Please try again.'
        );
        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        return;
    }

    // Update status to sending
    await supabase.updateDiscordAnnouncement(announcement.id, { status: 'sending' });

    // Create announcement embed for channel
    const announcementEmbed = createAnnouncementEmbed(pending);

    // Send to channel if applicable
    if (pending.target === 'channel' || pending.target === 'both') {
        await interaction.channel.send({
            components: [announcementEmbed],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    }

    // Send DMs if applicable
    if ((pending.target === 'dm' || pending.target === 'both') && pending.dmCategory) {
        // Start async DM sending
        sendDMsAsync(interaction.client, announcement.id, pending, interaction);
    }

    // Clean up
    pendingAnnouncements.delete(interaction.user.id);

    const container = ComponentsV2.successContainer(
        'Announcement Sent!',
        `Your announcement has been sent.\n\n` +
        `**ID:** \`${announcement.id.slice(0, 8)}\`\n` +
        (pending.dmCategory ? `DMs are being sent in the background. Use \`/announce history\` to track progress.` : '')
    );

    await interaction.editReply({
        components: [container],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });

    logger.info(`Announcement created by ${interaction.user.tag}: ${pending.title}`);
}

async function handleHistory(interaction: any) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

    const announcements = await supabase.getGuildAnnouncements(interaction.guildId!, 10);

    if (announcements.length === 0) {
        const container = ComponentsV2.infoContainer(
            'No Announcements',
            'No announcements have been sent yet.'
        );
        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        return;
    }

    const list = announcements.map((a, i) => {
        const statusMap: Record<string, string> = {
            draft: '📝',
            scheduled: '⏰',
            sending: '📤',
            completed: '✅',
            cancelled: '❌',
        };
        const statusEmoji = statusMap[a.status as string] || '❓';

        return `**${i + 1}.** ${statusEmoji} ${a.title}\n` +
            `-# ${a.status} | Sent: ${a.sent_count} | Failed: ${a.failed_count} | ${new Date(a.created_at).toLocaleDateString()}`;
    }).join('\n\n');

    const container = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.info)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# 📋 Announcement History\n\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `${list}\n` +
                `━━━━━━━━━━━━━━━━━━`
            )
        );

    await interaction.editReply({
        components: [container],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });
}

async function handleAbort(interaction: any) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

    const announcementId = interaction.options.getString('id', true);
    const job = activeSends.get(announcementId);

    if (!job) {
        const container = ComponentsV2.errorContainer(
            'Not Found',
            'No active sending job found for that announcement ID.'
        );
        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        return;
    }

    job.status = 'aborted';
    job.abortController?.abort();

    await supabase.updateDiscordAnnouncement(announcementId, { status: 'cancelled' });

    const container = ComponentsV2.successContainer(
        'Aborted',
        `Announcement sending has been aborted.\n\n` +
        `**Sent:** ${job.sent}\n` +
        `**Failed:** ${job.failed}\n` +
        `**Remaining:** ${job.total - job.sent - job.failed}`
    );

    await interaction.editReply({
        components: [container],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });

    logger.info(`Announcement ${announcementId} aborted by ${interaction.user.tag}`);
}

// ============================================
// DM Sending Logic (Rate Limited)
// ============================================

async function sendDMsAsync(client: any, announcementId: string, pending: any, interaction: any) {
    const optedIn = await supabase.getUsersOptedInForDM(pending.dmCategory);

    if (optedIn.length === 0) {
        await supabase.updateDiscordAnnouncement(announcementId, {
            status: 'completed',
            completed_at: new Date().toISOString(),
        });
        return;
    }

    const abortController = new AbortController();
    const job: SendJob = {
        status: 'running',
        sent: 0,
        failed: 0,
        total: optedIn.length,
        abortController,
    };
    activeSends.set(announcementId, job);

    const dmEmbed = createAnnouncementEmbed(pending);

    for (const discordId of optedIn) {
        if (job.status === 'aborted') break;

        try {
            const user = await client.users.fetch(discordId).catch(() => null);
            if (!user) {
                job.failed++;
                continue;
            }

            await user.send({
                components: [dmEmbed],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });

            job.sent++;
        } catch (error) {
            job.failed++;
            logger.error(`Failed to DM ${discordId}:`, error);
        }

        // Check abort threshold
        const failureRate = job.failed / (job.sent + job.failed);
        if (failureRate > DM_RATE_LIMIT.abortThreshold && (job.sent + job.failed) > 10) {
            logger.warn(`Abort threshold reached for announcement ${announcementId}`);
            job.status = 'aborted';
            break;
        }

        // Rate limiting delay
        await sleep(DM_RATE_LIMIT.delayBetweenMs);

        // Update progress every 10 messages
        if ((job.sent + job.failed) % 10 === 0) {
            await supabase.updateDiscordAnnouncement(announcementId, {
                sent_count: job.sent,
                failed_count: job.failed,
            });
        }
    }

    // Final update
    const finalStatus = job.status === 'aborted' ? 'cancelled' : 'completed';
    await supabase.updateDiscordAnnouncement(announcementId, {
        status: finalStatus,
        sent_count: job.sent,
        failed_count: job.failed,
        completed_at: new Date().toISOString(),
    });

    activeSends.delete(announcementId);
    logger.info(`Announcement ${announcementId} ${finalStatus}: ${job.sent} sent, ${job.failed} failed`);
}

// ============================================
// Utility Functions
// ============================================

function createAnnouncementEmbed(pending: any): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(getTypeAccent(pending.type))
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# ${getTypeEmoji(pending.type)} ${pending.title}\n\n` +
                `${pending.content}\n\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `-# Victus Cloud • ${new Date().toLocaleDateString()}`
            )
        )
    // Note: ContainerBuilder doesn't support thumbnails directly - use embed or media gallery
}

function getTypeEmoji(type: string): string {
    return {
        info: 'ℹ️',
        warning: '⚠️',
        success: '✅',
        error: '❌',
    }[type] || 'ℹ️';
}

function getTypeAccent(type: string): number {
    return {
        info: ComponentsV2.Accents.info,
        warning: ComponentsV2.Accents.warning,
        success: ComponentsV2.Accents.success,
        error: ComponentsV2.Accents.danger,
    }[type] || ComponentsV2.Accents.info;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
