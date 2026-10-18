import { supabase } from './supabase.js';
/** The one primary model used for customer-facing Victus AI replies. */
export const VICTUS_AI_MODEL = 'nvidia/nemotron-3.5-super-vl:free';
export const VICTUS_AI_FALLBACK_MODEL = 'nvidia/nemotron-3.5-lightning:free';
let cachedKey = '';
let keyExpiresAt = 0;
let openRouterQuotaUntil = 0;
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
    return Boolean(process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEYS
        || process.env.SUPABASE_SERVICE_KEY || process.env.GROQ_API_KEY || process.env.GROQ_API_KEYS);
}
export async function completeVictusAi(system, prompt, maxTokens = 700) {
    const messages = [{ role: 'system', content: system }, { role: 'user', content: prompt }];
    const groqKey = (process.env.GROQ_API_KEY || process.env.GROQ_API_KEYS || '').split(/[\r\n,]+/)[0].trim();
    const requestGroq = async () => {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'openai/gpt-oss-120b', messages,
                temperature: 0.25, max_tokens: Math.max(700, maxTokens) }),
            signal: AbortSignal.timeout(30_000),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok)
            throw new Error(`Groq AI failed (${response.status}): ${String(payload?.error?.message || response.statusText).slice(0, 150)}`);
        const answer = clean(String(payload?.choices?.[0]?.message?.content || '').trim());
        if (!answer)
            throw new Error('Groq AI returned an empty answer');
        return answer;
    };
    let key = '';
    let openRouterError;
    if (Date.now() >= openRouterQuotaUntil) {
        try {
            key = await getVictusAiKey();
        }
        catch (error) {
            openRouterError = error;
        }
    }
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
    if (key) {
        try {
            return await request([VICTUS_AI_MODEL, VICTUS_AI_FALLBACK_MODEL], 45_000);
        }
        catch (error) {
            openRouterError = error;
            const status = error.status;
            if (status === 429 && groqKey)
                openRouterQuotaUntil = Date.now() + 30 * 60_000;
            // The OpenRouter model fallback helps with transient provider errors;
            // a quota error needs a different provider, not another free request.
            if (status === undefined || status === 408 || status >= 500) {
                try {
                    return await request([VICTUS_AI_FALLBACK_MODEL], 65_000);
                }
                catch (fallbackError) {
                    openRouterError = fallbackError;
                }
            }
        }
    }
    if (groqKey) {
        try {
            return await requestGroq();
        }
        catch (groqError) {
            throw new Error(`Victus AI providers unavailable: ${openRouterError instanceof Error ? openRouterError.message : String(openRouterError || 'OpenRouter quota cooling down')}; ${groqError instanceof Error ? groqError.message : String(groqError)}`);
        }
    }
    throw openRouterError || new Error('Victus AI has no available provider key.');
}
function clean(answer) {
    if (!answer)
        throw new Error('Victus AI returned an empty answer');
    return answer.slice(0, 1800).replace(/@everyone|@here/g, '[mention]');
}
