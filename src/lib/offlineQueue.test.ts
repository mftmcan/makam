import { describe, it, expect, beforeEach, vi } from 'vitest';
import { offlineQueue, failedMutationsLog, OfflineMutation } from '../lib/offlineQueue';

// addDoc, updateDoc vb. mock'ları setup.ts'den geliyor
import * as firebase from '../firebase';
import { useUIStore } from '../store/uiStore';

let refCounter = 0;

describe('OfflineQueue', () => {
  beforeEach(() => {
    localStorage.clear();
    // isSyncing mutex'ini sıfırlamak için modülü yeniden import etmek yerine
    // localStorage temizliyoruz ve queue sıfırlıyoruz
    vi.clearAllMocks();
    refCounter = 0;
    vi.mocked(firebase.doc).mockImplementation(() => ({ id: `generated-ref-${++refCounter}` }) as any);
    vi.mocked(firebase.collection).mockImplementation(() => ({}) as any);
    vi.mocked(firebase.increment).mockImplementation((n: number) => ({ __increment: n }) as any);
  });

  // ─── getQueue / saveQueue ──────────────────────────────────────────────────

  describe('getQueue & saveQueue', () => {
    it('boş localStorage\'da boş dizi döner', () => {
      expect(offlineQueue.getQueue()).toEqual([]);
    });

    it('saveQueue ile kaydedilen kuyruk getQueue ile okunur', () => {
      const mutations: OfflineMutation[] = [
        { id: 'test-1', collectionName: 'tasks', action: 'create', timestamp: Date.now() }
      ];
      offlineQueue.saveQueue(mutations);
      expect(offlineQueue.getQueue()).toHaveLength(1);
      expect(offlineQueue.getQueue()[0]!.id).toBe('test-1');
    });

    it('bozuk JSON localStorage\'da boş dizi döner (hata yakalanır)', () => {
      localStorage.setItem('makam_offline_mutations', '{ corrupted }}}');
      expect(offlineQueue.getQueue()).toEqual([]);
    });
  });

  // ─── enqueue ──────────────────────────────────────────────────────────────

  describe('enqueue', () => {
    it('kuyrukta bulunmayan bir öğe ekler', () => {
      offlineQueue.enqueue('tasks', 'create', { id: 'task-temp-1', title: 'Test' });
      const queue = offlineQueue.getQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0]!.collectionName).toBe('tasks');
      expect(queue[0]!.action).toBe('create');
    });

    it('birden fazla öğe eklenebilir', () => {
      offlineQueue.enqueue('tasks', 'create', { id: 'a' });
      offlineQueue.enqueue('tasks', 'update', { title: 'Yeni' }, 'a');
      offlineQueue.enqueue('blockers', 'create', { taskId: 'a' });
      expect(offlineQueue.getQueue()).toHaveLength(3);
    });

    it('her öğeye benzersiz id atanır', () => {
      offlineQueue.enqueue('tasks', 'create', {});
      offlineQueue.enqueue('tasks', 'create', {});
      const queue = offlineQueue.getQueue();
      expect(queue[0]!.id).not.toBe(queue[1]!.id);
    });

    it('aynı doküman için art arda update çağrıları TEK mutasyonda birleştirilir', () => {
      offlineQueue.enqueue('tasks', 'update', { status: 'IN_PROGRESS' }, 'task-1', 3);
      offlineQueue.enqueue('tasks', 'update', { title: 'Yeni Başlık' }, 'task-1', 3);
      offlineQueue.enqueue('tasks', 'update', { status: 'BLOCKED' }, 'task-1', 3);

      const queue = offlineQueue.getQueue();
      expect(queue).toHaveLength(1);
      // Son değer kazanır (status), ayrık alanlar korunur (title)
      expect(queue[0]!.data).toMatchObject({ status: 'BLOCKED', title: 'Yeni Başlık' });
      expect(queue[0]!.expectedVersion).toBe(3);
    });

    it('farklı dokümanlara yapılan update\'ler birleştirilmez', () => {
      offlineQueue.enqueue('tasks', 'update', { status: 'IN_PROGRESS' }, 'task-1', 1);
      offlineQueue.enqueue('tasks', 'update', { status: 'IN_PROGRESS' }, 'task-2', 1);
      expect(offlineQueue.getQueue()).toHaveLength(2);
    });

    it('linkedTaskTransition taşıyan mutasyon birleştirmeye dahil edilmez', () => {
      offlineQueue.enqueue(
        'blockers', 'update', { isResolved: true }, 'blocker-1', undefined,
        { taskId: 'task-1', newStatus: 'IN_PROGRESS', userId: 'user-1', expectedVersion: 2 }
      );
      offlineQueue.enqueue('blockers', 'update', { reason: 'Güncellenmiş sebep' }, 'blocker-1');

      // linkedTaskTransition mutasyonu korunur, yeni plain update ayrı bir öğe olarak eklenir
      expect(offlineQueue.getQueue()).toHaveLength(2);
    });

    it('timestamp otomatik eklenir', () => {
      const before = Date.now();
      offlineQueue.enqueue('tasks', 'delete', undefined, 'some-id');
      const after = Date.now();
      const item = offlineQueue.getQueue()[0]!;
      expect(item.timestamp).toBeGreaterThanOrEqual(before);
      expect(item.timestamp).toBeLessThanOrEqual(after);
    });
  });

  // ─── sync — offline durumu ──────────────────────────────────────────────────

  describe('sync — offline durumu', () => {
    it('browser offline iken sync atlanır ve false döner', async () => {
      Object.defineProperty(window.navigator, 'onLine', { value: false, writable: true });
      offlineQueue.enqueue('tasks', 'create', { id: 'x' });
      const result = await offlineQueue.sync();
      expect(result).toBe(false);
      // Kuyruk hâlâ dolu olmalı
      expect(offlineQueue.getQueue()).toHaveLength(1);
      Object.defineProperty(window.navigator, 'onLine', { value: true, writable: true });
    });

    it('boş kuyrukta sync hemen true döner', async () => {
      const result = await offlineQueue.sync();
      expect(result).toBe(true);
    });
  });

  // ─── sync — başarılı create + ID remapping ──────────────────────────────────

  describe('sync — create işlemi ve ID remapping', () => {
    it('create başarılıysa kuyruk temizlenir', async () => {
      const fakeRef = { id: 'firestore-real-id' };
      vi.mocked(firebase.addDoc).mockResolvedValueOnce(fakeRef as any);
      vi.mocked(firebase.updateDoc).mockResolvedValueOnce(undefined as any);

      offlineQueue.enqueue('tasks', 'create', { id: 'temp-id', title: 'Görev' });

      Object.defineProperty(window.navigator, 'onLine', { value: true, writable: true });
      const result = await offlineQueue.sync();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
    });

    it('create sonrası bağımlı update\'teki geçici ID gerçek ID ile değiştirilir', async () => {
      const fakeRef = { id: 'real-firestore-id' };
      vi.mocked(firebase.addDoc).mockResolvedValueOnce(fakeRef as any);
      vi.mocked(firebase.updateDoc).mockResolvedValue(undefined as any);

      // Önce create, sonra aynı geçici ID ile update
      offlineQueue.enqueue('tasks', 'create', { id: 'temp-abc', title: 'Yeni' });
      offlineQueue.enqueue('tasks', 'update', { title: 'Güncellendi' }, 'temp-abc');

      await offlineQueue.sync();

      // Her iki işlem de başarılı — kuyruk boş olmalı
      expect(offlineQueue.getQueue()).toHaveLength(0);
    });

    it('başarısız mutation kuyrukta kalır', async () => {
      vi.mocked(firebase.addDoc).mockRejectedValueOnce(new Error('Network error'));

      offlineQueue.enqueue('tasks', 'create', { id: 'temp-fail', title: 'Başarısız' });

      const result = await offlineQueue.sync();

      expect(result).toBe(false);
      expect(offlineQueue.getQueue()).toHaveLength(1);
    });

    it('permission-denied ile reddedilen mutasyon sonsuza dek denenmez, kuyruktan düşürülür, toast gösterilir ve kalıcı günlüğe yazılır', async () => {
      vi.mocked(firebase.addDoc).mockRejectedValueOnce(
        new firebase.FirebaseError('permission-denied', 'Missing or insufficient permissions.')
      );
      useUIStore.setState({ toasts: [] });

      offlineQueue.enqueue('tasks', 'create', { id: 'temp-forbidden', title: 'Yasak İşlem' });
      const result = await offlineQueue.sync();

      // Kalıcı hata "başarısız senkron" değil — mutasyon bilerek düşürülür
      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      expect(useUIStore.getState().toasts).toHaveLength(1);
      expect(useUIStore.getState().toasts[0]).toMatchObject({ type: 'danger' });
      // 3.3: eskiden yalnızca geçici toast vardı — artık OfflineBanner'ın her
      // zaman gösterebileceği kalıcı bir günlük kaydı da tutulur.
      const failedLog = failedMutationsLog.getLog();
      expect(failedLog).toHaveLength(1);
      expect(failedLog[0]!.reason).toBe('permission-denied');
      expect(failedLog[0]!.mutation.collectionName).toBe('tasks');
    });

    it('INVALID_TRANSITION (geçersiz durum geçişi) sonsuza dek denenmez, kuyruktan düşürülür, toast gösterilir ve kalıcı günlüğe yazılır', async () => {
      // transitionTaskInTransaction bu hatayı düz bir Error olarak fırlatır
      // (FirebaseError DEĞİL) — eskiden NON_RETRYABLE_CODES yalnızca
      // FirebaseError kodlarına baktığından bu mutasyon sonsuza dek
      // "remaining"e itilip sessizce yeniden deneniyordu (bkz. kod denetimi).
      vi.mocked(firebase.runTransaction).mockRejectedValueOnce(
        new Error("INVALID_TRANSITION: 'COMPLETED' durumundan 'BLOCKED' durumuna geçiş izinli değil.")
      );
      useUIStore.setState({ toasts: [] });

      offlineQueue.enqueue(
        'tasks', 'update', {}, 'task-1', undefined, undefined,
        { newStatus: 'BLOCKED', userId: 'user-1', expectedVersion: 2 }
      );
      const result = await offlineQueue.sync();

      // Kalıcı/deterministik hata "başarısız senkron" değil — mutasyon bilerek düşürülür
      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      expect(useUIStore.getState().toasts).toHaveLength(1);
      expect(useUIStore.getState().toasts[0]).toMatchObject({ type: 'danger' });
      const failedLog = failedMutationsLog.getLog();
      expect(failedLog).toHaveLength(1);
      expect(failedLog[0]!.reason).toContain('INVALID_TRANSITION');
    });

    it('genel/bilinmeyen bir Error (FirebaseError değil, iş kuralı imzasıyla eşleşmiyor) yine de retry için kuyrukta kalır', async () => {
      // isNonRetryableError yalnızca bilinen iş-kuralı hata imzalarını
      // (INVALID_TRANSITION, Admin/Memur/Müdür kısıtları) non-retryable
      // sayar — rastgele bir Error mesajı (ör. geçici bir SDK içi hata)
      // yanlışlıkla kalıcı sayılıp düşürülmemeli.
      vi.mocked(firebase.addDoc).mockRejectedValueOnce(new Error('Something unexpected happened'));

      offlineQueue.enqueue('tasks', 'create', { id: 'temp-unexpected', title: 'Beklenmedik' });
      const result = await offlineQueue.sync();

      expect(result).toBe(false);
      expect(offlineQueue.getQueue()).toHaveLength(1);
    });

    it('kısmi başarı: başarılı olanlar silinir, başarısız olanlar kalır', async () => {
      const fakeRef = { id: 'real-id' };
      vi.mocked(firebase.addDoc).mockResolvedValueOnce(fakeRef as any);
      vi.mocked(firebase.updateDoc)
        .mockResolvedValueOnce(undefined as any)  // create sonrası id update
        .mockRejectedValueOnce(new Error('Permission denied')); // ikinci update başarısız

      offlineQueue.enqueue('tasks', 'create', { id: 'temp-1', title: 'Görev 1' });
      offlineQueue.enqueue('tasks', 'update', { status: 'IN_PROGRESS' }, 'temp-2');

      const result = await offlineQueue.sync();

      expect(result).toBe(false);
      expect(offlineQueue.getQueue()).toHaveLength(1);
    });
  });

  // ─── sync — delete ve set ───────────────────────────────────────────────────

  describe('sync — delete ve set işlemleri', () => {
    it('delete işlemi başarılıysa kuyruktan silinir', async () => {
      vi.mocked(firebase.deleteDoc).mockResolvedValueOnce(undefined as any);

      offlineQueue.enqueue('tasks', 'delete', undefined, 'task-to-delete');
      await offlineQueue.sync();

      expect(offlineQueue.getQueue()).toHaveLength(0);
    });

    it('docId olmayan delete işlemi sessizce geçilir', async () => {
      // docId'siz delete — hiçbir şey yapılmamalı ama hata fırlatılmamalı
      offlineQueue.enqueue('tasks', 'delete', undefined, undefined);
      const result = await offlineQueue.sync();
      expect(result).toBe(true);
    });

    it('set işlemi merge ile kaydeder', async () => {
      vi.mocked(firebase.setDoc).mockResolvedValueOnce(undefined as any);

      offlineQueue.enqueue('system', 'set', { key: 'sla_config', value: {} }, 'sla_config');
      await offlineQueue.sync();

      expect(firebase.setDoc).toHaveBeenCalledOnce();
      // Üçüncü argüman { merge: true } olmalı
      const callArgs = vi.mocked(firebase.setDoc).mock.calls[0]!;
      expect(callArgs[2]).toEqual({ merge: true });
      // Veri doğru
      expect(callArgs[1]).toMatchObject({ key: 'sla_config' });
    });
  });

  // ─── sync — withAuditLog (kullanıcı yönetimi / risk düzenleme) ─────────────
  // userService.addUser/updateUser/deleteUser ve blockerService.editBlocker'ın
  // online yoldaki writeBatch (ana yazım + audit_logs) atomikliğini offline
  // senkronda da korur — bkz. offlineQueue.ts withAuditLog/writeWithAuditLog.

  describe('sync — withAuditLog', () => {
    const makeBatch = () => ({ set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn() });

    it('set + withAuditLog: hem ana doküman hem audit_logs kaydı TEK writeBatch ile yazılır, merge kullanılmaz', async () => {
      const batch = makeBatch();
      vi.mocked(firebase.writeBatch).mockReturnValueOnce(batch as any);

      offlineQueue.enqueue(
        'users', 'set', { uid: 'a@b.com', fullName: 'X', role: 'Staff', email: 'a@b.com' }, 'a@b.com',
        undefined, undefined, undefined, undefined, undefined,
        { taskId: 'a@b.com', logType: 'STATUS', changedBy: 'admin-1', oldValue: 'Yok', newValue: 'Personel Eklendi: X (Staff)' }
      );
      const result = await offlineQueue.sync();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      // Ana yazım: merge OLMADAN tam doküman (userService.addUser ile aynı)
      expect(batch.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ uid: 'a@b.com', fullName: 'X' }));
      const setCallArgs = batch.set.mock.calls[0]!;
      expect(setCallArgs.length).toBe(2); // merge seçeneği YOK
      // Audit kaydı: ayrı bir batch.set çağrısı
      expect(batch.set).toHaveBeenCalledTimes(2);
      const auditCallArgs = batch.set.mock.calls[1]!;
      // logType, online userService.addUser'ın yazdığı değerle AYNI olmalı —
      // yoksa aynı işlem çevrimiçi/çevrimdışı yapıldığında denetim izinde
      // farklı tipte görünürdü (bkz. taskService.auditLogType).
      expect(auditCallArgs[1]).toMatchObject({ taskId: 'a@b.com', logType: 'STATUS', changedBy: 'admin-1', newValue: 'Personel Eklendi: X (Staff)' });
      // Kullanıcı-yönetimi kayıtlarında "taskId" bir görev değil bir kullanıcı
      // id'sidir — denormalize görev başlığı BİLEREK yazılmaz (uydurma veri
      // olurdu, bkz. userService.ts'teki aynı gerekçe).
      expect(auditCallArgs[1]).not.toHaveProperty('taskTitle');
      expect(batch.commit).toHaveBeenCalledOnce();
    });

    it('update + withAuditLog: hem alan güncellemesi hem audit_logs kaydı TEK writeBatch ile yazılır', async () => {
      const batch = makeBatch();
      vi.mocked(firebase.writeBatch).mockReturnValueOnce(batch as any);

      offlineQueue.enqueue(
        'blockers', 'update', { reason: 'Yeni sebep' }, 'blocker-1',
        undefined, undefined, undefined, undefined, undefined,
        { taskId: 'task-1', taskTitle: 'Risk Görevi', logType: 'FIELD', changedBy: 'user-1', oldValue: 'Risk Gerekçesi', newValue: 'Yeni sebep' }
      );
      const result = await offlineQueue.sync();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      expect(batch.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: 'Yeni sebep' }));
      // taskTitle, online blockerService.editBlocker yoluyla PARİTE için
      // offline senkronda da yazılır (bkz. P1-14 denormalizasyonu).
      expect(batch.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ taskId: 'task-1', taskTitle: 'Risk Görevi', logType: 'FIELD', newValue: 'Yeni sebep' }));
      expect(batch.commit).toHaveBeenCalledOnce();
    });

    it('logType verilmezse audit kaydına anahtar HİÇ eklenmez (eski/legacy kuyruk öğeleri)', async () => {
      // Firestore `undefined` değer kabul etmez ve alan opsiyoneldir. Bu dal
      // pratikte yalnızca bu alandan ÖNCE kuyruğa alınmış (localStorage'da
      // bekleyen) mutasyonlar için çalışır — onlar da yine yazılabilmeli,
      // aksi halde sürüm geçişinde bekleyen kuyruk kalıcı olarak düşerdi.
      const batch = makeBatch();
      vi.mocked(firebase.writeBatch).mockReturnValueOnce(batch as any);

      offlineQueue.enqueue(
        'users', 'delete', undefined, 'legacy-uid',
        undefined, undefined, undefined, undefined, undefined,
        { taskId: 'legacy-uid', changedBy: 'admin-1', oldValue: 'Aktif', newValue: 'Personel Silindi' }
      );
      await offlineQueue.sync();

      const auditCall = batch.set.mock.calls.find(call => 'changedBy' in (call[1] as object));
      expect(auditCall?.[1]).not.toHaveProperty('logType');
    });

    it('delete + withAuditLog: hem doküman silme hem audit_logs kaydı TEK writeBatch ile yazılır', async () => {
      const batch = makeBatch();
      vi.mocked(firebase.writeBatch).mockReturnValueOnce(batch as any);

      offlineQueue.enqueue(
        'users', 'delete', undefined, 'target-uid',
        undefined, undefined, undefined, undefined, undefined,
        { taskId: 'target-uid', changedBy: 'admin-1', oldValue: 'Aktif', newValue: 'Personel Silindi' }
      );
      const result = await offlineQueue.sync();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      expect(batch.delete).toHaveBeenCalledOnce();
      expect(batch.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ taskId: 'target-uid', newValue: 'Personel Silindi' }));
      expect(batch.commit).toHaveBeenCalledOnce();
    });

    it('writeBatch.commit reddederse mutasyon kuyrukta kalır (audit kaydı da uygulanmaz — atomiklik)', async () => {
      const batch = makeBatch();
      batch.commit.mockRejectedValueOnce(new Error('Network error'));
      vi.mocked(firebase.writeBatch).mockReturnValueOnce(batch as any);

      offlineQueue.enqueue(
        'users', 'delete', undefined, 'target-uid',
        undefined, undefined, undefined, undefined, undefined,
        { taskId: 'target-uid', changedBy: 'admin-1', oldValue: 'Aktif', newValue: 'Personel Silindi' }
      );
      const result = await offlineQueue.sync();

      expect(result).toBe(false);
      expect(offlineQueue.getQueue()).toHaveLength(1);
    });
  });

  // ─── sync — task update ile optimistic locking ─────────────────────────────
  // Çevrimdışı görev güncellemeleri artık expectedVersion taşıyor ve senkronda
  // sunucudaki lockVersion ile karşılaştırılıyor (bkz. offlineQueue.ts sync()).

  describe('sync — task update ile optimistic locking', () => {
    it('versiyon eşleşirse update uygulanır ve lockVersion artırılır', async () => {
      const transactionUpdate = vi.fn();
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ lockVersion: 3, title: 'Görev' }),
          }),
          update: transactionUpdate,
        };
        return fn(transaction);
      });

      offlineQueue.enqueue('tasks', 'update', { status: 'BLOCKED' }, 'task-1', 3);
      const result = await offlineQueue.sync();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      expect(transactionUpdate).toHaveBeenCalledOnce();
      const [, updateData] = transactionUpdate.mock.calls[0]!;
      expect(updateData).toMatchObject({ status: 'BLOCKED', lockVersion: 4 });
    });

    it('versiyon uyuşmazsa update UYGULANMAZ, mutasyon düşürülür ve çakışma bildirimi tetiklenir', async () => {
      const transactionUpdate = vi.fn();
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          // Sunucudaki gerçek versiyon (5), çevrimdışıyken kaydedilen beklenen versiyondan (3) farklı
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ lockVersion: 5, title: 'Başka Kullanıcı Değiştirdi' }),
          }),
          update: transactionUpdate,
        };
        return fn(transaction);
      });

      const { conflictDetectionService } = await import('../services/conflictDetectionService');
      const conflictHandler = vi.fn();
      const unsubscribe = conflictDetectionService.subscribe(conflictHandler);

      offlineQueue.enqueue('tasks', 'update', { status: 'BLOCKED' }, 'task-1', 3);
      const result = await offlineQueue.sync();

      unsubscribe();

      // Çakışma "başarısız" değil — mutasyon bilerek düşürülür (sonsuz retry anlamsız)
      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      // Sunucu verisi ÜZERİNE YAZILMADI
      expect(transactionUpdate).not.toHaveBeenCalled();
      // Kullanıcı çakışmadan haberdar edildi
      expect(conflictHandler).toHaveBeenCalledOnce();
      expect(conflictHandler.mock.calls[0]![0]).toMatchObject({
        taskId: 'task-1',
        taskTitle: 'Başka Kullanıcı Değiştirdi',
        expectedVersion: 3,
        serverVersion: 5,
      });
    });

    it('expectedVersion verilmeyen (eski/legacy) mutasyonlar versiyon kontrolü olmadan uygulanır', async () => {
      vi.mocked(firebase.updateDoc).mockResolvedValueOnce(undefined as any);

      offlineQueue.enqueue('tasks', 'update', { status: 'BLOCKED' }, 'task-1');
      const result = await offlineQueue.sync();

      expect(result).toBe(true);
      expect(firebase.updateDoc).toHaveBeenCalledOnce();
      expect(firebase.runTransaction).not.toHaveBeenCalled();
    });
  });

  // ─── sync — blocker + görev geçişi atomikliği (linkedTaskTransition) ───────
  // Çevrimdışıyken bir engel oluşturmak/çözmek artık görev durum geçişiyle
  // TEK mutasyonda kuyruğa alınıyor ve sync'te aynı transaction'da uygulanıyor
  // (bkz. useAppHandlers.ts + offlineQueue.ts sync()).

  describe('sync — blocker + görev geçişi atomikliği', () => {
    it('linkedTaskTransition ile create: engel dokümanı ve görev BLOCKED geçişi AYNI transaction\'da uygulanır', async () => {
      const transactionSet = vi.fn();
      const transactionUpdate = vi.fn();
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ status: 'IN_PROGRESS', lockVersion: 2, totalPausedTime: 0 }),
          }),
          set: transactionSet,
          update: transactionUpdate,
        };
        return fn(transaction);
      });

      offlineQueue.enqueue(
        'blockers', 'create',
        { id: 'temp_blocker_1', taskId: 'task-1', reason: 'Kriz', isResolved: false, createdAt: Date.now() },
        undefined, undefined,
        { taskId: 'task-1', newStatus: 'BLOCKED', userId: 'user-1', expectedVersion: 2 }
      );
      const result = await offlineQueue.sync();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      expect(transactionUpdate).toHaveBeenCalledOnce(); // görev durumu güncellendi
      const blockerSetCall = transactionSet.mock.calls.find(([, data]: any) => data?.reason !== undefined);
      expect(blockerSetCall?.[1]).toMatchObject({ taskId: 'task-1', reason: 'Kriz' });
    });

    it('linkedTaskTransition ile create: versiyon uyuşmazsa hem engel hem görev yazımı reddedilir, çakışma bildirilir', async () => {
      const transactionSet = vi.fn();
      vi.mocked(firebase.runTransaction).mockImplementation(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ status: 'IN_PROGRESS', lockVersion: 9, totalPausedTime: 0 }),
          }),
          set: transactionSet,
          update: vi.fn(),
        };
        return fn(transaction);
      });

      const { conflictDetectionService } = await import('../services/conflictDetectionService');
      const conflictHandler = vi.fn();
      const unsubscribe = conflictDetectionService.subscribe(conflictHandler);

      offlineQueue.enqueue(
        'blockers', 'create',
        { id: 'temp_blocker_1', taskId: 'task-1', reason: 'Kriz', isResolved: false, createdAt: Date.now() },
        undefined, undefined,
        { taskId: 'task-1', newStatus: 'BLOCKED', userId: 'user-1', expectedVersion: 2 }
      );
      const result = await offlineQueue.sync();
      unsubscribe();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      // Görev versiyonu uyuşmadığı için transaction'daki HİÇBİR yazma commit edilmez —
      // sahipsiz engel dokümanı oluşmaz
      expect(transactionSet).not.toHaveBeenCalled();
      expect(conflictHandler).toHaveBeenCalledOnce();
    });

    it('linkedTaskTransition ile update: engel çözümü ve görev IN_PROGRESS geçişi AYNI transaction\'da uygulanır', async () => {
      const transactionSet = vi.fn();
      const transactionUpdate = vi.fn();
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ status: 'BLOCKED', lockVersion: 5, totalPausedTime: 0, pausedAt: Date.now() - 5000, deadline: Date.now() + 100000 }),
          }),
          set: transactionSet,
          update: transactionUpdate,
        };
        return fn(transaction);
      });

      offlineQueue.enqueue(
        'blockers', 'update',
        { isResolved: true, resolvedAt: Date.now() },
        'blocker-1', undefined,
        { taskId: 'task-1', newStatus: 'IN_PROGRESS', userId: 'user-1', expectedVersion: 5 }
      );
      const result = await offlineQueue.sync();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      // İki update: görev (transitionTaskInTransaction) + blocker dokümanı
      expect(transactionUpdate).toHaveBeenCalledTimes(2);
    });
  });

  // ─── sync — statusTransition (offline durum geçişi) ────────────────────────
  // Çevrimdışı durum geçişleri artık ham transaction.update() yerine online ile
  // BİREBİR AYNI transitionTaskInTransaction'dan geçiyor (bkz. offlineQueue.ts
  // sync() + useAppHandlers.ts). Bu, audit_logs/system-stats yazımının ve
  // kriz-affı (breach-debt + 24s mühlet uzatması) mantığının offline'da da
  // uygulandığını doğrular.

  describe('sync — statusTransition (offline durum geçişi)', () => {
    it('CRISIS→IN_PROGRESS: offline geçişte de online ile aynı ihlal-affı, audit ve stats mantığı uygulanır', async () => {
      const transactionUpdate = vi.fn();
      const transactionSet = vi.fn();
      const now = Date.now();
      const pastDeadline = now - 2 * 60 * 60 * 1000; // 2 saat önce ihlal edilmiş

      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({
              status: 'CRISIS',
              lockVersion: 2,
              totalPausedTime: 0,
              pausedAt: null,
              deadline: pastDeadline,
            }),
          }),
          update: transactionUpdate,
          set: transactionSet,
        };
        return fn(transaction);
      });

      offlineQueue.enqueue(
        'tasks', 'update', undefined, 'task-1', undefined, undefined,
        { newStatus: 'IN_PROGRESS', userId: 'user-1', expectedVersion: 2 }
      );
      const result = await offlineQueue.sync();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);

      // Görev dokümanı: lockVersion arttı, kriz-affı (breach debt + 24s) totalPausedTime'a eklendi
      expect(transactionUpdate).toHaveBeenCalledOnce();
      const [, updateData] = transactionUpdate.mock.calls[0]!;
      expect(updateData).toMatchObject({ status: 'IN_PROGRESS', lockVersion: 3, pausedAt: null });
      expect(updateData.totalPausedTime).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);

      // Düz transaction.update() ile ASLA yazılmayan audit_logs + system/stats,
      // offline yolda da (online ile aynı transitionTaskInTransaction üzerinden) yazılıyor
      const auditCall = transactionSet.mock.calls.find(([, data]: any) => data?.changes !== undefined);
      expect(auditCall?.[1]).toMatchObject({ taskId: 'task-1', changedBy: 'user-1', oldValue: 'CRISIS', newValue: 'IN_PROGRESS' });
      const statsCall = transactionSet.mock.calls.find(([, data]: any) => 'status_CRISIS' in (data ?? {}));
      expect(statsCall?.[1]).toMatchObject({ status_IN_PROGRESS: { __increment: 1 } });
    });

    it('statusTransition taşıyan mutasyon birleştirmeye dahil edilmez', () => {
      offlineQueue.enqueue(
        'tasks', 'update', undefined, 'task-1', undefined, undefined,
        { newStatus: 'IN_PROGRESS', userId: 'user-1', expectedVersion: 2 }
      );
      offlineQueue.enqueue('tasks', 'update', { title: 'Başlık düzeltmesi' }, 'task-1', 2);

      // statusTransition mutasyonu korunur, ardından gelen plain update ayrı bir öğe olarak eklenir
      expect(offlineQueue.getQueue()).toHaveLength(2);
    });

    it('versiyon uyuşmazsa statusTransition UYGULANMAZ, mutasyon düşürülür ve çakışma bildirilir', async () => {
      const transactionUpdate = vi.fn();
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ status: 'IN_PROGRESS', lockVersion: 9, totalPausedTime: 0 }),
          }),
          update: transactionUpdate,
          set: vi.fn(),
        };
        return fn(transaction);
      });

      const { conflictDetectionService } = await import('../services/conflictDetectionService');
      const conflictHandler = vi.fn();
      const unsubscribe = conflictDetectionService.subscribe(conflictHandler);

      offlineQueue.enqueue(
        'tasks', 'update', undefined, 'task-1', undefined, undefined,
        { newStatus: 'COMPLETED', userId: 'user-1', expectedVersion: 2 }
      );
      const result = await offlineQueue.sync();
      unsubscribe();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      expect(transactionUpdate).not.toHaveBeenCalled();
      expect(conflictHandler).toHaveBeenCalledOnce();
    });

    // Regresyon kilidi: transitionTaskInTransaction artık senkron ANINDAKİ
    // Date.now() yerine mutation.timestamp'i (kullanıcının aksiyonu ÇEVRİMDIŞIYKEN
    // gerçekten yaptığı an) kullanıyor — aksi halde cihaz saatlerce çevrimdışı
    // kalıp sonra senkronize olduğunda, duraklama süresi hesabı senkron anına
    // kayar ve SLA deadline'ı haksız yere daralır/genişler.
    it('BLOCKED\'a girişte pausedAt, senkron anına değil mutasyonun çevrimdışı kuyruğa alındığı ana eşitlenir', async () => {
      const transactionUpdate = vi.fn();
      const queuedAt = Date.now() - 3 * 60 * 60 * 1000; // 3 saat önce, çevrimdışıyken kuyruğa alındı

      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ status: 'IN_PROGRESS', lockVersion: 2, totalPausedTime: 0 }),
          }),
          update: transactionUpdate,
          set: vi.fn(),
        };
        return fn(transaction);
      });

      offlineQueue.saveQueue([{
        id: 'm1', collectionName: 'tasks', action: 'update', docId: 'task-1', timestamp: queuedAt,
        statusTransition: { newStatus: 'BLOCKED', userId: 'user-1', expectedVersion: 2 },
      }]);

      await offlineQueue.sync();

      const [, updateData] = transactionUpdate.mock.calls[0]!;
      expect(updateData.pausedAt).toBe(queuedAt);
    });

    it('BLOCKED\'dan çıkışta duraklama süresi, senkron anına kadar geçen zaman değil, kuyruğa alındığı ana kadarki gerçek süre olarak hesaplanır', async () => {
      const transactionUpdate = vi.fn();
      const pausedSince = Date.now() - 5 * 60 * 60 * 1000; // görev 5 saat önce (çevrimiçi) BLOCKED'a alınmış
      const queuedAt = pausedSince + 60 * 60 * 1000; // kullanıcı, 1 saat sonra (çevrimdışı) IN_PROGRESS'e aldı

      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ status: 'BLOCKED', lockVersion: 3, totalPausedTime: 0, pausedAt: pausedSince, deadline: Date.now() + 100000 }),
          }),
          update: transactionUpdate,
          set: vi.fn(),
        };
        return fn(transaction);
      });

      offlineQueue.saveQueue([{
        id: 'm1', collectionName: 'tasks', action: 'update', docId: 'task-1', timestamp: queuedAt,
        statusTransition: { newStatus: 'IN_PROGRESS', userId: 'user-1', expectedVersion: 3 },
      }]);

      await offlineQueue.sync();

      const [, updateData] = transactionUpdate.mock.calls[0]!;
      // Gerçek duraklama 1 saat (pausedSince→queuedAt) olmalı; senkron anına kadar
      // geçen ~5 saat DEĞİL (eski hatalı davranışta bu değer ~5 saate yakın çıkardı).
      expect(updateData.totalPausedTime).toBe(queuedAt - pausedSince);
    });
  });

  // ─── sync — business-kurallı create/update (actorId) ───────────────────────
  // Offline oluşturulan/güncellenen görevler artık ham addDoc/updateDoc yerine
  // (actorId verildiğinde) online taskService.createTask/updateTaskInTransaction
  // üzerinden geçiyor — iş kuralları, audit_logs kaydı ve system/stats
  // güncellemesi offline yolda da online ile birebir aynı şekilde uygulanır.

  describe('sync — business-kurallı create/update (actorId)', () => {
    it('actorId ile create: taskService.createTask üzerinden audit-log ve stats TEK transaction\'da uygulanır', async () => {
      // taskService.createTask artık addDoc/updateDoc/setDoc değil, atomik bir
      // runTransaction kullanıyor (bkz. kod denetimi: çift-kayıt riski düzeltmesi).
      const transactionSet = vi.fn();
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        return fn({ set: transactionSet } as any);
      });

      offlineQueue.enqueue(
        'tasks', 'create',
        { id: 'temp-biz-1', title: 'Görev', description: 'Açıklama', assigneeId: 'u2', creatorId: 'u1', priority: 'Medium', deadline: Date.now() + 100000 },
        undefined, undefined, undefined, undefined, 'user-1'
      );
      const result = await offlineQueue.sync();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);

      const auditCall = transactionSet.mock.calls.find(([, data]: any) => data?.changedBy === 'user-1');
      expect(auditCall?.[1]).toMatchObject({ changedBy: 'user-1', newValue: 'Talimat Oluşturuldu ve Atandı' });

      const statsCall = transactionSet.mock.calls.find(([, data]: any) => 'totalTasks' in (data ?? {}));
      expect(statsCall?.[1]).toMatchObject({ totalTasks: { __increment: 1 } });
    });

    it('actorId ile create: bağımlı sonraki mutasyondaki geçici ID gerçek ID ile değiştirilir', async () => {
      const transactionSet = vi.fn();
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        return fn({ set: transactionSet } as any);
      });
      vi.mocked(firebase.deleteDoc).mockResolvedValue(undefined as any);

      offlineQueue.enqueue(
        'tasks', 'create',
        { id: 'temp-biz-2', title: 'Görev', description: 'Açıklama', assigneeId: 'u2', creatorId: 'u1', priority: 'Medium', deadline: Date.now() + 100000 },
        undefined, undefined, undefined, undefined, 'user-1'
      );
      offlineQueue.enqueue('tasks', 'delete', undefined, 'temp-biz-2');

      await offlineQueue.sync();

      // taskRef, transaction'dan ÖNCE doc(collection(db,'tasks')) ile üretilir
      // (mock: her doc() çağrısı sırayla 'generated-ref-N' döner) — createTask
      // BUNU İLK doc() çağrısı olarak üretir, bu yüzden ID 'generated-ref-1'
      // olur. Sonraki delete mutasyonunun geçici docId'si ('temp-biz-2') bu
      // gerçek ID ile yamalanmış olmalı.
      expect(vi.mocked(firebase.deleteDoc)).toHaveBeenCalledOnce();
      const docCallForDelete = vi.mocked(firebase.doc).mock.calls.find(args => args[2] === 'generated-ref-1');
      expect(docCallForDelete).toBeDefined();
      expect(offlineQueue.getQueue()).toHaveLength(0);
    });

    it('actorId ile update: updateTaskInTransaction üzerinden audit-log yazılır ve versiyon artar', async () => {
      const transactionUpdate = vi.fn();
      const transactionSet = vi.fn();
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ status: 'IN_PROGRESS', lockVersion: 3, title: 'Eski Başlık' }),
          }),
          update: transactionUpdate,
          set: transactionSet,
        };
        return fn(transaction);
      });

      const oldTaskSnapshot = { id: 'task-1', status: 'IN_PROGRESS', lockVersion: 3, title: 'Eski Başlık' } as any;
      offlineQueue.enqueue(
        'tasks', 'update', { title: 'Yeni Başlık' }, 'task-1', 3,
        undefined, undefined, 'user-1', oldTaskSnapshot
      );
      const result = await offlineQueue.sync();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      expect(transactionUpdate).toHaveBeenCalledOnce();
      const [, updateData] = transactionUpdate.mock.calls[0]!;
      expect(updateData).toMatchObject({ title: 'Yeni Başlık', lockVersion: 4 });

      const auditCall = transactionSet.mock.calls.find(([, data]: any) => data?.changes?.title);
      expect(auditCall?.[1]).toMatchObject({ taskId: 'task-1', changedBy: 'user-1' });
      expect(auditCall?.[1].changes.title).toEqual({ old: 'Eski Başlık', new: 'Yeni Başlık' });
    });

    it('actorId ile update: versiyon uyuşmazsa UYGULANMAZ, çakışma bildirilir', async () => {
      const transactionUpdate = vi.fn();
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ status: 'IN_PROGRESS', lockVersion: 9, title: 'Sunucudaki Başlık' }),
          }),
          update: transactionUpdate,
          set: vi.fn(),
        };
        return fn(transaction);
      });

      const { conflictDetectionService } = await import('../services/conflictDetectionService');
      const conflictHandler = vi.fn();
      const unsubscribe = conflictDetectionService.subscribe(conflictHandler);

      const oldTaskSnapshot = { id: 'task-1', status: 'IN_PROGRESS', lockVersion: 3, title: 'Eski Başlık' } as any;
      offlineQueue.enqueue(
        'tasks', 'update', { title: 'Yeni Başlık' }, 'task-1', 3,
        undefined, undefined, 'user-1', oldTaskSnapshot
      );
      const result = await offlineQueue.sync();
      unsubscribe();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      expect(transactionUpdate).not.toHaveBeenCalled();
      expect(conflictHandler).toHaveBeenCalledOnce();
    });
  });
});

// ─── failedMutationsLog ───────────────────────────────────────────────────
// 3.3: eskiden bir mutasyon sunucu tarafından kalıcı olarak reddedildiğinde
// yalnızca geçici bir toast gösteriliyordu, kullanıcı kaçırırsa NEYİN
// uygulanmadığını bir daha göremiyordu. Bu, o bilginin localStorage'a
// yazılıp OfflineBanner'da kalıcı olarak görüntülenmesini sağlayan saf
// (yukarıdaki sync() testlerinden BAĞIMSIZ, doğrudan record/dismiss/clear
// API'sini hedefleyen) katmandır — sync()'in KENDİSİ non-retryable
// durumlarda bu API'yi çağırdığını yukarıdaki "permission-denied"/
// "INVALID_TRANSITION" testlerinde zaten doğruluyor.
describe('failedMutationsLog', () => {
  const mutation = (overrides: Partial<OfflineMutation> = {}): OfflineMutation => ({
    id: 'm-1',
    collectionName: 'tasks',
    docId: 'task-1',
    action: 'update',
    timestamp: Date.now(),
    ...overrides,
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it('başlangıçta boştur', () => {
    expect(failedMutationsLog.getLog()).toEqual([]);
  });

  it('record() bir girdi ekler ve failedAt/reason/mutation alanlarını korur', () => {
    failedMutationsLog.record(mutation({ id: 'm-1' }), 'permission-denied');
    const log = failedMutationsLog.getLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.reason).toBe('permission-denied');
    expect(log[0]!.mutation.id).toBe('m-1');
    expect(typeof log[0]!.failedAt).toBe('number');
  });

  it('birden fazla record() çağrısı eklenme sırasını korur (en yeni sonda)', () => {
    failedMutationsLog.record(mutation({ id: 'm-1' }), 'permission-denied');
    failedMutationsLog.record(mutation({ id: 'm-2' }), 'invalid-argument');
    const log = failedMutationsLog.getLog();
    expect(log.map(f => f.mutation.id)).toEqual(['m-1', 'm-2']);
  });

  it('dismiss(id) yalnızca belirtilen girdiyi kaldırır', () => {
    failedMutationsLog.record(mutation({ id: 'm-1' }), 'permission-denied');
    failedMutationsLog.record(mutation({ id: 'm-2' }), 'invalid-argument');
    const [first] = failedMutationsLog.getLog();
    failedMutationsLog.dismiss(first!.id);
    const remaining = failedMutationsLog.getLog();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.mutation.id).toBe('m-2');
  });

  it('clear() tüm günlüğü boşaltır', () => {
    failedMutationsLog.record(mutation({ id: 'm-1' }), 'permission-denied');
    failedMutationsLog.record(mutation({ id: 'm-2' }), 'invalid-argument');
    failedMutationsLog.clear();
    expect(failedMutationsLog.getLog()).toEqual([]);
  });

  it('günlük 30 girdiyi aştığında en eskiler düşürülür (sınırsız büyümeyi önler)', () => {
    for (let i = 0; i < 35; i++) {
      failedMutationsLog.record(mutation({ id: `m-${i}` }), 'permission-denied');
    }
    const log = failedMutationsLog.getLog();
    expect(log).toHaveLength(30);
    // İlk 5 (m-0..m-4) düşürülmüş olmalı, en yeni (m-34) hâlâ mevcut.
    expect(log.some(f => f.mutation.id === 'm-0')).toBe(false);
    expect(log[log.length - 1]!.mutation.id).toBe('m-34');
  });
});
