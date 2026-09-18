import {
    EmbedBuilder,
    Guild,
    GuildMember,
    Message,
    PermissionFlagsBits,
    User,
} from 'discord.js';
import { supabase } from './supabase.js';
import { groqAi } from './groqAi.js';
import { warnSettings, WarningRecord } from './warnSettings.js';
import { whitelistSettings } from './whitelistSettings.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';

const SETTINGS_TTL_MS = 20_000;
const WARNING_LIMIT = 3;
const SUSPENSION_LIMIT = 3;
const SUSPENSION_MS = 24 * 60 * 60 * 1000;

const settingsCache = new Map<string, { settings: any; expiresAt: number }>();
const activeChecks = new Set<string>();

// Profanity detection is now STRICTLY based on the multilingual bad-words database.
// Language detection has been REMOVED per operator request — only actual bad words trigger warnings.
import { containsProfanity } from '../data/badWords.js';

function hasExplicitAbuse(content: string): boolean {
    return containsProfanity(content).matched;
}

async function classifyWithTimeout(content: string): Promise<Awaited<ReturnType<typeof groqAi.classifyModeration>>> {
    return Promise.race([
        groqAi.classifyModeration(content),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 6_000)),
    ]);
}

function policyText(): string {
    return 'Please keep conversations respectful. Avoid profanity and harassment.';
}

async function getSettings(guildId: string): Promise<any | null> {
    const cached = settingsCache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) return cached.settings;
    const settings = await supabase.getBotSettings(guildId).catch(() => null);
    settingsCache.set(guildId, { settings, expiresAt: Date.now() + SETTINGS_TTL_MS });
    return settings;
}

async function sendStaffLog(guild: Guild, channelId: string | null | undefined, text: string): Promise<void> {
    if (!channelId) return;
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased() || !('send' in channel)) return;
    const card = ComponentsV2.baseContainer(ComponentsV2.Accents.warning)
        .addTextDisplayComponents(ComponentsV2.text(text))
        .addSeparatorComponents(ComponentsV2.separator());
    await (channel as any).send({ components: [card], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => undefined);
}

async function getSuspensions(guildId: string, userId: string): Promise<number> {
    const record = await supabase.getCustomEmbed(guildId, `_suspensions_${userId}`).catch(() => null);
    if (!record?.description) return 0;
    try { return Math.max(0, Number(JSON.parse(record.description)?.count || 0)); } catch { return 0; }
}

async function setSuspensions(guildId: string, userId: string, count: number): Promise<void> {
    await supabase.saveCustomEmbed(guildId, `_suspensions_${userId}`, {
        description: JSON.stringify({ count, updated_at: new Date().toISOString() }),
    }).catch(() => undefined);
}

/** Enforce the stated 3-warning / 3-suspension policy for both manual and AI warnings. */
export async function enforceWarningThreshold(
    guild: Guild,
    target: GuildMember | User,
    warningCount: number,
    reason: string,
): Promise<'none' | 'suspended' | 'banned'> {
    if (warningCount < WARNING_LIMIT) return 'none';
    const currentSuspensions = await getSuspensions(guild.id, target.id);
    const nextSuspensions = currentSuspensions + 1;
    await setSuspensions(guild.id, target.id, nextSuspensions);

    const member = target instanceof GuildMember ? target : await guild.members.fetch(target.id).catch(() => null);
    let action: 'suspended' | 'banned' = 'suspended';
    if (nextSuspensions >= SUSPENSION_LIMIT) {
        await member?.ban({ reason: `Victus Cloud moderation: ${nextSuspensions} suspensions (${reason.slice(0, 300)})` }).catch((error) => {
            logger.warn(`Failed to ban ${target.id} after moderation threshold: ${(error as Error).message}`);
        });
        action = 'banned';
    } else {
        await member?.timeout(SUSPENSION_MS, `Victus Cloud moderation: suspension ${nextSuspensions}`).catch((error) => {
            logger.warn(`Failed to suspend ${target.id}: ${(error as Error).message}`);
        });
    }

    await warnSettings.resetWarnings(guild.id, target.id);
    await target.send({
        embeds: [new EmbedBuilder()
            .setColor(action === 'banned' ? 0xef4444 : 0xf59e0b)
            .setTitle(action === 'banned' ? '🚫 Victus Cloud ban' : '⏱️ Victus Cloud service suspension')
            .setDescription(
                action === 'banned'
                    ? `You reached **${nextSuspensions} suspensions** in **${guild.name}** and have been banned.`
                    : `You reached 3 active warnings in **${guild.name}**. Your service access has been suspended for 24 hours.\n\nSuspensions: **${nextSuspensions}/${SUSPENSION_LIMIT}**.`,
            )
            .setFooter({ text: '3 warnings = suspension • 3 suspensions = ban' })],
    }).catch(() => undefined);

    return action;
}

async function recordAutomaticWarning(message: Message, reason: string, category: string, deleteMessage: boolean): Promise<void> {
    if (!message.guild) return;
    const settings = await getSettings(message.guild.id);
    const warnConfig = await warnSettings.get(message.guild.id);
    const warningId = `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const record: WarningRecord = {
        id: warningId,
        userId: message.author.id,
        userName: message.author.username,
        moderatorId: message.client.user?.id || 'victus-ai-moderation',
        moderatorName: 'Victus AI Moderation',
        reason,
        timestamp: new Date().toISOString(),
        source: 'ai_moderation',
        category,
    };
    const warnings = await warnSettings.addWarning(message.guild.id, message.author.id, record);

    if (deleteMessage) await message.delete().catch(() => undefined);

    const logChannelId = settings?.moderation_log_channel_id || warnConfig.warnChannelId;
    await sendStaffLog(
        message.guild,
        logChannelId,
        `# 🛡️ AI moderation case\n\n` +
        `> **User:** <@${message.author.id}> (${message.author.username})\n` +
        `> **Channel:** <#${message.channelId}>\n` +
        `> **Category:** \`${category}\`\n` +
        `> **Action:** ${deleteMessage ? 'Message deleted + warning' : 'Warning'}\n` +
        `> **Warning ID:** \`${warningId}\`\n` +
        `> **Reason:** ${reason}\n\n` +
        `**Active warnings:** ${warnings.length}/${WARNING_LIMIT}`,
    );

    const dmText = `Please keep conversations respectful. ${reason}`;
    await message.author.send({
        embeds: [new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle('⚠️ Victus Cloud moderation warning')
            .setDescription(`${dmText}\n\n**Warning:** ${warnings.length}/${WARNING_LIMIT}\n\n3 warnings = service suspension. 3 suspensions = ban.`)
            .setFooter({ text: `Warning ID: ${warningId}` })],
    }).catch(() => undefined);

    const publicDescription = `This message was removed because it violated the server conduct policy. ${reason}`;
    const notice = ComponentsV2.moderationWarningContainer(
        'Message removed',
        publicDescription,
        message.guild.id,
        null,
    );
    if (message.channel.isTextBased() && 'send' in message.channel) {
        const sent = await (message.channel as any).send({
            components: [notice],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        }).catch(() => null);
        if (sent) setTimeout(() => sent.delete().catch(() => undefined), 5_000).unref?.();
    }

    const escalation = await enforceWarningThreshold(message.guild, message.author, warnings.length, reason);
    if (escalation !== 'none') {
        await sendStaffLog(message.guild, logChannelId, `# 🚨 Automatic escalation\n\n<@${message.author.id}> was **${escalation}** after reaching the moderation threshold.`);
    }
}

export async function inspectModerationMessage(message: Message): Promise<boolean> {
    // Language detection has been DISABLED — only actual profanity (multilingual bad-words DB) triggers a warning.
    if (!message.inGuild() || message.author.bot || !message.content.trim()) return false;
    const settings = await getSettings(message.guildId!);
    if (!settings?.moderation_enabled) return false;

    const member = message.member;
    if (member?.permissions.has(PermissionFlagsBits.Administrator)) return false;
    if (message.content.startsWith('/')) return false;

    const key = `${message.guildId}:${message.id}`;
    if (activeChecks.has(key)) return false;
    activeChecks.add(key);
    try {
        const content = message.content.trim().slice(0, 1800);
        const explicitAbuse = hasExplicitAbuse(content);
        const classification = content.length >= 4 ? await classifyWithTimeout(content) : null;

        const isCussImmune = await whitelistSettings.isImmune(message.guildId!, message.author.id, 'cuss').catch(() => false);
        // Only actual bad words (local DB) OR high-confidence AI abuse. Language signals are ignored.
        const profanity = containsProfanity(content);
        const abusive = !isCussImmune && (explicitAbuse || profanity.matched || Boolean(classification?.abusive && (classification.abuseConfidence >= 0.92)));

        if (abusive) {
            const reason = profanity.matched
                ? profanity.reason || 'Profanity detected (multilingual bad-words database).'
                : (classification?.reason || 'Disrespectful, abusive, or prohibited language.');
            await recordAutomaticWarning(
                message,
                reason,
                classification?.category || 'abuse',
                true,
            );
            return true;
        }
        return false;
    } finally {
        activeChecks.delete(key);
    }
}
