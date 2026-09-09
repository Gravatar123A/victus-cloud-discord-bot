import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} from 'discord.js';
import type { AntigravityResult } from '../services/antigravityPipeline.js';
import { config } from '../config.js';

export const AntigravityColors = {
    running: 0x00e5ff,      // Neon Cyan
    success: 0x00ff9d,      // Electric Emerald
    question: 0xffb300,     // Cyber Amber
    error: 0xff3b30,        // Crimson
    neutral: 0x1e2430,      // Deep Carbon
} as const;

/**
 * Format execution telemetry stats into a clean industrial terminal string
 */
function formatTelemetry(result: AntigravityResult): string {
    const parts: string[] = [];

    if (result.durationSeconds !== undefined) {
        parts.push(`⏱️ \`${result.durationSeconds.toFixed(1)}s\``);
    }
    if (result.numTurns !== undefined) {
        parts.push(`🔄 \`Turn ${result.numTurns}\``);
    }
    parts.push(`⚡ \`${config.antigravity.model || 'Gemini 3.8 Flash'}\``);

    if (result.usage?.total_tokens) {
        parts.push(`🪙 \`${result.usage.total_tokens.toLocaleString()} tokens\``);
    }

    return parts.join('  •  ');
}

/**
 * Truncate or split text safely without cutting markdown code fences in half
 */
function chunkMessage(text: string, maxLen = 3800): string[] {
    if (text.length <= maxLen) return [text];

    const chunks: string[] = [];
    let current = '';
    const lines = text.split('\n');

    for (const line of lines) {
        if ((current + '\n' + line).length > maxLen) {
            chunks.push(current.trim());
            current = line;
        } else {
            current = current ? current + '\n' + line : line;
        }
    }

    if (current.trim()) {
        chunks.push(current.trim());
    }

    return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
}

/**
 * Embed displayed while Antigravity is processing instructions
 */
export function createProcessingEmbed(taskPreview: string, userTag: string, hasAttachments = false): EmbedBuilder {
    const cleanPreview = taskPreview.length > 300 ? taskPreview.slice(0, 297) + '...' : taskPreview;

    return new EmbedBuilder()
        .setColor(AntigravityColors.running)
        .setAuthor({
            name: 'ANTIGRAVITY // ENGINE RUNNER',
            iconURL: config.branding.logo,
        })
        .setTitle('⚙️ Executing Workspace Pipeline...')
        .setDescription(
            `\`\`\`yaml\nOperator: ${userTag}\nModel: ${config.antigravity.model || 'Gemini 3.8 Flash'}\nMultimodal: ${hasAttachments ? 'Images Loaded' : 'Text Only'}\nStatus: Active Processing...\n\`\`\`\n` +
            `**Task Instruction:**\n> ${cleanPreview.replace(/\n/g, '\n> ')}`
        )
        .setFooter({
            text: 'Victus Cloud Staff Pipeline • Antigravity Agent Runtime',
        })
        .setTimestamp();
}

/**
 * Embeds displayed upon task completion or clarification request
 */
export function createResultEmbeds(
    result: AntigravityResult,
    options: {
        task: string;
        userTag: string;
        threadName?: string;
    }
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
    const embeds: EmbedBuilder[] = [];

    // Choose color: if it has questions for staff, highlight with Amber, else Emerald or Crimson
    const accentColor = !result.success
        ? AntigravityColors.error
        : result.hasQuestions
        ? AntigravityColors.question
        : AntigravityColors.success;

    const statusTitle = !result.success
        ? '❌ Pipeline Execution Failed'
        : result.hasQuestions
        ? '❓ Clarification Required from Staff'
        : '🟢 Task Completed Successfully';

    const telemetry = formatTelemetry(result);
    const chunks = chunkMessage(result.response);

    // Primary Embed
    const primaryEmbed = new EmbedBuilder()
        .setColor(accentColor)
        .setAuthor({
            name: 'ANTIGRAVITY // TASK REPORT',
            iconURL: config.branding.logo,
        })
        .setTitle(statusTitle)
        .setTimestamp();

    let desc = `-# ${telemetry}\n\n`;

    // If Antigravity has questions, highlight them at the very top
    if (result.hasQuestions && result.questions && result.questions.length > 0) {
        desc += `### ⚠️ Questions for Staff\n`;
        for (const q of result.questions) {
            desc += `> 🔹 **${q}**\n`;
        }
        desc += `\n*Reply directly in this thread or use \`/staffai\` to respond.*\n\n---\n\n`;
    }

    desc += chunks[0];
    primaryEmbed.setDescription(desc);

    if (result.conversationId) {
        primaryEmbed.setFooter({
            text: `Session: ${result.conversationId.slice(0, 8)}... • Reply to continue`,
        });
    }

    embeds.push(primaryEmbed);

    // Chained embeds if output is large
    for (let i = 1; i < chunks.length && i < 4; i++) {
        const continuationEmbed = new EmbedBuilder()
            .setColor(accentColor)
            .setDescription(chunks[i])
            .setFooter({
                text: `Part ${i + 1} of ${chunks.length}`,
            });
        embeds.push(continuationEmbed);
    }

    // Interactive Action Row
    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    const actionRow = new ActionRowBuilder<ButtonBuilder>();

    actionRow.addComponents(
        new ButtonBuilder()
            .setCustomId('staffai_new_session')
            .setLabel('New Session')
            .setEmoji('🆕')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('staffai_clear_session')
            .setLabel('Clear Memory')
            .setEmoji('🧹')
            .setStyle(ButtonStyle.Danger)
    );

    components.push(actionRow);

    return { embeds, components };
}

/**
 * Permission error embed when unauthorized user attempts command
 */
export function createUnauthorizedEmbed(): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(AntigravityColors.error)
        .setAuthor({
            name: 'ANTIGRAVITY // SECURITY GATEWAY',
            iconURL: config.branding.logo,
        })
        .setTitle('⛔ Access Denied')
        .setDescription(
            'The `/staffai` pipeline allows executing code, modifying files, and running server commands.\n\n' +
            'This tool is restricted to **Authorized Staff Members & Administrators**.'
        )
        .setFooter({
            text: 'Security Policy • Victus Cloud Operations',
        })
        .setTimestamp();
}
