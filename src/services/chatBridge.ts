import type { Message } from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

// The #general channel that is bridged to the website's public chat.
// Override with PUBLIC_CHAT_CHANNEL_ID if the channel ever changes.
const PUBLIC_CHAT_CHANNEL_ID = process.env.PUBLIC_CHAT_CHANNEL_ID || '1416377943776559204';

const client = createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Mirror a Discord message from the public channel into the website public chat
 * (`global_chat_messages`).
 *
 * Echo-safe: ignores bot + webhook messages. The web -> Discord direction posts
 * through a Discord webhook (see the `public-chat-send` edge function), and
 * webhook messages carry `webhookId`, so they are skipped here and never loop
 * back into the web chat.
 */
export async function bridgeDiscordMessageToWeb(message: Message): Promise<void> {
    try {
        if (message.channelId !== PUBLIC_CHAT_CHANNEL_ID) return;
        if (message.author?.bot) return;
        if (message.webhookId) return;

        const content = (message.content || '').trim();
        if (!content) return; // skip attachment-only / empty messages for now

        const username = message.member?.displayName || message.author.username || 'Discord user';
        const avatarUrl =
            message.member?.displayAvatarURL?.({ size: 128 }) ||
            message.author.displayAvatarURL({ size: 128 });

        await client.from('global_chat_messages').insert({
            user_id: null,
            username,
            avatar_url: avatarUrl,
            message: content.slice(0, 2000),
            discord_message_id: message.id,
        });
    } catch (err) {
        try {
            logger.error(`[chatBridge] failed to mirror Discord message: ${String(err)}`);
        } catch {
            /* noop */
        }
    }
}
