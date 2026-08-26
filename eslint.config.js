import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * What a machine checks, so that a person does not have to.
 *
 * MyVault has a settled style — long explanatory comments, single quotes, two
 * spaces — arrived at over eighteen thousand lines, and nothing here tries to
 * change it. There is deliberately no formatter: reformatting the codebase
 * would bury every future diff under whitespace, and the style is not the thing
 * that has ever caused a bug.
 *
 * What has caused bugs is the ordinary stuff a person stops seeing after the
 * third read — a promise nobody waited for, a hook that closes over last
 * render's value, a variable left behind by a refactor. Those are what these
 * rules are for, and rules that only complain about taste are left out, because
 * a linter a shop's developer starts ignoring is worse than no linter at all.
 *
 * Two worlds, so two sections: the renderer is a browser and TypeScript, the
 * main process is Node and CommonJS. Anything that treats one as the other is
 * itself a bug worth catching.
 */
export default [
  {
    // Nothing here is ours: bundled output, dependencies, the packaged app.
    ignores: ['dist/**', 'release/**', 'node_modules/**', '.claude/**'],
  },

  // ------------------------------------------------------------- the renderer
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        // Type-aware rules need the program, and the ones that need it — an
        // unawaited promise, most of all — are the reason this config exists.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: { jsx: true },
      },
      globals: globals.browser,
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,

      /**
       * The rule that pays for the whole file.
       *
       * Every call across the bridge is a promise, and one that nobody waits
       * for fails in silence: the stock does not move, no error reaches the
       * screen, and the shop finds out at stock-take.
       */
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],

      /**
       * A hook that closes over a stale value is the hardest kind of bug to see
       * in a screenshot: everything renders, the numbers are just yesterday's.
       */
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      /**
       * The base rule cannot read a type. It sees the parameter names in an
       * interface — `updateField: (id: string, patch: Partial<CustomField>)` —
       * as variables nobody uses, when they are the documentation of a call
       * made somewhere else entirely. The TypeScript-aware one below knows the
       * difference, so the base one is turned off rather than argued with.
       */
      'no-unused-vars': 'off',

      // A leftover from a refactor, which is how a half-finished rename hides.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],

      // `any` turns off the type checking this project relies on to keep the
      // main process and the screen agreeing about what a document looks like.
      '@typescript-eslint/no-explicit-any': 'error',

      /**
       * TypeScript already knows what is defined; this rule does not, and
       * reports `React.ReactNode` in a file that never imports React because
       * the JSX transform no longer needs it imported.
       */
      'no-undef': 'off',

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // --------------------------------------------------------- the main process
  {
    files: ['electron/**/*.js', 'scripts/**/*.mjs', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        // Empty catches are a deliberate, argued idiom here — see the comments
        // above each one — and the binding is often named for documentation.
        caughtErrors: 'none',
      }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      /**
       * A byte-order mark is a real character with a real job here: the CSV
       * reader strips one from the front of a file Excel wrote, and the licence
       * script strips one too. The rule is worth keeping for the stray
       * non-breaking space that gets pasted into code by accident, so it is
       * narrowed rather than turned off.
       */
      'no-irregular-whitespace': ['error', { skipRegExps: true, skipStrings: true }],
      // The tests print their results; the app must not print to a console
      // nobody is watching in a packaged build.
      'no-console': 'off',
    },
  },

  {
    /**
     * The end-to-end suites hand functions to the page through
     * `page.evaluate`, and inside those the browser globals are as real as
     * Node's are outside them. Both sets are in scope in one file, which is
     * unusual enough to be worth saying out loud.
     *
     * headless.js is not a suite but is written from the same two sides — it
     * asks the page whether it is still drawing — so it belongs here too.
     */
    files: ['tests/**/*.e2e.js', 'tests/headless.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  {
    // ES modules, despite living beside CommonJS. vite.config.ts is TypeScript
    // as well, so it needs the parser rather than only the module setting.
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: { sourceType: 'module' },
  },

  {
    files: ['vite.config.ts'],
    languageOptions: {
      sourceType: 'module',
      parser: tseslint.parser,
      globals: globals.node,
    },
  },
  {
    /**
     * A declaration file names its parameters for the reader, not for the
     * compiler: `update(id: string, patch: Partial<Item>)` in bridge.d.ts is
     * describing a call that lives in the preload script. Nothing is unused
     * there because nothing is used there.
     */
    files: ['**/*.d.ts'],
    rules: { '@typescript-eslint/no-unused-vars': 'off', 'no-unused-vars': 'off' },
  },

];
