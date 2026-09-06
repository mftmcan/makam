import { describe, it, expect, afterEach, vi } from 'vitest';
import { conflictDetectionService } from './conflictDetectionService';

describe('conflictDetectionService', () => {
  // Servis modül-seviyeli bir singleton — testler arası sızıntıyı önlemek için
  // her testte kaydedilen handler'ların unsubscribe'ı burada toplanır.
  let unsubs: Array<() => void> = [];
  afterEach(() => {
    unsubs.forEach(u => u());
    unsubs = [];
  });

  const subscribe = (handler: (info: unknown) => void) => {
    const unsub = conflictDetectionService.subscribe(handler as never);
    unsubs.push(unsub);
    return unsub;
  };

  describe('detectConflict', () => {
    it('VERSION_MISMATCH içeren hata mesajında true döner', () => {
      const result = conflictDetectionService.detectConflict(
        new Error('VERSION_MISMATCH: Beklenen Versiyon 2, Sunucu Versiyonu 3'),
        'task-1', 'Talimat', 2
      );
      expect(result).toBe(true);
    });

    it('ABORTED içeren hata mesajında true döner', () => {
      const result = conflictDetectionService.detectConflict(new Error('ABORTED'), 'task-1', 'Talimat', 1);
      expect(result).toBe(true);
    });

    it("'contention' içeren hata mesajında true döner", () => {
      const result = conflictDetectionService.detectConflict(new Error('too much contention on document'), 'task-1', 'Talimat', 1);
      expect(result).toBe(true);
    });

    it("'lock' içeren hata mesajında true döner", () => {
      const result = conflictDetectionService.detectConflict(new Error('failed to acquire lock'), 'task-1', 'Talimat', 1);
      expect(result).toBe(true);
    });

    it('eşleşmeyen bir hata mesajında false döner', () => {
      const result = conflictDetectionService.detectConflict(new Error('permission-denied'), 'task-1', 'Talimat', 1);
      expect(result).toBe(false);
    });

    it('küçük harfli "version" tek başına eşleşmez (yalnızca büyük harfli VERSION_MISMATCH tanınır)', () => {
      const result = conflictDetectionService.detectConflict(new Error('version conflict'), 'task-1', 'Talimat', 1);
      expect(result).toBe(false);
    });

    it('Error olmayan bir değer (string) String() ile mesaja çevrilip aynı şekilde kontrol edilir', () => {
      const result = conflictDetectionService.detectConflict('VERSION_MISMATCH', 'task-1', 'Talimat', 1);
      expect(result).toBe(true);
    });

    it('serverVersion verilmezse expectedVersion+1 olarak tahmin edilir', () => {
      const handler = vi.fn();
      subscribe(handler);

      conflictDetectionService.detectConflict(new Error('VERSION_MISMATCH'), 'task-1', 'Talimat', 4);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ serverVersion: 5 }));
    });

    it('serverVersion açıkça verildiğinde tahmin yerine o değer kullanılır', () => {
      const handler = vi.fn();
      subscribe(handler);

      conflictDetectionService.detectConflict(new Error('VERSION_MISMATCH'), 'task-1', 'Talimat', 4, 9);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ serverVersion: 9 }));
    });

    it('çakışma olmadığında hiçbir handler çağrılmaz', () => {
      const handler = vi.fn();
      subscribe(handler);

      conflictDetectionService.detectConflict(new Error('permission-denied'), 'task-1', 'Talimat', 1);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('subscribe / notify', () => {
    it('çakışma tespit edildiğinde kayıtlı handler taskId/taskTitle/expectedVersion ile çağrılır', () => {
      const handler = vi.fn();
      subscribe(handler);

      conflictDetectionService.detectConflict(new Error('VERSION_MISMATCH'), 'task-42', 'Aylık Rapor', 7);

      expect(handler).toHaveBeenCalledOnce();
      // context verilmediğinde servis kendi varsayılan ConflictContext'ini
      // üretir (bkz. tasarım denetimi F7 — offlineQueue.ts'teki senkron-replay
      // çağrıları için, App.tsx'in canlı düzenleme yolu her zaman gerçek bir
      // context sağlar).
      expect(handler).toHaveBeenCalledWith({
        taskId: 'task-42', taskTitle: 'Aylık Rapor', expectedVersion: 7, serverVersion: 8,
        attemptedChangeSummary: expect.any(String), retry: expect.any(Function),
      });
    });

    it('birden fazla kayıtlı handler\'ın tümü çağrılır', () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();
      subscribe(handlerA);
      subscribe(handlerB);

      conflictDetectionService.detectConflict(new Error('VERSION_MISMATCH'), 'task-1', 'Talimat', 1);

      expect(handlerA).toHaveBeenCalledOnce();
      expect(handlerB).toHaveBeenCalledOnce();
    });

    it('unsubscribe edilen handler bir sonraki çakışmada çağrılmaz', () => {
      const handler = vi.fn();
      const unsub = subscribe(handler);
      unsub();

      conflictDetectionService.detectConflict(new Error('VERSION_MISMATCH'), 'task-1', 'Talimat', 1);

      expect(handler).not.toHaveBeenCalled();
    });

    it('unsubscribe yalnızca kendi handler\'ını kaldırır, diğerlerini etkilemez', () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();
      const unsubA = subscribe(handlerA);
      subscribe(handlerB);
      unsubA();

      conflictDetectionService.detectConflict(new Error('VERSION_MISMATCH'), 'task-1', 'Talimat', 1);

      expect(handlerA).not.toHaveBeenCalled();
      expect(handlerB).toHaveBeenCalledOnce();
    });
  });
});
