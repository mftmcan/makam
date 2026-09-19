/**
 * useOfflineQueue testleri.
 *
 * Offline-first mimarinin UI'a açılan tek penceresi bu hook'tur — yanlış
 * çalışması ya kullanıcıya bekleyen/başarısız mutasyonları hiç göstermez
 * (sessizce veri kaybı izlenimi) ya da ağ durumunu yanlış yansıtır.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOfflineQueue } from './useOfflineQueue';
import { offlineQueue, failedMutationsLog } from '../lib/offlineQueue';
import type { OfflineMutation, FailedMutation } from '../lib/offlineQueue';

vi.mock('../lib/offlineQueue', () => ({
  offlineQueue: { getQueue: vi.fn(() => []), sync: vi.fn() },
  failedMutationsLog: { getLog: vi.fn(() => []), dismiss: vi.fn(), clear: vi.fn() },
}));

// src/test/setup.ts, window.dispatchEvent'i global olarak no-op'a çeviriyor
// (toast/SLA event'leri testleri kirletmesin diye) — bu dosyanın konusu tam
// da online/offline/makam_queue_changed event'lerinin dinlenmesi olduğundan
// orijinal davranış burada geri alınır (useIdleTimer.test.ts ile AYNI desen).
beforeAll(() => {
  (window.dispatchEvent as unknown as { mockRestore?: () => void }).mockRestore?.();
});

const mutation = (id: string): OfflineMutation => ({ id, collectionName: 'tasks', type: 'update', timestamp: Date.now() } as any);
const failed = (id: string): FailedMutation => ({ id, collectionName: 'tasks', type: 'update', timestamp: Date.now(), error: 'x' } as any);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(offlineQueue.getQueue).mockReturnValue([]);
  vi.mocked(failedMutationsLog.getLog).mockReturnValue([]);
  Object.defineProperty(window.navigator, 'onLine', { value: true, writable: true });
});

describe('useOfflineQueue', () => {
  it('mount anında navigator.onLine\'a göre isOffline\'ı ayarlar', () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, writable: true });
    const { result } = renderHook(() => useOfflineQueue());
    expect(result.current.isOffline).toBe(true);
  });

  it('mount anında kuyruk/başarısız-log içeriğini yükler', () => {
    vi.mocked(offlineQueue.getQueue).mockReturnValue([mutation('m1'), mutation('m2')]);
    vi.mocked(failedMutationsLog.getLog).mockReturnValue([failed('f1')]);

    const { result } = renderHook(() => useOfflineQueue());

    expect(result.current.queueLength).toBe(2);
    expect(result.current.pendingMutations).toHaveLength(2);
    expect(result.current.failedMutations).toHaveLength(1);
  });

  it('"offline" event\'i isOffline\'ı true yapar', () => {
    const { result } = renderHook(() => useOfflineQueue());
    expect(result.current.isOffline).toBe(false);

    act(() => {
      Object.defineProperty(window.navigator, 'onLine', { value: false, writable: true });
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.isOffline).toBe(true);
  });

  it('"online" event\'i isOffline\'ı false yapar (senkronu KENDİSİ tetiklemez)', () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, writable: true });
    const { result } = renderHook(() => useOfflineQueue());
    expect(result.current.isOffline).toBe(true);

    act(() => {
      Object.defineProperty(window.navigator, 'onLine', { value: true, writable: true });
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current.isOffline).toBe(false);
    // bkz. kaynak yorumu: gerçek sync tetiklemesi offlineQueue.ts'in kendi
    // 'online' listener'ındadır — bu hook AYRICA sync() çağırmamalı.
    expect(offlineQueue.sync).not.toHaveBeenCalled();
  });

  it('"makam_queue_changed" event\'i kuyruğu yeniden okur', () => {
    const { result } = renderHook(() => useOfflineQueue());
    expect(result.current.queueLength).toBe(0);

    vi.mocked(offlineQueue.getQueue).mockReturnValue([mutation('m1')]);
    act(() => { window.dispatchEvent(new Event('makam_queue_changed')); });

    expect(result.current.queueLength).toBe(1);
  });

  it('"makam_failed_log_changed" event\'i başarısız listesini yeniden okur', () => {
    const { result } = renderHook(() => useOfflineQueue());
    expect(result.current.failedMutations).toHaveLength(0);

    vi.mocked(failedMutationsLog.getLog).mockReturnValue([failed('f1')]);
    act(() => { window.dispatchEvent(new Event('makam_failed_log_changed')); });

    expect(result.current.failedMutations).toHaveLength(1);
  });

  it('syncNow başarılı olursa true döner ve kuyruğu günceller', async () => {
    vi.mocked(offlineQueue.sync).mockResolvedValue(true);
    vi.mocked(offlineQueue.getQueue).mockReturnValueOnce([]).mockReturnValue([]);
    const { result } = renderHook(() => useOfflineQueue());

    let syncResult: boolean | undefined;
    await act(async () => { syncResult = await result.current.syncNow(); });

    expect(syncResult).toBe(true);
    expect(offlineQueue.sync).toHaveBeenCalledOnce();
  });

  it('syncNow hata fırlatırsa yakalar ve false döner (uygulamayı çökertmez)', async () => {
    vi.mocked(offlineQueue.sync).mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useOfflineQueue());

    let syncResult: boolean | undefined;
    await act(async () => { syncResult = await result.current.syncNow(); });

    expect(syncResult).toBe(false);
  });

  it('dismissFailedMutation loga iletir ve listeyi günceller', () => {
    vi.mocked(failedMutationsLog.getLog)
      .mockReturnValueOnce([failed('f1')]) // ilk yükleme
      .mockReturnValue([]); // dismiss sonrası
    const { result } = renderHook(() => useOfflineQueue());
    expect(result.current.failedMutations).toHaveLength(1);

    act(() => { result.current.dismissFailedMutation('f1'); });

    expect(failedMutationsLog.dismiss).toHaveBeenCalledWith('f1');
    expect(result.current.failedMutations).toHaveLength(0);
  });

  it('clearFailedMutations loga iletir ve listeyi boşaltır', () => {
    vi.mocked(failedMutationsLog.getLog).mockReturnValue([failed('f1'), failed('f2')]);
    const { result } = renderHook(() => useOfflineQueue());
    expect(result.current.failedMutations).toHaveLength(2);

    act(() => { result.current.clearFailedMutations(); });

    expect(failedMutationsLog.clear).toHaveBeenCalledOnce();
    expect(result.current.failedMutations).toHaveLength(0);
  });

  it('unmount sonrası event listener\'lar kaldırılır', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useOfflineQueue());
    unmount();

    expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('makam_queue_changed', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('makam_failed_log_changed', expect.any(Function));
  });
});
