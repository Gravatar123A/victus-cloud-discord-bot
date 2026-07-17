import { ChannelType, AttachmentBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import type { Message } from 'discord.js';
import { config } from '../config.js';
import { supabase } from '../services/supabase.js';
import { groqAi } from '../services/groqAi.js';
import { victusAiActions } from '../services/victusAiActions.js';
import type { Event } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { formatAiMessage } from '../utils/aiMessages.js';
import { handleTicketChannelMessage, mirrorAiReplyToTicket } from '../services/ticketBridge.js';
import { isChannelSummoned } from '../services/summonedChannels.js';
import { awardMessageXp } from '../services/activityXp.js';
import { PrefixInteraction, translateV2Components } from '../utils/prefixInteraction.js';
import { checkCooldown } from '../middleware/rateLimit.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { calculateLevel } from '../utils/vccrs.js';
import { buildFinalEmbedPayload } from '../commands/embed.js';
import { bridgeDiscordMessageToWeb } from '../services/chatBridge.js';

const SETTINGS_TTL_MS = 20_000;
const MAX_QUEUE_DEPTH = 3;

const aiChannelCache = new Map<string, { channelId: string; expiresAt: number }>();

// Per-user serial queue: a message that arrives while the previous one is still
// being answered (slow free AI key) is queued and answered in order, instead of
// being silently dropped by a cooldown.
const userChains = new Map<string, Promise<unknown>>();
const userQueueDepth = new Map<string, number>();

function enqueuePerUser(userId: string, task: () => Promise<void>): boolean {
    const depth = userQueueDepth.get(userId) || 0;
    if (depth >= MAX_QUEUE_DEPTH) return false; // too many already pending; drop the overflow
    userQueueDepth.set(userId, depth + 1);
    const prev = userChains.get(userId) || Promise.resolve();
    const next = prev
        .then(task)
        .catch(() => { /* errors are handled inside the task */ })
        .finally(() => userQueueDepth.set(userId, Math.max(0, (userQueueDepth.get(userId) || 1) - 1)));
    userChains.set(userId, next);
    return true;
}

async function getAiChannelId(guildId: string): Promise<string> {
    const cached = aiChannelCache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) return cached.channelId;

    const settings = await supabase.getBotSettings(guildId).catch(() => null);
    const channelId = settings?.ai_channel_id || config.bot.aiChannelId || '';
    aiChannelCache.set(guildId, {
        channelId,
        expiresAt: Date.now() + SETTINGS_TTL_MS,
    });

    return channelId;
}

function buildPromptFromMessage(message: Message): string {
    const content = message.content.trim();
    const attachments = [...message.attachments.values()]
        .slice(0, 5)
        .map((attachment) => `${attachment.name || 'attachment'} (${attachment.contentType || 'unknown type'})`)
        .join(', ');

    if (content && attachments) return `${content}\n\nAttachments: ${attachments}`;
    if (content) return content;
    if (attachments) return `The user sent attachments and may need support: ${attachments}`;
    return '';
}

// When the AI answers publicly inside a ticket channel (e.g. staff /summon-ed
// it), mirror the answer into the website ticket thread so the web user sees it.
async function mirrorPublicReply(message: Message, publicReply: boolean, text: string): Promise<void> {
    if (!publicReply || !message.inGuild() || !text) return;
    const botId = message.client.user?.id;
    if (!botId) return;
    await mirrorAiReplyToTicket(message.channelId, botId, text).catch(() => undefined);
}

async function replyWithAi(message: Message, prompt: string, publicReply: boolean, fallbackMessage: string): Promise<void> {
    try {
        if ('sendTyping' in message.channel) {
            await message.channel.sendTyping().catch(() => undefined);
        }

        const actionResult = await victusAiActions.tryHandle(prompt, {
            discordId: message.author.id,
            publicReply,
        });

        if (actionResult.handled) {
            let content = actionResult.content;
            if (publicReply && actionResult.dmContent) {
                const dmSent = await message.author.send({
                    content: formatAiMessage(actionResult.dmContent),
                }).then(() => true).catch(() => false);

                if (!dmSent) {
                    content = 'That is private account info, so DM me for the answer. I could not open DMs with you from here.';
                }
            }

            await message.reply({
                content: formatAiMessage(content),
                allowedMentions: { repliedUser: false },
            });
            await mirrorPublicReply(message, publicReply, content);
            return;
        }

        const linked = await supabase.getLinkedAccount(message.author.id).catch(() => null);
        const profile = linked ? await supabase.getUserProfile(linked.user_id).catch(() => null) : null;
        const answer = await groqAi.askVictus(prompt, {
            discordTag: message.author.tag,
            discordId: message.author.id,
            linked: !!linked,
            profile,
            publicReply,
        });

        await message.reply({
            content: formatAiMessage(answer),
            allowedMentions: { repliedUser: false },
        });
        await mirrorPublicReply(message, publicReply, answer);
    } catch (error) {
        logger.error(publicReply ? 'AI channel response failed:' : 'AI DM response failed:', error);
        await message.reply({
            content: fallbackMessage,
            allowedMentions: { repliedUser: false },
        }).catch(() => undefined);
    }
}

function formatDurationMs(ms: number): string {
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hrs}h ${remainingMins}m`;
}

export const messageCreateEvent: Event = {
    name: 'messageCreate',
    async execute(message: Message) {
        // Mirror the public #general channel to the website public chat.
        // Fire-and-forget; the bridge self-guards against bot/webhook echo.
        void bridgeDiscordMessageToWeb(message);

        if (message.author.bot) return;

        // --- AFK System ---
        if (message.inGuild()) {
            const guildId = message.guildId!;
            
            // 1. Check if the message sender is returning from AFK
            try {
                const authorAfkEmbed = await supabase.getCustomEmbed(guildId, `_afk_${message.author.id}`);
                if (authorAfkEmbed?.description) {
                    const afkData = JSON.parse(authorAfkEmbed.description);
                    await supabase.deleteCustomEmbed(guildId, `_afk_${message.author.id}`);
                    
                    const durationMs = Date.now() - new Date(afkData.timestamp).getTime();
                    const durationStr = formatDurationMs(durationMs);
                    
                    const welcomeEmbed = new EmbedBuilder()
                        .setColor(0x8b5cf6) // Purple
                        .setTitle(`Welcome back, ${message.author.username}!`)
                        .setThumbnail(message.author.displayAvatarURL())
                        .setDescription('🔮 You are no longer AFK.')
                        .addFields(
                            { name: 'You were AFK for', value: `**${durationStr}**`, inline: true },
                            { name: 'Reason', value: afkData.reason || 'AFK', inline: true }
                        );

                    const loggedMentions = afkData.mentions || [];
                    if (loggedMentions.length > 0) {
                        const mentionList = loggedMentions
                            .map((m: any) => `› **${m.authorTag || m.username || m.tag || m.authorName || 'Unknown User'}** in <#${m.channelId}>: [Jump to Message](https://discord.com/channels/${guildId}/${m.channelId}/${m.messageId}) (<t:${Math.floor(new Date(m.timestamp).getTime() / 1000)}:R>)`)
                            .slice(0, 10)
                            .join('\n');
                        welcomeEmbed.addFields({ name: '📝 Mentions while you were AFK', value: mentionList, inline: false });
                    } else {
                        welcomeEmbed.addFields({ name: '📝 Mentions while you were AFK', value: 'No one mentioned you while you were away.', inline: false });
                    }

                    await message.reply({ embeds: [welcomeEmbed] }).catch(() => {});
                }
            } catch (err) {
                logger.error('Error handling sender AFK return:', err);
            }

            // 2. Check if the message mentions anyone who is AFK
            if (message.mentions.users.size > 0) {
                for (const [mentionedId, mentionedUser] of message.mentions.users) {
                    if (mentionedId === message.author.id || mentionedUser.bot) continue;
                    
                    try {
                        const targetAfkEmbed = await supabase.getCustomEmbed(guildId, `_afk_${mentionedId}`);
                        if (targetAfkEmbed?.description) {
                            const afkData = JSON.parse(targetAfkEmbed.description);
                            
                            // Send AFK notification in the channel
                            const afkEmbed = new EmbedBuilder()
                                .setColor(0x6366f1)
                                .setDescription(`🔍 **${mentionedUser.username}** is currently AFK: **${afkData.reason || 'AFK'}** (<t:${Math.floor(new Date(afkData.timestamp).getTime() / 1000)}:R>)`);
                            await message.reply({ embeds: [afkEmbed] }).catch(() => {});

                            // Log the mention into their AFK data
                            const loggedMentions = afkData.mentions || [];
                            loggedMentions.push({
                                authorTag: message.author.tag || message.author.username,
                                username: message.author.username,
                                content: message.content.slice(0, 100),
                                channelId: message.channelId,
                                messageId: message.id,
                                timestamp: new Date().toISOString()
                            });
                            afkData.mentions = loggedMentions;

                            await supabase.saveCustomEmbed(guildId, `_afk_${mentionedId}`, {
                                description: JSON.stringify(afkData)
                            });
                        }
                    } catch (err) {
                        logger.error(`Error logging AFK mention for user ${mentionedId}:`, err);
                    }
                }
            }
        }

        // Get guild specific prefix or default to '!'
        let prefix = '!';
        if (message.inGuild()) {
            const settings = await supabase.getBotSettings(message.guildId).catch(() => null);
            if (settings?.prefix) {
                prefix = settings.prefix;
            }
        }

        const botId = message.client.user?.id;
        const mentionPrefix = botId ? `<@${botId}>` : null;
        const mentionNickPrefix = botId ? `<@!${botId}>` : null;

        let isCommand = false;
        let commandPrefix = '';

        const content = message.content.trim();

        if (content.startsWith(prefix)) {
            isCommand = true;
            commandPrefix = prefix;
        } else if (mentionPrefix && content.startsWith(mentionPrefix)) {
            isCommand = true;
            commandPrefix = mentionPrefix;
        } else if (mentionNickPrefix && content.startsWith(mentionNickPrefix)) {
            isCommand = true;
            commandPrefix = mentionNickPrefix;
        }

        if (isCommand) {
            const rawArgs = content.slice(commandPrefix.length).trim();
            if (rawArgs.length > 0) {
                const args: string[] = [];
                const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
                let match;
                while ((match = regex.exec(rawArgs)) !== null) {
                    args.push(match[1] || match[2] || match[0]);
                }

                const commandName = args.shift()?.toLowerCase();
                if (commandName) {
                    // Check standard commands
                    const command = message.client.commands.get(commandName);
                    if (command) {
                        if (command.cooldown) {
                            const remaining = checkCooldown({ user: message.author } as any, commandName, command.cooldown);
                            if (remaining > 0) {
                                const container = ComponentsV2.warningContainer(
                                    'Slow Down!',
                                    `Please wait **${remaining}** second${remaining > 1 ? 's' : ''} before using this command again.`
                                );
                                await message.reply(translateV2Components({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 })).catch(() => {});
                                return;
                            }
                        }

                        if (command.requiresLink) {
                            const linked = await supabase.getLinkedAccount(message.author.id).catch(() => null);
                            if (!linked) {
                                const container = ComponentsV2.warningContainer(
                                    'Account Link Required',
                                    'This command requires you to link your Discord account to Victus Cloud. Use `/link` to start.'
                                );
                                await message.reply(translateV2Components({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 })).catch(() => {});
                                return;
                            }
                        }

                        if (command.adminOnly) {
                            const isAdmin = await supabase.isUserAdmin(message.author.id).catch(() => false);
                            if (!isAdmin) {
                                const container = ComponentsV2.errorContainer(
                                    'Permission Denied',
                                    'This command is restricted to bot administrators.'
                                );
                                await message.reply(translateV2Components({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 })).catch(() => {});
                                return;
                            }
                        }

                        try {
                            const prefixInteraction = new PrefixInteraction(message, commandName, args, command.data.toJSON());
                            logger.info(`Prefix Command: ${prefix}${commandName} by ${message.author.tag} (${message.author.id})`);
                            await command.execute(prefixInteraction as any);
                        } catch (error) {
                            logger.error(`Error running prefix command ${commandName}:`, error);
                            await message.reply('⚠️ An error occurred while executing this command.').catch(() => {});
                        }
                        return;
                    }

                    // Check custom commands
                    if (message.inGuild()) {
                        const customCmd = await supabase.getCustomCommand(message.guildId, commandName);
                        if (customCmd && customCmd.enabled) {
                            if (customCmd.cooldown > 0) {
                                const remaining = checkCooldown({ user: message.author } as any, `custom:${commandName}`, customCmd.cooldown);
                                if (remaining > 0) {
                                    const container = ComponentsV2.warningContainer(
                                        'Slow Down!',
                                        `Please wait **${remaining}** second${remaining > 1 ? 's' : ''} before using this command again.`
                                    );
                                    await message.reply(translateV2Components({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 })).catch(() => {});
                                    return;
                                }
                            }

                            if (customCmd.permissions && customCmd.permissions.length > 0) {
                                const member = message.member;
                                const hasRole = member?.roles.cache.some(role => customCmd.permissions.includes(role.id));
                                const isAdmin = member?.permissions.has(PermissionFlagsBits.Administrator);
                                if (!hasRole && !isAdmin) {
                                    const container = ComponentsV2.errorContainer(
                                        'Permission Denied',
                                        'You do not have the required roles to run this custom command.'
                                    );
                                    await message.reply(translateV2Components({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 })).catch(() => {});
                                    return;
                                }
                            }

                            let replyText = customCmd.reply_content;
                            let xp = 0;
                            let level = 1;
                            let coins = 0;
                            if (replyText.includes('{member.level}') || replyText.includes('{member.xp}') || replyText.includes('{member.coins}')) {
                                const linked = await supabase.getLinkedAccount(message.author.id).catch(() => null);
                                if (linked) {
                                    const profile = await supabase.getUserProfile(linked.user_id).catch(() => null);
                                    if (profile) {
                                        xp = Number(profile.total_xp ?? 0);
                                        level = calculateLevel(xp);
                                        coins = Number(profile.total_cp ?? 0);
                                    }
                                }
                            }

                            const variableMap: Record<string, string> = {
                                '{user}': `<@${message.author.id}>`,
                                '{user.name}': message.author.username,
                                '{user.id}': message.author.id,
                                '{guild}': message.guild?.name || 'this server',
                                '{channel}': `<#${message.channelId}>`,
                                '{member.level}': String(level),
                                '{member.xp}': String(xp),
                                '{member.coins}': String(coins),
                            };

                            for (const [vKey, vVal] of Object.entries(variableMap)) {
                                replyText = replyText.replace(new RegExp(vKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), vVal);
                            }

                            if (customCmd.reply_type === 'text') {
                                await message.reply({ content: replyText }).catch(() => {});
                            } else if (customCmd.reply_type === 'embed') {
                                try {
                                    let embedPayload;
                                    try {
                                        embedPayload = JSON.parse(replyText);
                                    } catch {
                                        embedPayload = { components: [ComponentsV2.infoContainer(customCmd.name, replyText)], flags: ComponentsV2.IS_COMPONENTS_V2 };
                                    }
                                    await message.reply(embedPayload).catch(() => {});
                                } catch {
                                    await message.reply({ content: replyText }).catch(() => {});
                                }
                            } else if (customCmd.reply_type === 'custom_embed') {
                                try {
                                    const embed = await supabase.getCustomEmbed(message.guildId!, replyText);
                                    if (embed) {
                                        const payload = buildFinalEmbedPayload(embed);
                                        await message.reply({ components: [payload], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => {});
                                    } else {
                                        await message.reply({ content: `❌ Linked custom embed template **\`${replyText}\`** not found.` }).catch(() => {});
                                    }
                                } catch (error) {
                                    logger.error('Failed to send custom command embed:', error);
                                    await message.reply({ content: '⚠️ Failed to load the custom embed response.' }).catch(() => {});
                                }
                            } else if (customCmd.reply_type === 'image') {
                                await message.reply({ files: [new AttachmentBuilder(replyText)] }).catch(() => {});
                            } else if (customCmd.reply_type === 'message') {
                                await message.reply({ content: replyText }).catch(() => {});
                            }
                            return;
                        }
                    }
                }
            }
        }

        // Award XP for guild activity to linked users (per-user cooldown applied
        // inside awardMessageXp). Skip DMs, system messages and command-like
        // messages (slash commands aren't messageCreate, but ignore prefix too).
        if (message.inGuild() && !message.system) {
            const looksLikeCommand = content.startsWith('/') || content.startsWith(prefix);
            if (!looksLikeCommand) {
                void awardMessageXp(message.author.id).catch(() => undefined);
            }
        }

        const summoned = message.inGuild() ? isChannelSummoned(message.channelId) : false;

        // Mirror messages in ticket channels to the website ticket (runs even if
        // the AI is disabled). Normally that's the end of it — but if staff have
        // /summon-ed this channel, fall through so the AI also answers.
        const ticketHandled = await handleTicketChannelMessage(message);
        if (ticketHandled && !summoned) return;

        if (!groqAi.isEnabled()) return;

        if (message.channel.type === ChannelType.DM) {
            const prompt = buildPromptFromMessage(message);
            if (prompt.length < 3) return;

            enqueuePerUser(message.author.id, () => replyWithAi(
                message,
                prompt,
                false,
                'Victus AI could not answer your DM right now. Please try again in a moment or open a support ticket.'
            ));
            return;
        }

        if (!message.inGuild()) return;

        // The AI answers in a guild channel when ANY of these is true:
        //  - the bot is directly @mentioned (works in any channel, configured or not)
        //  - the channel has been /summon-ed by staff
        //  - it's the configured AI support channel
        const isMentioned = !!botId && message.mentions.users.has(botId);
        const aiChannelId = await getAiChannelId(message.guildId);
        const isAiChannel = !!aiChannelId && message.channelId === aiChannelId;

        if (!isMentioned && !summoned && !isAiChannel) return;

        let prompt = buildPromptFromMessage(message);
        // Strip the bot mention so the AI doesn't see a raw "<@id>" token.
        if (isMentioned && botId) {
            prompt = prompt.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();
        }
        if (prompt.length < 3) return;

        enqueuePerUser(message.author.id, () => replyWithAi(
            message,
            prompt,
            true,
            'Victus AI could not answer this message right now. A staff member can still help here.'
        ));
    },
};
