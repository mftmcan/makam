import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT || '3000';
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  // authenticated.spec.ts ve visual.spec.ts yalnızca Firebase Emulator
  // Suite'e karşı, ayrı bir config ile çalışır (bkz.
  // playwright.emulator.config.ts, npm run test:e2e:emulator) — ikisi de
  // beforeAll'da emülatör seed'inin ürettiği .e2e-token.json'ı okur ve
  // VITE_USE_FIREBASE_EMULATOR ister; burada (argümansız `npx playwright
  // test`, CI'daki emülatörsüz `test` job'ı) çalıştırılırsa ENOENT ile her
  // zaman başarısız olur. Bu config'in kapsamı yalnızca core.spec.ts'tir.
  testIgnore: /(authenticated|visual)\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
