import https from 'node:https';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, } from 'discord.js';
import { supabase } from './supabase.js';
import { groqAi } from './groqAi.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';
export const TOP_10_LANGUAGES = [
    { code: 'en', name: 'English', nativeName: 'English', emoji: '🇬🇧', flag: '🇬🇧' },
    { code: 'es', name: 'Spanish', nativeName: 'Español', emoji: '🇪🇸', flag: '🇪🇸' },
    { code: 'zh-CN', name: 'Chinese', nativeName: '中文 (Mandarin)', emoji: '🇨🇳', flag: '🇨🇳' },
    { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', emoji: '🇮🇳', flag: '🇮🇳' },
    { code: 'ar', name: 'Arabic', nativeName: 'العربية', emoji: '🇸🇦', flag: '🇸🇦' },
    { code: 'fr', name: 'French', nativeName: 'Français', emoji: '🇫🇷', flag: '🇫🇷' },
    { code: 'pt', name: 'Portuguese', nativeName: 'Português', emoji: '🇧🇷', flag: '🇧🇷' },
    { code: 'ru', name: 'Russian', nativeName: 'Русский', emoji: '🇷🇺', flag: '🇷🇺' },
    { code: 'de', name: 'German', nativeName: 'Deutsch', emoji: '🇩🇪', flag: '🇩🇪' },
    { code: 'ja', name: 'Japanese', nativeName: '日本語', emoji: '🇯🇵', flag: '🇯🇵' },
];
class TicketTranslationService {
    // In-memory cache keyed by channelId
    channelCache = new Map();
    /**
     * Resolve language definition from code
     */
    getLanguage(code) {
        const normalized = code.toLowerCase();
        return (TOP_10_LANGUAGES.find((l) => l.code.toLowerCase() === normalized || l.code.toLowerCase().startsWith(normalized)) || TOP_10_LANGUAGES[0]);
    }
    /**
     * Get the active translation state for a ticket channel
     */
    async getState(channelId) {
        if (this.channelCache.has(channelId)) {
            return this.channelCache.get(channelId);
        }
        try {
            // Attempt to restore state from Supabase custom_embeds
            const embed = await supabase.getCustomEmbed('system', `_ticket_trans_${channelId}`);
            if (embed?.description) {
                const parsed = JSON.parse(embed.description);
                this.channelCache.set(channelId, parsed);
                return parsed;
            }
        }
        catch (error) {
            logger.warn(`Failed to fetch translation state for channel ${channelId}:`, error);
        }
        return null;
    }
    /**
     * Save the active translation state for a ticket channel
     */
    async setState(state) {
        this.channelCache.set(state.channelId, state);
        try {
            await supabase.saveCustomEmbed('system', `_ticket_trans_${state.channelId}`, {
                description: JSON.stringify(state),
            });
        }
        catch (error) {
            logger.warn(`Failed to persist translation state for channel ${state.channelId}:`, error);
        }
    }
    /**
     * Initialize or update language for a ticket
     */
    async setLanguage(channelId, ticketId, customerId, languageCode, enabled = true) {
        const lang = this.getLanguage(languageCode);
        const state = {
            ticketId,
            channelId,
            customerId,
            language: lang.code,
            languageName: lang.name,
            languageEmoji: lang.emoji,
            enabled: lang.code !== 'en' ? enabled : false,
            updatedAt: Date.now(),
        };
        await this.setState(state);
        return state;
    }
    /**
     * Toggle translation enabled/disabled for a ticket channel
     */
    async toggleTranslation(channelId, explicitState) {
        const current = await this.getState(channelId);
        if (!current)
            return null;
        current.enabled = explicitState !== undefined ? explicitState : !current.enabled;
        current.updatedAt = Date.now();
        await this.setState(current);
        return current;
    }
    /**
     * Primary Translation Engine: Google Translate API via direct HTTPS with resilient TLS handling
     */
    async translateViaGoogle(text, targetLang, sourceLang = 'auto') {
        return new Promise((resolve, reject) => {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
            const req = https.get(url, {
                rejectUnauthorized: false, // Prevents Windows/proxy certificate leaf errors
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
                timeout: 8000,
            }, (res) => {
                let raw = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    raw += chunk;
                });
                res.on('end', () => {
                    try {
                        if (res.statusCode && res.statusCode >= 400) {
                            return reject(new Error(`Google Translate HTTP ${res.statusCode}: ${raw}`));
                        }
                        const data = JSON.parse(raw);
                        if (Array.isArray(data) && Array.isArray(data[0])) {
                            const translated = data[0]
                                .map((item) => item[0])
                                .filter(Boolean)
                                .join('');
                            resolve(translated);
                        }
                        else {
                            reject(new Error('Invalid Google Translate response format'));
                        }
                    }
                    catch (err) {
                        reject(err);
                    }
                });
            });
            req.on('error', (err) => reject(err));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Google Translate request timed out'));
            });
        });
    }
    /**
     * Fallback Translation Engine: Groq AI
     */
    async translateViaGroq(text, targetLang) {
        const target = this.getLanguage(targetLang);
        const prompt = `You are a professional real-time translator for a high-priority customer support ticket.
Translate the following user message accurately into ${target.name} (${target.nativeName}).
Rules:
1. Output ONLY the translated text.
2. Do not add explanations, quotes, notes, or intros.
3. Preserve code snippets, links, mentions, technical terms, and punctuation exactly.

Message to translate:
${text}`;
        const response = await groqAi.askVictus(prompt, {
            discordTag: 'translator',
            discordId: 'system',
            linked: true,
            publicReply: true,
        });
        return response.trim();
    }
    /**
     * High-reliability translation wrapper with automatic fallback
     */
    async translate(text, targetLang, sourceLang = 'auto') {
        const trimmed = text.trim();
        if (!trimmed)
            return text;
        try {
            return await this.translateViaGoogle(trimmed, targetLang, sourceLang);
        }
        catch (googleError) {
            logger.warn(`Google Translate failed for target ${targetLang}, falling back to Groq AI:`, googleError);
            try {
                return await this.translateViaGroq(trimmed, targetLang);
            }
            catch (groqError) {
                logger.error('Both Google Translate and Groq AI translation failed:', groqError);
                throw groqError;
            }
        }
    }
    /**
     * Generate Components V2 Language Selection card
     */
    buildLanguageSelector(ticketId, customerId, currentState) {
        const isSelected = currentState && currentState.language !== 'en';
        const isEnabled = currentState?.enabled ?? false;
        const currentLang = currentState ? this.getLanguage(currentState.language) : TOP_10_LANGUAGES[0];
        const container = ComponentsV2.baseContainer(isEnabled ? ComponentsV2.Accents.success : ComponentsV2.Accents.primary);
        const statusBadge = !isSelected
            ? '`🇬🇧 English (Standard)`'
            : isEnabled
                ? `\`🟢 Active — ${currentLang.emoji} ${currentLang.name} ⇄ 🇬🇧 English\``
                : `\`⏸️ Paused — ${currentLang.emoji} ${currentLang.name} (Disabled by Staff)\``;
        const description = `### 🌐 Ticket Language & Live Translation\n` +
            `Choose your preferred language below so our team can assist you seamlessly in your native tongue.\n\n` +
            `› **Current Mode:** ${statusBadge}\n` +
            `› **Customer:** <@${customerId}>\n\n` +
            `**How it works:**\n` +
            `• **Your messages** are automatically translated to **English** for staff.\n` +
            `• **Staff responses** are automatically translated to **${currentLang.name}** for you.\n` +
            `• Staff can pause, re-enable, or change translation anytime using the button below or \`/ticket translate\`.`;
        container
            .addTextDisplayComponents(ComponentsV2.text(description))
            .addSeparatorComponents(ComponentsV2.separator());
        // Language Select Menu
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`ticket_lang_select:${ticketId}:${customerId}`)
            .setPlaceholder(`Select ticket language (${currentLang.emoji} ${currentLang.name})...`)
            .addOptions(TOP_10_LANGUAGES.map((lang) => new StringSelectMenuOptionBuilder()
            .setLabel(`${lang.name} (${lang.nativeName})`)
            .setValue(lang.code)
            .setDescription(lang.code === 'en'
            ? 'Standard English support (No translation)'
            : `Auto-translate ${lang.name} ⇄ English`)
            .setEmoji(lang.emoji)
            .setDefault(lang.code === (currentState?.language || 'en'))));
        // Control Buttons
        const buttonRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(`ticket_trans_toggle:${ticketId}`)
            .setLabel(isEnabled ? 'Pause Translation ⏸️' : 'Enable Translation ▶️')
            .setStyle(isEnabled ? ButtonStyle.Secondary : ButtonStyle.Success)
            .setDisabled(!isSelected), new ButtonBuilder()
            .setCustomId(`ticket_trans_reset:${ticketId}`)
            .setLabel('Set to English (Disable) 🇬🇧')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(currentState?.language === 'en'));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));
        container.addActionRowComponents(buttonRow);
        return container;
    }
    /**
     * Format a translated message for Discord
     */
    formatTranslationNotice(opts) {
        const direction = opts.isCustomer
            ? `${opts.sourceLanguage.emoji} ${opts.sourceLanguage.name} ➔ 🇬🇧 English (for Staff)`
            : `🇬🇧 English ➔ ${opts.targetLanguage.emoji} ${opts.targetLanguage.name} (for <@${opts.authorId}>)`;
        const badge = opts.isCustomer ? '👤 **Customer Translation**' : '🛡️ **Staff Translation**';
        return (`### 🌐 ${badge} • \`${direction}\`\n` +
            `> ${opts.translatedText.replace(/\n/g, '\n> ')}\n` +
            `-# Original: "${opts.originalText.length > 80 ? opts.originalText.slice(0, 77) + '...' : opts.originalText}"`);
    }
}
export const ticketTranslationService = new TicketTranslationService();
