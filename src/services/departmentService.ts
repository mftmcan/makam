import {
  collection,
  doc,
  deleteDoc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  startAfter,
  where,
  writeBatch,
  limit,
  db
} from '../firebase';
import { runWithRetry } from '../lib/retry';
import { Department, DepartmentSchema } from '../types';
import { validateOrPassthrough } from '../lib/validateOrPassthrough';

/**
 * departments koleksiyonu için TEK okuma/yazma katmanı (auditLogService.ts /
 * userService.ts ile aynı desen).
 *
 * NEDEN VAR: departman eskiden hiçbir yerde varlık olarak tutulmuyordu —
 * TeamList.tsx serbest metin olarak alıyor, firestore.rules ise onu TAM STRING
 * EŞİTLİĞİYLE karşılaştırıyordu (`existing().departmentId == getUserDepartment()`).
 * Tek bir yazım hatası ya yeni bir "hayalet departman" üretiyor ya da bir
 * Müdürü kendi biriminden sessizce koparıyordu (bkz. kod denetimi P0-2).
 *
 * Doküman ID'si = departmanın kendi değeri. Bu yüzden burada bir "id üret"
 * adımı YOKTUR ve olmamalıdır: ID'yi normalize etmek (slug'lamak) mevcut
 * tasks/users kayıtlarındaki string değerlerle eşleşmeyi bozardı.
 */

/** Firestore doküman ID'si olarak KULLANILAMAYACAK departman adları. Bunlar
 *  Firestore'un kendi ID kısıtlarıdır (eğik çizgi yol ayıracıdır; '.'/'..'
 *  ve '__x__' rezervedir) — bir departman adı bunlardan birine uyuyorsa o ad
 *  bu tasarımda hiçbir zaman referans varlığa dönüştürülemez. */
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

/** Kullanıcı girdisinin tek normalizasyonu: baştan/sondan boşluk kırpma.
 *  Büyük/küçük harf veya aksan normalizasyonu BİLİNÇLİ olarak yapılmaz —
 *  değer aynı zamanda doküman ID'si olduğundan, normalize edilmiş bir ad
 *  mevcut kayıtlardaki ham değerle eşleşmezdi. */
export function normalizeDepartmentName(raw: string): string {
  return raw.trim();
}

function toDepartment(id: string, data: Record<string, unknown>): Department {
  // `name` alanı kuralla ID'ye eşitlenmiştir; yine de eksik/bozuk bir eski
  // kayıtta liste boş bir etiketle görünmesin diye ID varsayılan olarak kullanılır.
  const raw = { id, name: id, ...data } as unknown as Department;
  return validateOrPassthrough(DepartmentSchema, raw, id, 'departments');
}

// Departman sayısı doğası gereği küçüktür; yine de tasks/users/blockers
// listener'larıyla AYNI disiplin gereği (bkz. useFirestoreData.ts — sınırsız
// sorgu, org büyüdükçe okuma profilini öngörülemez kılar) üst sınır konur.
const DEPARTMENT_QUERY_LIMIT = 200;

/** Firestore `writeBatch` TEK commit'te en fazla 500 işlem alır. 450, aynı
 *  sınırın `functions/src/departmentBackfillCore.ts` tarafındaki karşılığıyla
 *  (commitInBatches) AYNI güvenlik payıdır — sınırın dibinde çalışmak, ileride
 *  chunk başına tek bir yardımcı yazım eklendiğinde sessizce taşardı. */
const MAX_BATCH_OPS = 450;

/** Referans tarama sorgularının sayfa boyutu. Taşınacak referanslar TEK bir
 *  `limit()` ile çekilmez: koleksiyon sayfa boyutundan büyükse geri kalanı
 *  sessizce dışarıda kalır ve yeniden adlandırma yarım bir taşımayla
 *  sonuçlanırdı (yetim referanslar). Bu yüzden imleçli (startAfter) bir
 *  döngüyle TAMAMI toplanır. */
const REFERENCE_PAGE_SIZE = 300;

/** Bir yeniden adlandırmada istemciden taşınabilecek referans üst sınırı
 *  (koleksiyon başına). Aşılırsa işlem sessizce kesilmez, AÇIKÇA reddedilir:
 *  bu ölçekte bir taşıma Spark kotası ve tarayıcı oturumu için uygun değildir,
 *  Admin SDK ile (bkz. functions/src/departmentBackfillCore.ts) yapılmalıdır. */
const MAX_REFERENCES_PER_COLLECTION = 5000;

type BatchOp = (batch: ReturnType<typeof writeBatch>) => void;

/** `departmentId == value` olan TÜM doküman ID'lerini imleçli sayfalama ile
 *  toplar. `orderBy(documentId())` deterministik ve tekrarsız bir imleç verir
 *  (eşitlik filtresi + __name__ sıralaması Firestore'un otomatik tek alan
 *  indeksleriyle karşılanır, ayrı bir bileşik indeks gerektirmez). */
async function collectReferenceIds(collectionName: 'tasks' | 'users', departmentId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: unknown = null;

  for (;;) {
    const base = [where('departmentId', '==', departmentId), orderBy(documentId())];
    const snapshot = await getDocs(
      cursor === null
        ? query(collection(db, collectionName), ...base, limit(REFERENCE_PAGE_SIZE))
        : query(collection(db, collectionName), ...base, startAfter(cursor), limit(REFERENCE_PAGE_SIZE))
    );

    const docs = snapshot.docs;
    for (const d of docs) ids.push(d.id);

    if (ids.length > MAX_REFERENCES_PER_COLLECTION) {
      throw new Error(
        `"${departmentId}" birimi ${MAX_REFERENCES_PER_COLLECTION}'den fazla ${collectionName === 'tasks' ? 'görev' : 'kullanıcı'} tarafından kullanılıyor — bu ölçekte bir taşıma uygulama üzerinden yapılamaz.`
      );
    }
    if (docs.length < REFERENCE_PAGE_SIZE) return ids;
    cursor = docs[docs.length - 1];
  }
}

/** Yazma işlemlerini 500'lük Firestore sınırının altında kalan parçalara bölüp
 *  sırayla commit eder. Sıra ANLAMLIDIR (bkz. renameDepartment): çağıran,
 *  bağımlılığı olan işlemleri (ör. eski dokümanın silinmesi) diziye en sona
 *  koyar; parçalar sırayla commit edildiğinden bu sıra korunur. */
async function commitInChunks(ops: BatchOp[]): Promise<void> {
  for (let i = 0; i < ops.length; i += MAX_BATCH_OPS) {
    const chunk = ops.slice(i, i + MAX_BATCH_OPS);
    await runWithRetry(async () => {
      const batch = writeBatch(db);
      chunk.forEach(op => op(batch));
      await batch.commit();
    });
  }
}

/** `departmentId == id` olan doküman sayısı. `count()` agregasyonu bilinçli
 *  olarak dokümanları ÇEKMEK yerine kullanılır: maliyeti doküman sayısından
 *  bağımsızdır (Spark okuma kotası) ve — silme ön-kontrolü için asıl önemlisi —
 *  SUNUCUYA gider. `getDocs` offline kalıcılıkla yerel önbellekten yanıtlanıp
 *  "referans yok" gibi YANLIŞ bir yeşil ışık verebilirdi. */
async function countReferences(collectionName: 'tasks' | 'users', id: string): Promise<number> {
  const snapshot = await getCountFromServer(
    query(collection(db, collectionName), where('departmentId', '==', id))
  );
  return snapshot.data().count;
}

export const departmentService = {
  /** Canlı departman listesi. Döndürdüğü fonksiyon aboneliği sonlandırır. */
  subscribe(
    onNext: (departments: Department[]) => void,
    onError: (error: unknown) => void
  ): () => void {
    return onSnapshot(
      query(collection(db, 'departments'), limit(DEPARTMENT_QUERY_LIMIT)),
      (snapshot) => {
        const list = snapshot.docs.map(d => toDepartment(d.id, d.data()));
        list.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
        onNext(list);
      },
      (error) => onError(error)
    );
  },

  /** Tek seferlik okuma — listener kurmanın anlamsız olduğu yerler için
   *  (ör. testler, tek atımlık doğrulamalar). */
  async listAll(): Promise<Department[]> {
    const snapshot = await getDocs(query(collection(db, 'departments'), limit(DEPARTMENT_QUERY_LIMIT)));
    const list = snapshot.docs.map(d => toDepartment(d.id, d.data()));
    list.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    return list;
  },

  /**
   * Yeni birim oluşturur (yalnızca Admin — firestore.rules bunu ayrıca
   * zorunlu kılar). Aynı adla ikinci kez çağrılması zararsızdır: doküman ID'si
   * adın kendisi olduğundan çağrı idempotenttir, mevcut kaydı aynı şekilde
   * yeniden yazar. `createdAt`'ın da yeniden yazılması kuralın
   * `incoming().createdAt == existing().createdAt` kısıtına takılacağından
   * mevcut değer korunmak zorundadır — bu yüzden var olan bir departman için
   * yazma hiç denenmez.
   */
  async createDepartment(rawName: string, actorId: string, existing: Department[] = []): Promise<string> {
    const name = normalizeDepartmentName(rawName);
    if (!isUsableAsDepartmentId(name)) {
      throw new Error('Birim adı geçersiz: eğik çizgi (/) içeremez ve 1-100 karakter olmalıdır.');
    }
    if (existing.some(d => d.id === name)) {
      // Zaten var — yeniden yazmak createdAt kısıtına takılırdı (yukarı bkz.).
      return name;
    }
    await runWithRetry(async () => {
      await setDoc(doc(db, 'departments', name), {
        name,
        createdAt: Date.now(),
        createdBy: actorId,
      });
    });
    return name;
  },

  /**
   * Bir birimi yeniden adlandırır.
   *
   * GERÇEK BİR "RENAME" YOKTUR: `name == doküman ID` invaryantı (firestore.rules
   * `isValidDepartment`) yüzünden dokümanın adı yerinde değiştirilemez —
   * değiştirmek eşitliği bozar ve kural yazımı reddeder. Bu yüzden işlem üç
   * adımlı bir TAŞIMAdır:
   *   1. yeni ID ile YENİ bir departman dokümanı,
   *   2. `departmentId == oldId` olan TÜM tasks/users dokümanlarının yeni ID'ye
   *      güncellenmesi,
   *   3. eski departman dokümanının silinmesi.
   *
   * ADIM SIRASI ZORUNLUDUR ve (2)'nin batch'lerinden ÖNCE (1) ayrı bir yazım
   * olarak commit edilir: `isValidTaskBusinessRules`/`userDepartmentIsValid`
   * hedef departmanı `exists()` ile doğrular, ve Firestore kuralları bir
   * batch içindeki YAZIMLARI görmez (get/exists her zaman batch ÖNCESİ durumu
   * okur) — yeni dokümanı aynı batch'e koymak her referans güncellemesini
   * "hayalet departman" gerekçesiyle reddettirirdi.
   *
   * `updatedAt`/`lockVersion`'a DOKUNULMAZ (functions/src/departmentBackfillCore.ts
   * ile AYNI gerekçe): bu bir yönetim taşımasıdır, kullanıcı eylemi değil.
   * `updatedAt` ilerletmek scheduledAudit'in "24 saattir atıl" denetimini
   * sıfırlar ve listelerde gerçek aktiviteyi gizler; `lockVersion` artırmak
   * açık istemcilerde sahte VERSION_MISMATCH üretir.
   *
   * ATOMİK DEĞİLDİR: referanslar 450'lik parçalar hâlinde commit edilir. Yarıda
   * kesilirse (ağ/oturum) hem eski hem yeni birim var olur ve referanslar ikiye
   * bölünmüş olur — bu, YETİM referans üretmeyen güvenli bir ara durumdur ve
   * aynı çağrı tekrarlandığında kalanlar taşınır (yeni doküman zaten var
   * olacağı için önce onun varlık kontrolünden geçmek gerekir; bkz. aşağıdaki
   * "zaten var" reddi — kalanı taşımak için birleştirme gerekir, bu fazın
   * kapsamı dışı).
   */
  async renameDepartment(
    oldId: string,
    newId: string,
    actorId: string
  ): Promise<{ tasksUpdated: number; usersUpdated: number }> {
    const from = normalizeDepartmentName(oldId);
    const to = normalizeDepartmentName(newId);

    // createDepartment ile AYNI doğrulama — yeni ad da bir doküman ID'si olacak.
    if (!isUsableAsDepartmentId(to)) {
      throw new Error('Birim adı geçersiz: eğik çizgi (/) içeremez ve 1-100 karakter olmalıdır.');
    }
    if (from === to) {
      throw new Error('Yeni birim adı mevcut adla aynı.');
    }

    const [oldSnapshot, newSnapshot] = await Promise.all([
      getDoc(doc(db, 'departments', from)),
      getDoc(doc(db, 'departments', to)),
    ]);
    if (!oldSnapshot.exists()) {
      throw new Error(`"${from}" adlı birim bulunamadı.`);
    }
    // İki birimi BİRLEŞTİRMEK bu fazın kapsamı dışındadır (YAGNI): birleştirme,
    // geri alınamaz biçimde iki organizasyon biriminin kayıtlarını tek havuzda
    // toplar ve ayrı bir onay/rapor akışı gerektirir.
    if (newSnapshot.exists()) {
      throw new Error(`"${to}" adında bir birim zaten var — iki birimi birleştirmek desteklenmiyor.`);
    }

    const [taskIds, userIds] = await Promise.all([
      collectReferenceIds('tasks', from),
      collectReferenceIds('users', from),
    ]);

    // (1) Yeni doküman — createDepartment ile AYNI şema. createdAt/createdBy
    // MEVCUT kayıttan devralınır: bu bir yeniden adlandırmadır, yeni bir birimin
    // kuruluşu değil — birimin kuruluş tarihini "şimdi"ye çekmek geçmişi
    // sessizce yeniden yazardı. Eski kayıt bozuksa (tip/eksik alan) kural
    // yazımı reddedeceğinden güvenli varsayılana düşülür.
    const previous = oldSnapshot.data() ?? {};
    const previousCreatedAt = typeof previous.createdAt === 'number' && previous.createdAt > 0
      ? previous.createdAt
      : Date.now();
    const previousCreatedBy = typeof previous.createdBy === 'string' && previous.createdBy.length > 0
      ? previous.createdBy
      : actorId;
    await runWithRetry(async () => {
      await setDoc(doc(db, 'departments', to), {
        name: to,
        createdAt: previousCreatedAt,
        createdBy: previousCreatedBy,
      });
    });

    // (2) Referanslar + (3) eski dokümanın silinmesi. Silme diziye EN SONA
    // konur: parçalar sırayla commit edildiğinden eski doküman, referansların
    // tamamı taşındıktan sonra kaybolur (aksi halde arada kalan referanslar
    // "var olmayan departman" durumuna düşer ve kendi kurallarınca
    // güncellenemez hâle gelirdi).
    const ops: BatchOp[] = [
      ...taskIds.map<BatchOp>(id => batch => batch.update(doc(db, 'tasks', id), { departmentId: to })),
      ...userIds.map<BatchOp>(id => batch => batch.update(doc(db, 'users', id), { departmentId: to })),
      batch => batch.delete(doc(db, 'departments', from)),
    ];
    await commitInChunks(ops);

    return { tasksUpdated: taskIds.length, usersUpdated: userIds.length };
  },

  /**
   * Bir birimi siler — YALNIZCA hiçbir görev/kullanıcı ona referans vermiyorsa.
   *
   * REFERANS BÜTÜNLÜĞÜ NEDEN İSTEMCİDE: silinen bir departmanın referansları
   * yetim kalır ve o görevler (departman eşleşmesi artık sağlanamayacağından)
   * sorumlusu dışında herkes için görünmez olur. Bu kontrol firestore.rules'ta
   * YAPILAMAZ: kurallar tek bir dokümana bakar, "başka bir koleksiyonda bu
   * değere referans veren doküman var mı" sorusunu soramaz (koleksiyon geneli
   * sorgu/agregasyon rules dilinde yoktur; `exists()` yalnızca BİLİNEN bir
   * doküman yolunu kontrol eder). Kalan tek sunucu tarafı seçenek bir Cloud
   * Function tetikleyicisiydi ve proje Spark planda olduğundan (bkz.
   * functions/CLAUDE.md — deploy Blaze gerektirir) o da kullanılamıyor.
   *
   * YARIŞ KOŞULU (bilinçli olarak kabul edildi): aşağıdaki sayım ile silme
   * arasında başka bir Admin/Müdür bu birime yeni bir görev/kullanıcı
   * atayabilir; o referans yetim kalır. Ön-kontrol ile silmeyi tek bir atomik
   * işleme bağlamanın istemci tarafında yolu yoktur (Firestore transaction'ı
   * yalnızca BİLİNEN dokümanlar üzerinde çalışır, sorgu sonucunu kilitleyemez).
   * Düşük frekanslı, yalnızca Admin'e açık ve etkisi geri alınabilir (birim
   * aynı adla yeniden oluşturulabilir, referanslar aynı string'i taşımaya
   * devam eder) bir işlem için kabul edilebilir bir risktir.
   * BLAZE'E GEÇİLİRSE: bu, `departments` üzerinde bir `onDelete` trigger'ı
   * (yetim referansları tespit edip telafi eden) ya da silmeyi tek yetkili
   * yol hâline getiren bir callable ile atomikleştirilebilir.
   */
  async deleteDepartment(id: string): Promise<void> {
    const name = normalizeDepartmentName(id);
    const [taskCount, userCount] = await Promise.all([
      countReferences('tasks', name),
      countReferences('users', name),
    ]);

    if (taskCount > 0 || userCount > 0) {
      throw new Error(
        `Bu birim hâlâ ${taskCount} görev ve ${userCount} kullanıcı tarafından kullanılıyor — önce onları başka bir birime taşıyın.`
      );
    }

    await runWithRetry(async () => {
      await deleteDoc(doc(db, 'departments', name));
    });
  }
};
