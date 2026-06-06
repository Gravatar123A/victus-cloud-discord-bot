import { ChannelType } from 'discord.js';
import type { Message } from 'discord.js';
import { config } from '../config.js';
import { supabase } from '../services/supabase.js';
import { groqAi } from '../services/groqAi.js';
import { victusAiActions } from '../services/victusAiActions.js';
import type { Event } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { formatAiMessage } from '../utils/aiMessages.js';

const SETTINGS_TTL_MS = 20_000;
const USER_COOLDOWN_MS = 8_000;
const CHANNEL_COOLDOWN_MS = 2_500;

const aiChannelCache = new Map<string, { channelId: string; expiresAt: number }>();
const userCooldowns = new Map<string, number>();
const channelCooldowns = new Map<string, number>();

function isCoolingDown(key: string, store: Map<string, number>, cooldownMs: number): boolean {
    const now = Date.now();
    const expiresAt = store.get(key) || 0;
    if (expiresAt > now) return true;
    store.set(key, now + cooldownMs);
    return false;
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
        if (!groqAi.isEnabled()) return;

        if (message.channel.type === ChannelType.DM) {
            const prompt = buildPromptFromMessage(message);
            if (prompt.length < 3) return;

            if (isCoolingDown(message.author.id, userCooldowns, USER_COOLDOWN_MS)) return;

            await replyWithAi(
                message,
                prompt,
                false,
                'Victus AI could not answer your DM right now. Please try again in a moment or open a support ticket.'
            );
            return;
        }

        if (!message.inGuild()) return;

        const aiChannelId = await getAiChannelId(message.guildId);
        if (!aiChannelId || message.channelId !== aiChannelId) return;

        const prompt = buildPromptFromMessage(message);
        if (prompt.length < 3) return;

        if (isCoolingDown(message.author.id, userCooldowns, USER_COOLDOWN_MS)) return;
        if (isCoolingDown(message.channelId, channelCooldowns, CHANNEL_COOLDOWN_MS)) return;

        await replyWithAi(
            message,
            prompt,
            true,
            'Victus AI could not answer this message right now. A staff member can still help here.'
        );
    },
};
