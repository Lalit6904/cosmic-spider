import js from '@eslint/js';
import react from 'eslint-plugin-react';
import security from 'eslint-plugin-security';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '.mail-outbox/**',
      '.mongodb-binaries/**',
      'client/public/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs}'],
    plugins: { react, security },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      ...security.configs.recommended.rules,
      // Browser password-confirmation and role checks are not secret-dependent
      // comparisons. Cryptographic comparisons use bcrypt and timingSafeEqual.
      'security/detect-possible-timing-attacks': 'off',
      // Core no-unused-vars does not see JSX element references.
      'react/jsx-uses-vars': 'error',
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // These rules are noisy for a deliberately dynamic game protocol and
      // are covered by explicit schema validation instead.
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-regexp': 'off',
      'security/detect-unsafe-regex': 'off',
    },
  },
  {
    files: ['tests/**/*.{js,jsx}'],
    rules: {
      'security/detect-object-injection': 'off',
    },
  },
];
