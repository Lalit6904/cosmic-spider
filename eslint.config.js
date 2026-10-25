import js from '@eslint/js';
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';

export default tseslint.config(
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
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { security },
    rules: {
      ...security.configs.recommended.rules,
      // Browser password-confirmation and role checks are not secret-dependent
      // comparisons. Cryptographic comparisons use bcrypt and timingSafeEqual.
      'security/detect-possible-timing-attacks': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
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
    files: ['tests/**/*.{ts,tsx}', 'scripts/**/*.mjs'],
    rules: {
      'security/detect-object-injection': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        URL: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        performance: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
);
