import {
  collection,
  doc,
  deleteDoc,
  query,
  getDocs,
  where,
  limit,
  runTransaction,
  writeBatch,
  getDoc,
  increment,
  db
} from '../firebase';
import type { Transaction } from 'firebase/firestore';
import { Task, TaskStatus, User } from '../types';
import type { AuditLogType } from '../types';
import { calculateDeadline, getSLAConfigForPriority } from '../lib/sla';
import { cleanData } from '../lib/utils';
import { runWithRetry } from '../lib/retry';
import { isValidTaskTransition } from '../lib/taskStateMachine';

/**
 * Bir audit_logs kaydına, YAZILDIĞI andaki görev başlığını donduran
 * denormalize `taskTitle` alanını ekler (başlık bilinmiyorsa hiçbir şey
 * eklemez — alan opsiyoneldir, Firestore `undefined` değer kabul etmez).
 *
 * Neden denormalizasyon: denetim izi ekranı (`AuditLogList`) hedef başlığı
 * yalnızca `useFirestoreData`'nın `taskLimit` penceresine giren görev
 * listesinden çözüyordu; pencerenin DIŞINDA kalan eski/tamamlanmış görevlerin
 * kayıtları "Bilinmeyen Talimat" olarak görünüyordu — oysa denetim izi tanım
 * gereği eski olayları kapsar (bkz. kod denetimi P1-14). audit_logs zaten
 * değişmezdir (firestore.rules: `allow update, delete: if false`), bu yüzden
 * donmuş bir başlık kopyası burada DOĞRU desendir: kayıt, olayın gerçekleştiği
 * andaki gerçeği taşır ve sonradan bayatlayamaz/sahte veri üretemez.
 *
 * Not: rules'taki `taskTitle` uzunluk sınırı (<=200), görev `title` sınırıyla
 * (<=200) BİLEREK aynıdır — aksi halde uzun başlıklı bir görevin geçişi,
 * audit yazımı reddedildiği için tümüyle başarısız olurdu.
 */
export function auditTaskTitle(title?: string): { taskTitle?: string } {
  return title ? { taskTitle: title } : {};
}

/**
 * Bir audit_logs kaydına, YAZILDIĞI anda bilinen işlem tipini donduran
 * denormalize `logType` alanını ekler (tip bilinmiyorsa hiçbir şey eklemez —
 * alan opsiyoneldir, Firestore `undefined` değer kabul etmez).
 *
 * SINIFLANDIRMA KURALI — yazma noktası hangisini anlatıyor:
 *  - 'STATUS': bir varlığın YAŞAM DÖNGÜSÜ/durum olayı — görev durum geçişi,
 *    görev oluşturma/silme, risk unsurunun çözülmesi/silinmesi, personel
 *    ekleme/silme, dizge geri yükleme/dışa aktarma.
 *  - 'FIELD': bir varlığın İÇERİK/alan değerlerinin düzenlenmesi — görev alan
 *    güncellemesi (yorum/kanıt/başlık dahil), risk gerekçesi düzenleme,
 *    personel bilgisi güncelleme, dizge yapılandırması.
 *
 * Neden denormalizasyon: AuditLogList'in "İşlem Tipi" filtresi bu tipi
 * İSTEMCİDE, kaydın ŞEKLİNDEN tahmin ediyordu (`!log.changes &&
 * log.newValue !== undefined` → 'STATUS'). İki ayrı sorun (bkz. kod denetimi
 * P2-22):
 *  1. Sayfalama: aktör/tarih filtreleri sunucuda uygulanırken tip filtresi
 *     istemcide uygulandığı için, 15'lik bir sayfanın parçası elendiğinde
 *     kullanıcı "Daha Fazla Yükle"ye tekrar tekrar basmak zorunda kalıyordu.
 *  2. Doğruluk: tahmin, kaydın şekli semantiğiyle çelişen yazma noktalarında
 *     YANLIŞ sonuç veriyordu — `transitionTaskInTransaction` (gerçek bir durum
 *     geçişi) ve `deleteTask` de `changes` yazdığı için "İçerik Güncellemesi"
 *     sayılıyordu; `editBlocker` (bir gerekçe METNİ düzenlemesi) ise `changes`
 *     yazmadığı için "Durum Değişikliği" sayılıyordu. Tip artık şekilden
 *     türetilmiyor, olayı yazan kodun ZATEN bildiği bilgi olarak kaydediliyor.
 *
 * audit_logs değişmezdir (firestore.rules: `allow update, delete: if false`) —
 * bu yüzden buradaki değer sonradan düzeltilemez; sınıflandırma yazma anında
 * doğru olmak ZORUNDADIR (bkz. auditTaskTitle'daki aynı değişmezlik gerekçesi).
 */
export function auditLogType(type?: AuditLogType): { logType?: AuditLogType } {
  return type ? { logType: type } : {};
}

/**
 * Görev geçişinin tüm okuma+yazma mantığını mevcut bir transaction içinde
 * uygular — blockerService gibi çağıranlar, engel dokümanı yazımını görev
 * geçişiyle AYNI transaction'a katarak (ör. engel oluşturma + görev BLOCKED'a
 * alma) atomikliği garanti edebilir. Firestore kuralı: bir transaction'da
 * tüm okumalar tüm yazmalardan önce gelmeli — bu nedenle bu fonksiyon
 * çağrıldığı transaction'daki İLK işlem olmalı (kendi transaction.get'i hariç
 * başka yazma yapılmamış olmalı).
 */
async function transitionTaskInTransaction(
  transaction: Transaction,
  taskId: string,
  newStatus: TaskStatus,
  userId: string,
  options?: {
    evidence?: string;
    evidenceType?: Task['evidenceType'];
    assigneeId?: string;
    expectedVersion?: number;
    /** Çevrimdışı kuyruktan senkronize edilen geçişler için: geçişin sunucuya
     *  YAZILDIĞI an değil, kullanıcının çevrimdışıyken bu aksiyonu GERÇEKTEN
     *  yaptığı an (offlineQueue'nun `mutation.timestamp`'i). Verilmezse
     *  (çevrimiçi çağrılarda olduğu gibi) `Date.now()`'a düşer. Bu olmadan,
     *  ör. bir görev 14:00'de çevrimdışı BLOCKED'a alınıp 17:00'de senkronize
     *  edildiğinde `pausedAt` 17:00 olarak işaretlenir ve gerçek 3 saatlik
     *  duraklama SLA hesabına hiç yansımaz (deadline haksız yere daralır). */
    timestampOverride?: number;
  }
): Promise<Task> {
  const taskRef = doc(db, 'tasks', taskId);
  const snapshot = await transaction.get(taskRef);

  if (!snapshot.exists()) {
    throw new Error('Task does not exist');
  }

  const task = snapshot.data() as Task;
  const now = options?.timestampOverride ?? Date.now();

  // Optimistic Locking Check
  const currentVersion = task.lockVersion || 0;
  if (options?.expectedVersion !== undefined && currentVersion !== options.expectedVersion) {
    throw new Error(`VERSION_MISMATCH: Beklenen Versiyon ${options.expectedVersion}, Sunucu Versiyonu ${currentVersion}`);
  }

  // Client-side savunma hattı — firestore.rules'taki isValidTransition ile
  // aynı kurallar (bkz. lib/taskStateMachine.ts). Rules zaten bunu ayrıca
  // uyguluyor; bu kontrol yalnızca hatayı sunucuya gitmeden, daha erken ve
  // daha anlaşılır bir mesajla yakalar.
  if (!isValidTaskTransition(task.status, newStatus)) {
    throw new Error(`INVALID_TRANSITION: '${task.status}' durumundan '${newStatus}' durumuna geçiş izinli değil.`);
  }

  // --- SLA Pause Logic ---
  let pausedAt: number | null = task.pausedAt ?? null;
  let totalPausedTime = task.totalPausedTime || 0;

  // Rule: Transitions OUT of a pausing state (BLOCKED, AWAITING_APPROVAL, PENDING_DELEGATION)
  if (task.status === 'BLOCKED' || task.status === 'AWAITING_APPROVAL' || task.status === 'PENDING_DELEGATION') {
    if (task.pausedAt) {
      const pausedDuration = now - task.pausedAt;
      totalPausedTime += pausedDuration;
      pausedAt = null; // Reset pause marker
    }
  }

  // Rule: Transitions OUT of CRISIS
  const isCrisis = task.status !== 'CANCELLED' && task.status !== 'COMPLETED' && task.deadline < now;
  if (isCrisis && newStatus === 'IN_PROGRESS') {
    const effectiveDeadline = task.deadline + totalPausedTime;
    if (now > effectiveDeadline) {
      // Add the breach debt + 24 hours to paused time, effectively extending the deadline
      const extraTime = now - effectiveDeadline + (24 * 60 * 60 * 1000);
      totalPausedTime += extraTime;
    }
  }

  // Rule: Transitions INTO a pausing state (BLOCKED, AWAITING_APPROVAL, PENDING_DELEGATION)
  if (newStatus === 'BLOCKED' || newStatus === 'AWAITING_APPROVAL' || newStatus === 'PENDING_DELEGATION') {
    pausedAt = now; // Mark current time as start of pause
  }

  const updateData: Partial<Task> = {
    status: newStatus,
    updatedAt: now,
    lockVersion: currentVersion + 1,
    pausedAt,
    totalPausedTime,
    // changedBy ayrıca audit_logs dokümanına da yazılıyor (aşağıda), ama görev
    // dokümanının kendisinde de tutulur — aksi halde onTaskStatusChanged (Cloud
    // Function) trigger'ı after.changedBy'ı hiç okuyamaz ve "değiştiren kişiye
    // bildirim gönderme" filtresi asla çalışmaz (kullanıcı kendi değişikliğinde
    // bile bildirim alır).
    changedBy: userId
  };

  // Görev tamamlandığında completedAt otomatik ayarlanır
  if (newStatus === 'COMPLETED') {
    updateData.completedAt = now;
  }

  if (options?.evidence) {
    updateData.evidence = options.evidence;
    updateData.evidenceType = options.evidenceType;
  }

  if (options?.assigneeId) {
    updateData.assigneeId = options.assigneeId;
  }

  transaction.update(taskRef, cleanData(updateData));

  // Audit Log
  const auditRef = doc(collection(db, 'audit_logs'));
  transaction.set(auditRef, {
    taskId,
    ...auditTaskTitle(task.title),
    // Bu kayıt TANIM GEREĞİ bir durum geçişidir. Aşağıdaki `changes.status`
    // diff'i yalnızca geçişin DETAYIdır, onu bir "içerik güncellemesi"
    // yapmaz — istemci-taraflı eski tahmin (`!log.changes`) tam da burada
    // yanılıyordu (bkz. auditLogType).
    ...auditLogType('STATUS'),
    changedBy: userId,
    oldValue: task.status,
    newValue: newStatus,
    timestamp: now,
    changes: {
      status: { old: task.status, new: newStatus }
    }
  });

  // Aggregate Stats — task.status === newStatus olduğunda (sameStatus geçişi,
  // bkz. taskStateMachine.ts) iki hesaplanmış anahtar AYNI string'e
  // çözümlenir; obje literalinde ikinci değer birinciyi ezer ve net sıfır
  // değişim yerine sunucuya yalnızca increment(1) gider — fantom +1 (bkz. kod
  // denetimi). updateTaskInTransaction'daki eşdeğer korumayla tutarlı olsun
  // diye burada da yalnızca durum GERÇEKTEN değiştiğinde yazılıyor.
  if (task.status !== newStatus) {
    const statsRef = doc(db, 'system', 'stats');
    transaction.set(statsRef, {
      [`status_${task.status}`]: increment(-1),
      [`status_${newStatus}`]: increment(1)
    }, { merge: true });
  }

  return task;
}

export { transitionTaskInTransaction };

/**
 * Genel (durum-dışı) görev güncellemesinin transaction mantığı — mevcut bir
 * transaction içinde çalışır ki offlineQueue senkronu (bkz. offlineQueue.ts),
 * transitionTaskInTransaction'la aynı desende, online taskService.updateTask
 * ile BİREBİR AYNI audit-log/versiyon/stats davranışını offline'da da
 * uygulayabilsin. oldTask yalnızca audit diff'inin "eski değer" tabanı ve
 * optimistic-locking beklenen versiyonu için kullanılır (client'ın enqueue
 * anındaki anlık görüntüsü) — transaction'ın kendi okuduğu sunucu verisi
 * yalnızca versiyon karşılaştırması için kullanılır.
 */
async function updateTaskInTransaction(
  transaction: Transaction,
  taskId: string,
  data: Partial<Task>,
  oldTask: Task,
  userId: string,
  options?: { timestampOverride?: number }
): Promise<Task> {
  const taskRef = doc(db, 'tasks', taskId);
  const snapshot = await transaction.get(taskRef);
  if (!snapshot.exists()) {
    throw new Error('Task does not exist');
  }

  const task = snapshot.data() as Task;
  const currentServerVersion = task.lockVersion || 0;
  const expectedVersion = oldTask.lockVersion || 0;

  if (currentServerVersion !== expectedVersion) {
    throw new Error(`VERSION_MISMATCH: Beklenen Versiyon ${expectedVersion}, Sunucu Versiyonu ${currentServerVersion}`);
  }

  // Client-side savunma hattı — transitionTaskInTransaction'daki AYNI kontrol.
  // Bu genel (durum-dışı) güncelleme yolu durum makinesini hiç kontrol
  // etmiyordu; bugüne kadar hiçbir çağıran `data.status`'u buraya geçirmedi
  // (durum geçişleri her zaman transitionTaskInTransaction'dan gider), ama bu
  // yalnızca çağıran disiplinine dayanıyordu — kod seviyesinde zorlanmıyordu
  // (bkz. kod denetimi: savunma derinliği kırılabilirdi). firestore.rules
  // zaten bunu ayrıca uyguluyor; bu yalnızca hatayı daha erken/anlaşılır
  // yakalar.
  if (data.status && data.status !== task.status && !isValidTaskTransition(task.status, data.status)) {
    throw new Error(`INVALID_TRANSITION: '${task.status}' durumundan '${data.status}' durumuna geçiş izinli değil.`);
  }

  const now = options?.timestampOverride ?? Date.now();

  transaction.update(taskRef, cleanData({
    ...data,
    updatedAt: now,
    lockVersion: currentServerVersion + 1
  }));

  // Audit Log — görev güncellemesiyle aynı transaction içinde yazılır ki
  // biri başarısız olursa ikisi de geri alınsın (denetim izi bütünlüğü).
  const auditRef = doc(collection(db, 'audit_logs'));
  transaction.set(auditRef, {
    taskId,
    // Bu güncelleme başlığın KENDİSİNİ değiştiriyorsa yeni başlık donar —
    // kayıt "bu değişiklikten sonra görevin adı buydu"yu anlatır; eski başlık
    // zaten aşağıdaki `changes.title` diff'inde ayrıca korunur.
    ...auditTaskTitle(data.title ?? task.title),
    // Durum-DIŞI genel güncelleme yolu (yorum/kanıt/başlık/sorumlu vb.) —
    // durum geçişleri her zaman transitionTaskInTransaction'dan gider.
    ...auditLogType('FIELD'),
    changedBy: userId,
    oldValue: 'Kısmi Güncelleme',
    newValue: 'Kısmi Güncelleme',
    timestamp: now,
    changes: (Object.keys(data) as (keyof Task)[]).reduce((acc, key) => ({
      ...acc,
      [key]: {
        old: oldTask[key] === undefined ? null : oldTask[key],
        new: data[key] === undefined ? null : data[key]
      }
    }), {})
  });

  // Aggregate Stats — aynı transaction içinde
  if (data.status && data.status !== oldTask.status) {
    const statsRef = doc(db, 'system', 'stats');
    transaction.set(statsRef, {
      [`status_${oldTask.status}`]: increment(-1),
      [`status_${data.status}`]: increment(1)
    }, { merge: true });
  }

  return task;
}

export { updateTaskInTransaction };

export const taskService = {
  async createTask(taskData: Partial<Task>, userId: string, options?: { timestampOverride?: number }) {
    const now = options?.timestampOverride ?? Date.now();
    const slaConfig = getSLAConfigForPriority(taskData.priority ?? 'Medium');
    const deadline = typeof taskData.deadline === 'number' && taskData.deadline > 0
      ? taskData.deadline
      : calculateDeadline(new Date(now), slaConfig);

    // İş Kuralı: Admin irtibatlı atanamaz
    if (taskData.coordinatorId) {
      const coordSnap = await getDoc(doc(db, 'users', taskData.coordinatorId!));
      if (coordSnap.exists() && (coordSnap.data() as User).role === 'Admin') {
        throw new Error('Admin rolündeki kullanıcı irtibatlı olarak atanamaz.');
      }
    }

    // İş Kuralı: Alt talimatlar yalnızca Staff (memur) rolüne atanabilir
    if (taskData.parentId) {
      const assigneeSnap = await getDoc(doc(db, 'users', taskData.assigneeId!));
      if (assigneeSnap.exists() && (assigneeSnap.data() as User).role !== 'Staff') {
        throw new Error('Alt talimatlar yalnızca Memur rolündeki personele atanabilir.');
      }
    }

    // Doküman ID'si transaction'dan ÖNCE sabitlenir: addDoc kullanılırsa her
    // çağrı yeni bir ID üretir, bu yüzden runWithRetry bir ağ hatası sonrası
    // tüm fonksiyonu yeniden çalıştırdığında (transaction başarıyla commit
    // olduğu halde yalnızca ONAY yanıtı ağ hatasıyla kaybolmuş olsa bile)
    // İKİNCİ bir görev dokümanı oluşabiliyordu (bkz. kod denetimi). Sabit bir
    // taskRef ile retry, aynı dokümana idempotent bir tekrar-yazım yapar —
    // görev+audit-log+stats artık TEK bir transaction'da atomik yazılıyor.
    const taskRef = doc(collection(db, 'tasks'));

    return runWithRetry(async () => runTransaction(db, async (transaction) => {
      const auditRef = doc(collection(db, 'audit_logs'));
      const statsRef = doc(db, 'system', 'stats');

      transaction.set(taskRef, cleanData({
        ...taskData,
        id: taskRef.id,
        status: 'ASSIGNED',
        deadline,
        createdAt: now,
        updatedAt: now,
        lockVersion: 0,
        totalPausedTime: 0
      }));

      transaction.set(auditRef, {
        taskId: taskRef.id,
        ...auditTaskTitle(taskData.title),
        // Görevin yaşam döngüsünün BAŞLANGICI (→ ASSIGNED) — bir alan
        // düzenlemesi değil.
        ...auditLogType('STATUS'),
        changedBy: userId,
        oldValue: 'Yok',
        newValue: 'Talimat Oluşturuldu ve Atandı',
        timestamp: now
      });

      transaction.set(statsRef, {
        totalTasks: increment(1),
        status_ASSIGNED: increment(1)
      }, { merge: true });

      return taskRef.id;
    }));
  },

  async transitionTask(
    taskId: string,
    newStatus: TaskStatus,
    userId: string,
    options?: {
      evidence?: string;
      evidenceType?: Task['evidenceType'];
      assigneeId?: string;
      expectedVersion?: number;
    }
  ) {
    return runWithRetry(async () => {
      return runTransaction(db, (transaction) =>
        transitionTaskInTransaction(transaction, taskId, newStatus, userId, options)
      );
    });
  },

  async deleteTask(taskId: string, userId: string) {
    return runWithRetry(async () => {
      const rootSnap = await getDoc(doc(db, 'tasks', taskId));
      const rootData = rootSnap.exists() ? (rootSnap.data() as Task) : null;

      // Kök görev + tüm iç içe alt görevleri seviye seviye (BFS) topla — silme
      // öncesi hiçbir yazma yapılmaz, böylece yarıda kalan bir hata veri
      // tutarsızlığı bırakmaz (tüm silme/istatistik işlemleri tek bir atomik
      // batch'te yapılır). Önceki hali her düğüm için ayrı bir getDoc + ayrı
      // bir getDocs çağırıyordu (N düğüm → ~2N round-trip); burada aynı
      // seviyedeki tüm ebeveyn id'leri `parentId in [...]` ile TEK sorguda
      // toplanır (Firestore 'in' sınırı 30 olduğundan büyük seviyeler 30'luk
      // gruplara bölünür) ve düğüm verisi zaten sorgu sonucunda geldiği için
      // ayrıca getDoc ile yeniden okunmaz.
      const tasksToDelete: { id: string; status: TaskStatus }[] = [];
      if (rootSnap.exists()) {
        tasksToDelete.push({ id: taskId, status: rootData!.status });
      }
      let currentLevelIds = [taskId];
      while (currentLevelIds.length > 0) {
        const idChunks: string[][] = [];
        for (let i = 0; i < currentLevelIds.length; i += 30) {
          idChunks.push(currentLevelIds.slice(i, i + 30));
        }
        const levelSnapshots = await Promise.all(
          idChunks.map(chunk => getDocs(query(collection(db, 'tasks'), where('parentId', 'in', chunk))))
        );
        const levelChildren = levelSnapshots.flatMap(snap =>
          snap.docs.map(d => ({ id: d.id, status: (d.data() as Task).status }))
        );
        tasksToDelete.push(...levelChildren);
        currentLevelIds = levelChildren.map(c => c.id);
      }

      if (tasksToDelete.length === 0) return;

      // Blocker sorgusu da (üstteki görev-toplama gibi) 30'luk gruplar halinde
      // TEK 'in' sorgusuyla yapılır — önceden her görev için AYRI bir getDocs
      // çağrılıyordu (N görev → N sorgu), üstteki optimizasyonla tutarsızdı
      // (bkz. kod denetimi).
      const blockerIdChunks: string[][] = [];
      for (let i = 0; i < tasksToDelete.length; i += 30) {
        blockerIdChunks.push(tasksToDelete.slice(i, i + 30).map(t => t.id));
      }
      const blockerSnapshots = await Promise.all(
        blockerIdChunks.map(chunk => getDocs(query(collection(db, 'blockers'), where('taskId', 'in', chunk))))
      );

      // Audit kaydı + stats deltası, SİLME işlemlerinden ÖNCE ve deterministik
      // bir audit doküman ID'siyle AYRI bir batch'te commit edilir. Önceden bu
      // ikisi silme işlemlerinden SONRA, son 450'lik batch'e ekleniyordu;
      // batch'ler Promise.all ile BAĞIMSIZ commit edildiğinden, kök görevi
      // silen batch başarılı olup bu son batch bir ağ hatasıyla başarısız
      // olursa, runWithRetry fonksiyonu yeniden çalıştırdığında kök görev
      // zaten silinmiş olduğundan `tasksToDelete.length === 0` ile sessizce
      // erken çıkılıyor ve audit kaydı + stats düşüşü HİÇBİR ZAMAN
      // yazılmıyordu (bkz. kod denetimi). Deterministik ID, retry'ın bu adımı
      // atlayıp atlamayacağını (zaten commit edilmiş mi) güvenle söylemesini
      // sağlar — silme işlemlerinin kendisi zaten idempotenttir (var olmayan
      // bir dokümanı silmek no-op'tur), bu yüzden onlar için aynı korumaya
      // gerek yoktur.
      const deletionAuditRef = doc(db, 'audit_logs', `task-delete-${taskId}`);
      const existingDeletionAudit = await getDoc(deletionAuditRef);
      if (!existingDeletionAudit.exists()) {
        const accountingBatch = writeBatch(db);
        accountingBatch.set(deletionAuditRef, {
          taskId,
          // Silme kaydında başlık, görev SİLİNMEDEN ÖNCEKİ halidir — silinen
          // bir görev için `tasksById` fallback'i zaten hiçbir zaman
          // çözülemez, dolayısıyla denormalize başlık bu kayıtta tek başlık
          // kaynağıdır.
          ...auditTaskTitle(rootData?.title),
          // Görevin yaşam döngüsünün SONU. transitionTaskInTransaction'la aynı
          // gerekçe: aşağıdaki `changes` diff'i olayın detayıdır, tipi değil
          // (bkz. auditLogType).
          ...auditLogType('STATUS'),
          changedBy: userId,
          oldValue: rootData?.title ?? 'Silindi',
          newValue: 'Silindi',
          timestamp: Date.now(),
          changes: {
            deleted: { old: false, new: true },
            status: { old: rootData?.status ?? null, new: null }
          }
        });

        const statusDeltas: Record<string, number> = {};
        tasksToDelete.forEach(t => {
          statusDeltas[`status_${t.status}`] = (statusDeltas[`status_${t.status}`] ?? 0) - 1;
        });
        const statsPayload: Record<string, ReturnType<typeof increment>> = {
          totalTasks: increment(-tasksToDelete.length)
        };
        Object.entries(statusDeltas).forEach(([key, value]) => {
          if (value !== 0) statsPayload[key] = increment(value);
        });
        accountingBatch.set(doc(db, 'system', 'stats'), statsPayload, { merge: true });

        await accountingBatch.commit();
      }

      // Firestore batch'leri en fazla 500 işlem alır — güvenli pay için 450'de böl.
      const batches: ReturnType<typeof writeBatch>[] = [];
      let batch = writeBatch(db);
      let opCount = 0;
      const addOp = (fn: (b: ReturnType<typeof writeBatch>) => void) => {
        if (opCount >= 450) {
          batches.push(batch);
          batch = writeBatch(db);
          opCount = 0;
        }
        fn(batch);
        opCount++;
      };

      // NOT: Görev silindiğinde denetim izi bilinçli olarak SİLİNMİYOR — audit_logs
      // artık firestore.rules'ta değiştirilemez/silinemez; görevin geçmişi (silme
      // dahil) kanıt bütünlüğü için korunur.
      tasksToDelete.forEach(t => addOp(b => b.delete(doc(db, 'tasks', t.id))));
      blockerSnapshots.forEach(snap => snap.docs.forEach(bDoc => addOp(b => b.delete(bDoc.ref))));

      batches.push(batch);
      await Promise.all(batches.map(b => b.commit()));
    });
  },

  async addComment(taskId: string, userId: string, text: string, expectedVersion?: number) {
    return runWithRetry(async () => runTransaction(db, async (transaction) => {
      const taskRef = doc(db, 'tasks', taskId);
      const snapshot = await transaction.get(taskRef);
      if (!snapshot.exists()) return;

      const task = snapshot.data() as Task;
      const currentVersion = task.lockVersion || 0;

      // Optimistic Locking Check
      if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
        throw new Error(`VERSION_MISMATCH: Beklenen Versiyon ${expectedVersion}, Sunucu Versiyonu ${currentVersion}`);
      }

      const comments = [...(task.comments || []), {
        userId,
        text,
        timestamp: Date.now()
      }];

      transaction.update(taskRef, {
        comments,
        updatedAt: Date.now(),
        lockVersion: currentVersion + 1
      });
    }));
  },

  async updateTask(taskId: string, data: Partial<Task>, oldTask: Task, userId: string, options?: { timestampOverride?: number }) {
    return runWithRetry(async () => {
      // İş Kuralı: Admin irtibatlı atanamaz
      if (data.coordinatorId) {
        const coordSnap = await getDoc(doc(db, 'users', data.coordinatorId!));
        if (coordSnap.exists() && (coordSnap.data() as User).role === 'Admin') {
          throw new Error('Admin rolündeki kullanıcı irtibatlı olarak atanamaz.');
        }
      }

      await runTransaction(db, (transaction) =>
        updateTaskInTransaction(transaction, taskId, data, oldTask, userId, options)
      );
    });
  },

  async updateTaskStatus(taskId: string, newStatus: TaskStatus, oldStatus: TaskStatus | undefined, userId: string, evidence?: string, evidenceType?: Task['evidenceType'], expectedVersion?: number) {
    return this.transitionTask(taskId, newStatus, userId, { evidence, evidenceType, expectedVersion });
  },

  // İzin/mazeret devri: görev başka bir Müdür'e devredilir ve PENDING_DELEGATION'a
  // alınır (SLA sayacı BLOCKED/AWAITING_APPROVAL ile aynı şekilde duraklar).
  // Yeni sorumlunun Müdür olması firestore.rules'ta da (isValidTaskBusinessRules)
  // AYRICA doğrulanır — buradaki kontrol yalnızca client'a erken/anlaşılır bir
  // hata mesajı vermek için ikinci bir savunma hattıdır (bkz. kod denetimi).
  async delegateTask(taskId: string, newAssigneeId: string, userId: string, expectedVersion?: number) {
    const assigneeSnap = await getDoc(doc(db, 'users', newAssigneeId));
    if (assigneeSnap.exists() && (assigneeSnap.data() as User).role !== 'Manager') {
      throw new Error('İzin/mazeret devri yalnızca Müdür rolündeki personele yapılabilir.');
    }
    return this.transitionTask(taskId, 'PENDING_DELEGATION', userId, { assigneeId: newAssigneeId, expectedVersion });
  },

  /**
   * Ayarlar > "Dizge Optimizasyonu" butonunun arkasındaki elle temizlik.
   *
   * SPARK PLANI TELAFİSİ: bu işi yapacak olan `functions/cleanup.ts` (haftalık,
   * 30g bildirim + 90g system_logs + 30g error_logs) Blaze gerektirdiğinden hiç
   * deploy edilmedi — koleksiyonlar sınırsız büyüyordu (bkz. backend denetimi;
   * Spark depolama limiti 1 GiB). Bu fonksiyon, Admin'in elle tetikleyebildiği
   * karşılığıdır.
   *
   * `error_logs` de kapsama alındı (eskiden yalnızca bildirimler siliniyordu).
   * `system_logs` KAPSAM DIŞI: `firestore.rules` o koleksiyonda delete'i
   * TÜMÜYLE kapatır (`allow create, update, delete: if false`) — yalnızca Admin
   * SDK (deploy edilmemiş fonksiyonlar) silebilir, client'tan denemek her
   * seferinde reddedilirdi.
   *
   * Koşu başına `MAX_DELETES_PER_COLLECTION` üst sınırı, `cleanup.ts`'teki
   * MAX_BATCHES korumasıyla AYNI mühendislik yaklaşımı: sınır aşılırsa kalanlar
   * bir sonraki tetiklemeye devreder, tek koşuda Spark yazma kotası tüketilmez.
   * (Eski hâl sınırsızdı: `getDocs` sonucunun tamamı tek `Promise.all` ile
   * silinmeye çalışılıyordu.)
   *
   * @returns Silinen doküman sayıları — çağıran (Settings/DataTab) kullanıcıya
   *          somut bir sonuç gösterebilsin diye; eskiden sessizce dönüyordu.
   */
  async cleanupDatabase(): Promise<{ notifications: number; errorLogs: number }> {
    const MAX_DELETES_PER_COLLECTION = 500;
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const result = { notifications: 0, errorLogs: 0 };

    // İki koleksiyon BİLİNÇLİ olarak ayrı try/catch'te: `error_logs` yalnızca
    // Admin'e açık olduğundan (rules) yetkisiz bir çağrıda ikinci silme
    // reddedilse bile ilkinin sonucu korunur.
    try {
      const q = query(
        collection(db, 'notifications'),
        where('isRead', '==', true),
        where('timestamp', '<', thirtyDaysAgo),
        limit(MAX_DELETES_PER_COLLECTION)
      );
      const snapshot = await getDocs(q);
      await Promise.all(snapshot.docs.map(d => deleteDoc(d.ref)));
      result.notifications = snapshot.size;
    } catch (error) {
      console.error('Cleanup error (notifications):', error);
    }

    try {
      const q = query(
        collection(db, 'error_logs'),
        where('timestamp', '<', thirtyDaysAgo),
        limit(MAX_DELETES_PER_COLLECTION)
      );
      const snapshot = await getDocs(q);
      await Promise.all(snapshot.docs.map(d => deleteDoc(d.ref)));
      result.errorLogs = snapshot.size;
    } catch (error) {
      console.error('Cleanup error (error_logs):', error);
    }

    return result;
  }
};
