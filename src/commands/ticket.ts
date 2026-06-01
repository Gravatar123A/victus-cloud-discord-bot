/**
 * Victus Cloud — Ticket System Command
 * Full Components V2 implementation with account linking enforcement
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
    PermissionFlagsBits,
    MessageFlags,
    TextChannel,
    CategoryChannel,
    GuildMember,
} from 'discord.js';
import type { Command, TicketCategory, Ticket } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { config } from '../config.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { requireLinkedAccount, getLinkedAccount } from '../middleware/requireLinked.js';
import { requireAdmin } from '../middleware/requireLinked.js';
import { logger } from '../utils/logger.js';

// ============================================
// Custom IDs for components
// ============================================
const CUSTOM_IDS = {
    // Buttons
    CREATE_TICKET: 'ticket_create',
    LINK_ACCOUNT: 'ticket_link_account',
    CANCEL: 'ticket_cancel',
    CONFIRM: 'ticket_confirm',
    EDIT: 'ticket_edit',
    CLOSE: 'ticket_close',
    LOCK: 'ticket_lock',
    UNLOCK: 'ticket_unlock',
    CLAIM: 'ticket_claim',
    LINK_SERVER: 'ticket_link_server',
    LINK_INVOICE: 'ticket_link_invoice',
    AI_HELP: 'ticket_ai_help',
    // Select menus
    CATEGORY_SELECT: 'ticket_category_select',
    SERVER_SELECT: 'ticket_server_select',
    INVOICE_SELECT: 'ticket_invoice_select',
    // Modals
    TICKET_FORM: 'ticket_form',
    CATEGORY_ADD: 'ticket_category_add_modal',
} as const;

// Pending ticket data (in-memory cache for ticket creation flow)
const pendingTickets = new Map<string, {
    categoryId: string;
    categoryName: string;
    categoryEmoji: string;
    priorityDefault: string;
    customQuestions: any[];
}>();

export const ticketCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Ticket system management')
        .addSubcommand(sub =>
            sub
                .setName('panel')
                .setDescription('Spawn a ticket creation panel (Admin only)')
        )
        .addSubcommand(sub =>
            sub
                .setName('categories')
                .setDescription('Manage ticket categories (Admin only)')
        )
        .addSubcommandGroup(group =>
            group
                .setName('category')
                .setDescription('Category management')
                .addSubcommand(sub =>
                    sub
                        .setName('add')
                        .setDescription('Add a new ticket category')
                        .addStringOption(opt =>
                            opt
                                .setName('name')
                                .setDescription('Category name')
                                .setRequired(true)
                        )
                        .addStringOption(opt =>
                            opt
                                .setName('emoji')
                                .setDescription('Category emoji')
                                .setRequired(false)
                        )
                        .addStringOption(opt =>
                            opt
                                .setName('description')
                                .setDescription('Category description')
                                .setRequired(false)
                        )
                )
                .addSubcommand(sub =>
                    sub
                        .setName('edit')
                        .setDescription('Edit an existing ticket category')
                        .addStringOption(opt =>
                            opt
                                .setName('category')
                                .setDescription('Category to edit')
                                .setRequired(true)
                                .setAutocomplete(true)
                        )
                        .addStringOption(opt =>
                            opt
                                .setName('name')
                                .setDescription('New name')
                                .setRequired(false)
                        )
                        .addStringOption(opt =>
                            opt
                                .setName('emoji')
                                .setDescription('New emoji')
                                .setRequired(false)
                        )
                        .addStringOption(opt =>
                            opt
                                .setName('description')
                                .setDescription('New description')
                                .setRequired(false)
                        )
                        .addStringOption(opt =>
                            opt
                                .setName('parent_id')
                                .setDescription('Discord Category ID where tickets should be created')
                                .setRequired(false)
                        )
                )
                .addSubcommand(sub =>
                    sub
                        .setName('remove')
                        .setDescription('Remove a ticket category')
                        .addStringOption(opt =>
                            opt
                                .setName('category')
                                .setDescription('Category to remove')
                                .setRequired(true)
                                .setAutocomplete(true)
                        )
                )
                .addSubcommand(sub =>
                    sub
                        .setName('questions')
                        .setDescription('Manage custom questions for a category')
                        .addStringOption(opt =>
                            opt
                                .setName('category')
                                .setDescription('Category to manage')
                                .setRequired(true)
                                .setAutocomplete(true)
                        )
                        .addStringOption(opt =>
                            opt
                                .setName('action')
                                .setDescription('Action to perform')
                                .setRequired(true)
                                .addChoices(
                                    { name: 'Add Question', value: 'add' },
                                    { name: 'Remove Question', value: 'remove' },
                                    { name: 'List Questions', value: 'list' }
                                )
                        )
                )
        ),

    adminOnly: true,
    cooldown: 5,

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);

        if (focusedOption.name === 'category') {
            const categories = await supabase.getAllTicketCategories(interaction.guildId!);
            const filtered = categories
                .filter(c => c.name.toLowerCase().includes(focusedOption.value.toLowerCase()))
                .slice(0, 25);

            await interaction.respond(
                filtered.map(c => ({
                    name: `${c.emoji} ${c.name}`,
                    value: c.id,
                }))
            );
        }
    },

    async execute(interaction) {
        logger.info(`⚡ [Execute] /ticket command started by ${interaction.user.tag}`);

        try {
            const subcommandGroup = interaction.options.getSubcommandGroup(false);
            const subcommand = interaction.options.getSubcommand();
            logger.info(`👉 [Execute] Subcommand: ${subcommandGroup ? subcommandGroup + ' ' : ''}${subcommand}`);

            // Admin check for all current subcommands
            const isAdmin = await requireAdmin(interaction);
            if (!isAdmin) {
                logger.warn(`🚫 [Execute] Access denied for ${interaction.user.tag}`);
                return;
            }

            logger.info(`⌛ [Execute] Deferring reply...`);
            await interaction.deferReply({
                flags: MessageFlags.Ephemeral | (ComponentsV2 as any).IS_COMPONENTS_V2
            });

            if (subcommandGroup === 'category') {
                switch (subcommand) {
                    case 'edit':
                        await handleCategoryEdit(interaction);
                        break;
                    case 'questions':
                        await handleCategoryQuestions(interaction);
                        break;
                    case 'remove':
                        await handleCategoryRemove(interaction);
                        break;
                    case 'add':
                        await handleCategoryAdd(interaction);
                        break;
                    default:
                        await interaction.editReply({ content: '❌ Unknown category subcommand' });
                }
            } else {
                switch (subcommand) {
                    case 'panel':
                        await handlePanelSpawn(interaction);
                        break;
                    case 'categories':
                        await handleCategoriesList(interaction);
                        break;
                    default:
                        await interaction.editReply({ content: '❌ Unknown subcommand' });
                }
            }
            logger.info(`✅ [Execute] Command completed successfully`);
        } catch (error: any) {
            logger.error(`❌ [Execute] Critical crash:`, error);

            const errorContainer = ComponentsV2.errorContainer(
                'Command Error',
                `An unexpected error occurred: ${error.message || 'Unknown error'}`
            );

            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({
                        components: [errorContainer],
                        flags: (ComponentsV2 as any).IS_COMPONENTS_V2
                    });
                } else {
                    await interaction.reply({
                        components: [errorContainer],
                        flags: (ComponentsV2 as any).IS_COMPONENTS_V2 | MessageFlags.Ephemeral
                    });
                }
            } catch (replyErr) {
                logger.error(`Failed to send error reply:`, replyErr);
            }
        }
    },

    // ============================================
    // Button Handlers
    // ============================================
    async handleButton(interaction) {
        const customId = interaction.customId;

        try {
            // Create Ticket button
            if (customId === CUSTOM_IDS.CREATE_TICKET) {
                await handleCreateTicketButton(interaction);
                return;
            }

            // Link Account button
            if (customId === CUSTOM_IDS.LINK_ACCOUNT) {
                // Redirect to link command
                const container = ComponentsV2.infoContainer(
                    'Link Your Account',
                    'Use the `/link` command to connect your Discord to Victus Cloud.\n\n' +
                    'Once linked, you can create support tickets!'
                );
                await interaction.reply({
                    components: [container],
                    flags: ComponentsV2.IS_COMPONENTS_V2 | MessageFlags.Ephemeral,
                });
                return;
            }

            // Cancel button
            if (customId === CUSTOM_IDS.CANCEL) {
                pendingTickets.delete(interaction.user.id);
                const container = ComponentsV2.infoContainer(
                    'Cancelled',
                    'Ticket creation has been cancelled.'
                );
                await interaction.update({
                    components: [container],
                });
                return;
            }

            // Confirm/Submit button
            if (customId === CUSTOM_IDS.CONFIRM) {
                await handleConfirmTicket(interaction);
                return;
            }

            // Ticket control buttons (in ticket channel)
            if (customId.startsWith('ticket_close_')) {
                await handleCloseTicket(interaction);
                return;
            }
            if (customId.startsWith('ticket_lock_')) {
                await handleLockTicket(interaction);
                return;
            }
            if (customId.startsWith('ticket_unlock_')) {
                await handleUnlockTicket(interaction);
                return;
            }
            if (customId.startsWith('ticket_claim_')) {
                await handleClaimTicket(interaction);
                return;
            }
            if (customId.startsWith('ticket_ai_')) {
                await handleAIHelp(interaction);
                return;
            }

            // Custom Question Add button
            if (customId.startsWith('ticket_question_add_')) {
                const categoryId = customId.split('_')[3];
                await handleShowQuestionAddModal(interaction, categoryId);
                return;
            }
        } catch (error) {
            logger.error('Button handler error:', error);
            const container = ComponentsV2.errorContainer(
                'Error',
                'Failed to process your request.'
            );
            try {
                await interaction.reply({
                    components: [container],
                    flags: ComponentsV2.IS_COMPONENTS_V2 | MessageFlags.Ephemeral,
                });
            } catch {
                // Already replied
            }
        }
    },

    // ============================================
    // Select Menu Handlers
    // ============================================
    async handleSelectMenu(interaction) {
        const customId = interaction.customId;

        try {
            if (customId === CUSTOM_IDS.CATEGORY_SELECT) {
                logger.info(`🎯 [SelectMenu] Category selection detected`);
                await handleCategorySelect(interaction);
                return;
            }

            // Custom Question Remove select menu
            if (customId.startsWith('ticket_question_remove_')) {
                const categoryId = customId.split('_')[3];
                const index = parseInt(interaction.values[0]);
                await handleRemoveQuestion(interaction, categoryId, index);
                return;
            }
        } catch (error) {
            logger.error('Select menu handler error:', error);
        }
    },

    // ============================================
    // Modal Handlers
    // ============================================
    async handleModal(interaction) {
        const customId = interaction.customId;

        try {
            if (customId.startsWith(CUSTOM_IDS.TICKET_FORM)) {
                await handleTicketFormSubmit(interaction);
                return;
            }

            // Custom Question Add modal submit
            if (customId.startsWith('ticket_question_modal_')) {
                const categoryId = customId.split('_')[3];
                await handleAddQuestionSubmit(interaction, categoryId);
                return;
            }
        } catch (error) {
            logger.error('Modal handler error:', error);
            const container = ComponentsV2.errorContainer(
                'Error',
                'Failed to submit your ticket form.'
            );
            await interaction.reply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2 | MessageFlags.Ephemeral,
            });
        }
    },
};

// ============================================
// Panel Management
// ============================================

async function handlePanelSpawn(interaction: any) {
    const guildId = interaction.guildId!;
    const categories = await supabase.getTicketCategories(guildId);

    if (categories.length === 0) {
        const container = ComponentsV2.warningContainer(
            'No Categories',
            'You need to create ticket categories first.\n\n' +
            'Use `/ticket category add` to create categories.'
        );
        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        return;
    }

    // Create the premium ticket panel
    const panel = createTicketPanel(categories);

    // Send to channel (not ephemeral)
    await interaction.channel.send({
        components: [panel],
        flags: (ComponentsV2 as any).IS_COMPONENTS_V2,
    });

    const container = ComponentsV2.successContainer(
        'Panel Created',
        'The premium ticket panel has been spawned in this channel.'
    );
    await interaction.editReply({
        components: [container],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });
}

function createTicketPanel(categories: TicketCategory[]): ContainerBuilder {
    const sections = categories
        .map(c => `### ${c.emoji} ${c.name} Ticket:\n\n${c.description || 'No description available.'}`)
        .join('\n\n');

    const list = categories
        .map(c => `» ${c.emoji} **${c.name}** - Create a ${c.name} ticket`)
        .join('\n');

    const container = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.purple)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# Victus Cloud™ ➤ IT Solutions Support\n\n` +
                `Need help? Open a ticket below\n\n` +
                `**V** Please select the category that best fits your needs from the options below. Our team will assist you as soon as possible.\n\n` +
                `${sections}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `### ⭐ Available Categories\n` +
                `${list}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `-# 🆔 You'll be asked internal questions when creating a ticket`
            )
        );

    // Add select menu
    const select = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(CUSTOM_IDS.CATEGORY_SELECT)
            .setPlaceholder('Select a ticket type...')
            .addOptions(categories.map(c => ({
                label: c.name,
                emoji: c.emoji,
                value: c.id,
                description: c.description?.substring(0, 100) || 'Click to open ticket'
            })))
    );

    container.addActionRowComponents(select);

    return container;
}

// ============================================
// Category Management
// ============================================

async function handleCategoriesList(interaction: any) {
    const guildId = interaction.guildId!;
    const categories = await supabase.getAllTicketCategories(guildId);

    if (categories.length === 0) {
        const container = ComponentsV2.infoContainer(
            'No Categories',
            'No ticket categories have been created yet.\n\n' +
            'Use `/ticket category add` to create one.'
        );
        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        return;
    }

    const categoryList = categories
        .map((c, i) =>
            `**${i + 1}.** ${c.emoji} ${c.name} ${c.enabled ? '🟢' : '🔴'}\n` +
            `-# ${c.description || 'No description'} | Priority: ${c.priority_default}`
        )
        .join('\n\n');

    const container = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.info)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# 📋 Ticket Categories\n\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `${categoryList}\n` +
                `━━━━━━━━━━━━━━━━━━\n\n` +
                `-# Use \`/ticket category add\` or \`/ticket category remove\` to manage.`
            )
        );

    await interaction.editReply({
        components: [container],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });
}

async function handleCategoryAdd(interaction: any) {
    const guildId = interaction.guildId!;
    const name = interaction.options.getString('name', true);
    const emoji = interaction.options.getString('emoji') || '🎫';
    const description = interaction.options.getString('description') || null;

    // Get current position
    const existing = await supabase.getAllTicketCategories(guildId);
    const position = existing.length;

    const category = await supabase.createTicketCategory({
        guild_id: guildId,
        name,
        emoji,
        description,
        position,
    });

    if (!category) {
        const container = ComponentsV2.errorContainer(
            'Error',
            'Failed to create category. Please try again.'
        );
        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        return;
    }

    const container = ComponentsV2.successContainer(
        'Category Created',
        `${emoji} **${name}** has been added to ticket categories.`
    );
    await interaction.editReply({
        components: [container],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });
}

async function handleCategoryRemove(interaction: any) {
    const categoryId = interaction.options.getString('category', true);

    const success = await supabase.deleteTicketCategory(categoryId);

    if (!success) {
        const container = ComponentsV2.errorContainer(
            'Error',
            'Failed to remove category. Please try again.'
        );
        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        return;
    }

    const container = ComponentsV2.successContainer(
        'Category Removed',
        'The category has been removed.'
    );
    await interaction.editReply({
        components: [container],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });
}

// ============================================
// Ticket Creation Flow
// ============================================

async function handleCreateTicketButton(interaction: any) {
    // Step 1: Check if account is linked
    const linked = await getLinkedAccount(interaction.user.id);

    if (!linked) {
        // Show link account prompt
        const container = new ContainerBuilder()
            .setAccentColor(ComponentsV2.Accents.warning)
            .addTextDisplayComponents(
                ComponentsV2.text(
                    `# 🔗 Account Not Linked\n\n` +
                    `You need to link your Discord account to Victus Cloud before creating a ticket.\n\n` +
                    `━━━━━━━━━━━━━━━━━━\n` +
                    `### 📝 How to Link\n` +
                    `1. Use the \`/link\` command\n` +
                    `2. Click the verification link\n` +
                    `3. Log in to your Victus Cloud account\n` +
                    `4. Return here to create your ticket\n` +
                    `━━━━━━━━━━━━━━━━━━`
                )
            );

        const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(CUSTOM_IDS.LINK_ACCOUNT)
                .setLabel('Link Account')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔗'),
            new ButtonBuilder()
                .setCustomId(CUSTOM_IDS.CANCEL)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('❌')
        );

        container.addActionRowComponents(buttons);

        await interaction.reply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2 | MessageFlags.Ephemeral,
        });
        return;
    }

    // Step 2: Show category selection
    const categories = await supabase.getTicketCategories(interaction.guildId!);

    if (categories.length === 0) {
        const container = ComponentsV2.errorContainer(
            'No Categories',
            'No ticket categories are available. Please contact an administrator.'
        );
        await interaction.reply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2 | MessageFlags.Ephemeral,
        });
        return;
    }

    const container = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.info)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# 🎫 Create Support Ticket\n\n` +
                `Select the category that best describes your issue.\n\n` +
                `━━━━━━━━━━━━━━━━━━`
            )
        );

    const selectMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(CUSTOM_IDS.CATEGORY_SELECT)
            .setPlaceholder('Select a category...')
            .addOptions(
                categories.map(c =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(c.name)
                        .setDescription(c.description || 'No description')
                        .setValue(c.id)
                        .setEmoji(c.emoji)
                )
            )
    );

    const cancelButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(CUSTOM_IDS.CANCEL)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('❌')
    );

    container.addActionRowComponents(selectMenu);
    container.addActionRowComponents(cancelButton);

    await interaction.reply({
        components: [container],
        flags: ComponentsV2.IS_COMPONENTS_V2 | MessageFlags.Ephemeral,
    });
}

async function handleCategorySelect(interaction: any) {
    const categoryId = interaction.values[0];
    logger.info(`🔍 [CategorySelect] ID: ${categoryId} by ${interaction.user.tag}`);
    const category = await supabase.getTicketCategory(categoryId);

    if (!category) {
        const container = ComponentsV2.errorContainer(
            'Error',
            'Category not found. Please try again.'
        );
        await interaction.update({
            components: [container],
        });
        return;
    }

    // Store pending ticket data
    pendingTickets.set(interaction.user.id, {
        categoryId: category.id,
        categoryName: category.name,
        categoryEmoji: category.emoji,
        priorityDefault: category.priority_default,
        customQuestions: category.custom_questions || [],
    });

    // Get user's email from their profile
    const linked = await getLinkedAccount(interaction.user.id);
    let email = '';
    if (linked) {
        const profile = await supabase.getUserProfile(linked.userId);
        email = profile?.email || '';
    }

    // Open the ticket form modal
    logger.info(`✨ [CategorySelect] Opening modal for ${category.name}`);
    const modal = new ModalBuilder()
        .setCustomId(`${CUSTOM_IDS.TICKET_FORM}_${categoryId}`)
        .setTitle(`New Ticket: ${category.name}`);

    // Email field (pre-filled)
    const emailInput = new TextInputBuilder()
        .setCustomId('email')
        .setLabel('Email Address')
        .setStyle(TextInputStyle.Short)
        .setValue(email)
        .setPlaceholder('your@email.com')
        .setRequired(true)
        .setMaxLength(100);

    // Subject field
    const subjectInput = new TextInputBuilder()
        .setCustomId('subject')
        .setLabel('Issue Subject')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Brief description of your issue')
        .setRequired(true)
        .setMaxLength(100);

    // Description field
    const descriptionInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Issue Description')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Provide as much detail as possible about your issue...')
        .setRequired(true)
        .setMaxLength(1000);

    modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(emailInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(subjectInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput)
    );

    // Add up to 2 custom questions (Discord modal limit is 5 components)
    const customQuestions = (category.custom_questions || []).slice(0, 2);
    for (const q of customQuestions) {
        const customInput = new TextInputBuilder()
            .setCustomId(`custom_${q.id}`)
            .setLabel(q.label)
            .setStyle(q.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setPlaceholder(q.placeholder || '')
            .setRequired(q.required || false)
            .setMaxLength(q.max_length || 500);

        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(customInput)
        );
    }

    try {
        await interaction.showModal(modal);
        logger.info(`✅ [CategorySelect] Modal shown successfully`);
    } catch (err: any) {
        logger.error(`❌ [CategorySelect] Failed to show modal: ${err.message}`);
    }
}

async function handleTicketFormSubmit(interaction: any) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

    const pending = pendingTickets.get(interaction.user.id);
    if (!pending) {
        const container = ComponentsV2.errorContainer(
            'Session Expired',
            'Your ticket session has expired. Please start again.'
        );
        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        return;
    }

    // Get form values
    const email = interaction.fields.getTextInputValue('email');
    const subject = interaction.fields.getTextInputValue('subject');
    const description = interaction.fields.getTextInputValue('description');

    // Get custom answers
    const customAnswers: Record<string, string> = {};
    for (const q of pending.customQuestions) {
        try {
            const value = interaction.fields.getTextInputValue(`custom_${q.id}`);
            if (value) customAnswers[q.id] = value;
        } catch {
            // Field not found
        }
    }

    // Show confirmation
    const confirmContainer = createConfirmationContainer({
        categoryName: pending.categoryName,
        categoryEmoji: pending.categoryEmoji,
        email,
        subject,
        description,
        customAnswers,
        customQuestions: pending.customQuestions,
    });

    await interaction.editReply({
        components: [confirmContainer],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });

    // Store full data for confirmation
    pendingTickets.set(interaction.user.id, {
        ...pending,
        email,
        subject,
        description,
        customAnswers,
    } as any);
}

function createConfirmationContainer(data: any): ContainerBuilder {
    let customFields = '';
    if (data.customAnswers && Object.keys(data.customAnswers).length > 0) {
        for (const q of data.customQuestions) {
            if (data.customAnswers[q.id]) {
                customFields += `\n» **${q.label}:** ${data.customAnswers[q.id].substring(0, 50)}${data.customAnswers[q.id].length > 50 ? '...' : ''}`;
            }
        }
    }

    const container = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.info)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# 📋 Confirm Ticket\n\n` +
                `Please review your ticket before submitting.\n\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `### 📌 Ticket Details\n` +
                `» **Category:** ${data.categoryEmoji} ${data.categoryName}\n` +
                `» **Email:** ${data.email}\n` +
                `» **Subject:** ${data.subject}\n` +
                `${customFields}\n` +
                `\n### 📝 Description\n` +
                `${data.description.substring(0, 200)}${data.description.length > 200 ? '...' : ''}\n` +
                `━━━━━━━━━━━━━━━━━━`
            )
        );

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(CUSTOM_IDS.CONFIRM)
            .setLabel('Submit Ticket')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
        new ButtonBuilder()
            .setCustomId(CUSTOM_IDS.CANCEL)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌')
    );

    container.addActionRowComponents(buttons);

    return container;
}

async function handleConfirmTicket(interaction: any) {
    await interaction.deferUpdate();

    const pending = pendingTickets.get(interaction.user.id) as any;
    if (!pending || !pending.subject) {
        const container = ComponentsV2.errorContainer(
            'Session Expired',
            'Your ticket session has expired. Please start again.'
        );
        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        return;
    }

    const linked = await getLinkedAccount(interaction.user.id);
    if (!linked) {
        const container = ComponentsV2.errorContainer(
            'Account Not Linked',
            'Your account is no longer linked. Please link again.'
        );
        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        return;
    }

    // Create ticket channel
    const guild = interaction.guild!;
    const ticketNumber = await supabase.getNextTicketNumber(guild.id);
    const channelName = `ticket-${ticketNumber}`;

    // Get category for routing and staff roles
    const category = await supabase.getTicketCategory(pending.categoryId);

    // Find or create the parent category
    let parentId = category?.discord_category_id;

    // If no parentId is set, fall back to "Tickets" category
    if (!parentId) {
        let ticketsCategory = guild.channels.cache.find(
            (c: any) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'tickets'
        ) as CategoryChannel | undefined;

        if (!ticketsCategory) {
            ticketsCategory = await guild.channels.create({
                name: 'Tickets',
                type: ChannelType.GuildCategory,
            });
        }
        parentId = ticketsCategory!.id;
    }

    // Create the ticket channel
    const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: parentId,
        permissionOverwrites: [
            {
                id: guild.id,
                deny: [PermissionFlagsBits.ViewChannel],
            },
            {
                id: interaction.user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AttachFiles,
                ],
            },
        ],
    });

    // Category was already fetched above for routing
    if (category?.staff_roles) {
        for (const roleId of category.staff_roles) {
            await ticketChannel.permissionOverwrites.create(roleId, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true,
            }).catch(() => { });
        }
    }

    // Save ticket to database
    const ticket = await supabase.createTicket({
        guild_id: guild.id,
        channel_id: ticketChannel.id,
        user_id: linked.userId,
        discord_id: interaction.user.id,
        category_id: pending.categoryId,
        subject: pending.subject,
        description: pending.description,
        email: pending.email,
        priority: pending.priorityDefault,
        custom_answers: pending.customAnswers || {},
    });

    if (!ticket) {
        await ticketChannel.delete().catch(() => { });
        const container = ComponentsV2.errorContainer(
            'Error',
            'Failed to create ticket. Please try again.'
        );
        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        return;
    }

    // Send control panel to ticket channel
    const controlPanel = createTicketControlPanel(ticket, interaction.user);
    await ticketChannel.send({
        content: `<@${interaction.user.id}>`,
        components: [controlPanel],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });

    // Clean up pending data
    pendingTickets.delete(interaction.user.id);

    // Send confirmation
    const container = ComponentsV2.successContainer(
        'Ticket Created!',
        `Your ticket has been created: <#${ticketChannel.id}>\n\n` +
        `**Ticket #${ticket.ticket_number}** — ${pending.categoryEmoji} ${pending.categoryName}`
    );

    await interaction.editReply({
        components: [container],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });

    logger.info(`Ticket #${ticket.ticket_number} created by ${interaction.user.tag}`);
}

// ============================================
// Ticket Control Panel
// ============================================

function createTicketControlPanel(ticket: Ticket, user: any): ContainerBuilder {
    const statusEmoji = ticket.status === 'open' ? '🟢' : ticket.status === 'claimed' ? '🟡' : '🔴';
    const priorityEmoji = {
        low: '🟢',
        medium: '🟡',
        high: '🟠',
        urgent: '🔴',
    }[ticket.priority] || '⚪';

    const categoryEmoji = ticket.category?.emoji || '🎫';
    const categoryName = ticket.category?.name || 'General';

    const createdAt = new Date(ticket.created_at);
    const createdAgo = getTimeAgo(createdAt);

    const container = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.purple)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# 🎫 Support Ticket\n\n` +
                `Ticket #${ticket.ticket_number} • ${categoryEmoji} ${categoryName}\n\n` +
                `Please wait for a staff member to assist you. Use the buttons below to manage your ticket.\n\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `### 📊 Ticket Info\n` +
                `» **Owner:** <@${ticket.discord_id}>\n` +
                `» **Category:** ${categoryEmoji} ${categoryName}\n` +
                `» **Status:** ${statusEmoji} ${ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)}\n` +
                `» **Priority:** ${priorityEmoji} ${ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}\n` +
                `» **Created:** ${createdAgo}\n` +
                (ticket.claimed_by ? `» **Assigned:** <@${ticket.claimed_by}>\n` : '') +
                `━━━━━━━━━━━━━━━━━━`
            )
        );

    // Note: Thumbnails added via embed thumbnail, not ContainerBuilder

    // Control buttons
    const isLocked = ticket.status === 'locked';
    const isClaimed = !!ticket.claimed_by;

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`ticket_close_${ticket.id}`)
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌'),
        new ButtonBuilder()
            .setCustomId(`ticket_lock_${ticket.id}`)
            .setLabel('Lock')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔒')
            .setDisabled(isLocked),
        new ButtonBuilder()
            .setCustomId(`ticket_unlock_${ticket.id}`)
            .setLabel('Unlock')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔓')
            .setDisabled(!isLocked),
        new ButtonBuilder()
            .setCustomId(`ticket_claim_${ticket.id}`)
            .setLabel(isClaimed ? 'Claimed' : 'Claim')
            .setStyle(isClaimed ? ButtonStyle.Success : ButtonStyle.Primary)
            .setEmoji('👤')
            .setDisabled(isClaimed)
    );

    // Second row with AI and linking
    const buttons2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`ticket_ai_${ticket.id}`)
            .setLabel('Ask AI')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🤖'),
        new ButtonBuilder()
            .setLabel('Open Panel')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.panel)
            .setEmoji('🖥️')
    );

    container.addActionRowComponents(buttons);
    container.addActionRowComponents(buttons2);

    return container;
}

// ============================================
// Ticket Control Handlers
// ============================================

async function handleCloseTicket(interaction: any) {
    const ticketId = interaction.customId.split('_')[2];
    const ticket = await supabase.getTicket(ticketId);

    if (!ticket) {
        await interaction.reply({
            content: '❌ Ticket not found.',
            ephemeral: true,
        });
        return;
    }

    // Update ticket status
    await supabase.updateTicket(ticketId, {
        status: 'closed',
        closed_at: new Date().toISOString(),
    });

    // Send closing message
    const container = ComponentsV2.successContainer(
        'Ticket Closed',
        `This ticket has been closed by <@${interaction.user.id}>.\n\n` +
        `The channel will be deleted in 10 seconds.`
    );

    await interaction.update({
        components: [container],
    });

    // Delete channel after delay
    setTimeout(async () => {
        try {
            await interaction.channel.delete();
        } catch {
            // Channel already deleted
        }
    }, 10000);

    logger.info(`Ticket #${ticket.ticket_number} closed by ${interaction.user.tag}`);
}

async function handleLockTicket(interaction: any) {
    const ticketId = interaction.customId.split('_')[2];
    const ticket = await supabase.getTicket(ticketId);

    if (!ticket) {
        await interaction.reply({ content: '❌ Ticket not found.', ephemeral: true });
        return;
    }

    // Lock the channel
    await interaction.channel.permissionOverwrites.edit(ticket.discord_id, {
        SendMessages: false,
    });

    await supabase.updateTicket(ticketId, { status: 'locked' });

    // Update control panel
    const updatedTicket = await supabase.getTicket(ticketId);
    const controlPanel = createTicketControlPanel(updatedTicket, interaction.user);

    await interaction.update({
        components: [controlPanel],
    });

    logger.info(`Ticket #${ticket.ticket_number} locked by ${interaction.user.tag}`);
}

async function handleUnlockTicket(interaction: any) {
    const ticketId = interaction.customId.split('_')[2];
    const ticket = await supabase.getTicket(ticketId);

    if (!ticket) {
        await interaction.reply({ content: '❌ Ticket not found.', ephemeral: true });
        return;
    }

    // Unlock the channel
    await interaction.channel.permissionOverwrites.edit(ticket.discord_id, {
        SendMessages: true,
    });

    await supabase.updateTicket(ticketId, { status: ticket.claimed_by ? 'claimed' : 'open' });

    // Update control panel
    const updatedTicket = await supabase.getTicket(ticketId);
    const controlPanel = createTicketControlPanel(updatedTicket, interaction.user);

    await interaction.update({
        components: [controlPanel],
    });

    logger.info(`Ticket #${ticket.ticket_number} unlocked by ${interaction.user.tag}`);
}

async function handleClaimTicket(interaction: any) {
    const ticketId = interaction.customId.split('_')[2];
    const ticket = await supabase.getTicket(ticketId);

    if (!ticket) {
        await interaction.reply({ content: '❌ Ticket not found.', ephemeral: true });
        return;
    }

    await supabase.updateTicket(ticketId, {
        status: 'claimed',
        claimed_by: interaction.user.id,
        claimed_by_name: interaction.user.tag,
    });

    // Update control panel
    const updatedTicket = await supabase.getTicket(ticketId);
    const controlPanel = createTicketControlPanel(updatedTicket, interaction.user);

    await interaction.update({
        components: [controlPanel],
    });

    // Notify in channel
    await interaction.channel.send({
        content: `👤 **${interaction.user.tag}** has claimed this ticket.`,
    });

    logger.info(`Ticket #${ticket.ticket_number} claimed by ${interaction.user.tag}`);
}

async function handleAIHelp(interaction: any) {
    await interaction.deferReply({ ephemeral: true });

    const ticketId = interaction.customId.split('_')[2];
    const ticket = await supabase.getTicket(ticketId);

    if (!ticket) {
        await interaction.editReply({ content: '❌ Ticket not found.' });
        return;
    }

    // Check if AI is enabled
    if (!config.ai.enabled) {
        const container = ComponentsV2.infoContainer(
            'AI Not Available',
            'AI support is not currently enabled. A staff member will assist you shortly.'
        );
        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        return;
    }

    // Get ticket messages for context
    const messages = await supabase.getTicketMessages(ticketId);

    // Generate AI suggestion (simplified - would use OpenAI in production)
    const container = ComponentsV2.infoContainer(
        '🤖 AI Suggestion',
        `Based on your ticket in the **${ticket.category?.name}** category:\n\n` +
        `**Issue:** ${ticket.subject}\n\n` +
        `**Suggestion:** A staff member will review your ticket shortly. ` +
        `In the meantime, please ensure you've provided all relevant details ` +
        `including any error messages or steps to reproduce the issue.`
    );

    await interaction.editReply({
        components: [container],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });
}

// ============================================
// Utility Functions
// ============================================

function getTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
}

// ============================================
// Enhanced Category Management
// ============================================

async function handleCategoryEdit(interaction: any) {
    const guildId = interaction.guildId!;
    const categoryId = interaction.options.getString('category', true);
    const name = interaction.options.getString('name');
    const emoji = interaction.options.getString('emoji');
    const description = interaction.options.getString('description');
    const parentId = interaction.options.getString('parent_id');

    const updates: any = {};
    if (name) updates.name = name;
    if (emoji) updates.emoji = emoji;
    if (description) updates.description = description;
    if (parentId !== null) updates.discord_category_id = parentId;

    if (Object.keys(updates).length === 0) {
        await interaction.editReply({ content: '❌ No changes specified.' });
        return;
    }

    const success = await supabase.updateTicketCategory(categoryId, updates);

    if (success) {
        const container = ComponentsV2.successContainer(
            'Category Updated',
            `Successfully updated the ticket category.`
        );
        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    } else {
        await interaction.editReply({ content: '❌ Failed to update category.' });
    }
}

async function handleCategoryQuestions(interaction: any) {
    const categoryId = interaction.options.getString('category', true);
    const action = interaction.options.getString('action', true);

    const category = await supabase.getTicketCategory(categoryId);
    if (!category) {
        await interaction.editReply({ content: '❌ Category not found.' });
        return;
    }

    if (action === 'list') {
        const questions = (category.custom_questions as any[]) || [];
        if (questions.length === 0) {
            await interaction.editReply({ content: 'ℹ️ This category has no custom questions.' });
            return;
        }

        const questionList = questions.map((q, i) =>
            `**${i + 1}.** ${q.label} (${q.required ? 'Required' : 'Optional'})\n` +
            `-# Style: ${q.style} | Placeholder: ${q.placeholder || 'None'}`
        ).join('\n\n');

        const container = new ContainerBuilder()
            .setAccentColor(ComponentsV2.Accents.info)
            .addTextDisplayComponents(
                ComponentsV2.text(
                    `# ❓ Custom Questions: ${category.emoji} ${category.name}\n\n` +
                    `━━━━━━━━━━━━━━━━━━\n` +
                    `${questionList}\n` +
                    `━━━━━━━━━━━━━━━━━━\n\n` +
                    `-# Use \`/ticket category questions action:remove\` to delete a question.`
                )
            );

        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    } else if (action === 'add') {
        const container = ComponentsV2.infoContainer(
            'Add Custom Question',
            `Click the button below to add a custom question to **${category.emoji} ${category.name}**.`
        );

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`ticket_question_add_${categoryId}`)
                .setLabel('Open Question Form')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('➕')
        );

        await interaction.editReply({
            components: [container, row],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    } else if (action === 'remove') {
        const questions = (category.custom_questions as any[]) || [];
        if (questions.length === 0) {
            await interaction.editReply({ content: 'ℹ️ This category has no custom questions to remove.' });
            return;
        }

        const select = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`ticket_question_remove_${categoryId}`)
                .setPlaceholder('Select a question to remove...')
                .addOptions(questions.map((q, i) => ({
                    label: q.label.substring(0, 100),
                    description: `Position: ${i + 1}`,
                    value: i.toString(),
                })))
        );

        await interaction.editReply({
            content: `Select a question to remove from **${category.emoji} ${category.name}**:`,
            components: [select],
        });
    }
}
async function handleRemoveQuestion(interaction: any, categoryId: string, index: number) {
    const category = await supabase.getTicketCategory(categoryId);
    if (!category) {
        await interaction.reply({ content: '❌ Category not found.', ephemeral: true });
        return;
    }

    const questions = (category.custom_questions as any[]) || [];
    questions.splice(index, 1);

    const success = await supabase.updateTicketCategory(categoryId, { custom_questions: questions });

    if (success) {
        await interaction.update({
            content: '✅ Question removed successfully.',
            components: [],
        });
    } else {
        await interaction.reply({ content: '❌ Failed to remove question.', ephemeral: true });
    }
}

async function handleShowQuestionAddModal(interaction: any, categoryId: string) {
    const modal = new ModalBuilder()
        .setCustomId(`ticket_question_modal_${categoryId}`)
        .setTitle('Add Custom Question');

    const labelInput = new TextInputBuilder()
        .setCustomId('label')
        .setLabel('Question Label')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. Website URL, Account ID, etc.')
        .setRequired(true)
        .setMaxLength(45);

    const placeholderInput = new TextInputBuilder()
        .setCustomId('placeholder')
        .setLabel('Placeholder Text')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Instruction for the user...')
        .setRequired(false)
        .setMaxLength(100);

    const styleInput = new TextInputBuilder()
        .setCustomId('style')
        .setLabel('Style (short or paragraph)')
        .setStyle(TextInputStyle.Short)
        .setValue('short')
        .setRequired(true);

    const requiredInput = new TextInputBuilder()
        .setCustomId('required')
        .setLabel('Required? (yes or no)')
        .setStyle(TextInputStyle.Short)
        .setValue('yes')
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(labelInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(placeholderInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(styleInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(requiredInput)
    );

    await interaction.showModal(modal);
}

async function handleAddQuestionSubmit(interaction: any, categoryId: string) {
    const label = interaction.fields.getTextInputValue('label');
    const placeholder = interaction.fields.getTextInputValue('placeholder');
    const styleStr = interaction.fields.getTextInputValue('style').toLowerCase();
    const requiredStr = interaction.fields.getTextInputValue('required').toLowerCase();

    const category = await supabase.getTicketCategory(categoryId);
    if (!category) {
        await interaction.reply({ content: '❌ Category not found.', ephemeral: true });
        return;
    }

    const questions = (category.custom_questions as any[]) || [];

    // Discord Modal Limit check: max 5 questions total (3 standard + 2 custom)
    if (questions.length >= 2) {
        await interaction.reply({
            content: '⚠️ Max 2 custom questions allowed per category (due to Discord modal limits).',
            ephemeral: true
        });
        return;
    }

    questions.push({
        id: Math.random().toString(36).substring(7),
        label,
        placeholder: placeholder || undefined,
        style: styleStr === 'paragraph' ? 'paragraph' : 'short',
        required: requiredStr !== 'no',
    });

    const success = await supabase.updateTicketCategory(categoryId, { custom_questions: questions });

    if (success) {
        await interaction.reply({
            content: `✅ Added question: **${label}** to **${category.name}**.`,
            ephemeral: true
        });
    } else {
        await interaction.reply({ content: '❌ Failed to add question.', ephemeral: true });
    }
}
