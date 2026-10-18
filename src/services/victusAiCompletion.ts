import { supabase } from './supabase.js';

/** The one primary model used for customer-facing Victus AI replies. */
export const VICTUS_AI_MODEL = 'nvidia/nemotron-3.5-super-vl:free';

let cachedKey = '';
let keyExpiresAt = 0;

async function getVictusAiKey(): Promise<string> {
    const envKey = (process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEYS || '')
        .split(/[\r\n,]+/)[0].trim();
    if (envKey) return envKey;
    if (cachedKey && keyExpiresAt > Date.now()) return cachedKey;
    const { data, error } = await supabase.client.from('private_config').select('value')
        .eq('key', 'openrouter_api_key').maybeSingle();
    if (error || typeof data?.value !== 'string' || !data.value.trim()) {
        throw new Error(`OpenRouter key is unavailable${error ? `: ${error.message}` : ''}`);
    }
    cachedKey = data.value.trim();
    keyExpiresAt = Date.now() + 5 * 60_000;
    return cachedKey;
}

export function victusAiConfigured(): boolean {
    return Boolean(process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEYS || process.env.SUPABASE_SERVICE_KEY);
}

export async function completeVictusAi(system: string, prompt: string, maxTokens = 700): Promise<string> {
    const key = await getVictusAiKey();
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
            'HTTP-Referer': 'https://victuscloud.com', 'X-Title': 'Victus Cloud Discord AI',
        },
        body: JSON.stringify({
            model: VICTUS_AI_MODEL,
            messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
            temperature: 0.25, max_tokens: maxTokens,
            reasoning: { effort: 'low', exclude: true },
        }),
        signal: AbortSignal.timeout(45_000),
    });
    const payload = await response.json().catch(() => null) as any;
    if (!response.ok) throw new Error(`Victus AI failed (${response.status}): ${String(payload?.error?.message || response.statusText).slice(0, 150)}`);
    return clean(String(payload?.choices?.[0]?.message?.content || '').trim());
}

function clean(answer: string): string {
    if (!answer) throw new Error('Victus AI returned an empty answer');
    return answer.slice(0, 1800).replace(/@everyone|@here/g, '[mention]');
}
