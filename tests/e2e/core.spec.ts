import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('MAKAM E2E Core Workflow', () => {
  test('login defers data, animation services and unused font ranges', async ({ page }) => {
    const unnecessaryRequests: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('/src/firebase.ts') || url.pathname.includes('vendor-data-') || url.pathname.includes('/__/auth/iframe')
        || url.pathname.includes('vendor-motion-') || url.pathname.includes('motion_react')
        || /\/fonts\/(inter|outfit)-latin-ext\.woff2$/.test(url.pathname)) {
        unnecessaryRequests.push(url.pathname);
      }
    });
    await page.goto('/');
    await expect(page.getByRole('button', { name: /KURUMSAL GİRİŞ YAP/i })).toBeVisible({ timeout: 30000 });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await page.waitForLoadState('networkidle');
    expect(unnecessaryRequests).toEqual([]);
  });

  test('should finish loading and offer institutional sign in', async ({ page }) => {
    await page.goto('/');
    
    // Uygulamanın title'ını kontrol et
    await expect(page).toHaveTitle(/MAKAM \| Stratejik Yönetim/);

    const loginBtn = page.getByRole('button', { name: /KURUMSAL GİRİŞ YAP/i });
    await expect(loginBtn).toBeVisible({ timeout: 30000 });
    await expect(loginBtn).toBeEnabled();
  });

  test('should have no critical accessibility violations (axe-core, WCAG 2 AA dahil kontrast)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /KURUMSAL GİRİŞ YAP/i })).toBeVisible({ timeout: 30000 });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    if (critical.length > 0) {
      console.log(JSON.stringify(critical, null, 2));
    }

    expect(critical, `Kritik/ciddi a11y ihlalleri: ${critical.map(v => v.id).join(', ')}`).toEqual([]);
  });
});
