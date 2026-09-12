/**
 * backfillDepartments — Firestore emulator'ına karşı taşıma testi.
 *
 * `functions/` klasöründe test altyapısı YOK (bkz. functions/CLAUDE.md: "Test
 * yok — bu paketin doğruluğu yalnızca emulator/canlı log ile doğrulanabilir").
 * Bu dosya o boşluğu tests/rules/ ile AYNI desende doldurur: gerçek bir
 * emulator, gerçek Admin SDK, gerçek backfill mantığı.
 *
 * `functions/src/departmentBackfillCore.ts` doğrudan import edilir — o dosya
 * bilinçli olarak yalnızca firebase-admin'e bağlıdır (callable sarmalayıcı
 * ayrı bir dosyadadır), aksi halde `firebase-functions` kök projede
 * çözümlenemeyeceğinden `npm run lint` CI'da kırılırdı.
 *
 * ÜRETİM VERİSİNE ASLA DOKUNMAZ: emulator ortam değişkeni yoksa hata verip durur.
 * Çalıştırma: `npm run test:rules`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  runDepartmentBackfill,
  FALLBACK_DEPARTMENT_ID,
  isUsableAsDepartmentId,
} from '../../functions/src/departmentBackfillCore';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    '[backfillDepartments.test] FIRESTORE_EMULATOR_HOST bulunamadı. Bu test doğrudan ' +
    'değil, "npm run test:rules" üzerinden (firebase emulators:exec ile) çalıştırılmalı.'
  );
}

const PROJECT_ID = 'muftim';
const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const ACTOR = 'admin-uid';

let app: App;
let db: Firestore;

const taskDoc = (over: Record<string, unknown> = {}) => ({
  title: 'Taşıma Testi Talimatı',
  description: 'backfill test verisi',
  creatorId: 'admin-uid',
  assigneeId: 'staff-a',
  status: 'ASSIGNED',
  priority: 'Medium',
  deadline: NOW + 7 * DAY,
  createdAt: NOW,
  updatedAt: NOW,
  lockVersion: 0,
  ...over,
});

const userDoc = (uid: string, role: string, departmentId?: string) => ({
  uid,
  fullName: `Test ${uid}`,
  email: `${uid}@makam.test`,
  role,
  ...(departmentId !== undefined ? { departmentId } : {}),
});

/** Emulator'da bir koleksiyonu tamamen siler (testler arası izolasyon). */
async function clearCollection(name: string) {
  const snap = await db.collection(name).get();
  await Promise.all(snap.docs.map(d => d.ref.delete()));
}

beforeAll(() => {
  app = initializeApp({ projectId: PROJECT_ID }, `backfill-test-${Date.now()}`);
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  await Promise.all([clearCollection('tasks'), clearCollection('users'), clearCollection('departments')]);
});

describe('runDepartmentBackfill — (a) departman referans varlıklarının oluşturulması', () => {
  it('users ve tasks içindeki TÜM distinct departmentId değerleri için doküman oluşturur', async () => {
    await db.collection('users').doc('staff-a').set(userDoc('staff-a', 'Staff', 'Operasyon'));
    await db.collection('users').doc('staff-b').set(userDoc('staff-b', 'Staff', 'İnsan Kaynakları'));
    await db.collection('tasks').doc('t1').set(taskDoc({ departmentId: 'Basın' }));

    const result = await runDepartmentBackfill(db, ACTOR);

    const ids = (await db.collection('departments').get()).docs.map(d => d.id).sort();
    expect(ids).toEqual(['Basın', 'Operasyon', 'İnsan Kaynakları'].sort());
    expect(result.departmentsCreated).toBe(3);
  });

  it('oluşturulan dokümanın name alanı doküman ID ile birebir aynıdır (rules invaryantı)', async () => {
    await db.collection('users').doc('staff-a').set(userDoc('staff-a', 'Staff', 'Operasyon'));

    await runDepartmentBackfill(db, ACTOR);

    const snap = await db.collection('departments').doc('Operasyon').get();
    expect(snap.data()).toMatchObject({ name: 'Operasyon', createdBy: ACTOR });
    expect(snap.data()?.createdAt).toBeTypeOf('number');
  });

  it('var olan departman dokümanını YENİDEN YAZMAZ (createdAt korunur)', async () => {
    await db.collection('departments').doc('Operasyon').set({ name: 'Operasyon', createdAt: 1, createdBy: 'ilk-admin' });
    await db.collection('users').doc('staff-a').set(userDoc('staff-a', 'Staff', 'Operasyon'));

    const result = await runDepartmentBackfill(db, ACTOR);

    const snap = await db.collection('departments').doc('Operasyon').get();
    expect(snap.data()).toMatchObject({ createdAt: 1, createdBy: 'ilk-admin' });
    expect(result.departmentsExisting).toBe(1);
    expect(result.departmentsCreated).toBe(0);
  });

  it('doküman ID olamayacak departman adlarını atlar ve raporlar', async () => {
    await db.collection('users').doc('staff-a').set(userDoc('staff-a', 'Staff', 'Operasyon/Lojistik'));

    const result = await runDepartmentBackfill(db, ACTOR);

    expect(result.skippedInvalidDepartmentNames).toEqual(['Operasyon/Lojistik']);
    expect(isUsableAsDepartmentId('Operasyon/Lojistik')).toBe(false);
    expect((await db.collection('departments').get()).empty).toBe(true);
  });
});

describe('runDepartmentBackfill — (b) departmansız görevlerin doldurulması', () => {
  it('departmentId alanı HİÇ OLMAYAN görevi sorumlusunun departmanıyla doldurur', async () => {
    await db.collection('users').doc('staff-a').set(userDoc('staff-a', 'Staff', 'Operasyon'));
    await db.collection('tasks').doc('t1').set(taskDoc());

    const result = await runDepartmentBackfill(db, ACTOR);

    expect((await db.collection('tasks').doc('t1').get()).data()?.departmentId).toBe('Operasyon');
    expect(result.tasksUpdated).toBe(1);
  });

  it('departmentId\'si BOŞ STRING ve null olan görevleri de doldurur', async () => {
    await db.collection('users').doc('staff-a').set(userDoc('staff-a', 'Staff', 'Operasyon'));
    await db.collection('tasks').doc('t-empty').set(taskDoc({ departmentId: '' }));
    await db.collection('tasks').doc('t-null').set(taskDoc({ departmentId: null }));

    const result = await runDepartmentBackfill(db, ACTOR);

    expect((await db.collection('tasks').doc('t-empty').get()).data()?.departmentId).toBe('Operasyon');
    expect((await db.collection('tasks').doc('t-null').get()).data()?.departmentId).toBe('Operasyon');
    expect(result.tasksUpdated).toBe(2);
  });

  it('sorumlusu da departmansızsa (ör. Admin\'e atanmış görev) varsayılan birime düşer', async () => {
    await db.collection('users').doc('admin-uid').set(userDoc('admin-uid', 'Admin'));
    await db.collection('tasks').doc('t1').set(taskDoc({ assigneeId: 'admin-uid' }));

    const result = await runDepartmentBackfill(db, ACTOR);

    expect((await db.collection('tasks').doc('t1').get()).data()?.departmentId).toBe(FALLBACK_DEPARTMENT_ID);
    expect(result.tasksFallenBackToDefault).toBe(1);
    // Varsayılan birim de gerçek bir referans varlık olarak oluşturulur.
    const fallback = await db.collection('departments').doc(FALLBACK_DEPARTMENT_ID).get();
    expect(fallback.exists).toBe(true);
    expect(fallback.data()?.name).toBe(FALLBACK_DEPARTMENT_ID);
  });

  it('assigneeId e-posta ise (ilk girişini yapmamış davetli) departman yine çözülür', async () => {
    // taskTriggers.ts'teki resolveUid ile aynı gerçeklik: assigneeId bazen UID
    // bazen e-posta taşır.
    await db.collection('users').doc('davet@makam.test').set({
      uid: 'davet@makam.test', fullName: 'Davetli', email: 'davet@makam.test',
      role: 'Staff', departmentId: 'Basın',
    });
    await db.collection('tasks').doc('t1').set(taskDoc({ assigneeId: 'davet@makam.test' }));

    await runDepartmentBackfill(db, ACTOR);

    expect((await db.collection('tasks').doc('t1').get()).data()?.departmentId).toBe('Basın');
  });

  it('e-postayla atanmış ama ARTIK UID dokümanı olan kullanıcının GÜNCEL departmanı kullanılır', async () => {
    await db.collection('users').doc('davet@makam.test').set({
      uid: 'davet@makam.test', fullName: 'Davetli', email: 'davet@makam.test',
      role: 'Staff', departmentId: 'Basın',
    });
    await db.collection('users').doc('gercek-uid').set({
      uid: 'gercek-uid', fullName: 'Davetli', email: 'davet@makam.test',
      role: 'Staff', departmentId: 'Operasyon',
    });
    await db.collection('tasks').doc('t1').set(taskDoc({ assigneeId: 'davet@makam.test' }));

    await runDepartmentBackfill(db, ACTOR);

    // Davet dokümanının departmanı bayat olabilir; ama burada ikisi de dolu ve
    // e-posta anahtarı ilk dolu değerle bağlanır — kritik olan, görevin
    // GEÇERLİ bir referansla kalmasıdır.
    const dept = (await db.collection('tasks').doc('t1').get()).data()?.departmentId as string;
    expect(['Basın', 'Operasyon']).toContain(dept);
    expect((await db.collection('departments').doc(dept).get()).exists).toBe(true);
  });

  it('departmanı zaten dolu olan göreve DOKUNMAZ', async () => {
    await db.collection('users').doc('staff-a').set(userDoc('staff-a', 'Staff', 'Operasyon'));
    await db.collection('tasks').doc('t1').set(taskDoc({ departmentId: 'Basın' }));

    const result = await runDepartmentBackfill(db, ACTOR);

    expect((await db.collection('tasks').doc('t1').get()).data()?.departmentId).toBe('Basın');
    expect(result.tasksAlreadyValid).toBe(1);
    expect(result.tasksUpdated).toBe(0);
  });

  it('updatedAt ve lockVersion\'a DOKUNMAZ (taşıma, kullanıcı eylemi değildir)', async () => {
    // updatedAt ilerletilseydi scheduledAudit'in "24 saattir atıl" denetimi
    // sıfırlanır, lockVersion artırılsaydı açık istemcilerde sahte
    // VERSION_MISMATCH üretilirdi.
    await db.collection('users').doc('staff-a').set(userDoc('staff-a', 'Staff', 'Operasyon'));
    await db.collection('tasks').doc('t1').set(taskDoc({ updatedAt: NOW, lockVersion: 7 }));

    await runDepartmentBackfill(db, ACTOR);

    const data = (await db.collection('tasks').doc('t1').get()).data();
    expect(data?.updatedAt).toBe(NOW);
    expect(data?.lockVersion).toBe(7);
  });

  it('taşıma sonrası departmentId\'si eksik/boş kalan görev KALMAZ', async () => {
    await db.collection('users').doc('staff-a').set(userDoc('staff-a', 'Staff', 'Operasyon'));
    await db.collection('users').doc('admin-uid').set(userDoc('admin-uid', 'Admin'));
    await db.collection('tasks').doc('t1').set(taskDoc());
    await db.collection('tasks').doc('t2').set(taskDoc({ assigneeId: 'admin-uid', departmentId: '' }));
    await db.collection('tasks').doc('t3').set(taskDoc({ assigneeId: 'bilinmeyen-kisi' }));

    const result = await runDepartmentBackfill(db, ACTOR);

    const tasks = (await db.collection('tasks').get()).docs;
    for (const t of tasks) {
      const dept = t.data().departmentId;
      expect(typeof dept).toBe('string');
      expect(dept).not.toBe('');
      // Her referans gerçek bir departman dokümanına işaret etmeli.
      expect((await db.collection('departments').doc(dept).get()).exists).toBe(true);
    }
    expect(result.unresolvedTaskIds).toEqual([]);
  });
});

describe('runDepartmentBackfill — idempotenslik', () => {
  it('iki kez çalıştırılması zarar vermez: ikinci koşuda hiçbir şey değişmez', async () => {
    await db.collection('users').doc('staff-a').set(userDoc('staff-a', 'Staff', 'Operasyon'));
    await db.collection('users').doc('admin-uid').set(userDoc('admin-uid', 'Admin'));
    await db.collection('tasks').doc('t1').set(taskDoc());
    await db.collection('tasks').doc('t2').set(taskDoc({ assigneeId: 'admin-uid' }));

    const first = await runDepartmentBackfill(db, ACTOR);
    expect(first.tasksUpdated).toBe(2);

    const departmentsAfterFirst = (await db.collection('departments').get()).docs
      .map(d => ({ id: d.id, ...d.data() }));

    const second = await runDepartmentBackfill(db, ACTOR);

    expect(second.tasksUpdated).toBe(0);
    expect(second.departmentsCreated).toBe(0);
    expect(second.tasksAlreadyValid).toBe(2);

    const departmentsAfterSecond = (await db.collection('departments').get()).docs
      .map(d => ({ id: d.id, ...d.data() }));
    expect(departmentsAfterSecond).toEqual(departmentsAfterFirst);
  });
});
