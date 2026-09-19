import tseslint from 'typescript-eslint';

/** Minimal bar: recommended rules. Type-checked rules arrive with Phase 1. */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/generated/**',
      'packages/spec/openapi.json',
      'packages/spec/manifest.json',
    ],
  },
  tseslint.configs.recommended,
);
