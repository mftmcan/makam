import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReloadPrompt } from './ReloadPrompt';

const sw = vi.hoisted(() => ({ offlineReady: true, needRefresh: false, update: vi.fn() }));
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ offlineReady: [sw.offlineReady, vi.fn()], needRefresh: [sw.needRefresh, vi.fn()], updateServiceWorker: sw.update }),
}));
beforeEach(() => { sw.offlineReady = true; sw.needRefresh = false; sw.update.mockClear(); });

describe('PWA notification visibility', () => {
  it('does not announce offline readiness on a signed-out login screen', () => {
    render(<ReloadPrompt showOfflineReady={false} />);
    expect(screen.queryByText('Çevrimdışı Hazır')).not.toBeInTheDocument();
  });
  it('keeps update recovery available even when offline-ready notices are hidden', () => {
    sw.needRefresh = true;
    render(<ReloadPrompt showOfflineReady={false} />);
    expect(screen.getByRole('heading', { name: 'Dizge Güncellemesi', level: 2 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Güncelle ve Yeniden Başlat' }));
    expect(sw.update).toHaveBeenCalledWith(true);
  });
  it('shows the offline-ready status after sign-in', () => {
    render(<ReloadPrompt showOfflineReady />);
    expect(screen.getByRole('status')).toHaveTextContent('Çevrimdışı Hazır');
  });
});
