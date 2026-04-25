import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  // `dist/` is the Vite build output. `.claude/` holds Claude Code's per-agent
  // git worktrees — they're full repo copies and would cause every src file to
  // be linted N+1 times, also producing duplicate errors in older snapshots.
  globalIgnores(['dist', '.claude']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      prettier,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Allow `_foo` arg names for params we have to keep for type compatibility
      // but don't use (e.g. `clampGridPosition(candidate, _item)`).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // The new react-hooks v7 rule false-positives on @floating-ui/react: it
      // treats the `refs` object returned by `useFloating` as a ref-bearing
      // value and complains about both `ref={refs.setFloating}` (a callback ref
      // setter, not a ref read) and `[refs.floating]` in deps arrays. Floating
      // UI's API requires both, so silencing the rule project-wide is cleaner
      // than scattering eslint-disable comments across every popover.
      'react-hooks/refs': 'off',
      // Several places legitimately mirror an external/parent value into local
      // state (NumericField focus draft, useTimers config-vs-state sync). The
      // v7 rule treats every `setState` inside `useEffect` as a smell, but
      // these sync patterns are intentional and correct. Disable globally.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
