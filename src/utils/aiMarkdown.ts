/** Undo model-added Markdown escapes without touching fenced or inline code. */
export function normalizeAiMarkdown(input: string): string {
    return input
        .split(/(```[\s\S]*?```|```[\s\S]*$|`[^`\n]*`)/g)
        .map((part) => part.startsWith('```') || (part.startsWith('`') && part.endsWith('`'))
            ? part : part.replace(/\\([*_#>`~])/g, '$1'))
        .join('');
}
