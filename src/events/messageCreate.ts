import { ChannelType } from 'discord.js';
import type { Message } from 'discord.js';
import { config } from '../config.js';
import { supabase } from '../services/supabase.js';
import { groqAi } from '../services/groqAi.js';
import { victusAiActions } from '../services/victusAiActions.js';
import type { Event } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { formatAiMessage } from '../utils/aiMessages.js';
import { handleTicketChannelMessage } from '../services/ticketBridge.js';
import { isChannelSummoned } from '../services/summonedChannels.js';

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
    } catch (error) {
        logger.error(publicReply ? 'AI channel response failed:' : 'AI DM response failed:', error);
        await message.reply({
            content: fallbackMessage,
            allowedMentions: { repliedUser: false },
        }).catch(() => undefined);
    }
}

export const messageCreateEvent: Event = {
    name: 'messageCreate',
    async execute(message: Message) {
        if (message.author.bot) return;

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
        const botId = message.client.user?.id;
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
