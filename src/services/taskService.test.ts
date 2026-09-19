import { describe, it, expect, beforeEach, vi } from 'vitest';
import { taskService, transitionTaskInTransaction } from './taskService';
import * as firebase from '../firebase';
import type { Task } from '../types';

let refCounter = 0;

function makeTransactionMock(taskData: Partial<Task> & { exists?: boolean }) {
  const update = vi.fn();
  const set = vi.fn();
  const get = vi.fn().mockResolvedValue({
    exists: () => taskData.exists !== false,
    data: () => taskData,
  });
  return { transaction: { get, update, set } as any, update, set, get };
}

describe('taskService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refCounter = 0;
    vi.mocked(firebase.doc).mockImplementation(() => ({ id: `ref-${++refCounter}` }) as any);
    vi.mocked(firebase.collection).mockImplementation((_db: any, name: string) => ({ __name: name }) as any);
    vi.mocked(firebase.increment).mockImplementation((n: number) => ({ __increment: n }) as any);
  });

  // ─── transitionTaskInTransaction — SLA / kilit / iş kuralı mantığı ─────────

  describe('transitionTaskInTransaction (görev geçişi çekirdek mantığı)', () => {
    it('lockVersion artırılır, audit log ve stats aynı transaction içinde yazılır', async () => {
      const { transaction, update, set } = makeTransactionMock({
        status: 'IN_PROGRESS', title: 'Denetim Hedefi', lockVersion: 2, totalPausedTime: 0, deadline: Date.now() + 100_000,
      });

      await transitionTaskInTransaction(transaction, 'task-1', 'COMPLETED', 'user-1', {});

      expect(update).toHaveBeenCalledOnce();
      const [, updateData] = update.mock.calls[0]!;
      expect(updateData).toMatchObject({ status: 'COMPLETED', lockVersion: 3 });
      expect(updateData.completedAt).toBeTypeOf('number');

      const auditCall = set.mock.calls.find(([, data]: any) => data?.changedBy === 'user-1');
      expect(auditCall?.[1]).toMatchObject({
        taskId: 'task-1', oldValue: 'IN_PROGRESS', newValue: 'COMPLETED',
        // Başlık kayda DONDURULARAK yazılır: denetim izi ekranı, görevin hâlâ
        // yüklü görev penceresinde olmasına bağlı kalmasın (bkz. P1-14).
        taskTitle: 'Denetim Hedefi',
        // Bu kayıt TANIM GEREĞİ bir durum geçişidir — aşağıdaki `changes.status`
        // diff'i geçişin DETAYIdır, tipi değil (bkz. taskService.auditLogType).
        logType: 'STATUS',
        changes: { status: { old: 'IN_PROGRESS', new: 'COMPLETED' } },
      });

      const statsCall = set.mock.calls.find(([, data]: any) => 'status_IN_PROGRESS' in (data ?? {}));
      expect(statsCall?.[1]).toMatchObject({
        status_IN_PROGRESS: { __increment: -1 },
        status_COMPLETED: { __increment: 1 },
      });
    });

    it('başlıksız (eski/bozuk) bir görev dokümanında audit kaydına taskTitle anahtarı HİÇ eklenmez', async () => {
      // Firestore `undefined` alan değeri kabul etmez — denormalize başlık
      // opsiyonel olduğundan, başlık yoksa anahtarın kendisi de payload'a
      // girmemeli; aksi halde başlıksız bir görevin HER geçişi yazma
      // hatasıyla tümden başarısız olurdu.
      const { transaction, set } = makeTransactionMock({
        status: 'IN_PROGRESS', lockVersion: 0, totalPausedTime: 0, deadline: Date.now() + 100_000,
      });

      await transitionTaskInTransaction(transaction, 'task-1', 'COMPLETED', 'user-1', {});

      const auditCall = set.mock.calls.find(call => 'changedBy' in (call[1] as object));
      expect(auditCall?.[1]).not.toHaveProperty('taskTitle');
    });

    it('durum geçişi kaydı `changes` TAŞISA BİLE logType STATUS yazılır (eski istemci tahmininin düzeltmesi)', async () => {
      // Bu, P2-22'nin özüdür: tip eskiden istemcide kaydın şeklinden tahmin
      // ediliyordu (`!log.changes && log.newValue !== undefined` → 'STATUS').
      // transitionTaskInTransaction hem `newValue` HEM `changes` yazdığı için
      // tahmin burada YANILIYOR ve gerçek durum geçişleri "İçerik
      // Güncellemeleri" filtresine düşüyordu. Tip artık şekilden değil, olayı
      // yazan kodun zaten bildiği bilgiden geliyor — bu testin kırılması, o
      // hatanın geri geldiği anlamına gelir.
      const { transaction, set } = makeTransactionMock({
        status: 'IN_PROGRESS', title: 'Denetim Hedefi', lockVersion: 0, totalPausedTime: 0, deadline: Date.now() + 100_000,
      });

      await transitionTaskInTransaction(transaction, 'task-1', 'COMPLETED', 'user-1', {});

      const auditCall = set.mock.calls.find(call => 'changedBy' in (call[1] as object));
      expect(auditCall?.[1]).toHaveProperty('changes');
      expect(auditCall?.[1].logType).toBe('STATUS');
    });

    it('BLOCKED durumuna geçişte pausedAt şimdiki zamana ayarlanır (SLA duraklatılır)', async () => {
      const { transaction, update } = makeTransactionMock({
        status: 'IN_PROGRESS', lockVersion: 0, totalPausedTime: 0, deadline: Date.now() + 100_000,
      });
      const before = Date.now();

      await transitionTaskInTransaction(transaction, 'task-1', 'BLOCKED', 'user-1', {});

      const [, updateData] = update.mock.calls[0]!;
      expect(updateData.pausedAt).toBeGreaterThanOrEqual(before);
      expect(updateData.pausedAt).toBeLessThanOrEqual(Date.now());
    });

    it('BLOCKED durumundan çıkışta duraklama süresi totalPausedTime\'a eklenir ve pausedAt sıfırlanır', async () => {
      const pausedAt = Date.now() - 5000;
      const { transaction, update } = makeTransactionMock({
        status: 'BLOCKED', lockVersion: 1, totalPausedTime: 1000, pausedAt, deadline: Date.now() + 100_000,
      });

      await transitionTaskInTransaction(transaction, 'task-1', 'IN_PROGRESS', 'user-1', {});

      const [, updateData] = update.mock.calls[0]!;
      expect(updateData.pausedAt).toBeNull();
      // 1000 (mevcut) + ~5000 (duraklama süresi) — küçük zamanlama toleransı
      expect(updateData.totalPausedTime).toBeGreaterThanOrEqual(1000 + 5000 - 50);
    });

    it('AWAITING_APPROVAL/PENDING_DELEGATION durumlarına geçişte de aynı şekilde duraklatılır', async () => {
      const { transaction, update } = makeTransactionMock({
        status: 'IN_PROGRESS', lockVersion: 0, totalPausedTime: 0, deadline: Date.now() + 100_000,
      });

      await transitionTaskInTransaction(transaction, 'task-1', 'PENDING_DELEGATION', 'user-1', {});

      const [, updateData] = update.mock.calls[0]!;
      expect(updateData.pausedAt).toBeTypeOf('number');
    });

    it('kriz döneminden IN_PROGRESS\'e dönüşte ihlal borcu + 24 saat totalPausedTime\'a eklenir', async () => {
      const now = Date.now();
      const deadline = now - 10_000; // 10 saniye önce geçmiş — görev kriz halinde
      const { transaction, update } = makeTransactionMock({
        status: 'IN_PROGRESS', lockVersion: 0, totalPausedTime: 0, deadline,
      });

      await transitionTaskInTransaction(transaction, 'task-1', 'IN_PROGRESS', 'user-1', {});

      const [, updateData] = update.mock.calls[0]!;
      // extraTime ≈ (now - deadline) + 24 saat ≈ 10.000ms + 86.400.000ms
      expect(updateData.totalPausedTime).toBeGreaterThan(24 * 60 * 60 * 1000);
    });

    it('deadline geçmemişse (kriz değilse) IN_PROGRESS\'e dönüş totalPausedTime\'ı etkilemez', async () => {
      const { transaction, update } = makeTransactionMock({
        status: 'ASSIGNED', lockVersion: 0, totalPausedTime: 0, deadline: Date.now() + 100_000,
      });

      await transitionTaskInTransaction(transaction, 'task-1', 'IN_PROGRESS', 'user-1', {});

      const [, updateData] = update.mock.calls[0]!;
      expect(updateData.totalPausedTime).toBe(0);
    });

    it('expectedVersion sunucu versiyonuyla uyuşmazsa VERSION_MISMATCH fırlatılır, hiçbir yazma yapılmaz', async () => {
      const { transaction, update, set } = makeTransactionMock({
        status: 'IN_PROGRESS', lockVersion: 5, totalPausedTime: 0, deadline: Date.now() + 100_000,
      });

      await expect(
        transitionTaskInTransaction(transaction, 'task-1', 'COMPLETED', 'user-1', { expectedVersion: 3 })
      ).rejects.toThrow(/VERSION_MISMATCH/);

      expect(update).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
    });

    it('görev bulunamazsa hata fırlatılır', async () => {
      const { transaction } = makeTransactionMock({ exists: false });

      await expect(
        transitionTaskInTransaction(transaction, 'missing-task', 'COMPLETED', 'user-1', {})
      ).rejects.toThrow('Task does not exist');
    });

    it('kanıt (evidence) verilirse güncelleme verisine eklenir', async () => {
      const { transaction, update } = makeTransactionMock({
        status: 'IN_PROGRESS', lockVersion: 0, totalPausedTime: 0, deadline: Date.now() + 100_000,
      });

      await transitionTaskInTransaction(transaction, 'task-1', 'AWAITING_APPROVAL', 'user-1', {
        evidence: 'https://ornek.com/kanit', evidenceType: 'Link',
      });

      const [, updateData] = update.mock.calls[0]!;
      expect(updateData).toMatchObject({ evidence: 'https://ornek.com/kanit', evidenceType: 'Link' });
    });

    it('yeni sorumlu (assigneeId) verilirse görev devri uygulanır', async () => {
      const { transaction, update } = makeTransactionMock({
        status: 'IN_PROGRESS', lockVersion: 0, totalPausedTime: 0, deadline: Date.now() + 100_000,
      });

      await transitionTaskInTransaction(transaction, 'task-1', 'PENDING_DELEGATION', 'user-1', {
        assigneeId: 'new-manager-uid',
      });

      const [, updateData] = update.mock.calls[0]!;
      expect(updateData.assigneeId).toBe('new-manager-uid');
    });

    it('isSystemEscalation OLMADAN BLOCKED -> CRISIS reddedilir (normal kullanıcı akışı)', async () => {
      const { transaction } = makeTransactionMock({
        status: 'BLOCKED', lockVersion: 0, totalPausedTime: 0, deadline: Date.now() + 100_000,
      });

      await expect(
        transitionTaskInTransaction(transaction, 'task-1', 'CRISIS', 'user-1', {})
      ).rejects.toThrow(/INVALID_TRANSITION/);
    });

    it('isSystemEscalation: true İLE BLOCKED -> CRISIS izinli olur (useStaleTaskEscalation istisnası)', async () => {
      const { transaction, update } = makeTransactionMock({
        status: 'BLOCKED', lockVersion: 1, totalPausedTime: 500, pausedAt: Date.now() - 2000, deadline: Date.now() + 100_000,
      });

      await transitionTaskInTransaction(transaction, 'task-1', 'CRISIS', 'admin-1', { isSystemEscalation: true });

      const [, updateData] = update.mock.calls[0]!;
      expect(updateData.status).toBe('CRISIS');
      // BLOCKED'dan çıkışın genel duraklama-kapatma mantığı (satır 137-144)
      // eskalasyonda da AYNEN çalışır — özel bir kod yolu gerekmez.
      expect(updateData.pausedAt).toBeNull();
      expect(updateData.totalPausedTime).toBeGreaterThan(500);
    });

    it('isSystemEscalation: true İLE bile ASSIGNED -> CRISIS reddedilir (istisna dar tutulur)', async () => {
      const { transaction } = makeTransactionMock({
        status: 'ASSIGNED', lockVersion: 0, totalPausedTime: 0, deadline: Date.now() + 100_000,
      });

      await expect(
        transitionTaskInTransaction(transaction, 'task-1', 'CRISIS', 'admin-1', { isSystemEscalation: true })
      ).rejects.toThrow(/INVALID_TRANSITION/);
    });
  });

  // ─── taskService.transitionTask / updateTaskStatus / delegateTask (public API) ──

  describe('taskService.transitionTask (retry sarmalayıcı üzerinden)', () => {
    it('runTransaction çağrısını transitionTaskInTransaction ile yapar', async () => {
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const { transaction } = makeTransactionMock({
          status: 'ASSIGNED', lockVersion: 0, totalPausedTime: 0, deadline: Date.now() + 100_000,
        });
        return fn(transaction);
      });

      await expect(taskService.transitionTask('task-1', 'IN_PROGRESS', 'user-1')).resolves.toBeDefined();
    });
  });

  describe('taskService.delegateTask', () => {
    it('yeni sorumluyu atar ve durumu PENDING_DELEGATION yapar (hedef Müdür ise)', async () => {
      vi.mocked(firebase.getDoc).mockResolvedValue({ exists: () => true, data: () => ({ role: 'Manager' }) } as any);
      let capturedTransaction: any;
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const mock = makeTransactionMock({
          status: 'IN_PROGRESS', lockVersion: 4, totalPausedTime: 0, deadline: Date.now() + 100_000,
        });
        capturedTransaction = mock;
        return fn(mock.transaction);
      });

      await taskService.delegateTask('task-1', 'manager-2', 'user-1', 4);

      const [, updateData] = capturedTransaction.update.mock.calls[0]!;
      expect(updateData).toMatchObject({ status: 'PENDING_DELEGATION', assigneeId: 'manager-2', lockVersion: 5 });
    });

    it('hedef kullanıcı Müdür değilse reddedilir, transaction hiç başlatılmaz', async () => {
      vi.mocked(firebase.getDoc).mockResolvedValue({ exists: () => true, data: () => ({ role: 'Staff' }) } as any);

      await expect(
        taskService.delegateTask('task-1', 'staff-1', 'user-1', 4)
      ).rejects.toThrow(/yalnızca Müdür rolündeki personele/);

      expect(firebase.runTransaction).not.toHaveBeenCalled();
    });

    it('hedef kullanıcı dokümanı bulunamazsa (henüz oluşmamış davet) devir engellenmez — nihai karar rules\'a bırakılır', async () => {
      vi.mocked(firebase.getDoc).mockResolvedValue({ exists: () => false, data: () => undefined } as any);
      let capturedTransaction: any;
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const mock = makeTransactionMock({
          status: 'IN_PROGRESS', lockVersion: 4, totalPausedTime: 0, deadline: Date.now() + 100_000,
        });
        capturedTransaction = mock;
        return fn(mock.transaction);
      });

      await taskService.delegateTask('task-1', 'unknown-user', 'user-1', 4);

      expect(capturedTransaction.update).toHaveBeenCalledOnce();
    });
  });

  // ─── createTask — iş kuralları ──────────────────────────────────────────────

  describe('createTask', () => {
    it('Admin rolündeki kullanıcı irtibatlı olarak atanamaz — transaction hiç başlatılmaz', async () => {
      vi.mocked(firebase.getDoc).mockResolvedValue({ exists: () => true, data: () => ({ role: 'Admin' }) } as any);

      await expect(
        taskService.createTask({ title: 'Test', coordinatorId: 'admin-uid' }, 'user-1')
      ).rejects.toThrow(/Admin rolündeki kullanıcı irtibatlı/);

      expect(firebase.runTransaction).not.toHaveBeenCalled();
    }, 10_000);

    it('alt talimat yalnızca Staff (memur) rolüne atanabilir — transaction hiç başlatılmaz', async () => {
      vi.mocked(firebase.getDoc).mockResolvedValue({ exists: () => true, data: () => ({ role: 'Manager' }) } as any);

      await expect(
        taskService.createTask({ title: 'Alt görev', parentId: 'parent-1', assigneeId: 'manager-uid' }, 'user-1')
      ).rejects.toThrow(/yalnızca Memur/);

      expect(firebase.runTransaction).not.toHaveBeenCalled();
    }, 10_000);

    it('başarılı oluşturmada görev + audit log + stats TEK transaction içinde atomik yazılır (çift-kayıt riskine karşı)', async () => {
      let capturedTransaction: any;
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const mock = makeTransactionMock({});
        capturedTransaction = mock;
        return fn(mock.transaction);
      });

      const id = await taskService.createTask({ title: 'Yeni Görev', priority: 'Medium' }, 'user-1');

      // taskRef, runTransaction'dan ÖNCE (transaction dışında) sabitlenir —
      // bu sayede bir runWithRetry tekrarı aynı dokümana idempotent yazar,
      // addDoc'un her seferinde yeni ID üretmesiyle oluşan çift-kayıt riski yok.
      expect(id).toBe('ref-1');

      const taskSetCall = capturedTransaction.set.mock.calls.find(([, data]: any) => data?.status === 'ASSIGNED');
      expect(taskSetCall?.[1]).toMatchObject({ id: 'ref-1', status: 'ASSIGNED', lockVersion: 0, totalPausedTime: 0 });

      const auditSetCall = capturedTransaction.set.mock.calls.find(([, data]: any) => data?.newValue === 'Talimat Oluşturuldu ve Atandı');
      // logType 'STATUS': görevin yaşam döngüsünün başlangıcı (→ ASSIGNED).
      expect(auditSetCall?.[1]).toMatchObject({ taskId: 'ref-1', changedBy: 'user-1', taskTitle: 'Yeni Görev', logType: 'STATUS' });

      const statsSetCall = capturedTransaction.set.mock.calls.find(([, data]: any) => 'status_ASSIGNED' in (data ?? {}));
      expect(statsSetCall?.[1]).toMatchObject({ totalTasks: { __increment: 1 }, status_ASSIGNED: { __increment: 1 } });
    });

    it('ağ hatası sonrası runWithRetry tekrar denediğinde AYNI taskRef ile yazar (idempotent, çift doküman oluşmaz)', async () => {
      let callCount = 0;
      let capturedTransaction: any;
      vi.mocked(firebase.runTransaction).mockImplementation(async (_db: any, fn: any) => {
        callCount++;
        if (callCount === 1) {
          // İlk deneme ağ hatasıyla başarısız olur.
          throw new Error('unavailable');
        }
        const mock = makeTransactionMock({});
        capturedTransaction = mock;
        return fn(mock.transaction);
      });

      const id = await taskService.createTask({ title: 'Tekrar Denenen Görev' }, 'user-1');

      expect(callCount).toBe(2);
      // taskRef, runWithRetry döngüsünün DIŞINDA yalnızca bir kez üretildi —
      // bu yüzden ilk deneme başarısız olsa da ikinci deneme aynı ID'yi
      // kullanıyor (addDoc kullanılsaydı her deneme yeni bir ID üretirdi).
      expect(id).toBe('ref-1');
      const taskSetCall = capturedTransaction.set.mock.calls.find(([, data]: any) => data?.status === 'ASSIGNED');
      expect(taskSetCall?.[1]).toMatchObject({ id: 'ref-1' });
    });
  });

  // ─── updateTask — versiyon kontrolü + alan bazlı diff ──────────────────────

  describe('updateTask', () => {
    it('Admin rolündeki kullanıcı irtibatlı olarak atanamaz', async () => {
      vi.mocked(firebase.getDoc).mockResolvedValue({ exists: () => true, data: () => ({ role: 'Admin' }) } as any);
      const oldTask = { id: 'task-1', status: 'IN_PROGRESS', lockVersion: 1 } as Task;

      await expect(
        taskService.updateTask('task-1', { coordinatorId: 'admin-uid' }, oldTask, 'user-1')
      ).rejects.toThrow(/Admin rolündeki kullanıcı irtibatlı/);
    }, 10_000);

    it('data.status geçersiz bir geçişse (durum makinesi ihlali) güncelleme reddedilir', async () => {
      // updateTaskInTransaction eskiden data.status'u hiç kontrol etmiyordu —
      // durum geçişleri her zaman transitionTaskInTransaction'dan gittiği için
      // bugüne kadar hiçbir çağıran bunu kötüye kullanmadı, ama kural kod
      // seviyesinde zorlanmıyordu (bkz. kod denetimi: savunma derinliği
      // kırılabilirdi).
      const { transaction, update } = makeTransactionMock({ status: 'COMPLETED', lockVersion: 3 });
      vi.mocked(firebase.runTransaction).mockImplementation(async (_db: any, fn: any) => fn(transaction));
      const oldTask = { id: 'task-1', status: 'COMPLETED', lockVersion: 3 } as Task;

      await expect(
        taskService.updateTask('task-1', { status: 'IN_PROGRESS' }, oldTask, 'user-1')
      ).rejects.toThrow(/INVALID_TRANSITION/);

      expect(update).not.toHaveBeenCalled();
    }, 10_000);

    it('data.status geçerli bir geçişse (ör. IN_PROGRESS→COMPLETED) güncelleme uygulanır', async () => {
      const { transaction, update } = makeTransactionMock({ status: 'IN_PROGRESS', lockVersion: 3 });
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => fn(transaction));
      const oldTask = { id: 'task-1', status: 'IN_PROGRESS', lockVersion: 3 } as Task;

      await taskService.updateTask('task-1', { status: 'COMPLETED' }, oldTask, 'user-1');

      expect(update).toHaveBeenCalledOnce();
    });

    it('sunucu versiyonu beklenenle uyuşmazsa güncelleme uygulanmaz', async () => {
      const { transaction, update } = makeTransactionMock({ status: 'IN_PROGRESS', lockVersion: 7 });
      vi.mocked(firebase.runTransaction).mockImplementation(async (_db: any, fn: any) => fn(transaction));
      const oldTask = { id: 'task-1', status: 'IN_PROGRESS', lockVersion: 2 } as Task;

      await expect(
        taskService.updateTask('task-1', { title: 'Güncel Başlık' }, oldTask, 'user-1')
      ).rejects.toThrow(/VERSION_MISMATCH/);

      expect(update).not.toHaveBeenCalled();
    }, 10_000);

    it('alan bazlı audit diff eski/yeni değerleri doğru eşler', async () => {
      const { transaction, set } = makeTransactionMock({ status: 'IN_PROGRESS', lockVersion: 3 });
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => fn(transaction));
      const oldTask = { id: 'task-1', status: 'IN_PROGRESS', lockVersion: 3, title: 'Eski Başlık' } as Task;

      await taskService.updateTask('task-1', { title: 'Yeni Başlık' }, oldTask, 'user-1');

      const auditCall = set.mock.calls.find(([, data]: any) => data?.changes?.title);
      expect(auditCall?.[1].changes.title).toEqual({ old: 'Eski Başlık', new: 'Yeni Başlık' });
      // Başlığın KENDİSİ değiştiğinde donan denormalize başlık YENİ başlıktır —
      // eski başlık zaten yukarıdaki diff'te korunuyor.
      expect(auditCall?.[1].taskTitle).toBe('Yeni Başlık');
    });

    it('başlık değişmeyen bir güncellemede audit kaydına sunucudaki mevcut başlık donar', async () => {
      const { transaction, set } = makeTransactionMock({ status: 'IN_PROGRESS', title: 'Mevcut Başlık', lockVersion: 3 });
      vi.mocked(firebase.runTransaction).mockImplementationOnce((_db, fn) => fn(transaction));
      const oldTask = { id: 'task-1', status: 'IN_PROGRESS', lockVersion: 3, description: 'eski' } as Task;

      await taskService.updateTask('task-1', { description: 'yeni' }, oldTask, 'user-1');

      const auditCall = set.mock.calls.find(call => 'changes' in (call[1] as object));
      expect(auditCall?.[1].taskTitle).toBe('Mevcut Başlık');
      // Durum-DIŞI genel güncelleme yolu — tek 'FIELD' üreten görev yazma
      // noktası budur (durum geçişleri transitionTaskInTransaction'dan gider).
      expect(auditCall?.[1].logType).toBe('FIELD');
    });

    it('durum değişikliği varsa stats deltası aynı transaction\'da yazılır, yoksa yazılmaz', async () => {
      const { transaction, set } = makeTransactionMock({ status: 'IN_PROGRESS', lockVersion: 1 });
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => fn(transaction));
      const oldTask = { id: 'task-1', status: 'IN_PROGRESS', lockVersion: 1 } as Task;

      await taskService.updateTask('task-1', { status: 'COMPLETED' }, oldTask, 'user-1');

      const statsCall = set.mock.calls.find(([, data]: any) => 'status_IN_PROGRESS' in (data ?? {}));
      expect(statsCall?.[1]).toMatchObject({
        status_IN_PROGRESS: { __increment: -1 },
        status_COMPLETED: { __increment: 1 },
      });
    });
  });

  // ─── addComment — versiyon kontrolü ─────────────────────────────────────────

  describe('addComment', () => {
    it('sunucu versiyonu uyuşmazsa yorum eklenmez', async () => {
      const { transaction, update } = makeTransactionMock({ lockVersion: 4, comments: [] });
      vi.mocked(firebase.runTransaction).mockImplementation(async (_db: any, fn: any) => fn(transaction));

      await expect(
        taskService.addComment('task-1', 'user-1', 'Merhaba', 2)
      ).rejects.toThrow(/VERSION_MISMATCH/);

      expect(update).not.toHaveBeenCalled();
    }, 10_000);

    it('yorum mevcut listeye eklenir ve lockVersion artırılır', async () => {
      const { transaction, update } = makeTransactionMock({ lockVersion: 4, comments: [{ userId: 'u0', text: 'ilk', timestamp: 1 }] });
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => fn(transaction));

      await taskService.addComment('task-1', 'user-1', 'Yeni yorum', 4);

      const [, updateData] = update.mock.calls[0]!;
      expect(updateData.lockVersion).toBe(5);
      expect(updateData.comments).toHaveLength(2);
      expect(updateData.comments[1]).toMatchObject({ userId: 'user-1', text: 'Yeni yorum' });
    });
  });

  // ─── deleteTask — kademeli silme + istatistik ───────────────────────────────

  describe('deleteTask', () => {
    it('görev yoksa hiçbir batch commit edilmez', async () => {
      vi.mocked(firebase.getDoc).mockResolvedValue({ exists: () => false } as any);
      vi.mocked(firebase.getDocs).mockResolvedValue({ docs: [] } as any);

      await taskService.deleteTask('missing-task', 'user-1');

      expect(firebase.writeBatch).not.toHaveBeenCalled();
    });

    it('alt görevi olmayan bir görev silindiğinde: görev + engeller silinir, audit log korunur, stats düşürülür', async () => {
      vi.mocked(firebase.getDoc)
        .mockResolvedValueOnce({
          exists: () => true,
          data: () => ({ status: 'IN_PROGRESS', title: 'Silinecek Görev' }),
        } as any) // rootSnap
        .mockResolvedValueOnce({ exists: () => false } as any); // deterministik silme-audit kaydı henüz yok
      // Alt görev sorgusu boş, engel sorgusu bir kayıt döner
      vi.mocked(firebase.getDocs)
        .mockResolvedValueOnce({ docs: [] } as any) // alt görevler
        .mockResolvedValueOnce({ docs: [{ ref: { id: 'blocker-1' } }] } as any); // engeller

      const batchDelete = vi.fn();
      const batchSet = vi.fn();
      const batchCommit = vi.fn().mockResolvedValue(undefined);
      vi.mocked(firebase.writeBatch).mockReturnValue({ delete: batchDelete, set: batchSet, commit: batchCommit } as any);

      await taskService.deleteTask('task-1', 'user-1');

      // Görev + 1 engel silindi
      expect(batchDelete).toHaveBeenCalledTimes(2);
      // Audit log SİLİNMEDİ, yeni bir "silindi" kaydı EKLENDİ (ayrı bir
      // "accounting" batch'te, silme işlemlerinden ÖNCE commit edilir)
      const auditSetCall = batchSet.mock.calls.find(([, data]: any) => data?.newValue === 'Silindi');
      expect(auditSetCall).toBeTruthy();
      // Silme kaydında başlık, görev SİLİNMEDEN ÖNCEKİ halidir — silinmiş bir
      // görev için görev listesi fallback'i zaten hiçbir zaman çözülemez, bu
      // yüzden denormalize başlık burada tek başlık kaynağıdır (bkz. P1-14).
      // logType 'STATUS': görevin yaşam döngüsünün SONU. transitionTask ile
      // aynı gerekçe — bu kayıt da `changes` taşır ama tipi bu değiştirmez.
      expect(auditSetCall?.[1]).toMatchObject({ taskTitle: 'Silinecek Görev', oldValue: 'Silinecek Görev', logType: 'STATUS' });
      // Stats: bu görevin durumu (IN_PROGRESS) için -1
      const statsSetCall = batchSet.mock.calls.find(([, data]: any) => 'status_IN_PROGRESS' in (data ?? {}));
      expect(statsSetCall?.[1]).toMatchObject({
        totalTasks: { __increment: -1 },
        status_IN_PROGRESS: { __increment: -1 },
      });
      // Accounting batch (audit+stats) + ana silme batch'i ayrı ayrı commit edilir
      expect(batchCommit).toHaveBeenCalledTimes(2);
    });
  });

  describe('taskService.escalateStaleTask (useStaleTaskEscalation)', () => {
    it('CRISIS\'e isSystemEscalation:true ile geçiş yapar (BLOCKED kaynaktan bile)', async () => {
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const { transaction, update } = makeTransactionMock({
          status: 'BLOCKED', lockVersion: 4, totalPausedTime: 0, deadline: Date.now() + 100_000,
        });
        const result = await fn(transaction);
        expect(update.mock.calls[0]![1]).toMatchObject({ status: 'CRISIS' });
        return result;
      });

      await taskService.escalateStaleTask('task-1', 'admin-1', 4);

      expect(firebase.runTransaction).toHaveBeenCalledOnce();
    });
  });

  describe('taskService.reconcileStats (Spark planı kalıcı mutabakat telafisi)', () => {
    const countSnap = (count: number) => ({ data: () => ({ count }) }) as any;

    it('sapma yoksa system/stats\'e yazmaz', async () => {
      // totalTasks=10, status_ASSIGNED=10, geri kalan status_X=0 — toplamla
      // tutarlı ve mevcut system/stats ile birebir aynı bir senaryo.
      vi.mocked(firebase.getCountFromServer)
        .mockResolvedValueOnce(countSnap(10)) // totalTasks
        .mockResolvedValueOnce(countSnap(10)) // status_ASSIGNED
        .mockResolvedValue(countSnap(0));      // kalan status_X sorguları
      vi.mocked(firebase.getDoc).mockResolvedValue({
        exists: () => true,
        data: () => ({
          totalTasks: 10, status_ASSIGNED: 10, status_PENDING_DELEGATION: 0, status_IN_PROGRESS: 0,
          status_BLOCKED: 0, status_AWAITING_APPROVAL: 0, status_COMPLETED: 0, status_CANCELLED: 0, status_CRISIS: 0,
        }),
      } as any);

      const result = await taskService.reconcileStats();

      expect(result.driftDetected).toBe(false);
      expect(firebase.setDoc).not.toHaveBeenCalled();
    });

    it('sapma varsa system/stats\'i yeniden hesaplanan değerlerle (set+merge) üzerine yazar', async () => {
      vi.mocked(firebase.getCountFromServer)
        .mockResolvedValueOnce(countSnap(5))  // totalTasks (gerçek)
        .mockResolvedValueOnce(countSnap(5))  // status_ASSIGNED (gerçek)
        .mockResolvedValue(countSnap(0));
      vi.mocked(firebase.getDoc).mockResolvedValue({
        exists: () => true,
        // Mevcut (sapmış) değer: totalTasks Firestore'daki gerçek sayıdan farklı
        data: () => ({ totalTasks: 7, status_ASSIGNED: 5 }),
      } as any);

      const result = await taskService.reconcileStats();

      expect(result.driftDetected).toBe(true);
      expect(result.reconciled).toMatchObject({ totalTasks: 5, status_ASSIGNED: 5 });
      expect(firebase.setDoc).toHaveBeenCalledOnce();
      const [, data, options] = vi.mocked(firebase.setDoc).mock.calls[0]!;
      expect(data).toMatchObject({ totalTasks: 5, status_ASSIGNED: 5 });
      expect(options).toMatchObject({ merge: true });
    });
  });
});
