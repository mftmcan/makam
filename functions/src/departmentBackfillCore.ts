/**
 * Departman backfill'inin SAF mantığı (P0-1/P0-2 taşıması).
 *
 * NEDEN AYRI BİR DOSYA: burada `firebase-functions` İTHAL EDİLMEZ, yalnızca
 * `firebase-admin`'in Firestore tipi kullanılır. Bu sayede kök projedeki
 * emulator testi (tests/emulator/backfillDepartments.test.ts) bu dosyayı
 * doğrudan import edip GERÇEK mantığı doğrulayabilir — `functions/` kök
 * `tsconfig.json`'da hariç tutulmuş olsa da import edilen dosyalar programa
 * dahil edildiğinden, `firebase-functions` içeren bir modülü import etmek
 * CI'da (yalnızca kök node_modules kurulu) `tsc --noEmit`'i kırardı.
 * Callable sarmalayıcı bu yüzden backfillDepartments.ts'te ayrı durur.
 *
 * İDEMPOTENT: iki kez çalıştırılması zarar vermez — var olan departman
 * dokümanı yeniden yazılmaz, departmanı zaten dolu olan görev güncellenmez.
 */
import type * as firestore from 'firebase-admin/firestore';

/**
 * Sorumlusu da departmansız olan görevlerin düşürüleceği varsayılan birim.
 *
 * Doküman ID'si ile `name` BİLİNÇLİ olarak aynıdır ('Genel'): firestore.rules
 * `isValidDepartment`, name'in doküman ID'siyle birebir eşleşmesini zorunlu
 * kılar. ID'yi 'genel', adı 'Genel' yapmak (Admin SDK rules'ı bypass ettiği
 * için yazılabilirdi) tam da bu fazın kapattığı ad/değer sapmasını üretir ve
 * bu dokümanı istemciden sonsuza dek güncellenemez kılardı.
 */
export const FALLBACK_DEPARTMENT_ID = 'Genel';

/** Firestore doküman ID kısıtları — src/services/departmentService.ts'teki
 *  isUsableAsDepartmentId ile AYNI kural kümesi. İki ayrı TS projesi
 *  olduğundan (bkz. functions/CLAUDE.md) burada tekrarlanır; birini
 *  değiştirirken diğerini de güncelleyin. */
export function isUsableAsDepartmentId(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= 100 &&
    !name.includes('/') &&
    name !== '.' &&
    name !== '..' &&
    !/^__.*__$/.test(name)
  );
}

export interface DepartmentBackfillResult {
  /** Yeni oluşturulan departments dokümanı sayısı. */
  departmentsCreated: number;
  /** Zaten var olduğu için dokunulmayan departman sayısı. */
  departmentsExisting: number;
  /** departmentId'si doldurulan görev sayısı. */
  tasksUpdated: number;
  /** Departmanı zaten geçerli olduğu için dokunulmayan görev sayısı. */
  tasksAlreadyValid: number;
  /** Sorumlusu da departmansız olduğu için varsayılan birime düşen görevler. */
  tasksFallenBackToDefault: number;
  /** Doküman ID'si olamayacak (ör. eğik çizgi içeren) departman değerleri —
   *  bunlar referans varlığa dönüştürülemez ve ELLE düzeltilmelidir. */
  skippedInvalidDepartmentNames: string[];
  /** departmentId'si hâlâ boş kalan görev ID'leri (beklenen: boş liste). */
  unresolvedTaskIds: string[];
}

// Spark kotası disiplini (bkz. functions/CLAUDE.md — scheduledAudit/cleanup'taki
// aynı yaklaşım): koleksiyonlar sayfa sayfa okunur, yazımlar 450'lik
// batch'lere bölünür (Firestore'un 500 limiti altında güvenlik payı).
const PAGE_SIZE = 500;
const BATCH_LIMIT = 450;

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/** Bir koleksiyonu documentId() imleciyle sayfa sayfa okur — tek seferde
 *  tüm koleksiyonu belleğe almak yerine (scheduledAudit.ts'teki imleç
 *  yaklaşımının aynısı). */
async function forEachDoc(
  collection: firestore.CollectionReference,
  visit: (doc: firestore.QueryDocumentSnapshot) => void
): Promise<void> {
  let cursor: firestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = collection.orderBy('__name__').limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    if (snap.empty) return;
    snap.docs.forEach(visit);
    if (snap.docs.length < PAGE_SIZE) return;
    cursor = snap.docs[snap.docs.length - 1];
  }
}

async function commitInBatches(
  db: firestore.Firestore,
  writes: Array<(batch: firestore.WriteBatch) => void>
): Promise<void> {
  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    writes.slice(i, i + BATCH_LIMIT).forEach(apply => apply(batch));
    await batch.commit();
  }
}

/**
 * (a) users + tasks içindeki TÜM distinct departmentId değerleri için eksik
 *     departments dokümanlarını oluşturur.
 * (b) departmentId'si eksik/null/boş olan her görevi, SORUMLUSUNUN güncel
 *     departmanıyla doldurur; sorumlu da departmansızsa varsayılan birime düşer.
 */
export async function runDepartmentBackfill(
  db: firestore.Firestore,
  actorId: string
): Promise<DepartmentBackfillResult> {
  const now = Date.now();

  // ── Mevcut durumu oku ─────────────────────────────────────────────────────
  const existingDepartments = new Set<string>();
  await forEachDoc(db.collection('departments'), doc => existingDepartments.add(doc.id));

  /** uid VEYA e-posta -> departman. İki anahtarla da doldurulur çünkü
   *  assigneeId bazen UID bazen (ilk girişini yapmamış davetli için) e-posta
   *  taşır — taskTriggers.ts'teki resolveUid ile AYNI gerçeklik, burada tek
   *  geçişte kurulan bir haritayla çözülür (görev başına ayrı sorgu yapmamak
   *  için: Spark okuma kotası). */
  const departmentByUserKey = new Map<string, string>();
  const referencedDepartments = new Set<string>();

  await forEachDoc(db.collection('users'), doc => {
    const data = doc.data();
    const dept = typeof data.departmentId === 'string' ? data.departmentId : '';
    if (!isBlank(dept)) referencedDepartments.add(dept);
    departmentByUserKey.set(doc.id, dept);
    if (typeof data.email === 'string' && data.email !== '') {
      // Gerçek UID dokümanı davet dokümanını EZMELİ: aynı e-posta iki
      // dokümanda görünebilir (davet + ilk giriş sonrası UID) ve güncel
      // departman UID'li olandadır. Davet dokümanının kendi ID'si zaten
      // e-postadır, bu yüzden yalnızca dolu bir departman yazılır.
      const previous = departmentByUserKey.get(data.email);
      if (previous === undefined || isBlank(previous)) {
        departmentByUserKey.set(data.email, dept);
      }
    }
  });

  const tasksNeedingDepartment: Array<{ id: string; assigneeId: string }> = [];
  let tasksAlreadyValid = 0;

  await forEachDoc(db.collection('tasks'), doc => {
    const data = doc.data();
    const dept = data.departmentId;
    if (isBlank(dept) || typeof dept !== 'string') {
      tasksNeedingDepartment.push({
        id: doc.id,
        assigneeId: typeof data.assigneeId === 'string' ? data.assigneeId : '',
      });
      return;
    }
    referencedDepartments.add(dept);
    tasksAlreadyValid++;
  });

  // ── (b) Görevlerin departmanını çöz ───────────────────────────────────────
  // ÖNCE çözüm yapılır, SONRA departmanlar oluşturulur: sorumludan gelen
  // departman değerleri de referans kümesine katılmalı (o kullanıcı zaten
  // taranmış olduğundan pratikte katılmış olur) ve varsayılan birimin
  // gerçekten gerekip gerekmediği ancak burada belli olur.
  const taskUpdates: Array<{ id: string; departmentId: string }> = [];
  const unresolvedTaskIds: string[] = [];
  let tasksFallenBackToDefault = 0;

  for (const task of tasksNeedingDepartment) {
    const assigneeDepartment = task.assigneeId ? departmentByUserKey.get(task.assigneeId) : undefined;
    let resolved = !isBlank(assigneeDepartment) ? assigneeDepartment! : '';

    if (resolved !== '' && !isUsableAsDepartmentId(resolved)) {
      // Sorumlunun departmanı referans varlığa dönüştürülemiyor — görevi
      // geçersiz bir referansla bırakmaktansa varsayılan birime düşürülür.
      resolved = '';
    }
    if (resolved === '') {
      resolved = FALLBACK_DEPARTMENT_ID;
      tasksFallenBackToDefault++;
    }
    referencedDepartments.add(resolved);
    taskUpdates.push({ id: task.id, departmentId: resolved });
  }

  // ── (a) Eksik departman dokümanlarını oluştur ─────────────────────────────
  const skippedInvalidDepartmentNames: string[] = [];
  const departmentWrites: Array<(batch: firestore.WriteBatch) => void> = [];
  let departmentsExisting = 0;

  for (const name of referencedDepartments) {
    if (!isUsableAsDepartmentId(name)) {
      skippedInvalidDepartmentNames.push(name);
      continue;
    }
    if (existingDepartments.has(name)) {
      departmentsExisting++;
      continue;
    }
    departmentWrites.push(batch => {
      batch.set(db.collection('departments').doc(name), {
        name,
        createdAt: now,
        createdBy: actorId,
      });
    });
  }

  await commitInBatches(db, departmentWrites);

  // ── Görev güncellemelerini yaz ────────────────────────────────────────────
  // updatedAt'e DOKUNULMAZ: bu bir veri taşımasıdır, kullanıcı eylemi değil.
  // updatedAt'i ilerletmek "24 saattir güncellenmemiş" denetimini
  // (scheduledAudit.ts) sıfırlar ve tüm listeleri en üste taşıyarak gerçek
  // aktiviteyi gizlerdi. lockVersion de artırılmaz — artırmak, açık
  // istemcilerde sahte VERSION_MISMATCH üretirdi (bkz. conflictDetectionService).
  const validDepartmentIds = new Set<string>([...existingDepartments]);
  for (const name of referencedDepartments) {
    if (isUsableAsDepartmentId(name)) validDepartmentIds.add(name);
  }

  const taskWrites: Array<(batch: firestore.WriteBatch) => void> = [];
  let tasksUpdated = 0;
  for (const update of taskUpdates) {
    if (!validDepartmentIds.has(update.departmentId)) {
      unresolvedTaskIds.push(update.id);
      continue;
    }
    tasksUpdated++;
    taskWrites.push(batch => {
      batch.update(db.collection('tasks').doc(update.id), { departmentId: update.departmentId });
    });
  }

  await commitInBatches(db, taskWrites);

  return {
    departmentsCreated: referencedDepartments.size - departmentsExisting - skippedInvalidDepartmentNames.length,
    departmentsExisting,
    tasksUpdated,
    tasksAlreadyValid,
    tasksFallenBackToDefault,
    skippedInvalidDepartmentNames,
    unresolvedTaskIds,
  };
}
