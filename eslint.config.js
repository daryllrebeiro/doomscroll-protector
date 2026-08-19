import js from '@eslint/js';
import globals from 'globals';
import noUnsanitized from 'eslint-plugin-no-unsanitized';

/**
 * The extension ships as classic scripts (no bundler), so extension sources are
 * linted as scripts with the webextension globals; tooling and tests are ESM.
 */
export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.serviceworker,
        importScripts: 'readonly'
      }
    },
    plugins: {
      'no-unsanitized': noUnsanitized
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-implicit-globals': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error'
    }
  },
  {
    files: ['tools/**/*.mjs', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser }
    }
  }
];
