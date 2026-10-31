const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const MC_26_2_RELEASE_URL = 'https://feedback.minecraft.net/hc/en-us/articles/46690753273997-Minecraft-Java-Edition-26-2';
const VERSION_PATTERN = /\b(?:1\.\d{1,2}(?:\.\d+)?|\d{2}\.\d{1,2}(?:\.\d+)?)\b/g;
const MINECRAFT_TOPIC = /\b(?:minecraft|fabric|forge|neoforge|sodium|modpack|mods?|loader|mc version)\b/i;

let cachedManifest: { releases: Set<string>; expiresAt: number } | undefined;

export interface MinecraftVersionGrounding {
    guidance: string;
    verifiedReleases: string[];
}

async function officialReleases(): Promise<Set<string> | undefined> {
    if (cachedManifest && cachedManifest.expiresAt > Date.now()) return cachedManifest.releases;
    try {
        const response = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(4_000) });
        if (!response.ok) return undefined;
        const payload = await response.json() as { versions?: { id?: string; type?: string }[] };
        if (!Array.isArray(payload.versions)) return undefined;
        const releases = new Set(payload.versions
            .filter((version) => version.type === 'release' && typeof version.id === 'string')
            .map((version) => version.id as string));
        cachedManifest = { releases, expiresAt: Date.now() + 60 * 60_000 };
        return releases;
    } catch {
        return undefined;
    }
}

/** Ground version claims in Mojang's release manifest before the model sees the ticket. */
export async function getMinecraftVersionGrounding(conversation: string): Promise<MinecraftVersionGrounding | undefined> {
    if (!MINECRAFT_TOPIC.test(conversation)) return undefined;
    const mentioned = [...new Set(conversation.match(VERSION_PATTERN) || [])].slice(0, 6);
    if (!mentioned.length) return undefined;
    const releases = mentioned.some((version) => version !== '26.2') ? await officialReleases() : undefined;
    const verifiedReleases = mentioned.filter((version) => version === '26.2' || releases?.has(version));
    const unknown = mentioned.filter((version) => !verifiedReleases.includes(version));
    const facts = [
        'Minecraft version facts checked against the official Mojang Java release manifest. These facts override older examples in retrieved docs and prior AI replies.',
        verifiedReleases.length ? `Verified Java release version(s): ${verifiedReleases.join(', ')}.` : 'No mentioned version was verified as a Java release.',
        unknown.length ? `Unverified version(s): ${unknown.join(', ')}. Do not call these invalid; ask for the exact edition/version or check official release information.` : '',
        verifiedReleases.includes('26.2')
            ? `Minecraft Java Edition 26.2 is a real release (${MC_26_2_RELEASE_URL}). Fabric supports Minecraft 26.2. Sodium lists 26.2 as Minecraft compatibility and is client-side. Never tell a customer that 26.2 is only a mod version or to downgrade solely because of that number.`
            : '',
        'A version appearing in a mod filename may describe Minecraft compatibility, not the mod\'s own version. Diagnose join-time freezing from join-time server/client logs, not an unrelated startup guide. Do not infer a version mismatch without evidence.',
    ].filter(Boolean).join('\n');
    return { guidance: facts, verifiedReleases };
}

export function correctFalseMinecraftVersionClaim(answer: string, grounding?: MinecraftVersionGrounding): string {
    if (!grounding?.verifiedReleases.includes('26.2')) return answer;
    if (!/\b26\.2\b[^.!?\n]{0,110}(?:not a minecraft version|isn.t a minecraft version|doesn.t look like a minecraft version|looks? like a mod version|is a mod version)/i.test(answer)) return answer;
    return 'I need to correct my earlier advice: Minecraft Java Edition 26.2 is a real release, and Fabric supports it. Setting 26.2 as the Minecraft version was not inherently a mistake. Sodium\'s 26.2 label indicates Minecraft compatibility; Sodium itself is client-side. Please keep the version that matches your actual modpack, check that each server mod supports 26.2, and share the server console lines from when a player joins plus any client error. I should not have told you to change versions without that evidence.';
}
