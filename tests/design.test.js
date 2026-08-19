/**
 * The claims the stylesheet makes about itself.
 *
 * The top of src/styles.css says the light and dark pairs "both clear WCAG AA
 * for body text and controls". That was not true: --text-faint sat at 3.74:1 on
 * white and is used for 12px hints, placeholders and panel subtitles. Nothing
 * caught it because a colour is only wrong when somebody measures it.
 *
 * So this measures it. Every text colour against every surface it can land on,
 * in both themes, at the 4.5:1 that AA asks for body text — plus the two other
 * things about this app that a person notices and a compiler does not: the size
 * of the button that gets pressed all day, and which way an arrow points when
 * the shop is reading Arabic.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

let passed = 0;
const ok = (label) => { passed += 1; console.log('  ok  ' + label); };

// ------------------------------------------------------------------ contrast

function tokensIn(selector) {
  const at = css.indexOf(selector);
  assert.ok(at >= 0, `no ${selector} block in styles.css`);
  const end = css.indexOf('}', at);
  const found = {};
  for (const [, name, hex] of css.slice(at, end).matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)) {
    found[name] = hex;
  }
  return found;
}

function luminance(hex) {
  let value = hex.replace('#', '');
  if (value.length === 3) value = [...value].map((c) => c + c).join('');
  const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(value.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** Body text at AA. Every one of these is used at 12–15px, so none is "large". */
const AA_BODY = 4.5;

const THEMES = {
  light: tokensIn(':root,\n:root[data-theme="light"]'),
  dark: tokensIn(':root[data-theme="dark"]'),
};

/** The three backgrounds text sits on. A hint can be on any of them. */
const SURFACES = ['--bg', '--surface', '--surface-2', '--surface-3'];

/** Every colour used for words, including the quiet ones. */
const TEXT = ['--text', '--text-muted', '--text-faint', '--accent', '--danger', '--success', '--warning'];

{
  const failures = [];
  for (const [theme, tokens] of Object.entries(THEMES)) {
    for (const text of TEXT) {
      for (const surface of SURFACES) {
        assert.ok(tokens[text], `${theme} has no ${text}`);
        assert.ok(tokens[surface], `${theme} has no ${surface}`);
        const ratio = contrast(tokens[text], tokens[surface]);
        if (ratio < AA_BODY) {
          failures.push(
            `${theme}: ${text} (${tokens[text]}) on ${surface} (${tokens[surface]}) `
            + `is ${ratio.toFixed(2)}:1, under ${AA_BODY}`,
          );
        }
      }
    }
  }
  assert.deepStrictEqual(failures, [], `\n  ${failures.join('\n  ')}\n`);
  ok(`every text colour clears ${AA_BODY}:1 on every surface, in both themes`);

  // The specific one that was wrong, named so the regression is unmistakable.
  const faintOnWhite = contrast(THEMES.light['--text-faint'], THEMES.light['--surface']);
  assert.ok(
    faintOnWhite >= AA_BODY,
    `--text-faint is back under AA on white: ${faintOnWhite.toFixed(2)}:1`,
  );
  ok(`the quiet grey used for 12px hints is ${faintOnWhite.toFixed(2)}:1 on white, not 3.74`);

  // And the disabled state, which is allowed to be quiet but not invisible.
  assert.ok(css.includes('opacity: 0.5'), 'disabled controls are dimmed rather than hidden');
  ok('disabled controls stay legible rather than vanishing');
}

// -------------------------------------------------------------- touch targets
{
  // The plus and minus on every row are the most-pressed controls in MyVault,
  // and a shop counter often has a touchscreen. The visible button stays small
  // because the table is dense on purpose; what has to be 44px is the area that
  // responds to a fingertip.
  const stepper = css.slice(css.indexOf('.stepper button {'));
  const hitArea = stepper.slice(0, stepper.indexOf('.stepper button:hover'));

  assert.ok(hitArea.includes('position: relative'), 'the button positions its own hit area');
  assert.ok(hitArea.includes('width: 44px'), 'the hit area is 44px wide');
  assert.ok(hitArea.includes('height: 44px'), 'and 44px tall');
  assert.ok(hitArea.includes("content: ''"), 'by way of a pseudo-element rather than padding');
  ok('the sell button responds across 44px even though it draws smaller');

  // A focus ring is how the keyboard knows where it is. Removing it is the
  // single most common accessibility regression in a codebase like this.
  assert.ok(/:focus-visible\s*\{[^}]*outline:/.test(css), 'there is a visible focus ring');
  assert.ok(!/outline:\s*(none|0)\s*;?\s*\}/.test(css.replace(/\.search-input:focus[^}]*\}/g, '')),
    'and it is not switched off globally');
  ok('a keyboard focus ring exists and is not switched off');

  // Motion is a preference, not a decision the app gets to make.
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'motion can be turned down');
  ok('the interface respects a request for reduced motion');
}

// ------------------------------------------------------------------------ RTL
{
  // Two of the twenty-one languages read right to left, and an arrow that means
  // "back" does so only by pointing against the reading direction.
  const icon = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'Icon.tsx'), 'utf8');
  assert.ok(icon.includes('DIRECTIONAL'), 'the directional icons are listed somewhere');
  assert.ok(icon.includes("'chevronLeft'") && icon.includes("'chevronRight'"), 'and include the chevrons');
  assert.ok(icon.includes('data-flip-rtl'), 'and are marked for the stylesheet');
  assert.ok(
    css.includes('[dir="rtl"] [data-flip-rtl]') && css.includes('scaleX(-1)'),
    'the stylesheet flips whatever carries the mark',
  );
  ok('a back arrow points the other way in Arabic and Urdu');

  // Layout is written in logical properties so it mirrors on its own; the few
  // physical ones that remain are inside an explicit [dir="rtl"] override.
  const logical = (css.match(/inline-start|inline-end|margin-inline|padding-inline/g) || []).length;
  assert.ok(logical > 10, `only ${logical} logical properties — layout will not mirror`);
  ok(`${logical} logical properties, so the layout mirrors rather than being mirrored by hand`);
}

console.log('\n' + passed + ' checks passed.');
