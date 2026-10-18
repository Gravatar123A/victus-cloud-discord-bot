import { supabase } from './supabase.js';
/** The one primary model used for customer-facing Victus AI replies. */
export const VICTUS_AI_MODEL = 'nvidia/nemotron-3.5-super-vl:free';
export const VICTUS_AI_FALLBACK_MODEL = 'nvidia/nemotron-3.5-lightning:free';
let cachedKey = '';
let keyExpiresAt = 0;
async function getVictusAiKey() {
    const envKey = (process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEYS || '')
        .split(/[\r\n,]+/)[0].trim();
    if (envKey)
        return envKey;
    if (cachedKey && keyExpiresAt > Date.now())
        return cachedKey;
    const { data, error } = await supabase.client.from('private_config').select('value')
        .eq('key', 'openrouter_api_key').maybeSingle();
    if (error || typeof data?.value !== 'string' || !data.value.trim()) {
        throw new Error(`OpenRouter key is unavailable${error ? `: ${error.message}` : ''}`);
    }
    cachedKey = data.value.trim();
    keyExpiresAt = Date.now() + 5 * 60_000;
    return cachedKey;
}
export function victusAiConfigured() {
    return Boolean(process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEYS || process.env.SUPABASE_SERVICE_KEY);
}
export async function completeVictusAi(system, prompt, maxTokens = 700) {
    const key = await getVictusAiKey();
    const messages = [{ role: 'system', content: system }, { role: 'user', content: prompt }];
    const request = async (models, timeoutMs) => {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
                'HTTP-Referer': 'https://victuscloud.com', 'X-Title': 'Victus Cloud Discord AI',
            },
            // OpenRouter tries the second model if the first model's providers fail.
            body: JSON.stringify({
                models, messages, temperature: 0.25, max_tokens: maxTokens,
            }),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
            const error = new Error(`Victus AI failed (${response.status}): ${String(payload?.error?.message || response.statusText).slice(0, 150)}`);
            Object.assign(error, { status: response.status });
            throw error;
        }
        const answer = clean(String(payload?.choices?.[0]?.message?.content || '').trim());
        if (!answer)
            throw new Error('Victus AI returned an empty answer');
        return answer;
    };
    try {
        return await request([VICTUS_AI_MODEL, VICTUS_AI_FALLBACK_MODEL], 45_000);
    }
    catch (error) {
        const status = error.status;
        const retryable = status === undefined || status === 408 || status >= 500;
        if (!retryable)
            throw error;
        // A single bounded retry covers empty responses, timeouts, and transient
        // provider failures without looping on quota or authentication errors.
        try {
            return await request([VICTUS_AI_FALLBACK_MODEL], 65_000);
        }
        catch (fallbackError) {
            throw new Error(`Victus AI primary and fallback failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
        }
    }
}
function clean(answer) {
    if (!answer)
        throw new Error('Victus AI returned an empty answer');
    return answer.slice(0, 1800).replace(/@everyone|@here/g, '[mention]');
}
