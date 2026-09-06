import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT || '3001';
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Kimlik doğrulamalı e2e testleri için ayrı config — Firebase Emulator
 * Suite'e karşı çalışır (bkz. package.json `test:e2e:emulator`, ki bu
 * firebase emulators:exec ile emulator'ları ayağa kaldırıp bu config'i
 * çağırır). Ana playwright.config.ts (core.spec.ts — sadece Login ekranı)
 * gerçek Firebase projesine karşı çalışmaya devam eder, buradan etkilenmez.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /authenticated\.spec\.ts|visual\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testMatch: /authenticated\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // a11y taraması eskiden yalnızca aydınlık modu görüyordu — karanlık moda
    // özgü kontrast ihlalleri (bkz. tasarım denetimi F3, F11, F16 gibi
    // bulguların çoğu tam da bu kör noktada yaşıyordu) hiç yakalanmıyordu.
    // `colorScheme: 'dark'`, index.html'deki tema önyükleme betiğinin
    // `prefers-color-scheme` sorgusunu tetikler — uygulama gerçekten karanlık
    // modda açılır, testte ayrıca bir "temayı değiştir" adımı gerekmez.
    {
      name: 'chromium-dark',
      testMatch: /authenticated\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
    },
    // Görsel regresyon ağı (bkz. tasarım denetimi 3.6 — F6/tipografi ölçeği
    // migrasyonunun ön koşulu) yalnızca visual.spec.ts'i çalıştıran AYRI
    // dört proje: masaüstü/mobil × açık/koyu. authenticated.spec.ts'in
    // testMatch'i bunları KAPSAMAZ — aksi halde a11y testleri de bu dört
    // projede gereksiz yere tekrarlanırdı.
    {
      name: 'visual-desktop-light',
      testMatch: /visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], colorScheme: 'light' },
    },
    {
      name: 'visual-desktop-dark',
      testMatch: /visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
    },
    // `devices['iPhone 13']` gibi Apple ön ayarları WebKit'i varsayılan motor
    // yapar — bu ortamda yalnızca Chromium kurulu (bkz. chromium/chromium-dark
    // projeleri). `Pixel 7` Chromium tabanlı bir mobil ön ayar olduğundan aynı
    // tarayıcı motoruyla gerçekçi bir mobil görüntü alanı verir.
    {
      name: 'visual-mobile-light',
      testMatch: /visual\.spec\.ts/,
      use: { ...devices['Pixel 7'], colorScheme: 'light' },
    },
    {
      name: 'visual-mobile-dark',
      testMatch: /visual\.spec\.ts/,
      use: { ...devices['Pixel 7'], colorScheme: 'dark' },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT,
      VITE_USE_FIREBASE_EMULATOR: 'true',
    },
  },
});
