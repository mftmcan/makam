import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Modal } from './Modal';

/**
 * jsdom layout hesaplamadığından `offsetParent` varsayılan olarak HER ZAMAN
 * null döner — bu yüzden "görünür" elemanları simüle etmek için prototip
 * seviyesinde override edilir. `data-hidden-for-test` taşıyan eleman gizli
 * (offsetParent null) kabul edilir, diğerleri görünür (bkz. Modal.tsx'teki
 * focus-trap görünürlük filtresi — bu test tam olarak onu doğrular).
 */
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-hidden-for-test') ? null : document.body;
    },
  });
});

afterAll(() => {
  // @ts-expect-error test-only temizlik
  delete HTMLElement.prototype.offsetParent;
});

describe('Modal — focus-trap görünürlük filtresi', () => {
  it('kapanınca odağı açan düğmeye ve önceki scroll stiline döndürür', async () => {
    document.body.style.overflow = 'auto';
    const { rerender } = render(<><button>Aç</button><Modal isOpen={false} onClose={() => {}} title="Pencere">İçerik</Modal></>);
    screen.getByRole('button', { name: 'Aç' }).focus();
    rerender(<><button>Aç</button><Modal isOpen onClose={() => {}} title="Pencere">İçerik</Modal></>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pencere penceresini kapat' })).toHaveFocus());
    rerender(<><button>Aç</button><Modal isOpen={false} onClose={() => {}} title="Pencere">İçerik</Modal></>);
    expect(screen.getByRole('button', { name: 'Aç' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('auto');
    document.body.style.overflow = '';
  });

  it('odak dışarı kaçtığında Tab ile geri alır ve devre dışı alanları atlar', async () => {
    render(<><button>Dışarı</button><Modal isOpen onClose={() => {}} title="Pencere"><input disabled aria-label="Pasif" /><button>Son eylem</button></Modal></>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pencere penceresini kapat' })).toHaveFocus());
    screen.getByRole('button', { name: 'Dışarı' }).focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Son eylem' })).toHaveFocus();
  });

  it('Tab döngüsü, DOM içinde bulunan ama CSS ile gizlenmiş (offsetParent=null) bir elemana odaklanmaz', async () => {
    render(
      <Modal isOpen={true} onClose={() => {}} title="Talimat Detayı">
        <button>Görünür Eylem</button>
        {/* Sekmeli bir modalda (ör. TaskDetails) pasif sekmenin içeriği tam
            olarak böyle DOM'da kalıp yalnızca CSS ile gizlenir. */}
        <button data-hidden-for-test>Gizli Sekme İçeriği</button>
      </Modal>
    );

    const closeButton = screen.getByRole('button', { name: 'Talimat Detayı penceresini kapat' });
    const visibleAction = screen.getByRole('button', { name: 'Görünür Eylem' });
    const hiddenAction = screen.getByRole('button', { name: 'Gizli Sekme İçeriği' });

    // Modal açılışta kapat butonuna odaklanır (50ms gecikmeli)
    await waitFor(() => expect(closeButton).toHaveFocus());

    // Son GÖRÜNÜR elemana odaklan (gizli buton DOM'da bundan sonra gelse de
    // görmezden gelinmeli) ve Tab'a bas — döngü ilk görünür elemana (kapat
    // butonuna) sarmalı, gizli butona ASLA değil.
    visibleAction.focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    expect(document.activeElement).toBe(closeButton);
    expect(document.activeElement).not.toBe(hiddenAction);

    // Ters yönde (Shift+Tab) ilk elemandan son GÖRÜNÜR elemana sarmalı
    closeButton.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(visibleAction);
    expect(document.activeElement).not.toBe(hiddenAction);
  });
});
