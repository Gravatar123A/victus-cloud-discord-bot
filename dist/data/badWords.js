// Comprehensive multilingual profanity database — only actual bad words, no language detection.
// Sources: LDNOOBW + community reports; normalized to lowercase word boundaries.
// This is the sole source for automatic warnings. Update here to add/remove words.
// Language detection has been REMOVED per operator request — do NOT add language-only tokens.
export const MULTILINGUAL_BAD_WORDS = [
    // English
    "fuck", "fucking", "fucker", "fucked", "fucks", "fck", "fuk", "shit", "shitting", "shitter", "bullshit", "bitch", "bitches", "bitching", "bastard", "asshole", "assholes", "cunt", "cunts", "dick", "dicks", "dickhead", "cock", "pussy", "whore", "whores", "slut", "sluts", "nigger", "nigga", "niggas", "niggers", "faggot", "faggots", "fag", "fags", "retard", "retards", "retarded", "kill yourself", "kys", "go die", "motherfucker", "motherfuckers",
    // English variations / obfuscated handled via regex, but keep base forms
    "arsehole", "bollocks", "wanker", "tosser", "prick", "twat", "bellend", "douche", "douchebag",
    // Hindi — romanized (most common on Discord)
    "bhenchod", "behenchod", "behanchod", "bhenchhod", "madarchod", "madarchood", "madharchod", "chutiya", "chutya", "chutia", "chut", "lund", "laude", "lauda", "gandu", "gand", "gandmara", "randi", "rand", "harami", "haraami", "kutta", "kutte", "kutti", "saala", "sala", "suar", "suvar", "tatta", "bhadwa", "bhadva", "loda", "lodabhosda", "bhosda", "bhosdi", "bhosdike", "chod", "choda", "chodu", "chudai", "chud", "gaand", "gand", "jhant", "jhatu",
    // Hindi — Devanagari script
    "भेंचोद", "बहनचोद", "मादरचोद", "चूतिया", "चूत", "लंड", "गांडू", "गांड", "रंडी", "हरामी", "कुत्ता", "साला", "सुअर", "भोसड़ा", "भोसड़ी", "लौड़ा",
    // Spanish
    "puta", "puto", "putas", "putos", "mierda", "coño", "cono", "cabron", "cabrón", "joder", "jodete", "gilipollas", "maricon", "maricón", "pendejo", "pendeja", "imbecil", "imbécil", "verga", "culero", "chinga", "chingar",
    // Portuguese
    "puta", "puto", "caralho", "caralhos", "merda", "viado", "viados", "desgraca", "desgraça", "corno", "arrombado", "fuder", "foda", "fdp",
    // French
    "putain", "merde", "connard", "connasse", "salope", "encule", "enculé", "batard", "bâtard", "con", "conne", "pute",
    // German
    "scheisse", "scheiße", "arschloch", "arsch", "hurensohn", "hure", "wichser", "fotze", "schlampe", "fick", "ficken",
    // Italian
    "cazzo", "stronzo", "puttana", "merda", "troia", "vaffanculo", "coglione", "frocio", "bastardo",
    // Russian — Cyrillic
    "сука", "суки", "блядь", "бля", "хуй", "хуйня", "пизда", "ебать", "ебал", "ебаный", "пидор", "пидорас", "долбоеб", "уебок",
    // Russian — latin transliteration
    "suka", "suki", "blyad", "blyat", "khuy", "huy", "pizda", "pizdec", "ebat", "ebal", "pidor", "pidoras", "dolboeb", "uebok", "cyka", "blyat",
    // Arabic — latin / common transliterations
    "nik", "nayek", "zamel", "sharmuta", "khawal", "kos", "kosom", "manyak", "abn al",
    // Turkish
    "amk", "amcik", "orospu", "siktir", "sik", "yarrak", "piç", "oç", "göt", "pezevenk", "yavsak",
    // Dutch
    "kanker", "kut", "tering", "lul", "hoer", "neuken",
    // Polish
    "kurwa", "chuj", "pierdolic", "pierdole", "cipa", "dziwka", "skurwysyn",
    // Additional universally recognized slurs (handled with care, but included for protection)
    "nazi", // context may be non-profane, but kept for completeness — will be checked via word boundary only
];
// Normalized set for fast lookup — lowercased, no diacritics stripped here (handled at check time)
export const BAD_WORDS_SET = new Set(MULTILINGUAL_BAD_WORDS.map(w => w.toLowerCase()));
// For regex we need to escape and allow common obfuscation: repeated letters, * _ - etc between letters
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// Build a single regex that matches any bad phrase as whole word, tolerant to obfuscation:
// - repeated letters: /f+u+c+k+/i
// - separators: f*u*c*k , f_u_c_k , f-c-k etc -> allow [^a-z0-9]* between letters
function buildProfanityRegex(words) {
    const patterns = words.map(word => {
        // phrase with space: e.g. "kill yourself" -> allow flexible whitespace
        if (word.includes(' ')) {
            const parts = word.split(/\s+/).map(p => {
                const letters = [...p].map(ch => `${escapeRegex(ch)}+`).join('[^a-z\\u0900-\\u097F\\u0600-\\u06FF\\u0400-\\u04FF]*');
                return letters;
            });
            return `\\b${parts.join('\\s+')}\\b`;
        }
        const letters = [...word].map(ch => `${escapeRegex(ch)}+`).join('[^a-z\\u0900-\\u097F\\u0600-\\u06FF\\u0400-\\u04FF]*');
        return `\\b${letters}\\b`;
    });
    // Join with |, case-insensitive, unicode-aware
    return new RegExp(patterns.join('|'), 'iu');
}
export const PROFANITY_REGEX = buildProfanityRegex(MULTILINGUAL_BAD_WORDS);
// Also expose a simple check that normalizes leet speak and strips diacritics
const LEET_MAP = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i',
};
function normalizeLeet(input) {
    return input.toLowerCase().split('').map(ch => LEET_MAP[ch] ?? ch).join('');
}
function stripDiacritics(input) {
    return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
export function containsProfanity(content) {
    if (!content || content.trim().length < 2)
        return { matched: false };
    const normalized = stripDiacritics(normalizeLeet(content.toLowerCase()));
    // Quick set check for exact tokens
    const tokens = normalized.match(/[\p{L}\p{N}]+/gu) || [];
    for (const tok of tokens) {
        if (BAD_WORDS_SET.has(tok))
            return { matched: true, word: tok, reason: `Matched profanity: ${tok}` };
    }
    // Regex fallback for obfuscated/phrase forms (repeated letters, separators)
    const m = normalized.match(PROFANITY_REGEX);
    if (m && m[0]) {
        const snippet = m[0].slice(0, 30);
        return { matched: true, word: snippet, reason: `Matched profanity pattern: ${snippet}` };
    }
    return { matched: false };
}
