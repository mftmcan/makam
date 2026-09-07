import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Panel } from '../components/ui/Panel';
import { ExecutiveToast, type ToastData } from '../components/ExecutiveToast';
import { AboutModal } from '../components/AboutModal';

expect.extend(toHaveNoViolations);

/**
 * Playwright + axe-core (tests/e2e/core.spec.ts) sadece giriş yapılmamış Login
 * ekranını tarıyor — kimlik doğrulama/Firestore gerektiren asıl uygulama
 * ekranlarına (Dashboard, TaskBoard, Modal akışları) tam bir Firebase Emulator
 * kurulumu olmadan e2e ile ulaşmak mümkün değil. Bu dosya, çekirdek etkileşimli
 * bileşenleri gerçek auth/Firestore bağımlılığı olmadan izole şekilde render
 * ederek aynı a11y kapsamını component seviyesinde kapatır.
 */
describe('Bileşen erişilebilirliği (axe-core)', () => {
  it('Modal (açık durum) a11y ihlali içermemeli', async () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Görev Detayı">
        <p>Örnek içerik</p>
      </Modal>
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Button varyantları a11y ihlali içermemeli', async () => {
    const { container } = render(
      <div>
        <Button variant="primary">Kaydet</Button>
        <Button variant="secondary">İptal</Button>
        <Button variant="danger">Sil</Button>
        <Button variant="ghost" isLoading>Yükleniyor</Button>
      </div>
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Panel a11y ihlali içermemeli', async () => {
    const { container } = render(
      <Panel>
        <h3>Aktif Görevler</h3>
        <p>Bu ay tamamlanan görev sayısı: 42</p>
      </Panel>
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('ExecutiveToast (her tip için) a11y ihlali içermemeli', async () => {
    const types: NonNullable<ToastData['type']>[] = ['info', 'success', 'warning', 'danger'];
    for (const type of types) {
      const toast: ToastData = { id: `t-${type}`, title: 'Bildirim', body: 'Örnek mesaj', type };
      const { container, unmount } = render(
        <ExecutiveToast toast={toast} onClose={vi.fn()} onClick={vi.fn()} />
      );
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
  });

  it('AboutModal a11y ihlali içermemeli', async () => {
    const { container } = render(<AboutModal isOpen={true} onClose={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
