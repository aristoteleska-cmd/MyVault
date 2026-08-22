/**
 * Guards every translation MyVault ships.
 *
 * A wrong key or a dropped {placeholder} would show a raw key or a broken
 * sentence to a shop that cannot read the English original, so all of it is
 * checked mechanically rather than by eye.
 */
import assert from 'assert';
import { en } from '../src/i18n/locales/en';
import { catalogues } from '../src/i18n/catalogues';
import { LANGUAGES, resolveLanguage } from '../src/i18n/languages';

let passed = 0;
const ok = (label: string) => { passed += 1; console.log('  ok  ' + label); };

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

/**
 * Whether a key is a plural form rather than a string in its own right.
 *
 * `docs.units.one` sits beside `docs.units` and is used only when the number is
 * one, in the languages that say it differently. Chinese and Vietnamese do not,
 * Turkish does not after a numeral, and Russian happens to use an invariant
 * abbreviation here — so demanding these of every catalogue would mean twelve
 * copies of a sentence nobody's language needs. The reader falls back to the
 * plain key, so an absent form is correct behaviour, not a gap.
 */
const PLURAL_FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const isPluralForm = (key: string) => {
  const dot = key.lastIndexOf('.');
  return dot > 0 && PLURAL_FORMS.has(key.slice(dot + 1)) && key.slice(0, dot) in en;
};

const enKeys = Object.keys(en) as (keyof typeof en)[];
/** What every language is expected to carry: everything except plural extras. */
const requiredKeys = enKeys.filter((key) => !isPluralForm(String(key)));

// ------------------------------------------------------------ the line-up
assert.strictEqual(LANGUAGES.length, 21, 'the twenty most spoken languages, plus Greek');
assert.ok(LANGUAGES.some((l) => l.code === 'el'), 'Greek is included');
assert.strictEqual(
  new Set(LANGUAGES.map((l) => l.code)).size,
  LANGUAGES.length,
  'no duplicate language codes',
);
for (const language of LANGUAGES) {
  assert.ok(language.native.trim(), `${language.code} has a native name`);
  assert.ok(language.english.trim(), `${language.code} has an English name`);
}
ok('21 languages are offered, each with a name in its own script');

// ------------------------------------------------------- catalogue health
for (const [code, catalogue] of Object.entries(catalogues)) {
  assert.ok(
    LANGUAGES.some((l) => l.code === code),
    `catalogue "${code}" belongs to a language that is offered`,
  );

  const keys = Object.keys(catalogue);
  assert.ok(keys.length > 0, `${code} is not empty`);

  for (const key of keys) {
    assert.ok(key in en, `${code}: "${key}" is not a key English defines`);
    const value = catalogue[key as keyof typeof catalogue];
    assert.ok(
      typeof value === 'string' && value.trim() !== '',
      `${code}: "${key}" has no text`,
    );
    assert.strictEqual(
      placeholders(String(value)),
      placeholders(en[key as keyof typeof en]),
      `${code}: "${key}" does not carry the same {placeholders} as English`,
    );
  }
}
ok('every translated string matches an English key and keeps its placeholders');

// A translation that covers a key must cover it for real, not with the English
// text left in place by accident on a language that clearly differs.
const complete = Object.entries(catalogues).filter(
  ([code, catalogue]) => code !== 'en'
    && requiredKeys.every((key) => key in catalogue),
);
for (const [code, catalogue] of complete) {
  const missing = requiredKeys.filter((key) => !(key in catalogue));
  assert.strictEqual(missing.length, 0, `${code} is missing: ${missing.slice(0, 5).join(', ')}`);
}

// A floor, not a note. Adding an English string without translating it used to
// quietly drop every language out of this list and still pass; now it fails and
// names what is missing, which is the only way the twelve stay complete.
const partial = Object.entries(catalogues)
  .filter(([code]) => code !== 'en')
  .map(([code, catalogue]) => [code, requiredKeys.filter((key) => !(key in catalogue))] as const)
  .filter(([, missing]) => missing.length > 0);
assert.strictEqual(
  partial.length,
  0,
  `these languages are no longer complete:\n${partial
    .map(([code, missing]) => `  ${code} is missing ${missing.length}: ${missing.slice(0, 6).join(', ')}`)
    .join('\n')}`,
);
assert.ok(complete.length >= 12, 'twelve languages are translated in full');
ok(`${complete.length} languages are translated in full`);

// ------------------------------------------------------ the English source
for (const key of enKeys) {
  assert.ok(String(en[key]).trim() !== '', `English "${key}" has text`);
}
assert.ok(enKeys.length > 250, 'the English catalogue covers the whole interface');
ok(`${enKeys.length} strings make up the English source`);

// ------------------------------------------------------ picking a language
assert.strictEqual(resolveLanguage('el-GR'), 'el');
assert.strictEqual(resolveLanguage('el'), 'el');
assert.strictEqual(resolveLanguage('de_DE'), 'de');
assert.strictEqual(resolveLanguage('pt-BR'), 'pt');
assert.strictEqual(resolveLanguage('es-419'), 'es');
assert.strictEqual(resolveLanguage('zh-CN'), 'zh-Hans');
assert.strictEqual(resolveLanguage('zh-Hans-CN'), 'zh-Hans');
assert.strictEqual(resolveLanguage('zh-TW'), 'zh-Hant');
assert.strictEqual(resolveLanguage('zh-HK'), 'zh-Hant');
assert.strictEqual(resolveLanguage('ar-EG'), 'ar');
assert.strictEqual(resolveLanguage('sv-SE'), 'en', 'a language we do not ship falls back');
assert.strictEqual(resolveLanguage(''), 'en');
assert.strictEqual(resolveLanguage(undefined), 'en');
ok('a Windows locale maps to the right shipped language');

// ------------------------------------------------------------------- RTL
const rtl = LANGUAGES.filter((l) => l.rtl).map((l) => l.code).sort();
assert.deepStrictEqual(rtl, ['ar', 'ur'], 'Arabic and Urdu are the right-to-left ones');
ok('right-to-left languages are marked');

// --------------------------------------------------------- installer list
const installerCodes = LANGUAGES.filter((l) => l.installer).map((l) => l.installer);
assert.strictEqual(new Set(installerCodes).size, installerCodes.length, 'no duplicate installer locales');
assert.ok(installerCodes.includes('el_GR'), 'Greek can be picked in the installer');
assert.ok(installerCodes.length >= 15, 'the installer offers most of the languages');
assert.ok(
  !installerCodes.includes('hi_IN'),
  "Hindi is app-only: NSIS's own Hindi language file is malformed and breaks the build",
);
ok(`${installerCodes.length} languages can also be chosen during installation`);

console.log('\n' + passed + ' checks passed.');
