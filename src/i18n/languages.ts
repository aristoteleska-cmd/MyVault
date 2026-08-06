/**
 * The languages MyVault ships in: the twenty most widely spoken in the world,
 * plus Greek.
 *
 * `installer` marks the ones the Windows installer itself can also be shown in.
 * NSIS, which builds the installer, has no translation for Bengali, Urdu,
 * Marathi, Telugu or Tamil, and the Hindi one it does ship is broken — those six
 * are offered inside the app instead, and the installer falls back to English
 * for them.
 */
export interface LanguageMeta {
  code: string;
  /** The language's own name for itself — always shown, never translated. */
  native: string;
  english: string;
  rtl?: boolean;
  installer?: string;
}

export const LANGUAGES: LanguageMeta[] = [
  { code: 'en', native: 'English', english: 'English', installer: 'en_US' },
  { code: 'zh-Hans', native: '简体中文', english: 'Chinese (Simplified)', installer: 'zh_CN' },
  // No installer entry: the Hindi language file shipped with NSIS is malformed
  // ("unterminated string" at Hindi.nsh:128) and aborts the installer build.
  { code: 'hi', native: 'हिन्दी', english: 'Hindi' },
  { code: 'es', native: 'Español', english: 'Spanish', installer: 'es_ES' },
  { code: 'fr', native: 'Français', english: 'French', installer: 'fr_FR' },
  { code: 'ar', native: 'العربية', english: 'Arabic', rtl: true, installer: 'ar_SA' },
  { code: 'bn', native: 'বাংলা', english: 'Bengali' },
  { code: 'pt', native: 'Português', english: 'Portuguese', installer: 'pt_BR' },
  { code: 'ru', native: 'Русский', english: 'Russian', installer: 'ru_RU' },
  { code: 'ur', native: 'اردو', english: 'Urdu', rtl: true },
  { code: 'id', native: 'Bahasa Indonesia', english: 'Indonesian', installer: 'id_ID' },
  { code: 'de', native: 'Deutsch', english: 'German', installer: 'de_DE' },
  { code: 'ja', native: '日本語', english: 'Japanese', installer: 'ja_JP' },
  { code: 'mr', native: 'मराठी', english: 'Marathi' },
  { code: 'te', native: 'తెలుగు', english: 'Telugu' },
  { code: 'tr', native: 'Türkçe', english: 'Turkish', installer: 'tr_TR' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil' },
  { code: 'zh-Hant', native: '繁體中文', english: 'Chinese (Traditional)', installer: 'zh_TW' },
  { code: 'vi', native: 'Tiếng Việt', english: 'Vietnamese', installer: 'vi_VN' },
  { code: 'ko', native: '한국어', english: 'Korean', installer: 'ko_KR' },
  { code: 'el', native: 'Ελληνικά', english: 'Greek', installer: 'el_GR' },
];

export const LANGUAGE_CODES = LANGUAGES.map((language) => language.code);

export const RTL_LANGUAGES = new Set(
  LANGUAGES.filter((language) => language.rtl).map((language) => language.code),
);

export function findLanguage(code: string): LanguageMeta | undefined {
  return LANGUAGES.find((language) => language.code === code);
}

/**
 * Turns whatever Windows reports (`el-GR`, `zh-Hans-CN`, `pt_BR`) into one of
 * the languages we actually ship. Falls back to English.
 */
export function resolveLanguage(locale: string | undefined | null): string {
  if (!locale) return 'en';
  const normalized = String(locale).replace('_', '-').toLowerCase();

  const exact = LANGUAGE_CODES.find((code) => code.toLowerCase() === normalized);
  if (exact) return exact;

  const [base, ...rest] = normalized.split('-');

  if (base === 'zh') {
    // Hong Kong, Macau and Taiwan write traditional characters.
    const traditional = rest.some((part) => ['hant', 'tw', 'hk', 'mo'].includes(part));
    return traditional ? 'zh-Hant' : 'zh-Hans';
  }

  const byBase = LANGUAGE_CODES.find((code) => code.toLowerCase().split('-')[0] === base);
  return byBase ?? 'en';
}
