import { Interaction, MessageFlags } from 'discord.js';
import { logger } from '../utils/logger.js';
import { checkCooldown } from '../middleware/rateLimit.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import type { Event } from '../types/index.js';

export const interactionCreateEvent: Event = {
    name: 'interactionCreate',
    async execute(interaction: Interaction) {
        // Intercept prefix command message component interactions and translate V2 components
        if (interaction.isMessageComponent()) {
            const isV2 = interaction.message.flags?.has(32768) ?? false;
            if (!isV2) {
                const origUpdate = interaction.update.bind(interaction);
                (interaction as any).update = async (options: any) => {
                    const { translateV2Components } = await import('../utils/prefixInteraction.js');
                    const translated = translateV2Components(options);
                    return origUpdate(translated);
                };
                
                const origEditReply = interaction.editReply.bind(interaction);
                (interaction as any).editReply = async (options: any) => {
                    const { translateV2Components } = await import('../utils/prefixInteraction.js');
                    const translated = translateV2Components(options);
                    return origEditReply(translated);
                };
            }
        }

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
                const errMsg = error?.message || String(error);
                const errStack = error?.stack || '';
                logger.error(`❌ Error executing command ${interaction.commandName}:`, error);
                logger.error(`Stack: ${errStack}`);
                if (error.errors) logger.error('Validation details:', JSON.stringify(error.errors, null, 2));
                if (error?.code) logger.error(`Discord error code: ${error.code} | HTTP: ${error?.httpStatus || error?.status || 'n/a'}`);

                const isCertError = errMsg.includes('unable to verify the first certificate') || errMsg.includes('certificate');
                const isSupabaseError = errMsg.includes('supabase') || errMsg.includes('PGRST') || errMsg.includes('FunctionsHttpError');
                const hint = isCertError
                    ? '🔒 TLS certificate verification failed - check container CA certificates.'
                    : isSupabaseError
                        ? '🗄️ Account data temporarily unavailable - Supabase is unreachable.'
                        : `Details: \`${errMsg.slice(0, 300)}\``;

                const container = ComponentsV2.errorContainer(
                    'Command Error',
                    `An error occurred while executing \`/${interaction.commandName}\`. ${hint}\n\nWe are using the standard interface for now. If this persists, contact support with the command name and time.`
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
                        if (interaction.replied || interaction.deferred) return;
                    } catch (error) {
                        logger.error(`Error handling button ${customId}:`, error);
                    }
                }
            }

            logger.debug(`Unhandled button: ${customId}`);
        }

        // Handle select menus
        else if (interaction.isAnySelectMenu()) {
            const customId = interaction.customId;

            // Try each command's select handler, but only stop once one has
            // actually acknowledged the interaction. (Several commands define
            // handleSelectMenu; returning after the first one — even when it
            // ignored this customId — left ticket selects unanswered ->
            // "interaction failed".) showModal also sets `replied`.
            for (const [, command] of interaction.client.commands) {
                if (command.handleSelectMenu) {
                    try {
                        await command.handleSelectMenu(interaction as any);
                        if (interaction.replied || interaction.deferred) return;
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

            // Same fix as select menus: only stop once a handler acknowledges
            // the modal submit, so the ticket form submit isn't swallowed by
            // another command's handleModal.
            for (const [, command] of interaction.client.commands) {
                if (command.handleModal) {
                    try {
                        await command.handleModal(interaction);
                        if (interaction.replied || interaction.deferred) return;
                    } catch (error) {
                        logger.error(`Error handling modal ${customId}:`, error);
                    }
                }
            }

            logger.debug(`Unhandled modal: ${customId}`);
        }
    },
};
