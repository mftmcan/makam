import {
  db,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  addDoc,
  updateDoc,
  runTransaction,
  writeBatch,
  FirebaseError
} from '../firebase';
import { logger } from './logger';
import { conflictDetectionService } from '../services/conflictDetectionService';
import { useUIStore } from '../store/uiStore';
import { auditLogType, auditTaskTitle, transitionTaskInTransaction, updateTaskInTransaction, taskService } from '../services/taskService';
import type { AuditLogType, Task, TaskBlocker, TaskStatus, User } from '../types';

// Sunucu bu hata kodlarıyla reddettiğinde yeniden deneme sonucu asla değişmez
// (ör. firestore.rules'taki bir iş kuralı ihlali veya bozuk veri) — kuyrukta
// sonsuza dek tutmak yerine mutasyon düşürülür ve kullanıcı bilgilendirilir.
const NON_RETRYABLE_CODES = new Set(['permission-denied', 'invalid-argument']);

// taskStateMachine/taskService'in fırlattığı, DETERMİNİSTİK iş kuralı
// hataları — bir ağ hatası değildir, sync() kaç kez çalışırsa çalışsın
// sonuç asla değişmez. Genel/bilinmeyen `Error` mesajları (ör. geçici bir
// 'Network error') kasıtlı olarak bu listeye dahil EDİLMEZ ve retry'a devam
// eder — yalnızca kod tabanının kendi iş-kuralı hata imzaları tanınır.
const NON_RETRYABLE_MESSAGE_PATTERNS = [
  /^INVALID_TRANSITION:/,
  /Admin rolündeki kullanıcı irtibatlı/,
  /yalnızca Memur/,
  /yalnızca Müdür/,
];

/**
 * Bir senkron hatası yeniden denenirse sonucun değişip değişmeyeceğine karar
 * verir. `FirebaseError` (ağ/sunucu kaynaklı) ise yalnızca yukarıdaki bilinen
 * kalıcı kodlar non-retryable sayılır. Diğer (`FirebaseError` olmayan)
 * hatalarda mesaj, yukarıdaki bilinen iş-kuralı imzalarıyla eşleşiyorsa
 * (ör. `transitionTaskInTransaction`'ın fırlattığı `'INVALID_TRANSITION: ...'`)
 * yine non-retryable sayılır. Eskiden INVALID_TRANSITION `NON_RETRYABLE_CODES`
 * kapsamında olmadığından (FirebaseError değil) sonsuza dek `remaining`'e
 * itilip her `sync()` çağrısında sessizce yeniden deneniyordu — kullanıcıya
 * hiç bildirilmeyen bir "zombi mutasyon" haline geliyordu (bkz. kod denetimi).
 */
function isNonRetryableError(err: unknown): boolean {
  if (err instanceof FirebaseError) {
    return NON_RETRYABLE_CODES.has(err.code);
  }
  const msg = err instanceof Error ? err.message : String(err);
  return NON_RETRYABLE_MESSAGE_PATTERNS.some(p => p.test(msg));
}

export interface OfflineMutation {
  id: string;
  collectionName: string;
  docId?: string;
  action: 'create' | 'update' | 'delete' | 'set';
  data?: Record<string, unknown>;
  timestamp: number;
  /** 'tasks' 'update' mutasyonları için: kuyruğa alındığı andaki lockVersion.
   *  Senkronizasyonda sunucudaki güncel versiyonla karşılaştırılır — eşleşmezse
   *  görev çevrimdışıyken başkası tarafından değiştirilmiş demektir ve mutasyon
   *  sessizce üzerine yazmak yerine çakışma olarak işlenir. */
  expectedVersion?: number;
  /** 'blockers' create/update mutasyonları için: bu engel yazımıyla AYNI
   *  transaction'da uygulanması gereken görev durum geçişi (ör. yeni engel +
   *  görevi BLOCKED'a alma, ya da son engelin çözümü + görevi IN_PROGRESS'e
   *  döndürme). Online blockerService.addBlocker/resolveBlocker ile birebir
   *  aynı atomiklik garantisini çevrimdışı senkrona da taşır — biri başarısız
   *  olursa diğeri de uygulanmaz, sahipsiz engel/durum kaydı oluşmaz. */
  linkedTaskTransition?: {
    taskId: string;
    newStatus: TaskStatus;
    userId: string;
    expectedVersion?: number;
  };
  /** 'tasks' 'update' mutasyonları için: bu mutasyon aslında bir durum geçişidir
   *  (ör. IN_PROGRESS→COMPLETED, kriz kurtarma, devir). Senkronizasyonda ham
   *  transaction.update() yerine online yolla BİREBİR aynı transitionTaskInTransaction
   *  fonksiyonu çağrılır — böylece audit_logs kaydı, system/stats sayaçları ve
   *  kriz-affı (breach-debt + 24s mühlet uzatması) mantığı offline geçişlerde de
   *  uygulanır. pausedAt/totalPausedTime artık burada elle hesaplanmaz; hesaplama
   *  yalnızca transitionTaskInTransaction'da, senkron anında yapılır. */
  statusTransition?: {
    newStatus: TaskStatus;
    userId: string;
    evidence?: string;
    evidenceType?: Task['evidenceType'];
    assigneeId?: string;
    expectedVersion?: number;
  };
  /** 'tasks' 'create'/'update' (durum-dışı, business-kurallı) mutasyonları için:
   *  bu mutasyonu senkronda ham addDoc/updateDoc yerine online taskService.createTask/
   *  updateTaskInTransaction üzerinden — BİREBİR AYNI iş-kuralı (Admin-koordinatör/
   *  irtibatlı kısıtı, alt-talimat-yalnızca-Staff), audit_logs kaydı ve system/stats
   *  güncellemesiyle — uygulamak için gereken "değiştiren kullanıcı" kimliği.
   *  Verilmezse (eski/legacy kuyruk öğeleri) ham addDoc/updateDoc'a düşülür. */
  actorId?: string;
  /** 'tasks' 'update' + actorId mutasyonları için: enqueue anındaki görev anlık
   *  görüntüsü — audit-log diff'inin "eski değer" tabanı olarak kullanılır
   *  (online updateTask'taki oldTask parametresiyle aynı rol). */
  oldTaskSnapshot?: Task;
  /** HERHANGİ bir koleksiyonun 'set'/'update'/'delete' mutasyonu için: bu
   *  yazımla AYNI writeBatch'te bir audit_logs kaydı da oluşturulmalı —
   *  userService.addUser/updateUser/deleteUser ve blockerService.editBlocker
   *  online yolda BİREBİR bunu yapıyor (bkz. userService.ts/blockerService.ts).
   *  Bu alan olmadan sync() generic setDoc/updateDoc/deleteDoc'a düşer ve
   *  audit_logs'u sessizce atlar — offline yapılan bir kullanıcı-yönetimi/
   *  risk-düzenleme işlemi hiç iz bırakmadan uygulanmış olurdu (bkz. kod
   *  denetimi). `taskId` alanı audit_logs şemasının zorunlu alanıdır; görev-dışı
   *  senaryolarda (ör. kullanıcı yönetimi) etkilenen varlığın id'sini taşır —
   *  bkz. userService.ts'teki userAuditLogRef yorumu, AYNI ilke.
   */
  withAuditLog?: {
    taskId: string;
    /** Kaydın yazıldığı andaki görev başlığının donmuş kopyası — online
     *  yoldaki blockerService.editBlocker ile PARİTE (bkz.
     *  taskService.auditTaskTitle). Görev-dışı senaryolarda (kullanıcı
     *  yönetimi) verilmez ve alan hiç yazılmaz. */
    taskTitle?: string;
    /** Kaydın işlem tipi — online yoldaki karşılığıyla (userService.addUser/
     *  updateUser/deleteUser, blockerService.editBlocker) BİREBİR AYNI değer
     *  olmalıdır, aksi halde aynı işlem çevrimiçi/çevrimdışı yapıldığında
     *  denetim izinde FARKLI tipte görünür ve "İşlem Tipi" filtresi tutarsız
     *  sonuç verir (bkz. taskService.auditLogType). Tek bir genel değer
     *  gömülemez: bu kuyruk hem durum olaylarını (personel ekleme/silme) hem
     *  içerik güncellemelerini (personel bilgisi, risk gerekçesi) taşır. */
    logType?: AuditLogType;
    changedBy: string;
    oldValue: string;
    newValue: string;
    changes?: Record<string, { old: unknown; new: unknown }>;
  };
}

/**
 * Bir koleksiyonun taban listesine (Firestore'dan gelen) bekleyen offline
 * mutasyonları uygular — App.tsx'teki türetilmiş tasks/blockers state'i bu
 * fonksiyonu kullanır. Aynı if/else if yapısı eskiden App.tsx içinde tasks
 * ve blockers için ayrı ayrı, neredeyse birebir kopyalanmıştı (bkz. kod
 * denetimi) — üçüncü bir offline-senkronlu koleksiyon eklendiğinde artık
 * bu desen tekrar elle kopyalanmak zorunda değil.
 */
export function applyOfflineMutations<T extends { id: string }>(
  base: T[],
  mutations: OfflineMutation[],
  collectionName: string
): T[] {
  let result = [...base];
  mutations.forEach(mutation => {
    if (mutation.collectionName !== collectionName) return;
    if (mutation.action === 'create') {
      if (!result.some(item => item.id === mutation.data?.id)) result.push(mutation.data as T);
    } else if (mutation.action === 'update' || mutation.action === 'set') {
      const idx = result.findIndex(item => item.id === mutation.docId);
      if (idx !== -1) result[idx] = { ...result[idx], ...(mutation.data as Partial<T>) } as T;
    } else if (mutation.action === 'delete') {
      result = result.filter(item => item.id !== mutation.docId);
    }
  });
  return result;
}

const QUEUE_KEY = 'makam_offline_mutations';
const FAILED_LOG_KEY = 'makam_offline_failed_mutations';
// Sınırsız büyümeyi önler — bu bir denetim izi değil, kullanıcının "az önce ne
// reddedildi"yi görebileceği kısa vadeli bir bildirim listesidir (kalıcı/
// resmî kayıt zaten audit_logs'tadır, bkz. auditLogType).
const FAILED_LOG_MAX = 30;

/** Bir mutasyon sunucu tarafından KALICI olarak reddedildiğinde (bkz.
 *  isNonRetryableError) kuyruktan düşürülür ve burada, tek seferlik bir
 *  toast'un aksine kullanıcı OfflineBanner'ı ne zaman açarsa açsın görebileceği
 *  şekilde localStorage'a yazılır (bkz. tasarım denetimi 3.3: eskiden yalnızca
 *  geçici bir toast vardı, kullanıcı toast'ı kaçırırsa NEYİN uygulanmadığını
 *  bir daha asla göremiyordu). */
export interface FailedMutation {
  id: string;
  mutation: OfflineMutation;
  /** FirebaseError ise .code, değilse ham hata mesajı — OfflineBanner bunu
   *  kullanıcıya göstermeden önce insan-okunur bir karşılığa çevirir. */
  reason: string;
  failedAt: number;
}

export const failedMutationsLog = {
  getLog(): FailedMutation[] {
    try {
      const data = localStorage.getItem(FAILED_LOG_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      logger.error('Failed to parse failed-mutations log:', e);
      return [];
    }
  },

  saveLog(log: FailedMutation[]) {
    try {
      localStorage.setItem(FAILED_LOG_KEY, JSON.stringify(log));
      window.dispatchEvent(new CustomEvent('makam_failed_log_changed'));
    } catch (e) {
      logger.error('Failed to save failed-mutations log:', e);
    }
  },

  record(mutation: OfflineMutation, reason: string) {
    const log = this.getLog();
    log.push({ id: crypto.randomUUID(), mutation, reason, failedAt: Date.now() });
    // En eskiyi düşür — FIFO, en yeni reddedilenler her zaman görünür kalır.
    while (log.length > FAILED_LOG_MAX) log.shift();
    this.saveLog(log);
  },

  dismiss(id: string) {
    this.saveLog(this.getLog().filter(f => f.id !== id));
  },

  clear() {
    this.saveLog([]);
  },
};

let isSyncing = false;

/**
 * Aynı offline oturumda bir görevi hedefleyen birden fazla FARKLI TÜR mutasyon
 * (düz update, statusTransition, linkedTaskTransition) kuyruğa alındığında
 * hepsi enqueue anındaki AYNI eski lockVersion'ı taşır. Sync sırasıyla
 * işlendiği için, bir görev mutasyonu başarıyla sunucu lockVersion'ını
 * artırdığında bu artık kuyruktaki AYNI görevi hedefleyen SONRAKİ
 * mutasyonların expectedVersion'ını da güncelliyoruz — aksi halde ikinci
 * mutasyon artık eskimiş bir versiyonla sahte VERSION_MISMATCH alıp
 * retry'sız kalıcı olarak düşürülür. Bu, aşağıdaki tempId remapping ile
 * aynı "ileriye bak ve kuyruktaki bekleyen öğeleri yamalayarak" deseni izler.
 */
function propagateVersionBump(
  workingQueue: OfflineMutation[],
  fromIndex: number,
  taskId: string,
  newVersion: number
) {
  for (let j = fromIndex + 1; j < workingQueue.length; j++) {
    const item = workingQueue[j]!;
    if (item.collectionName === 'tasks' && item.docId === taskId) {
      if (item.statusTransition) {
        item.statusTransition.expectedVersion = newVersion;
      } else if (item.expectedVersion !== undefined) {
        item.expectedVersion = newVersion;
      }
    }
    if (item.collectionName === 'blockers' && item.linkedTaskTransition?.taskId === taskId) {
      item.linkedTaskTransition.expectedVersion = newVersion;
    }
  }
}

/**
 * `withAuditLog` taşıyan bir mutasyonun ana yazımını (mainWrite) ve buna
 * bağlı audit_logs kaydını TEK writeBatch'te atomik olarak uygular —
 * userService.addUser/updateUser/deleteUser ve blockerService.editBlocker'ın
 * online yolda yaptığı writeBatch'in senkron karşılığı (bkz. OfflineMutation.
 * withAuditLog yorumu).
 */
async function writeWithAuditLog(
  mainWrite: (batch: ReturnType<typeof writeBatch>) => void,
  auditLog: NonNullable<OfflineMutation['withAuditLog']>
) {
  const batch = writeBatch(db);
  mainWrite(batch);
  batch.set(doc(collection(db, 'audit_logs')), {
    taskId: auditLog.taskId,
    ...auditTaskTitle(auditLog.taskTitle),
    ...auditLogType(auditLog.logType),
    changedBy: auditLog.changedBy,
    oldValue: auditLog.oldValue,
    newValue: auditLog.newValue,
    timestamp: Date.now(),
    ...(auditLog.changes ? { changes: auditLog.changes } : {}),
  });
  await batch.commit();
}

/**
 * Bir 'create' mutasyonu sunucuda gerçek bir ID aldığında, kuyrukta ondan
 * SONRA gelen ve enqueue anında geçici (temp) ID'yi referans alan öğeleri
 * (docId veya data içindeki herhangi bir alan) gerçek ID ile yamalar. Hem
 * generic addDoc yolunda hem taskService.createTask yolunda kullanılır.
 */
function remapTempId(workingQueue: OfflineMutation[], fromIndex: number, tempIdValue: string | undefined, realId: string | undefined) {
  if (!tempIdValue || !realId || tempIdValue === realId) return;
  logger.debug(`[Offline Queue] Remapping ${tempIdValue} -> ${realId}`);
  for (let j = fromIndex + 1; j < workingQueue.length; j++) {
    const item = workingQueue[j]!;
    if (item.docId === tempIdValue) item.docId = realId;
    if (item.data && typeof item.data === 'object') {
      for (const key of Object.keys(item.data)) {
        if (item.data[key] === tempIdValue) item.data[key] = realId;
      }
    }
  }
}

export const offlineQueue = {
  getQueue(): OfflineMutation[] {
    try {
      const data = localStorage.getItem(QUEUE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      logger.error('Failed to parse offline mutations queue:', e);
      return [];
    }
  },

  saveQueue(queue: OfflineMutation[]) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      // Trigger a custom event to update the UI banner
      window.dispatchEvent(new CustomEvent('makam_queue_changed'));
    } catch (e) {
      logger.error('Failed to save offline mutations queue:', e);
    }
  },

  enqueue(
    collectionName: string,
    action: OfflineMutation['action'],
    data?: Record<string, unknown>,
    docId?: string,
    expectedVersion?: number,
    linkedTaskTransition?: OfflineMutation['linkedTaskTransition'],
    statusTransition?: OfflineMutation['statusTransition'],
    actorId?: string,
    oldTaskSnapshot?: Task,
    withAuditLog?: OfflineMutation['withAuditLog']
  ) {
    const queue = this.getQueue();

    // Aynı doküman için kuyrukta zaten bekleyen bir 'update' varsa yeni veriyi
    // onun üzerine birleştir. Firestore updateDoc zaten alan bazlı kısmi
    // güncelleme yaptığından, N ayrı sıralı update yerine tek birleşik update
    // göndermek davranışsal olarak eşdeğerdir (son değer kazanır) — kuyruk
    // şişmesini ve senkronda gereksiz yazma sayısını azaltır. linkedTaskTransition
    // taşıyan mutasyonlar (blocker+görev atomik çifti), statusTransition taşıyan
    // mutasyonlar (durum geçişleri) ve withAuditLog taşıyan mutasyonlar (her biri
    // KENDİ oldValue/newValue audit mesajını taşır — iki farklı düzenlemeyi
    // birleştirmek yanıltıcı/eksik bir tek audit kaydı üretir) birleştirilmez.
    if (action === 'update' && docId && !linkedTaskTransition && !statusTransition && !withAuditLog) {
      const existing = queue.find(m =>
        m.action === 'update' &&
        m.collectionName === collectionName &&
        m.docId === docId &&
        !m.linkedTaskTransition &&
        !m.statusTransition &&
        !m.withAuditLog
      );
      if (existing) {
        existing.data = { ...existing.data, ...data };
        existing.timestamp = Date.now();
        if (existing.expectedVersion === undefined) existing.expectedVersion = expectedVersion;
        if (existing.actorId === undefined) existing.actorId = actorId;
        if (existing.oldTaskSnapshot === undefined) existing.oldTaskSnapshot = oldTaskSnapshot;
        this.saveQueue(queue);
        logger.debug(`[Offline Queue] Coalesced update mutation for ${collectionName}/${docId}`);
        return;
      }
    }

    const mutation: OfflineMutation = {
      // crypto.randomUUID() — Math.random() tabanlı önceki ID kriptografik
      // olmayan, düşük-entropili bir üreteçti (bkz. kod denetimi). Bu ID
      // yalnızca yerel kuyruk içi eşleştirme için kullanıldığından pratik
      // risk düşüktü, ama proje genelinde (TaskDetails checklist) zaten
      // kullanılan standart deseple tutarlı hale getirildi.
      id: crypto.randomUUID(),
      collectionName,
      docId,
      action,
      data,
      timestamp: Date.now(),
      expectedVersion,
      linkedTaskTransition,
      statusTransition,
      actorId,
      oldTaskSnapshot,
      withAuditLog
    };
    queue.push(mutation);
    this.saveQueue(queue);
    logger.debug(`[Offline Queue] Enqueued mutation: ${action} on ${collectionName}`);
  },

  async sync(): Promise<boolean> {
    if (isSyncing) {
      logger.debug('[Offline Queue] Sync already in progress. Skipping execution to prevent race conditions.');
      return false;
    }

    if (typeof window !== 'undefined' && !window.navigator.onLine) {
      logger.debug('[Offline Queue] Sync skipped: Browser is offline.');
      return false;
    }

    const queue = this.getQueue();
    if (queue.length === 0) return true;

    isSyncing = true;
    logger.debug(`[Offline Queue] Starting sync for ${queue.length} mutations...`);

    const idsToSync = queue.map(m => m.id);

    // Working copy — mutasyonlar (ID remapping) bu kopya uzerinde yapilir
    const workingQueue: OfflineMutation[] = queue.map(m => ({
      ...m,
      data: m.data ? { ...m.data } : m.data
    }));
    const remaining: OfflineMutation[] = [];

    // Her mutasyon işlendikçe kuyruğu HEMEN localStorage'a yazar (yalnızca
    // döngü sonunda değil). Önceden yalnızca döngü bittiğinde tek bir
    // `saveQueue` çağrısı vardı — sekme kapanırsa/cihaz uykuya geçerse/JS
    // çökerse, sunucuda zaten başarıyla uygulanmış `create` mutasyonları
    // localStorage'dan hiç silinmemiş olurdu ve bir sonraki açılışta TÜM
    // kuyruk yeniden oynatılırdı; `create` yolu her çağrıda yeni bir doküman
    // ID'si ürettiğinden bu, sunucuda ÇİFT görev/doküman oluşturuyordu (bkz.
    // kod denetimi). `workingQueue.slice(i + 1)`, henüz denenmemiş öğeleri
    // (varsa ID remapping ile güncellenmiş halleriyle) korur.
    const persistProgress = (processedThroughIndex: number) => {
      const currentQueue = this.getQueue();
      const merged = [
        ...remaining,
        ...workingQueue.slice(processedThroughIndex + 1),
        ...currentQueue.filter(item => !idsToSync.includes(item.id))
      ];
      this.saveQueue(merged);
    };

    try {
      for (let i = 0; i < workingQueue.length; i++) {
        const mutation = workingQueue[i]!;
        let hadConflict = false;
        try {
          switch (mutation.action) {
            case 'create': {
              if (mutation.collectionName === 'blockers' && mutation.linkedTaskTransition) {
                const { taskId, newStatus, userId, expectedVersion } = mutation.linkedTaskTransition;
                // Rastgele Firestore ID üretmek yerine kuyruğa alınırken atanan geçici
                // ID'yi (mutation.data.id) doğrudan kalıcı doküman ID'si olarak kullan —
                // aksi halde bu engeli hemen ardından referans alan sonraki mutasyonlar
                // (ör. aynı oturumda çözme) sunucuda var olmayan bir ID'ye yazmaya çalışır.
                const blockerRef = doc(db, 'blockers', mutation.data!.id as string);
                try {
                  const prevTask = await runTransaction(db, async (transaction) => {
                    const t = await transitionTaskInTransaction(transaction, taskId, newStatus, userId, { expectedVersion, timestampOverride: mutation.timestamp });
                    transaction.set(blockerRef, { ...mutation.data, id: blockerRef.id });
                    return t;
                  });
                  propagateVersionBump(workingQueue, i, taskId, (prevTask.lockVersion || 0) + 1);
                } catch (transitionErr) {
                  if (conflictDetectionService.detectConflict(transitionErr, taskId, 'Talimat', expectedVersion ?? 0)) {
                    hadConflict = true;
                    break;
                  }
                  throw transitionErr;
                }
                break;
              }
              if (mutation.collectionName === 'tasks' && mutation.actorId) {
                // Business-kurallı oluşturma — online taskService.createTask ile aynı
                // yoldan: Admin-koordinatör/irtibatlı ve alt-talimat-yalnızca-Staff
                // kısıtları, audit_logs kaydı ve system/stats artırımı offline
                // oluşturmada da uygulanır (bkz. taskService.ts).
                const newTaskId = await taskService.createTask(mutation.data as Partial<Task>, mutation.actorId, { timestampOverride: mutation.timestamp });
                remapTempId(workingQueue, i, mutation.data?.id as string | undefined, newTaskId);
                break;
              }
              const docRef = await addDoc(collection(db, mutation.collectionName), {
                ...mutation.data,
                createdAt: mutation.data?.createdAt || mutation.timestamp,
                updatedAt: Date.now()
              });
              await updateDoc(docRef, { id: docRef.id });

              // Sonraki kuyruk ogelerinde gecici ID'leri kalici Firestore ID'siyle eslestir.
              // Belirli alan adlarını (id/taskId/parentId/...) sabit kodlamak yerine data
              // nesnesindeki HER alanı tarar — yeni bir referans alanı (ör. relatedTaskId)
              // eklendiğinde bu mantığın ayrıca güncellenmesi gerekmez.
              remapTempId(workingQueue, i, mutation.data?.id as string | undefined, docRef.id);
              break;
            }
            case 'set':
              if (mutation.docId) {
                if (mutation.withAuditLog) {
                  // userService.addUser online yolda merge YAPMADAN tam bir
                  // doküman yazar (yeni personel kaydı) — merge:true kullanılsaydı
                  // aynı e-postayla önceden silinmiş bir kullanıcının eski
                  // alanları (ör. eski rolü) yeni kayıtta sessizce hayatta kalabilirdi.
                  await writeWithAuditLog(
                    (batch) => batch.set(doc(db, mutation.collectionName, mutation.docId!), mutation.data),
                    mutation.withAuditLog
                  );
                } else {
                  await setDoc(doc(db, mutation.collectionName, mutation.docId), mutation.data, { merge: true });
                }
              }
              break;
            case 'update':
              if (mutation.docId) {
                if (mutation.collectionName === 'blockers' && mutation.linkedTaskTransition) {
                  const { taskId, newStatus, userId, expectedVersion } = mutation.linkedTaskTransition;
                  const blockerRef = doc(db, 'blockers', mutation.docId);
                  try {
                    const prevTask = await runTransaction(db, async (transaction) => {
                      const t = await transitionTaskInTransaction(transaction, taskId, newStatus, userId, { expectedVersion, timestampOverride: mutation.timestamp });
                      transaction.update(blockerRef, { ...mutation.data } as Partial<TaskBlocker>);
                      return t;
                    });
                    propagateVersionBump(workingQueue, i, taskId, (prevTask.lockVersion || 0) + 1);
                  } catch (transitionErr) {
                    if (conflictDetectionService.detectConflict(transitionErr, taskId, 'Talimat', expectedVersion ?? 0)) {
                      hadConflict = true;
                      break;
                    }
                    throw transitionErr;
                  }
                } else if (mutation.collectionName === 'tasks' && mutation.statusTransition) {
                  const { newStatus, userId, evidence, evidenceType, assigneeId, expectedVersion } = mutation.statusTransition;
                  try {
                    const prevTask = await runTransaction(db, async (transaction) =>
                      transitionTaskInTransaction(transaction, mutation.docId!, newStatus, userId, {
                        evidence, evidenceType, assigneeId, expectedVersion, timestampOverride: mutation.timestamp
                      })
                    );
                    propagateVersionBump(workingQueue, i, mutation.docId!, (prevTask.lockVersion || 0) + 1);
                  } catch (transitionErr) {
                    if (conflictDetectionService.detectConflict(transitionErr, mutation.docId!, 'Talimat', expectedVersion ?? 0)) {
                      hadConflict = true;
                      break;
                    }
                    throw transitionErr;
                  }
                } else if (mutation.collectionName === 'tasks' && mutation.actorId) {
                  // Business-kurallı genel güncelleme — online taskService.updateTask
                  // ile aynı çekirdek mantık (updateTaskInTransaction) üzerinden:
                  // Admin-koordinatör kısıtı, audit_logs kaydı ve (durum alanı
                  // varsa) stats deltası offline'da da uygulanır.
                  if (mutation.data?.coordinatorId) {
                    const coordSnap = await getDoc(doc(db, 'users', mutation.data.coordinatorId as string));
                    if (coordSnap.exists() && (coordSnap.data() as User).role === 'Admin') {
                      throw new Error('Admin rolündeki kullanıcı irtibatlı olarak atanamaz.');
                    }
                  }
                  const oldTaskForDiff = mutation.oldTaskSnapshot ?? ({ lockVersion: mutation.expectedVersion } as Task);
                  try {
                    const prevTask = await runTransaction(db, (transaction) =>
                      updateTaskInTransaction(transaction, mutation.docId!, mutation.data as Partial<Task>, oldTaskForDiff, mutation.actorId!, { timestampOverride: mutation.timestamp })
                    );
                    propagateVersionBump(workingQueue, i, mutation.docId!, (prevTask.lockVersion || 0) + 1);
                  } catch (transitionErr) {
                    if (conflictDetectionService.detectConflict(transitionErr, mutation.docId!, oldTaskForDiff.title ?? 'Talimat', mutation.expectedVersion ?? 0)) {
                      hadConflict = true;
                      break;
                    }
                    throw transitionErr;
                  }
                } else if (mutation.collectionName === 'tasks' && mutation.expectedVersion !== undefined) {
                  const taskRef = doc(db, 'tasks', mutation.docId);
                  const result = await runTransaction(db, async (transaction) => {
                    const snap = await transaction.get(taskRef);
                    if (!snap.exists()) return { conflict: false };
                    const serverTask = snap.data() as { lockVersion?: number; title?: string; status?: string };
                    const currentVersion = serverTask.lockVersion || 0;
                    if (currentVersion !== mutation.expectedVersion) {
                      return { conflict: true, serverTitle: serverTask.title, serverVersion: currentVersion };
                    }
                    transaction.update(taskRef, {
                      ...mutation.data,
                      updatedAt: Date.now(),
                      lockVersion: currentVersion + 1
                    });
                    return { conflict: false, newVersion: currentVersion + 1 };
                  });
                  if (result.conflict) {
                    conflictDetectionService.detectConflict(
                      new Error('VERSION_MISMATCH: Çevrimdışı değişiklik senkronizasyon çakışması'),
                      mutation.docId,
                      result.serverTitle ?? 'Talimat',
                      mutation.expectedVersion,
                      result.serverVersion
                    );
                    // Çakışma tespit edildiyse mutasyonu sonsuza dek yeniden denemek anlamsızdır
                    // (expectedVersion asla eşleşmeyecektir) — kuyruktan düşürülür, kullanıcı
                    // çakışma bildirimiyle bilgilendirilir.
                    hadConflict = true;
                    break;
                  }
                  if (result.newVersion !== undefined) {
                    propagateVersionBump(workingQueue, i, mutation.docId, result.newVersion);
                  }
                } else if (mutation.withAuditLog) {
                  await writeWithAuditLog(
                    (batch) => batch.update(doc(db, mutation.collectionName, mutation.docId!), {
                      ...mutation.data,
                      updatedAt: Date.now()
                    }),
                    mutation.withAuditLog
                  );
                } else {
                  await updateDoc(doc(db, mutation.collectionName, mutation.docId), {
                    ...mutation.data,
                    updatedAt: Date.now()
                  });
                }
              }
              break;
            case 'delete':
              if (mutation.docId) {
                if (mutation.collectionName === 'blockers' && mutation.linkedTaskTransition) {
                  const { taskId, newStatus, userId, expectedVersion } = mutation.linkedTaskTransition;
                  const blockerRef = doc(db, 'blockers', mutation.docId);
                  try {
                    const prevTask = await runTransaction(db, async (transaction) => {
                      const t = await transitionTaskInTransaction(transaction, taskId, newStatus, userId, { expectedVersion, timestampOverride: mutation.timestamp });
                      transaction.delete(blockerRef);
                      return t;
                    });
                    propagateVersionBump(workingQueue, i, taskId, (prevTask.lockVersion || 0) + 1);
                  } catch (transitionErr) {
                    if (conflictDetectionService.detectConflict(transitionErr, taskId, 'Talimat', expectedVersion ?? 0)) {
                      hadConflict = true;
                      break;
                    }
                    throw transitionErr;
                  }
                } else if (mutation.withAuditLog) {
                  await writeWithAuditLog(
                    (batch) => batch.delete(doc(db, mutation.collectionName, mutation.docId!)),
                    mutation.withAuditLog
                  );
                } else {
                  await deleteDoc(doc(db, mutation.collectionName, mutation.docId));
                }
              }
              break;
          }
          if (hadConflict) {
            logger.warn(`[Offline Queue] Mutation ${mutation.id} dropped due to version conflict (task changed on server while offline)`);
          } else {
            logger.debug(`[Offline Queue] Successfully synced mutation ${mutation.id}`);
          }
        } catch (err) {
          const isNonRetryable = isNonRetryableError(err);
          if (isNonRetryable) {
            const reason = err instanceof FirebaseError ? err.code : (err instanceof Error ? err.message : String(err));
            logger.error(`[Offline Queue] Mutation ${mutation.id} kalıcı olarak reddedildi (${reason}), kuyruktan düşürülüyor:`, err);
            failedMutationsLog.record(mutation, reason);
            useUIStore.getState().addToast({
              title: '⚠️ Senkronizasyon Başarısız',
              body: 'Çevrimdışıyken yapılan bir değişiklik sunucu tarafından reddedildi ve uygulanamadı. Ayrıntı için üstteki çevrimdışı çubuğuna bakın.',
              type: 'danger'
            });
          } else {
            logger.error(`[Offline Queue] Failed to sync mutation ${mutation.id}:`, err);
            remaining.push(mutation);
          }
        }
        persistProgress(i);
      }
    } finally {
      isSyncing = false;
    }

    return remaining.length === 0;
  }
};

// Auto-trigger sync when coming back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    logger.debug('[Offline Queue] Connection restored! Triggering synchronization...');
    offlineQueue.sync().catch(logger.error);
  });

  // Initial sync check on load
  setTimeout(() => {
    if (window.navigator.onLine) {
      offlineQueue.sync().catch(logger.error);
    }
  }, 3000);
}
