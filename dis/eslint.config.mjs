// Flat ESLint config for DIS.
// References:
//   - coding_standards.md §1 (no-any without justification)
//   - coding_standards.md §17 (enforcement)
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `any` is allowed only with an inline justification comment; we warn
      // so reviewers see it rather than hard-failing CI on a guarded use.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
);
