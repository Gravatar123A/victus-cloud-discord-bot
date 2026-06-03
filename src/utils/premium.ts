export const Icons = {
    brand: "◆",
    crown: "✦",
    spark: "✧",
    success: "◇",
    danger: "◆",
    warning: "△",
    info: "◈",
    user: "◌",
    id: "▣",
    link: "⟡",
    mail: "✉",
    credits: "✦",
    calendar: "◷",
    server: "▰",
    node: "▱",
    memory: "▤",
    disk: "▥",
    cpu: "⌁",
    database: "▦",
    backup: "▧",
    network: "⌬",
    activity: "⌁",
    invoice: "▧",
    service: "▰",
    panel: "↗",
    start: "▶",
    stop: "■",
    restart: "↻",
    kill: "⚡",
} as const;

const currencySymbols: Record<string, string> = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    AED: "د.إ ",
};

export function decodeDisplayText(value: unknown, fallback = "Unknown"): string {
    if (typeof value !== "string" || !value.trim()) return fallback;

    let text = value.trim();
    try {
        text = text.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
    } catch {
        // Keep original text if an external API returns malformed escape sequences.
    }

    return text
        .replace(/\s+/g, " ")
        .replace(/[^\S\r\n]+/g, " ")
        .slice(0, 90);
}

export function formatDate(value: unknown): string {
    if (!value || typeof value !== "string") return "Unknown";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown";
    return `<t:${Math.floor(date.getTime() / 1000)}:D>`;
}

export function formatCredits(amount: unknown, currency = "USD"): string {
    const numeric = typeof amount === "number"
        ? amount
        : typeof amount === "string"
            ? Number(amount.replace(/[^0-9.-]+/g, ""))
            : 0;
    const safeAmount = Number.isFinite(numeric) ? numeric : 0;
    const code = String(currency || "USD").toUpperCase();
    const symbol = currencySymbols[code] || `${code} `;
    return `${symbol}${safeAmount.toLocaleString(undefined, {
        minimumFractionDigits: safeAmount % 1 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
    })}`;
}

export function statusLabel(status: unknown): string {
    const normalized = String(status || "unknown").toLowerCase();
    if (["running", "active", "paid", "completed"].includes(normalized)) return "Online";
    if (["starting", "pending", "processing"].includes(normalized)) return "Warming";
    if (["stopping"].includes(normalized)) return "Cooling";
    if (["suspended", "cancelled", "failed", "overdue"].includes(normalized)) return "Attention";
    if (["offline", "stopped"].includes(normalized)) return "Offline";
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function statusIcon(status: unknown): string {
    const normalized = String(status || "unknown").toLowerCase();
    if (["running", "active", "paid", "completed"].includes(normalized)) return "●";
    if (["starting", "pending", "processing", "stopping"].includes(normalized)) return "◐";
    if (["suspended", "cancelled", "failed", "overdue"].includes(normalized)) return "◆";
    if (["offline", "stopped"].includes(normalized)) return "○";
    return "◇";
}

export function compactId(value: unknown): string {
    const text = String(value || "");
    if (text.length <= 8) return text || "unknown";
    return text.slice(0, 8);
}
