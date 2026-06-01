import { Interaction, MessageFlags } from 'discord.js';
import { logger } from '../utils/logger.js';
import { checkCooldown } from '../middleware/rateLimit.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import type { Event } from '../types/index.js';

export const interactionCreateEvent: Event = {
    name: 'interactionCreate',
    async execute(interaction: Interaction) {
        // Handle slash commands
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);

            if (!command) {
                logger.warn(`Unknown command: ${interaction.commandName}`);
                return;
            }

            // Check cooldown
            if (command.cooldown) {
                const remaining = checkCooldown(interaction, interaction.commandName, command.cooldown);
                if (remaining > 0) {
                    const container = ComponentsV2.warningContainer(
                        'Slow Down!',
                        `Please wait **${remaining}** second${remaining > 1 ? 's' : ''} before using this command again.`
                    );
                    try {
                        await interaction.reply({
                            components: [container],
                            flags: ComponentsV2.IS_COMPONENTS_V2 | MessageFlags.Ephemeral,
                        });
                    } catch (error: any) {
                        logger.error('❌ Failed to send V2 auto-link response:', error);
                        if (error.errors) logger.error('Validation details:', JSON.stringify(error.errors, null, 2));

                        await interaction.reply({
                            content: '⚠️ **System Error:** Failed to render linking interface. Please contact support.',
                            ephemeral: true
                        }).catch(() => { });
                    }
                    return;
                }
            }

            try {
                logger.info(`Command: /${interaction.commandName} by ${interaction.user.tag} (${interaction.user.id})`);
                await command.execute(interaction);
            } catch (error: any) {
                logger.error(`❌ Error executing command ${interaction.commandName}:`, error);
                if (error.errors) logger.error('Validation details:', JSON.stringify(error.errors, null, 2));

                const container = ComponentsV2.errorContainer(
                    'Command Error',
                    'An error occurred while executing this command. We are using the standard interface for now.'
                );

                const replyOptions = {
                    components: [container],
                    flags: ComponentsV2.IS_COMPONENTS_V2 | MessageFlags.Ephemeral,
                };

                try {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.editReply(replyOptions);
                    } else {
                        await interaction.reply(replyOptions);
                    }
                } catch (fallbackError: any) {
                    logger.error('❌ Fallback V2 response failed:', fallbackError);
                    const finalFallback = { content: '⚠️ **Critical Error:** High-end UI failed. Check bot console.', ephemeral: true };
                    if (interaction.replied || interaction.deferred) {
                        await interaction.editReply(finalFallback).catch(() => { });
                    } else {
                        await interaction.reply(finalFallback).catch(() => { });
                    }
                }
            }
        }

        // Handle autocomplete
        else if (interaction.isAutocomplete()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command?.autocomplete) return;

            try {
                await command.autocomplete(interaction);
            } catch (error) {
                logger.error(`Autocomplete error for ${interaction.commandName}:`, error);
            }
        }

        // Handle buttons
        else if (interaction.isButton()) {
            const customId = interaction.customId;

            // Check if any command has a button handler
            for (const [, command] of interaction.client.commands) {
                if (command.handleButton) {
                    try {
                        await command.handleButton(interaction);
                        return;
                    } catch (error) {
                        logger.error(`Error handling button ${customId}:`, error);
                    }
                }
            }

            logger.debug(`Unhandled button: ${customId}`);
        }

        // Handle select menus
        else if (interaction.isStringSelectMenu()) {
            const customId = interaction.customId;

            // Check if any command has a select menu handler
            for (const [, command] of interaction.client.commands) {
                if (command.handleSelectMenu) {
                    try {
                        await command.handleSelectMenu(interaction);
                        return;
                    } catch (error) {
                        logger.error(`Error handling select menu ${customId}:`, error);
                    }
                }
            }

            logger.debug(`Unhandled select menu: ${customId}`);
        }

        // Handle modals
        else if (interaction.isModalSubmit()) {
            const customId = interaction.customId;

            // Check if any command has a modal handler
            for (const [, command] of interaction.client.commands) {
                if (command.handleModal) {
                    try {
                        await command.handleModal(interaction);
                        return;
                    } catch (error) {
                        logger.error(`Error handling modal ${customId}:`, error);
                    }
                }
            }

            logger.debug(`Unhandled modal: ${customId}`);
        }
    },
};
