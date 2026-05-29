import { defineConfig, devices } from '@playwright/test';

/**
 * Minimal Playwright config — currently just the Bug F scroll-jump
 * regression test, which runs the app in its hash-driven `#e2e` mode
 * (no auth / no Supabase, seeded micro-tasks in local state).
 *
 * Uses a dedicated port (5180) so it doesn't collide with a dev server
 * a human might have running on 5173. A fresh `vite` boot reads the
 * current source (HMR is irrelevant here, and is in fact disabled for
 * this worktree because vite.config ignores the .claude worktree path).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5180',
    headless: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --port 5180 --strictPort',
    url: 'http://localhost:5180',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
