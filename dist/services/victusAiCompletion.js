import { supabase } from './supabase.js';
import { normalizeVictusLinks } from './victusLinks.js';
import { normalizeAiMarkdown } from '../utils/aiMarkdown.js';
/** The one primary model used for customer-facing Victus AI replies. */
export const VICTUS_AI_MODEL = 'nvidia/nemotron-3.5-super-vl:free';
export const VICTUS_AI_FALLBACK_MODEL = 'nvidia/nemotron-3.5-lightning:free';
const cachedKeys = new Map();
const quotaUntil = new Map();
async function getVictusAiKey(fallback = false) {
    const envKey = (fallback
        ? process.env.OPENROUTER_FALLBACK_API_KEY || ''
        : process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEYS || '')
        .split(/[\r\n,]+/)[0].trim();
    if (envKey)
        return envKey;
    const configKey = fallback ? 'openrouter_fallback_api_key' : 'openrouter_api_key';
    const cached = cachedKeys.get(configKey);
    if (cached && cached.expiresAt > Date.now())
        return cached.value;
    const { data, error } = await supabase.client.from('private_config').select('value')
        .eq('key', configKey).maybeSingle();
    if (error || typeof data?.value !== 'string' || !data.value.trim()) {
        throw new Error(`OpenRouter key is unavailable${error ? `: ${error.message}` : ''}`);
    }
    const value = data.value.trim();
    cachedKeys.set(configKey, { value, expiresAt: Date.now() + 5 * 60_000 });
    return value;
}
export function victusAiConfigured() {
    return Boolean(process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEYS || process.env.OPENROUTER_FALLBACK_API_KEY
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
    let openRouterError;
    const request = async (key, models, timeoutMs) => {
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
    for (const fallback of [false, true]) {
        let key = '';
        try {
            key = await getVictusAiKey(fallback);
        }
        catch (error) {
            openRouterError ||= error;
            continue;
        }
        if ((quotaUntil.get(key) || 0) > Date.now())
            continue;
        try {
            return await request(key, [VICTUS_AI_MODEL, VICTUS_AI_FALLBACK_MODEL], 45_000);
        }
        catch (error) {
            openRouterError = error;
            const status = error.status;
            if (status === 429 || status === 402) {
                quotaUntil.set(key, Date.now() + 30 * 60_000);
                continue;
            }
            if (status === undefined || status === 408 || status >= 500) {
                try {
                    return await request(key, [VICTUS_AI_FALLBACK_MODEL], 65_000);
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
    return normalizeAiMarkdown(normalizeVictusLinks(answer.slice(0, 1800).replace(/@everyone|@here/g, '[mention]'))).slice(0, 1900);
}
