import { fileURLToPath } from 'node:url';
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const typedRules = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: ['**/*.{ts,tsx}'],
}));

export const trailConfig = tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.expo/**',
      '**/coverage/**',
      '**/node_modules/**',
    ],
  },
  eslint.configs.recommended,
  ...typedRules,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.es2022 } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['apps/api/drizzle.config.ts'],
        },
        tsconfigRootDir: fileURLToPath(new URL('../..', import.meta.url)),
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  prettier,
);

export default trailConfig;
