// Comprehensive multilingual profanity database — only actual bad words, no language detection.
// Sources: LDNOOBW + community reports; normalized to lowercase word boundaries.
// This is the sole source for automatic warnings. Update here to add/remove words.
// Language detection has been REMOVED per operator request — do NOT add language-only tokens.

export const MULTILINGUAL_BAD_WORDS: string[] = [
  // English
  "fuck", "fucking", "fucker", "fucked", "fucks", "fck", "fuk", "shit", "shitting", "shitter", "bullshit", "bitch", "bitches", "bitching", "bastard", "asshole", "assholes", "cunt", "cunts", "dick", "dicks", "dickhead", "cock", "pussy", "whore", "whores", "slut", "sluts", "nigger", "nigga", "niggas", "niggers", "faggot", "faggots", "fag", "fags", "motherfucker", "motherfuckers",
  // English variations / obfuscated handled via regex, but keep base forms
  "arsehole", "bollocks", "wanker", "tosser", "prick", "twat", "bellend", "douche", "douchebag",
  // Hindi — romanized (most common on Discord)
  "bhenchod", "behenchod", "behanchod", "bhenchhod", "madarchod", "madarchood", "madharchod", "chutiya", "chutya", "chutia", "chut", "lund", "laude", "lauda", "gandu", "gand", "gandmara", "randi", "harami", "haraami", "tatta", "bhadwa", "bhadva", "loda", "lodabhosda", "bhosda", "bhosdi", "bhosdike", "chod", "choda", "chodu", "chudai", "chud", "gaand", "gand", "jhant", "jhatu",
  // Hindi — Devanagari script
  "भेंचोद", "बहनचोद", "मादरचोद", "चूतिया", "चूत", "लंड", "गांडू", "गांड", "रंडी", "हरामी", "भोसड़ा", "भोसड़ी", "लौड़ा",
  // Spanish
  "puta", "puto", "putas", "putos", "mierda", "coño", "cabron", "cabrón", "joder", "jodete", "gilipollas", "maricon", "maricón", "pendejo", "pendeja", "verga", "culero", "chinga", "chingar",
  // Portuguese
  "puta", "puto", "caralho", "caralhos", "merda", "viado", "viados", "desgraca", "desgraça", "corno", "arrombado", "fuder", "foda", "fdp",
  // French
  "putain", "merde", "connard", "connasse", "salope", "encule", "enculé", "batard", "bâtard", "conne", "pute",
  // German
  "scheisse", "scheiße", "arschloch", "arsch", "hurensohn", "hure", "wichser", "fotze", "schlampe", "fick", "ficken",
  // Italian
  "cazzo", "stronzo", "puttana", "merda", "troia", "vaffanculo", "coglione", "frocio", "bastardo",
  // Russian — Cyrillic
  "сука", "суки", "блядь", "бля", "хуй", "хуйня", "пизда", "ебать", "ебал", "ебаный", "пидор", "пидорас", "долбоеб", "уебок",
  // Russian — latin transliteration
  "suka", "suki", "blyad", "blyat", "khuy", "huy", "pizda", "pizdec", "ebat", "ebal", "pidor", "pidoras", "dolboeb", "uebok", "cyka", "blyat",
  // Arabic — latin / common transliterations
  "nayek", "zamel", "sharmuta", "khawal", "kosom", "manyak",
  // Turkish
  "amk", "amcik", "orospu", "siktir", "sik", "yarrak", "piç", "oç", "göt", "pezevenk", "yavsak",
  // Dutch
  "kanker", "kut", "tering", "lul", "hoer", "neuken",
  // Polish
  "kurwa", "chuj", "pierdolic", "pierdole", "cipa", "dziwka", "skurwysyn",
];

// Preserve accents so ordinary words do not become profanity during normalization.
export const BAD_WORDS_SET = new Set(MULTILINGUAL_BAD_WORDS.map(w => w.toLowerCase()));

// For regex we need to escape and allow common obfuscation: repeated letters, * _ - etc between letters
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Match whole words with repeated letters and short punctuation obfuscation.
function buildProfanityRegex(words: string[]): RegExp {
  const patterns = words.map(word => {
    const letters = [...word].map(ch => `${escapeRegex(ch)}+`).join('[^\\p{L}\\p{N}]{0,2}');
    return `(?<![\\p{L}\\p{N}])${letters}(?![\\p{L}\\p{N}])`;
  });
  // Join with |, case-insensitive, unicode-aware
  return new RegExp(patterns.join('|'), 'iu');
}

export const PROFANITY_REGEX = buildProfanityRegex(MULTILINGUAL_BAD_WORDS);

// Also expose a simple check that normalizes common leet speak.
const LEET_MAP: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i',
};

function normalizeLeet(input: string): string {
  return input.toLowerCase().split('').map(ch => LEET_MAP[ch] ?? ch).join('');
}

export function containsProfanity(content: string): { matched: boolean; word?: string; reason?: string } {
  if (!content || content.trim().length < 2) return { matched: false };
  const normalized = normalizeLeet(content);
  // Quick set check for exact tokens
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  for (const tok of tokens) {
    if (BAD_WORDS_SET.has(tok)) return { matched: true, word: tok, reason: `Matched profanity: ${tok}` };
  }
  // Regex fallback for obfuscated/phrase forms (repeated letters, separators)
  const m = normalized.match(PROFANITY_REGEX);
  if (m && m[0]) {
    const snippet = m[0].slice(0, 30);
    return { matched: true, word: snippet, reason: `Matched profanity pattern: ${snippet}` };
  }
  return { matched: false };
}
