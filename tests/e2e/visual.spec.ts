import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';

/**
 * Görsel regresyon ağı — 7 sekme × açık/koyu tema × masaüstü/mobil (bkz.
 * tasarım denetimi 3.6, F6'nın (tipografi ölçeği migrasyonu) ön koşulu).
 * Proje matrisi (playwright.emulator.config.ts) 4 varyant üretir:
 * visual-desktop-light/dark, visual-mobile-light/dark — bu dosyadaki testler
 * o dört projede ayrı ayrı çalışır, snapshot dosya adına proje adı otomatik
 * eklenir (bkz. Playwright'ın kendi `toHaveScreenshot` davranışı).
 *
 * İlk çalıştırmada (lokal, CI dışı) eksik baseline'lar otomatik oluşturulup
 * test PASS sayılır — bilinçli bir tasarım değişikliğinden sonra farkı kabul
 * etmek için `npx playwright test --config=playwright.emulator.config.ts
 * tests/e2e/visual.spec.ts --update-snapshots` çalıştırın.
 */

let e2eToken: string;
let seededUid: string;

test.beforeAll(() => {
  const data = JSON.parse(readFileSync('.e2e-token.json', 'utf-8'));
  e2eToken = data.token;
  seededUid = data.uid;
});

const TABS: { path: string; snapshotName: string }[] = [
  { path: '/dashboard', snapshotName: 'harekat-merkezi' },
  { path: '/tasks', snapshotName: 'talimatlar' },
  { path: '/blockers', snapshotName: 'engeller' },
  { path: '/team', snapshotName: 'kadro' },
  { path: '/reports', snapshotName: 'raporlar' },
  { path: '/audit', snapshotName: 'denetim-izleri' },
  { path: '/settings', snapshotName: 'dizge-ayarlari' },
];

test.describe('Görsel Regresyon Ağı', () => {
  test.beforeEach(async ({ page }) => {
    // WelcomeModal onboarding overlay'i (bkz. authenticated.spec.ts'teki AYNI
    // gerekçe) — bu paket navigasyon/ekran görünümünü test ediyor, onboarding'i
    // değil.
    await page.addInitScript((uid) => {
      window.localStorage.setItem(`makam-onboarding-seen-${uid}`, '1');
    }, seededUid);

    // Motion/react'in giriş animasyonları (stagger/spring) MotionConfig
    // reducedMotion="user" ile prefers-reduced-motion'a saygı gösterir (bkz.
    // App.tsx) — bunu emüle etmek, her ekranda animasyonun oturmasını
    // beklemek yerine anlık, kararlı bir görüntü verir.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Giriş, her testin kendi page.goto(tab.path) çağrısında yapılır (bkz.
    // aşağısı) — burada ayrıca Harekat Merkezi'ne gidip ayrı bir sayfa yükü
    // eklemeye gerek yok.
  });

  for (const tab of TABS) {
    test(`${tab.snapshotName} ekranı görsel olarak tutarlı kalmalı`, async ({ page }) => {
      // Sidebar/MobileDock üzerinden tıklamak yerine doğrudan goto — mobil
      // projede (Pixel 7) MAX_VISIBLE=4'ü aşan sekmeler (Raporlar/Denetim/
      // Ayarlar) MobileDock'un "Daha Fazla" taşma paneline düşer ve testte
      // ekstra bir tıklama adımı gerektirirdi. signInWithCustomToken zaten
      // idempotent olduğundan ?e2e_token= her navigasyonda tekrar verilebilir
      // (bkz. App.tsx) — Firebase Auth oturumu zaten kalıcı, ama bu tam
      // navigasyonun oturuma bağlı olup olmadığı belirsizliğini ortadan kaldırır.
      await page.goto(`${tab.path}?e2e_token=${e2eToken}`);
      await expect(page.getByRole('main')).toBeVisible({ timeout: 15000 });
      // Route değişimi + veri yeniden render'ı için kısa bir yerleşme payı
      // (reducedMotion animasyonu ortadan kaldırsa da veri bağlı grafik/liste
      // render'ları hâlâ bir tık sürebilir).
      await page.waitForTimeout(600);

      await expect(page).toHaveScreenshot(`${tab.snapshotName}.png`, {
        fullPage: true,
        // Canlı saat (LocalTime), "Canlı · HH:MM" göstergesi gibi saniye
        // bazlı içerik piksel-birebir karşılaştırmayı imkansız kılar —
        // küçük bir tolerans, gerçek bir tasarım regresyonunu hâlâ yakalar.
        maxDiffPixelRatio: 0.02,
      });
    });
  }
});
