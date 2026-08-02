import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'server-dist', 'bin-dist', 'coverage', '.worktrees']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      reactRefresh.configs.vite,
    ],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // React Compiler is not enabled; keep the stable Hooks correctness rules
      // without compiler-specific ref, effect, and memoization restrictions.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: [
      'server/**/*.ts',
      'scripts/**/*.ts',
      'bin/**/*.ts',
      '*.config.ts',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: [
      'server/routes/canvas.ts',
      'server/lib/canvas-send-service.ts',
      'server/lib/canvas-send-worker.ts',
      'server/lib/canvas-send-coordinator.ts',
      'server/lib/canvas-backend-events.ts',
      'server/lib/canvas-reconciler.ts',
      'server/lib/canvas-context-snapshot.ts',
      'server/lib/canvas-artifact-store.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: './gateway-rpc.js',
            message: 'Canvas business modules must use AgentBackend instead of the OpenClaw transport.',
          },
          {
            name: '../lib/gateway-rpc.js',
            message: 'Canvas routes must use AgentBackend instead of the OpenClaw transport.',
          },
          {
            name: './openclaw-agent-backend.js',
            message: 'Resolve AgentBackend through the registry; do not bind Canvas to OpenClaw.',
          },
          {
            name: '../lib/openclaw-agent-backend.js',
            message: 'Resolve AgentBackend through the registry; do not bind Canvas to OpenClaw.',
          },
        ],
      }],
    },
  },
])
