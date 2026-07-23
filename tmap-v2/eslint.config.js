// ESLint flat config for tmap-v2 (Node/Express + CLI, no framework-specific rules needed).
// Mirrors aof-web's TypeScript-strictness intent (see aof-web/.eslintrc.json), but built on
// @typescript-eslint directly since this package has no Next.js dependency.
//
// Deliberately does NOT pull in @eslint/js's `recommended` core ruleset: several of its rules
// (no-redeclare, no-useless-assignment, preserve-caught-error, no-empty, ...) are either
// TS-unaware (no-redeclare false-positives on the standard `const X = {...} as const; type X =
// typeof X` pattern used throughout this codebase, e.g. src/server/audit.ts) or unrelated to
// this config's actual goal (catching genuinely-dead local code). Scope is intentionally the
// unused-vars family + @typescript-eslint's own recommended TS rules.
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

// Shared options for the classic "genuine local dead code" no-unused-vars family of rules:
// flags unused imports/locals/params, but — per @typescript-eslint/no-unused-vars' documented
// default behavior — never flags an unused EXPORTED function/value, since that requires
// whole-project analysis this rule deliberately does not attempt. Exported-but-unused is a
// distinct, deliberate category (e.g. a function pending a product decision) and is out of
// scope for this gate.
const unusedVarsOptions = {
  vars: 'all',
  args: 'all',
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_',
  caughtErrors: 'all',
  caughtErrorsIgnorePattern: '^_',
  ignoreRestSiblings: true,
};

const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  setTimeout: 'readonly',
  setInterval: 'readonly',
  clearTimeout: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  globalThis: 'readonly',
  module: 'readonly',
  require: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortController: 'readonly',
};

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.aof-server/**',
      '.aof/**',
      'aof-output/**',
      // Static asset served as-is (browser service worker), not app source.
      'src/server/public/**',
      '**/*.log',
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 'latest',
      },
      globals: nodeGlobals,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // TypeScript (via `tsc --noEmit`) already catches undefined/undeclared identifiers with
      // full type information; core no-undef is unreliable on TS syntax (ambient types, etc).
      'no-undef': 'off',
      // Superseded by the TS-aware variant below.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', unusedVarsOptions],
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 'latest',
      globals: nodeGlobals,
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': ['error', unusedVarsOptions],
    },
  },
];
