import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'fs';

/**
 * Kimlik doğrulamalı e2e testleri — Firebase Emulator Suite'e karşı çalışır.
 * Gerçek Google OAuth popup'ını otomatikleştirmek pratik olmadığından,
 * scripts/seedE2E.ts'in ürettiği bir custom token ile ?e2e_token= üzerinden
 * giriş yapılır (bkz. src/App.tsx'teki emulator-only bypass).
 *
 * Çalıştırma: npm run test:e2e:emulator
 * (firebase emulators:exec, emulator'ları ayağa kaldırıp seed script'ini ve
 * bu test dosyasını sırayla çalıştırır, sonunda emulator'ları kapatır.)
 */

let e2eToken: string;
let seededTaskTitle: string;
let seededUid: string;

test.beforeAll(() => {
  const data = JSON.parse(readFileSync('.e2e-token.json', 'utf-8'));
  e2eToken = data.token;
  seededTaskTitle = data.taskTitle;
  seededUid = data.uid;
});

test.describe('MAKAM E2E — Kimlik Doğrulamalı Akışlar', () => {
  test.beforeEach(async ({ page }) => {
    // WelcomeModal (P2-17) taze bir tarayıcı context'inde (localStorage boş)
    // ilk girişte tam ekran bir overlay olarak açılıp alttaki nav linklerinin
    // tıklanmasını engeller — bu paket NAVİGASYON/a11y akışlarını test ediyor,
    // onboarding'i değil, bu yüzden karşılamayı "zaten görülmüş" işaretleyerek
    // baştan atlanır (bkz. src/components/WelcomeModal.tsx onboardingSeenKey).
    await page.addInitScript((uid) => {
      window.localStorage.setItem(`makam-onboarding-seen-${uid}`, '1');
    }, seededUid);

    await page.goto(`/?e2e_token=${e2eToken}`);
    // Harekat Merkezi (Dashboard) sekmesinin görünmesini bekle — giriş başarılı demektir
    await expect(page.getByText('Stratejik Sağlık Endeksi')).toBeVisible({ timeout: 15000 });
  });

  test('Admin girişi Harekat Merkezi\'ni yükler', async ({ page }) => {
    await expect(page).toHaveTitle(/MAKAM \| Stratejik Yönetim/);
    await expect(page.getByText('Stratejik Sağlık Endeksi')).toBeVisible();
  });

  test('Talimatlar sekmesi seed edilen görevi gösterir', async ({ page }) => {
    // Menü öğeleri routing katmanıyla birlikte <button> değil <NavLink> (yani
    // gerçek bir <a href="/tasks">) — rol 'button' değil 'link'.
    await page.getByRole('link', { name: 'Talimatlar' }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    // Responsive tasarım hem mobil kart hem masaüstü tablo satırını DOM'da
    // tutar (CSS ile birini gizler) — masaüstü test viewport'unda görünür
    // olan tablo satırına özel olarak bak.
    await expect(page.getByRole('table').getByText(seededTaskTitle)).toBeVisible({ timeout: 10000 });
  });

  // a11y taraması eskiden yalnızca bu ekranı (Harekat Merkezi) kapsıyordu —
  // Talimatlar/Engeller/Kadro/Raporlar/Denetim/Ayarlar hiç taranmıyordu (bkz.
  // tasarım denetimi F3). Sidebar'daki gerçek nav etiketleriyle (Sidebar.tsx)
  // birebir eşleşir — menüler <NavLink> olduğundan rolleri 'link'tir.
  const TAB_NAV_LABELS = [
    'Harekat Merkezi', 'Talimatlar', 'Engeller', 'Kadro', 'Raporlar', 'Denetim İzleri', 'Dizge Ayarları',
  ];

  for (const label of TAB_NAV_LABELS) {
    test(`${label} sekmesi kritik/ciddi a11y ihlali içermemeli`, async ({ page }) => {
      // Harekat Merkezi zaten beforeEach'te açık — yine de tıklamak zararsız
      // (aynı sekmeye navigasyon no-op'tur) ve döngüyü tek tip tutar.
      await page.getByRole('link', { name: label }).click();
      // Sekmeler arası geçişte kademeli (staggered) spring animasyonları var
      // (bkz. Dashboard a11y testindeki AYNI gerekçe) — sabit duruma gelmesini
      // bekliyoruz ki axe geçici, yanıltıcı düşük-opaklık "ihlalleri" yakalamasın.
      await page.waitForTimeout(1200);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const critical = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      );

      expect(critical, `${label} — kritik/ciddi a11y ihlalleri: ${critical.map(v => v.id).join(', ')}`).toEqual([]);
    });
  }

  test('Talimat Detayı modalı kritik/ciddi a11y ihlali içermemeli', async ({ page }) => {
    // Modal sekme ağacının dışında durur (bkz. CLAUDE.md: /tasks/:taskId TaskBoard
    // route'unun alt route'u) — bu yüzden ayrı bir taramayı hak eder, diğer
    // 7 sekmenin hiçbiri açık bir modalı kapsamaz.
    await page.getByRole('link', { name: 'Talimatlar' }).click();
    await page.getByRole('table').getByText(seededTaskTitle).click();
    await expect(page.getByRole('dialog', { name: /Talimat Detayı/i })).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(critical, `Talimat Detayı — kritik/ciddi a11y ihlalleri: ${critical.map(v => v.id).join(', ')}`).toEqual([]);
  });
});
