/**
 * useAppHandlers — Uygulama Seviyesi İş Mantığı Hook'u
 *
 * App.tsx içindeki tüm CRUD, durum geçiş ve yardımcı handler'ları
 * tek merkezde toplar. Offline-first kuyruğu, toast bildirimleri
 * ve Firestore operasyonlarını yönetir.
 *
 * Bağımlılıklar uiStore üzerinden okunur — prop drilling ortadan kalkar.
 */
import { useCallback } from 'react';
import { taskService } from './taskService';
import { userService } from './userService';
import { blockerService } from './blockerService';
import { notificationService } from './notificationService';
import type { ConflictContext } from './conflictDetectionService';
import { offlineQueue } from '../lib/offlineQueue';
import { getSLAConfigForPriority, calculateDeadline } from '../lib/sla';
import { useUIStore } from '../store/uiStore';
import { useSelectedTaskId, useTaskNavigation } from '../hooks/useTaskRoute';
import { STATUS_LABELS } from '../constants';
import type { Task, TaskStatus, TaskBlocker, TaskPriority, User, UserRole } from '../types';

/** Çakışma modalının "sizin değişikliğiniz" satırı için `updateTask`'a
 *  geçirilen kısmi güncellemeyi okunabilir bir özete çevirir — alan adlarının
 *  Türkçe karşılıkları TaskFormModal'daki etiketlerle eşleşir. */
const TASK_FIELD_LABELS: Partial<Record<keyof Task, string>> = {
  title: 'Başlık', description: 'Açıklama', assigneeId: 'Sorumlu', coordinatorId: 'İrtibatlı',
  departmentId: 'Birim', priority: 'Öncelik', deadline: 'Mühlet',
};
function summarizeTaskEdit(data: Partial<Task>): string {
  const labels = (Object.keys(data) as (keyof Task)[])
    .map(key => TASK_FIELD_LABELS[key])
    .filter((label): label is string => Boolean(label));
  return labels.length > 0 ? `${labels.join(', ')} alanlarını güncellemek` : 'Bu talimatı güncellemek';
}

// ─── Statü emoji haritası ─────────────────────────────────────────────────────
const STATUS_EMOJI: Partial<Record<TaskStatus, string>> = {
  COMPLETED:        '✅',
  IN_PROGRESS:      '🔄',
  BLOCKED:          '🚫',
  AWAITING_APPROVAL:'⏳',
  CRISIS:           '🚨',
  CANCELLED:        '🗑',
};

// ─── Tip tanımları ────────────────────────────────────────────────────────────
interface UseAppHandlersOptions {
  user: User | null;
  tasks: Task[];
  blockers: TaskBlocker[];
  onError: (err: unknown, op: string, path: string | null, conflictContext?: ConflictContext) => void;
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────
const isOfflineNow = () => typeof window !== 'undefined' && !window.navigator.onLine;

const tempId = () => 'temp_' + Math.random().toString(36).substring(2, 9);

// ─── Hook ────────────────────────────────────────────────────────────────────
export function useAppHandlers({
  user,
  tasks,
  blockers,
  onError,
}: UseAppHandlersOptions) {
  // Açık görev detayı artık uiStore'da değil URL'dedir (bkz. kod denetimi
  // P1-6) — silinen görev o an açıksa modalı kapatmak, `/tasks`'a
  // yönlendirmek demektir.
  const selectedTaskId = useSelectedTaskId();
  const { closeTask } = useTaskNavigation();

  // Selector bazlı okuma — whole-store `useUIStore()` kullanmak toasts/filter
  // gibi ilgisiz her alan değişiminde (ör. her toast eklenip 6sn sonra otomatik
  // kaldırıldığında) App.tsx'in gereksiz yere yeniden render olmasına yol
  // açıyordu. Action fonksiyonları zustand'da stabil referanslar olduğundan
  // selector ile alınmaları da re-render tetiklemez.
  const setIsCreateModalOpen = useUIStore(s => s.setIsCreateModalOpen);
  const setIsEditModalOpen = useUIStore(s => s.setIsEditModalOpen);
  const addToast = useUIStore(s => s.addToast);

  // Merkezi toast yardımcısı
  const toast = useCallback((
    title: string,
    body: string,
    type: 'info' | 'danger' | 'success' | 'warning' = 'success',
    taskId?: string
  ) => {
    addToast({ title, body, type, taskId });
  }, [addToast]);

  // ─── updateTaskStatus ────────────────────────────────────────────────────
  // `options.silent`: TaskBoard'un toplu durum değişikliği akışı (P2-18) bu
  // fonksiyonu bir Promise.allSettled DÖNGÜSÜNDE, N görev için art arda
  // çağırır — varsayılan davranış (her çağrıda ayrı bir başarı toast'ı VE
  // hata durumunda onError'ın kendi toast'ı) 15 görevlik bir toplu işlemde
  // 15 ayrı bildirime yol açardı. silent:true bu iki yan etkiyi bastırır VE
  // (varsayılandan farklı olarak) hatayı YUTMAZ, olduğu gibi fırlatır ki
  // çağıran Promise.allSettled ile gerçek başarı/başarısızlık sayısını
  // (ör. kaçının VERSION_MISMATCH olduğunu) doğru raporlayabilsin — aksi
  // halde bu fonksiyon hiçbir zaman reddetmediğinden toplu özet her zaman
  // "hepsi başarılı" görünürdü. Var olan tüm çağıranlar (TaskDetailsFooter
  // vb.) options geçmediği için mevcut davranış BİREBİR korunur.
  const updateTaskStatus = useCallback(async (
    taskId: string,
    newStatus: TaskStatus,
    evidence?: string,
    evidenceType?: Task['evidenceType'],
    options?: { silent?: boolean }
  ) => {
    if (!user) return;
    const oldTask = tasks.find(t => t.id === taskId);

    if (isOfflineNow()) {
      if (newStatus === 'BLOCKED') {
        const hasBlocker = blockers.some(b => b.taskId === taskId && !b.isResolved);
        if (!hasBlocker) {
          const bid = 'temp_blocker_' + Math.random().toString(36).substring(2, 9);
          // Engel oluşturma + görevi BLOCKED'a alma tek mutasyonda birleştirilir —
          // sync sırasında blockerService.addBlocker ile aynı transaction'da uygulanır.
          offlineQueue.enqueue(
            'blockers', 'create',
            { id: bid, taskId, reason: 'Hızlı kaydırma ile kriz bildirimi.', isResolved: false, createdAt: Date.now() },
            undefined, undefined,
            { taskId, newStatus: 'BLOCKED', userId: user.uid, expectedVersion: oldTask?.lockVersion }
          );
        } else {
          // statusTransition: pausedAt/totalPausedTime burada elle hesaplanmaz —
          // senkronda transitionTaskInTransaction, online ile birebir aynı mantıkla hesaplar.
          offlineQueue.enqueue(
            'tasks', 'update', undefined, taskId, undefined, undefined,
            { newStatus: 'BLOCKED', userId: user.uid, evidence, evidenceType, expectedVersion: oldTask?.lockVersion }
          );
        }
      } else {
        offlineQueue.enqueue(
          'tasks', 'update', undefined, taskId, undefined, undefined,
          { newStatus, userId: user.uid, evidence, evidenceType, expectedVersion: oldTask?.lockVersion }
        );
      }
      if (!options?.silent) {
        toast('🔄 Çevrimdışı Güncelleme', `Durum lokal kuyrukta güncellendi: ${STATUS_LABELS[newStatus] ?? newStatus}`, 'warning', taskId);
      }
      return;
    }

    try {
      if (newStatus === 'BLOCKED') {
        const hasBlocker = blockers.some(b => b.taskId === taskId && !b.isResolved);
        if (!hasBlocker) {
          // Kaydırma ile hızlı kriz bildirimi bir kullanıcı seçimi içermez —
          // "Yüksek" varsayılan ciddiyet, bu yolun bilinçli acil-durum niteliğini yansıtır.
          await blockerService.addBlocker(taskId, 'Hızlı kaydırma ile kriz bildirimi.', user.uid, oldTask?.lockVersion, 'High');
        } else {
          await taskService.updateTaskStatus(taskId, newStatus, oldTask?.status, user.uid, evidence, evidenceType, oldTask?.lockVersion);
        }
      } else {
        await taskService.updateTaskStatus(taskId, newStatus, oldTask?.status, user.uid, evidence, evidenceType, oldTask?.lockVersion);
      }
      if (!options?.silent) {
        addToast({
          title: `${STATUS_EMOJI[newStatus] ?? '📋'} Talimat Durumu Güncellendi`,
          body: `"${oldTask?.title?.slice(0, 40) ?? 'Talimat'}" → ${STATUS_LABELS[newStatus] ?? newStatus}`,
          type: newStatus === 'COMPLETED' ? 'success' : (newStatus === 'BLOCKED' || newStatus === 'CRISIS') ? 'danger' : 'info',
          taskId,
        });
      }
    } catch (err) {
      if (options?.silent) throw err;
      onError(err, 'update', `tasks/${taskId}`, {
        attemptedChangeSummary: `Durumu "${STATUS_LABELS[newStatus] ?? newStatus}" yapmak`,
        // Çakışma modalında "Benimkini Uygula" — taze lockVersion (tasks[]
        // artık çakışmaya neden olan sunucu yazımını onSnapshot ile almış
        // olmalı) ile AYNI hedef duruma yeniden dener.
        retry: () => { void updateTaskStatus(taskId, newStatus, evidence, evidenceType, options); },
      });
    }
  }, [user, tasks, blockers, toast, addToast, onError]);

  // ─── createTask ──────────────────────────────────────────────────────────
  const createTask = useCallback(async (data: Partial<Task>) => {
    if (!user) return;

    if (isOfflineNow()) {
      const id = tempId();
      const slaConfig = getSLAConfigForPriority(data.priority ?? 'Medium');
      const deadline = calculateDeadline(new Date(), slaConfig);
      // status/lockVersion/totalPausedTime/createdAt/updatedAt burada elle
      // ayarlanmaz — senkronda taskService.createTask, online ile BİREBİR AYNI
      // mantıkla (iş kuralı kontrolleri + audit_logs + system/stats artırımı
      // dahil) bunları kendisi hesaplar (bkz. offlineQueue.ts sync()).
      offlineQueue.enqueue(
        'tasks', 'create', { ...data, id, deadline },
        undefined, undefined, undefined, undefined,
        user.uid
      );
      setIsCreateModalOpen(false);
      toast('📋 Çevrimdışı Talimat', `"${data.title?.slice(0, 45)}" lokal sıraya alındı.`, 'warning', id);
      return;
    }

    try {
      await taskService.createTask(data, user.uid);
      setIsCreateModalOpen(false);
      toast('📋 Talimat Tanımlandı', `"${data.title?.slice(0, 50) ?? 'Yeni talimat'}" dizgeye işlendi.`, 'success');
    } catch (err) {
      onError(err, 'create', 'tasks');
    }
  }, [user, setIsCreateModalOpen, toast, onError]);

  // ─── updateTask ──────────────────────────────────────────────────────────
  // `options.silent`: updateTaskStatus'taki AYNI gerekçe (bkz. yukarısı) —
  // TaskBoard'un toplu atama akışı bu fonksiyonu bir döngüde N kez çağırır;
  // silent:true toast/onError yan etkilerini bastırıp hatayı fırlatır ki
  // Promise.allSettled gerçek başarı/başarısızlık sayısını görebilsin.
  // setIsEditModalOpen(false) de silent modda ATLANIR — bu çağrı Düzenle
  // modalından gelmiyor, kapatacak bir modal yok (ve modal başka bir
  // sebeple açıksa yanlışlıkla kapatılmamalı).
  const updateTask = useCallback(async (taskId: string, data: Partial<Task>, options?: { silent?: boolean }) => {
    if (!user) return;
    const oldTask = tasks.find(t => t.id === taskId);

    if (isOfflineNow()) {
      // actorId + oldTask: senkronda taskService.updateTask ile BİREBİR AYNI
      // mantıkla (Admin-koordinatör kısıtı + audit_logs kaydı dahil) uygulanır
      // (bkz. offlineQueue.ts sync()).
      offlineQueue.enqueue(
        'tasks', 'update', { ...data, updatedAt: Date.now() }, taskId, oldTask?.lockVersion,
        undefined, undefined, user.uid, oldTask
      );
      if (!options?.silent) {
        setIsEditModalOpen(false);
        toast('🔄 Çevrimdışı Güncelleme', 'Talimat düzenlemesi lokal sıraya alındı.', 'warning', taskId);
      }
      return;
    }

    try {
      if (!oldTask) throw new Error('Güncellenecek talimat bulunamadı.');
      await taskService.updateTask(taskId, data, oldTask, user.uid);
      if (!options?.silent) setIsEditModalOpen(false);
    } catch (err) {
      if (options?.silent) throw err;
      onError(err, 'update', `tasks/${taskId}`, {
        attemptedChangeSummary: summarizeTaskEdit(data),
        retry: () => { void updateTask(taskId, data, options); },
      });
    }
  }, [user, tasks, setIsEditModalOpen, toast, onError]);

  // ─── deleteTask ──────────────────────────────────────────────────────────
  const deleteTask = useCallback(async (taskId: string) => {
    if (!user) return;

    if (isOfflineNow()) {
      // Çok seviyeli alt-görev/engel temizliği — online taskService.deleteTask'taki
      // BFS mantığıyla aynı: yalnızca doğrudan alt görevler değil TÜM torun
      // görevler, ve yalnızca kökün değil HER seviyedeki görevin engelleri de
      // kuyruğa alınır (aksi halde offline silinen çok seviyeli bir hiyerarşide
      // torun görevler/engeller sunucuda yetim kalır — bkz. kod denetimi).
      const descendantIds: string[] = [];
      let frontier = [taskId];
      while (frontier.length > 0) {
        const children = tasks.filter(t => t.parentId && frontier.includes(t.parentId)).map(t => t.id);
        descendantIds.push(...children);
        frontier = children;
      }
      const allIds = [taskId, ...descendantIds];
      blockers.filter(b => allIds.includes(b.taskId)).forEach(b => offlineQueue.enqueue('blockers', 'delete', undefined, b.id));
      descendantIds.forEach(id => offlineQueue.enqueue('tasks', 'delete', undefined, id));
      offlineQueue.enqueue('tasks', 'delete', undefined, taskId);
      if (selectedTaskId === taskId) closeTask();
      toast('🗑 Çevrimdışı Silme', 'Talimat ve bağlı unsurları lokal kuyrukta silindi.', 'warning');
      return;
    }

    try {
      await taskService.deleteTask(taskId, user.uid);
      if (selectedTaskId === taskId) closeTask();
    } catch (err) {
      onError(err, 'delete', `tasks/${taskId}`);
    }
  }, [user, tasks, blockers, selectedTaskId, closeTask, toast, onError]);

  // ─── addBlocker ──────────────────────────────────────────────────────────
  const addBlocker = useCallback(async (taskId: string, reason: string, severity: TaskPriority = 'Medium') => {
    if (!user) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    if (isOfflineNow()) {
      const bid = 'temp_blocker_' + Math.random().toString(36).substring(2, 9);
      const now = Date.now();
      // Engel oluşturma + görevi BLOCKED'a alma tek mutasyonda birleştirilir —
      // sync sırasında blockerService.addBlocker ile aynı transaction'da uygulanır.
      offlineQueue.enqueue(
        'blockers', 'create',
        { id: bid, taskId, reason, severity, isResolved: false, createdAt: now },
        undefined, undefined,
        { taskId, newStatus: 'BLOCKED', userId: user.uid, expectedVersion: task.lockVersion }
      );
      toast('🚫 Çevrimdışı Risk Bildirimi', 'Gelişen kriz lokal sıraya eklendi.', 'warning', taskId);
      return;
    }

    try {
      await blockerService.addBlocker(taskId, reason, user.uid, task.lockVersion, severity);
    } catch (err) {
      // addBlocker HER ZAMAN transitionTaskInTransaction (görevi BLOCKED'a alma)
      // içerir — bir VERSION_MISMATCH burada aslında görevin lockVersion'ı
      // hakkındadır. path 'tasks/{taskId}' olarak verilir ki App.tsx'teki
      // handleFirestoreError bunu genel bir sistem hatası yerine "Düzenleme
      // Çakışması" olarak tanıyıp doğru toast'ı göstersin (bkz. kod denetimi:
      // eskiden 'blockers' path'i bu algılamayı hiç tetiklemiyordu).
      onError(err, 'create', `tasks/${taskId}`);
    }
  }, [user, tasks, toast, onError]);

  // ─── resolveBlocker ──────────────────────────────────────────────────────
  const resolveBlocker = useCallback(async (blockerId: string) => {
    if (!user) return;
    const blocker = blockers.find(b => b.id === blockerId);
    if (!blocker) return;

    if (isOfflineNow()) {
      const now = Date.now();
      const remaining = blockers.filter(b => b.taskId === blocker.taskId && b.id !== blockerId && !b.isResolved);
      if (remaining.length === 0) {
        // Son aktif engel çözülüyor: engel dokümanı + görevin IN_PROGRESS'e dönüşü
        // tek mutasyonda birleştirilir — sync sırasında aynı transaction'da uygulanır.
        const task = tasks.find(t => t.id === blocker.taskId);
        offlineQueue.enqueue(
          'blockers', 'update',
          { isResolved: true, resolvedAt: now },
          blockerId, undefined,
          { taskId: blocker.taskId, newStatus: 'IN_PROGRESS', userId: user.uid, expectedVersion: task?.lockVersion }
        );
      } else {
        offlineQueue.enqueue('blockers', 'update', { isResolved: true, resolvedAt: now }, blockerId);
      }
      toast('✅ Çevrimdışı Risk Çözüldü', 'Engel çözümü lokal sıraya alındı.', 'warning', blocker.taskId);
      return;
    }

    try {
      const taskBlockers = blockers.filter(b => b.taskId === blocker.taskId && !b.isResolved);
      const task = tasks.find(t => t.id === blocker.taskId);
      await blockerService.resolveBlocker(blockerId, blocker.taskId, taskBlockers.length - 1, user.uid, task?.lockVersion, task?.title);
    } catch (err) {
      // Son aktif engelse resolveBlocker de transitionTaskInTransaction
      // içerir (görevi IN_PROGRESS'e döndürme) — bkz. addBlocker'daki aynı
      // path-seçim gerekçesi (kod denetimi: conflictDetectionService'in
      // tasks/ dışı path'lerde hiç tetiklenmemesi sorunu).
      onError(err, 'update', `tasks/${blocker.taskId}`);
    }
  }, [user, blockers, tasks, toast, onError]);

  // ─── addComment ──────────────────────────────────────────────────────────
  const addComment = useCallback(async (taskId: string, text: string) => {
    if (!user) return;
    const task = tasks.find(t => t.id === taskId);

    if (isOfflineNow()) {
      if (task) {
        const tempComments = [...(task.comments || []), { userId: user.uid, text, timestamp: Date.now() }];
        offlineQueue.enqueue('tasks', 'update', { comments: tempComments, updatedAt: Date.now() }, taskId, task.lockVersion);
        toast('💬 Çevrimdışı Yorum', 'Şerh/yorum lokal sıraya eklendi.', 'warning', taskId);
      }
      return;
    }

    try {
      await taskService.addComment(taskId, user.uid, text, task?.lockVersion);
    } catch (err) {
      onError(err, 'update', `tasks/${taskId}/comments`);
    }
  }, [user, tasks, toast, onError]);

  // ─── delegateTask (izin/mazeret devri, Müdür → Müdür) ───────────────────
  const delegateTask = useCallback(async (taskId: string, newAssigneeId: string) => {
    if (!user) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    if (isOfflineNow()) {
      // statusTransition: pausedAt/totalPausedTime burada elle hesaplanmaz —
      // senkronda transitionTaskInTransaction, online ile birebir aynı mantıkla hesaplar.
      offlineQueue.enqueue(
        'tasks', 'update', undefined, taskId, undefined, undefined,
        { newStatus: 'PENDING_DELEGATION', userId: user.uid, assigneeId: newAssigneeId, expectedVersion: task.lockVersion }
      );
      toast('🔄 Çevrimdışı Devir', 'Talimat devri lokal sıraya alındı.', 'warning', taskId);
      return;
    }

    try {
      await taskService.delegateTask(taskId, newAssigneeId, user.uid, task.lockVersion);
      toast('🔄 Talimat Devredildi', 'Talimat başka bir müdüre devredildi.', 'info', taskId);
    } catch (err) {
      onError(err, 'update', `tasks/${taskId}`);
    }
  }, [user, tasks, toast, onError]);

  // ─── Kullanıcı yönetimi ──────────────────────────────────────────────────
  // Offline dallar userService'in online writeBatch (ana yazım + audit_logs)
  // atomikliğini offlineQueue.ts'teki withAuditLog mekanizmasıyla korur —
  // eskiden bu üç fonksiyon offline'ı hiç desteklemiyordu (bkz. kod denetimi).
  const addUser = useCallback(async (data: { email: string; fullName: string; role: UserRole; departmentId?: string }) => {
    if (!user) return;

    if (isOfflineNow()) {
      // userService.addUser ile AYNI deterministik doküman ID'si (e-posta) —
      // sync sırasında setDoc bu ID'ye yazar, addDoc gibi rastgele bir ID
      // ÜRETMEZ (bkz. offlineQueue.ts sync() 'set' dalı).
      const emailId = data.email.toLowerCase().trim();
      offlineQueue.enqueue(
        'users', 'set', { uid: emailId, ...data, email: emailId }, emailId,
        undefined, undefined, undefined, undefined, undefined,
        // logType: userService.addUser'daki online karşılığıyla BİREBİR aynı
        // olmalı — aksi halde aynı işlem çevrimiçi/çevrimdışı yapıldığında
        // denetim izinde farklı tipte görünürdü (bkz. taskService.auditLogType).
        { taskId: emailId, logType: 'STATUS', changedBy: user.uid, oldValue: 'Yok', newValue: `Personel Eklendi: ${data.fullName} (${data.role})` }
      );
      toast('👤 Çevrimdışı Personel Ekleme', `"${data.fullName}" lokal sıraya alındı.`, 'warning');
      return;
    }

    try { await userService.addUser(data, user.uid); }
    catch (err) { onError(err, 'create', 'users'); }
  }, [user, toast, onError]);

  const updateUserRole = useCallback(async (userId: string, data: Partial<User>) => {
    if (!user) return;

    if (isOfflineNow()) {
      offlineQueue.enqueue(
        'users', 'update', data, userId,
        undefined, undefined, undefined, undefined, undefined,
        {
          taskId: userId, logType: 'FIELD', changedBy: user.uid,
          oldValue: 'Personel Bilgisi', newValue: 'Personel Bilgisi Güncellendi',
          // userService.updateUser ile AYNI gerekçe: bu katmanda eski değerler
          // bilinmiyor, yalnızca HANGİ alanların değiştiği ve yeni değerleri
          // denetim izinde kalıcı olarak görünür (bkz. userService.ts).
          changes: (Object.keys(data) as (keyof User)[]).reduce((acc, key) => ({
            ...acc,
            [key]: { old: null, new: data[key] === undefined ? null : data[key] }
          }), {} as Record<string, { old: unknown; new: unknown }>)
        }
      );
      toast('🔄 Çevrimdışı Personel Güncelleme', 'Personel bilgisi lokal sıraya alındı.', 'warning');
      return;
    }

    try { await userService.updateUser(userId, data, user.uid); }
    catch (err) { onError(err, 'update', `users/${userId}`); }
  }, [user, toast, onError]);

  const deleteUser = useCallback(async (userId: string) => {
    if (!user) return;

    if (isOfflineNow()) {
      offlineQueue.enqueue(
        'users', 'delete', undefined, userId,
        undefined, undefined, undefined, undefined, undefined,
        { taskId: userId, logType: 'STATUS', changedBy: user.uid, oldValue: 'Aktif', newValue: 'Personel Silindi' }
      );
      toast('🗑 Çevrimdışı Personel Silme', 'Personel silme işlemi lokal sıraya alındı.', 'warning');
      return;
    }

    try { await userService.deleteUser(userId, user.uid); }
    catch (err) { onError(err, 'delete', `users/${userId}`); }
  }, [user, toast, onError]);

  // ─── Blocker yönetimi ────────────────────────────────────────────────────
  const updateBlocker = useCallback(async (blockerId: string, reason: string) => {
    if (!user) return;
    const blocker = blockers.find(b => b.id === blockerId);
    if (!blocker) return;
    // Denetim kaydına donacak görev başlığı (bkz. taskService.auditTaskTitle) —
    // blockerService görevi kendisi okumadığı için başlığı, görev listesini
    // zaten elinde tutan bu katman geçirir; hem online hem offline yolda AYNI
    // kayıt yazılsın diye iki dalda da kullanılır.
    const task = tasks.find(t => t.id === blocker.taskId);

    if (isOfflineNow()) {
      // blockerService.editBlocker ile AYNI atomiklik: offlineQueue.ts'teki
      // withAuditLog mekanizması, sync sırasında engel güncellemesi + audit_logs
      // kaydını tek writeBatch'te uygular (bkz. kod denetimi — eskiden bu
      // fonksiyon hiç offline desteklemiyordu).
      offlineQueue.enqueue(
        'blockers', 'update', { reason }, blockerId,
        undefined, undefined, undefined, undefined, undefined,
        { taskId: blocker.taskId, taskTitle: task?.title, logType: 'FIELD', changedBy: user.uid, oldValue: 'Risk Gerekçesi', newValue: reason }
      );
      toast('🔄 Çevrimdışı Risk Düzenleme', 'Risk gerekçesi lokal sıraya alındı.', 'warning', blocker.taskId);
      return;
    }

    try { await blockerService.editBlocker(blockerId, reason, user.uid, blocker.taskId, task?.title); }
    catch (err) { onError(err, 'update', `blockers/${blockerId}`); }
  }, [user, blockers, tasks, toast, onError]);

  const deleteBlocker = useCallback(async (blockerId: string) => {
    if (!user) return;
    if (user.role !== 'Admin') {
      // firestore.rules: blockers/{id} silme YALNIZCA Admin'e açık — diğer
      // koleksiyonlardaki "aynı departman Manager" istisnası burada YOK.
      // UI (BlockerList) zaten bu butonu isAdmin'e göre gizliyor; bu erken
      // dönüş, o kontrolü atlayan bir çağrı olursa sunucudan gelecek
      // anlaşılmaz bir permission-denied yerine net bir uyarı gösterir
      // (bkz. kod denetimi: client/rules rol asimetrisi).
      toast('⛔ Yetkisiz İşlem', 'Risk unsuru silme yalnızca Yöneticilere açıktır.', 'danger');
      return;
    }
    const blocker = blockers.find(b => b.id === blockerId);
    if (!blocker) return;

    const others = blockers.filter(b => b.taskId === blocker.taskId && b.id !== blockerId && !b.isResolved);
    const task = tasks.find(t => t.id === blocker.taskId);
    const isLastActiveBlocker = others.length === 0 && task?.status === 'BLOCKED';

    if (isOfflineNow()) {
      if (isLastActiveBlocker) {
        // Engel silme + görevin IN_PROGRESS'e dönmesi TEK mutasyonda birleştirilir —
        // sync sırasında blockerService.deleteBlocker ile aynı transaction'da uygulanır
        // (pausedAt/totalPausedTime transitionTaskInTransaction tarafından temizlenir;
        // ham bir 'update' mutasyonu kullanılırsa bu temizlik hiç çalışmaz ve SLA
        // sayacı kalıcı olarak "duraklatıldı" görünmeye devam eder).
        offlineQueue.enqueue(
          'blockers', 'delete', undefined, blockerId, undefined,
          { taskId: blocker.taskId, newStatus: 'IN_PROGRESS', userId: user.uid, expectedVersion: task?.lockVersion }
        );
      } else {
        offlineQueue.enqueue('blockers', 'delete', undefined, blockerId);
      }
      toast('🗑 Çevrimdışı Risk Silindi', 'Risk unsuru kaldırılması lokal sıraya eklendi.', 'warning', blocker.taskId);
      return;
    }

    try {
      // taskId/userId HER ZAMAN geçilir (son aktif engel olsun ya da olmasın)
      // — blockerService.deleteBlocker, otherActiveCount===0 değilse zaten
      // transaction'a girmiyor, sadece audit_logs yazımı için bu bilgiye
      // ihtiyaç duyuyor (bkz. kod denetimi: eskiden son-engel-olmayan dalda
      // hiç audit log yazılmıyordu).
      await blockerService.deleteBlocker(blockerId, blocker.taskId, others.length, user.uid, task?.lockVersion, task?.title);
    } catch (err) {
      // Son aktif engelse deleteBlocker de transitionTaskInTransaction içerir
      // (görevi IN_PROGRESS'e döndürme) — bkz. addBlocker'daki aynı path-seçim
      // gerekçesi. Son engel değilse VERSION_MISMATCH zaten hiç oluşamaz,
      // bu path seçimi o durumda zararsızdır.
      onError(err, 'delete', `tasks/${blocker.taskId}`);
    }
  }, [user, blockers, tasks, toast, onError]);

  // ─── Bildirim yönetimi ───────────────────────────────────────────────────
  // Bildirim koleksiyonunda audit_logs gerekmez (yalnızca isRead bayrağı) —
  // withAuditLog olmadan generic offlineQueue 'update' yolu yeterli (bkz. kod
  // denetimi: eskiden bu iki fonksiyon hiç offline desteklemiyordu).
  const markNotificationRead = useCallback(async (notificationId: string) => {
    if (!user) return;

    if (isOfflineNow()) {
      offlineQueue.enqueue('notifications', 'update', { isRead: true }, notificationId);
      return;
    }

    try { await notificationService.markAsRead(notificationId); }
    catch (err) { onError(err, 'update', `notifications/${notificationId}`); }
  }, [user, onError]);

  // notificationIds: panelde GERÇEKTEN gösterilmiş bildirimlerin id'leri —
  // sunucudan bağımsız bir "tümünü getir" sorgusu YAPILMAZ, aksi halde
  // kullanıcının hiç görmediği (ör. limit(5)'in dışında kalan eski bir Kriz
  // bildirimi) bir kayıt sessizce okundu işaretlenip kaybolabilir (bkz. kod
  // denetimi).
  const markAllNotificationsRead = useCallback(async (notificationIds: string[]) => {
    if (!user) return;

    if (isOfflineNow()) {
      // Kuyruk motoru mutasyon başına tek doküman işler — markManyAsRead'in
      // tek batch'i N ayrı offline mutasyona bölünür (deleteTask'ın çok
      // seviyeli engel/alt-görev temizliğindeki AYNI desen).
      notificationIds.forEach(id => offlineQueue.enqueue('notifications', 'update', { isRead: true }, id));
      if (notificationIds.length > 0) {
        toast('🔔 Çevrimdışı Bildirimler', 'Bildirimler okundu olarak lokal sıraya alındı.', 'warning');
      }
      return;
    }

    try { await notificationService.markManyAsRead(notificationIds); }
    catch (err) { onError(err, 'update', 'notifications'); }
  }, [user, toast, onError]);

  return {
    updateTaskStatus,
    createTask,
    updateTask,
    deleteTask,
    addBlocker,
    resolveBlocker,
    addComment,
    delegateTask,
    addUser,
    updateUserRole,
    deleteUser,
    updateBlocker,
    deleteBlocker,
    markNotificationRead,
    markAllNotificationsRead,
  };
}
