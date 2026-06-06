const DISCORD_CONTENT_LIMIT = 2000;
const TRIM_NOTICE = '\n\n[trimmed]';

export function formatAiMessage(answer: string): string {
    const clean = answer.trim() || 'I could not generate a useful answer for that.';
    if (clean.length <= DISCORD_CONTENT_LIMIT) return clean;
    return `${clean.slice(0, DISCORD_CONTENT_LIMIT - TRIM_NOTICE.length).trim()}${TRIM_NOTICE}`;
}
