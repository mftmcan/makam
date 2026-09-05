/**
 * firestore.rules — otomatik güvenlik kuralı test matrisi (P0-3).
 *
 * Bu dosya, `firestore.rules`'ın İDDİA ettiği güvenlik garantilerini (default
 * deny, rol ayrımı, departman izolasyonu, alan bazlı yazma kilidi, durum
 * makinesi, denetim izi değişmezliği) gerçek bir Firestore emulator'ına karşı
 * KANITLAR. Genel "çalışıyor mu" testleri değil, her testte tek bir somut
 * (rol × koleksiyon × işlem) kombinasyonu doğrulanır — bir kural yanlışlıkla
 * gevşetilirse ilgili test kırılır.
 *
 * Emulator zorunluluğu (bkz. scripts/seedE2E.ts'teki AYNI koruma deseni):
 * bu testler yalnızca `firebase emulators:exec` içinden, emulator ortam
 * değişkenleri set edilmişken çalışır — gerçek `makam-1453` projesine hiçbir
 * koşulda bağlanmaz. Çalıştırma: `npm run test:rules`.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// ── Emulator koruması ────────────────────────────────────────────────────────
// seedE2E.ts ile aynı sözleşme: ortam değişkeni yoksa hiçbir şey denemeden
// anlaşılır bir hata ile dur. `initializeTestEnvironment`, host/port'u bu
// değişkenden okur; değişken yoksa gerçek projeye gitmez ama sessizce
// bağlanamayıp anlamsız bir timeout üretir — açık hata mesajı daha iyidir.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    '[firestore.rules.test] FIRESTORE_EMULATOR_HOST bulunamadı. Bu testler doğrudan ' +
    'değil, "npm run test:rules" üzerinden (firebase emulators:exec ile) çalıştırılmalı.'
  );
}

const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const [EMULATOR_HOST, EMULATOR_PORT] = process.env.FIRESTORE_EMULATOR_HOST.split(':');

// firebase.json'da `singleProjectMode: true` olduğundan projectId, .firebaserc'
// deki emulator projesiyle AYNI olmalı — farklı bir id emulator tarafından
// reddedilir. Yine de bu yalnızca emulator içindeki izole bir projedir.
const PROJECT_ID = 'makam-1453';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

let testEnv: RulesTestEnvironment;

// ── Kimlikler ────────────────────────────────────────────────────────────────
// Admin YALNIZCA custom claim üzerinden Admin sayılır (rules'taki tercih edilen
// yol); Manager/Staff ise yalnızca users/{uid} dokümanındaki role alanından —
// bu asimetri firestore.rules'ta kasıtlıdır (bkz. isManager() yorumu).
const admin = () =>
  testEnv.authenticatedContext('admin-uid', {
    email: 'admin@makam.test',
    email_verified: true,
    admin: true,
  }).firestore();

const managerA = () =>
  testEnv.authenticatedContext('mgr-a', { email: 'mgr-a@makam.test', email_verified: true }).firestore();

const managerB = () =>
  testEnv.authenticatedContext('mgr-b', { email: 'mgr-b@makam.test', email_verified: true }).firestore();

const staffA = () =>
  testEnv.authenticatedContext('staff-a', { email: 'staff-a@makam.test', email_verified: true }).firestore();

/** dept-c'de tek başına duran personel — hiçbir seed görevi bu departmana ait
 *  değil, bu yüzden "başka departman" reddi testlerinin doğal öznesi. */
const staffC = () =>
  testEnv.authenticatedContext('staff-c', { email: 'staff-c@makam.test', email_verified: true }).firestore();

const anon = () => testEnv.unauthenticatedContext().firestore();

/**
 * Firestore'un istek başına 1000 ifade bütçesi aşıldığında emulator, ret
 * mesajının İÇİNE bu cümleyi koyar. Üretimde de aynı bütçe geçerlidir; aşım
 * fail-closed olduğu için isteği zaten reddeder, ama ret NEDENİNİ belirsizleştirir
 * ("kural mı reddetti, bütçe mi bitti?") ve günlükleri kirletir.
 */
const BUDGET_OVERFLOW = /maximum of 1000 expressions/i;

/**
 * `assertFails` + ret NEDENİNİN doğruluğu: istek reddedilmeli AMA reddin
 * gerekçesi ifade bütçesinin tükenmesi OLMAMALI.
 *
 * Neden gerekli (bkz. firestore.rules → canUpdateTask "İFADE BÜTÇESİ" yorumu):
 * REDDEDİLEN bir istekte Firestore kuralın TÜM ifade ağacını (kısa devre
 * YAPMADAN) değerlendirir, bu yüzden reddedilen yol izin verilen yoldan
 * belirgin biçimde pahalıdır. Bütçe aşılırsa her `assertFails` testi
 * "doğru nedenle mi geçti, yoksa bütçe bittiği için mi?" sorusunu açık
 * bırakır — bu yardımcı o belirsizliği testin kendisinde kapatır.
 */
async function assertFailsForRuleReason(op: Promise<unknown>): Promise<string> {
  let message = '';
  try {
    await op;
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  expect(message, 'istek reddedilmeliydi ama BAŞARILI oldu').not.toBe('');
  expect(message, 'ret, izin kuralından değil başka bir hatadan geliyor').toMatch(/PERMISSION_DENIED/);
  expect(
    message.replace(/\s+/g, ' '),
    'ret gerekçesi kuralın mantığı değil, 1000 ifade bütçesinin aşılması'
  ).not.toMatch(BUDGET_OVERFLOW);
  return message;
}

// ── Seed yardımcıları ────────────────────────────────────────────────────────
const userDoc = (uid: string, role: string, departmentId?: string) => ({
  uid,
  fullName: `Test ${uid}`,
  email: `${uid}@makam.test`,
  role,
  ...(departmentId !== undefined ? { departmentId } : {}),
});

/**
 * Sade (9 alanlı) görev dokümanı — durum makinesi ve rol matrisi testlerinin
 * ortak zemini. Alan sayısı burada KISITLAYICI DEĞİLDİR: gerçekçi genişlikteki
 * (24 alana kadar) dokümanların da Müdür/Memur tarafından güncellenebildiği
 * aşağıdaki "gerçekçi alan genişliği" bloğunda ayrıca kanıtlanır.
 *
 * (Bu yorum eskiden "10 alan geçer, 11. alanda ifade bütçesi aşılır" diyordu;
 * bu ölçüm HATALIYDI — bkz. aşağıdaki "ifade bütçesi" bloğunun açıklaması:
 * 11. alan olarak eklenen `lockVersion` reddi, bütçeden değil optimistic
 * locking kuralından kaynaklanıyordu.)
 */
const taskDoc = (over: Record<string, unknown> = {}) => ({
  title: 'Test Talimatı',
  description: 'firestore.rules test verisi',
  creatorId: 'mgr-a',
  assigneeId: 'staff-a',
  status: 'ASSIGNED',
  priority: 'Medium',
  deadline: NOW + 7 * DAY,
  updatedAt: NOW,
  departmentId: 'dept-a',
  ...over,
});

/** Her testten önce sıfırdan kurulan sabit dizge durumu. Testler doküman
 *  MUTASYONU yaptığından (durum geçişleri, silme) paylaşılan tek bir seed
 *  yeterli değil — beforeEach'te tamamen yeniden kurulur. */
/** departments/{id} dokümanı — doküman ID'si departmanın KENDİ değeridir ve
 *  `name` ile birebir aynı olmak zorundadır (bkz. firestore.rules
 *  isValidDepartment). Bu koleksiyon P0-2 ile eklendi: tasks/users
 *  departmentId'si artık burada var olan bir dokümana referans vermek
 *  zorunda. */
const departmentDoc = (id: string) => ({
  name: id,
  createdAt: NOW,
  createdBy: 'admin-uid',
});

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // Departman referans varlıkları — aşağıdaki users/tasks seed'lerinin
    // departmentId'leri bunlara işaret eder. 'dept-z' bilinçli olarak hiçbir
    // kullanıcıya/göreve atanmamıştır: "Admin herhangi bir departmanda görev
    // oluşturabilir" testinin öznesi odur.
    for (const id of ['dept-a', 'dept-b', 'dept-c', 'dept-z']) {
      await setDoc(doc(db, 'departments', id), departmentDoc(id));
    }

    await setDoc(doc(db, 'users', 'admin-uid'), userDoc('admin-uid', 'Admin', 'dept-a'));
    await setDoc(doc(db, 'users', 'mgr-a'), userDoc('mgr-a', 'Manager', 'dept-a'));
    await setDoc(doc(db, 'users', 'mgr-b'), userDoc('mgr-b', 'Manager', 'dept-b'));
    await setDoc(doc(db, 'users', 'staff-a'), userDoc('staff-a', 'Staff', 'dept-a'));
    await setDoc(doc(db, 'users', 'staff-c'), userDoc('staff-c', 'Staff', 'dept-c'));

    // İlk giriş taşıması için Admin'in e-posta ile açtığı davet dokümanı
    // (users/{email}) — bkz. rules `users` create kuralı.
    await setDoc(doc(db, 'users', 'davet@makam.test'), {
      uid: 'davet@makam.test',
      fullName: 'Davetli Personel',
      email: 'davet@makam.test',
      role: 'Staff',
      departmentId: 'dept-a',
    });

    // Departman/rol matrisi görevleri
    await setDoc(doc(db, 'tasks', 'task-a'), taskDoc());
    await setDoc(doc(db, 'tasks', 'task-b'), taskDoc({
      departmentId: 'dept-b', creatorId: 'mgr-b', assigneeId: 'mgr-b', status: 'IN_PROGRESS',
    }));
    // dept-b'de ama staff-c'ye atanmış — "atanan kişi departmandan bağımsız okur"
    await setDoc(doc(db, 'tasks', 'task-b-for-c'), taskDoc({
      departmentId: 'dept-b', creatorId: 'mgr-b', assigneeId: 'staff-c',
    }));
    // P0-1 REGRESYON zemini: bu iki doküman, kurallar SIKILAŞTIRILMADAN ÖNCE
    // üretimde oluşmuş "eski" (backfill edilmemiş) görevleri temsil eder —
    // artık bu biçimde YENİ görev oluşturulamıyor, ama var olanların da
    // dünyaya açık OLMAMASI gerekir. Bu yüzden yalnızca rules'ı bypass eden
    // seed ile yazılabilirler.
    const noDept: Record<string, unknown> = taskDoc({ creatorId: 'mgr-b', assigneeId: 'mgr-b' });
    delete noDept.departmentId;
    await setDoc(doc(db, 'tasks', 'task-no-dept'), noDept);
    await setDoc(doc(db, 'tasks', 'task-empty-dept'), taskDoc({
      departmentId: '', creatorId: 'mgr-b', assigneeId: 'mgr-b',
    }));

    // Durum makinesi görevleri — hepsi staff-a'ya atanmış, dept-a
    for (const status of [
      'ASSIGNED', 'PENDING_DELEGATION', 'IN_PROGRESS', 'BLOCKED',
      'AWAITING_APPROVAL', 'CRISIS', 'COMPLETED', 'CANCELLED',
    ]) {
      await setDoc(doc(db, 'tasks', `sm-${status}`), taskDoc({ status }));
    }
    // Devir hedefi Müdür olan görevler (hasValidDelegationTarget testleri)
    await setDoc(doc(db, 'tasks', 'sm-mgr-ASSIGNED'), taskDoc({ assigneeId: 'mgr-b' }));
    await setDoc(doc(db, 'tasks', 'sm-mgr-IN_PROGRESS'), taskDoc({ assigneeId: 'mgr-b', status: 'IN_PROGRESS' }));

    // lockVersion testleri için 10 alanlı (bütçe sınırındaki) görev
    await setDoc(doc(db, 'tasks', 'task-lock'), taskDoc({ lockVersion: 3 }));

    await setDoc(doc(db, 'blockers', 'blocker-a'), {
      id: 'blocker-a', taskId: 'task-a', reason: 'Tedarik gecikmesi',
      severity: 'High', isResolved: false, createdAt: NOW,
    });

    await setDoc(doc(db, 'audit_logs', 'log-a'), {
      taskId: 'task-a', changedBy: 'staff-a', oldValue: 'ASSIGNED',
      newValue: 'IN_PROGRESS', timestamp: NOW,
    });

    await setDoc(doc(db, 'notifications', 'notif-a'), {
      userId: 'staff-a', title: 'Yeni Talimat', message: 'Size bir talimat atandı.',
      type: 'TaskAssigned', taskId: 'task-a', timestamp: NOW, isRead: false,
    });

    await setDoc(doc(db, 'system', 'settings'), { sessionTimeoutMs: 30 * 60 * 1000 });
    await setDoc(doc(db, 'system', 'stats'), { totalTasks: 5, status_ASSIGNED: 3 });
    await setDoc(doc(db, 'system_logs', 'syslog-a'), {
      type: 'scheduledAudit', timestamp: NOW, idleTaskCount: 0, result: 'ok', source: 'scheduler',
    });
    await setDoc(doc(db, 'error_logs', 'err-a'), {
      message: 'Test hatası', source: 'manual', timestamp: NOW, appVersion: '2.3.0',
    });
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      host: EMULATOR_HOST,
      port: Number(EMULATOR_PORT),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed();
});

// =============================================================================
// 1. Default deny — oturum açmamış kullanıcı
// =============================================================================
describe('Yetkisiz (oturum açmamış) erişim', () => {
  it('tasks okuyamaz', async () => {
    await assertFails(getDoc(doc(anon(), 'tasks', 'task-a')));
  });

  it('users okuyamaz', async () => {
    await assertFails(getDoc(doc(anon(), 'users', 'staff-a')));
  });

  it('blockers okuyamaz', async () => {
    await assertFails(getDoc(doc(anon(), 'blockers', 'blocker-a')));
  });

  it('audit_logs okuyamaz', async () => {
    await assertFails(getDoc(doc(anon(), 'audit_logs', 'log-a')));
  });

  it('notifications okuyamaz', async () => {
    await assertFails(getDoc(doc(anon(), 'notifications', 'notif-a')));
  });

  it('system dokümanını okuyamaz', async () => {
    await assertFails(getDoc(doc(anon(), 'system', 'settings')));
  });

  it('tasks yazamaz', async () => {
    await assertFails(setDoc(doc(anon(), 'tasks', 'yeni'), taskDoc()));
  });

  it('error_logs yazamaz (istemci hata logu bile oturum ister)', async () => {
    await assertFails(setDoc(doc(anon(), 'error_logs', 'err-anon'), {
      message: 'x', source: 'manual', timestamp: NOW, appVersion: '2.3.0',
    }));
  });

  it('kural kapsamı dışındaki bir koleksiyon default-deny ile reddedilir', async () => {
    await assertFails(getDoc(doc(anon(), 'rastgele_koleksiyon', 'x')));
  });
});

// =============================================================================
// 2. Admin — tam erişim
// =============================================================================
describe('Admin (custom claim) yetkileri', () => {
  it('başka departmandaki görevi okuyabilir', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'tasks', 'task-b')));
  });

  it('kendi departmanı dışındaki bir departmanda da görev oluşturabilir', async () => {
    // dept-z hiçbir kullanıcıya atanmamış bir departmandır — Admin'in
    // departman kısıtına tabi olmadığını gösterir. (P0-2 sonrası departman
    // yine de GERÇEK olmak zorunda: var olmayan bir departman reddedilir,
    // bkz. "departments koleksiyonu" bloğu.)
    await assertSucceeds(setDoc(doc(admin(), 'tasks', 'yeni-admin-gorev'), taskDoc({
      departmentId: 'dept-z', creatorId: 'admin-uid',
    })));
  });

  it('başka departmandaki görevi güncelleyebilir', async () => {
    await assertSucceeds(updateDoc(doc(admin(), 'tasks', 'task-b'), { priority: 'Urgent', updatedAt: NOW + 1 }));
  });

  it('görev silebilir', async () => {
    await assertSucceeds(deleteDoc(doc(admin(), 'tasks', 'task-a')));
  });

  it('kullanıcı rolünü değiştirebilir', async () => {
    await assertSucceeds(updateDoc(doc(admin(), 'users', 'staff-a'), { role: 'Manager' }));
  });

  it('kullanıcı silebilir', async () => {
    await assertSucceeds(deleteDoc(doc(admin(), 'users', 'staff-c')));
  });

  it('başka departmanın engelini okuyabilir ve güncelleyebilir', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'blockers', 'blocker-a')));
    await assertSucceeds(updateDoc(doc(admin(), 'blockers', 'blocker-a'), { isResolved: true, resolvedAt: NOW + 1 }));
  });

  it('engel silebilir', async () => {
    await assertSucceeds(deleteDoc(doc(admin(), 'blockers', 'blocker-a')));
  });

  it('denetim izini okuyabilir ve yeni kayıt oluşturabilir', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'audit_logs', 'log-a')));
    await assertSucceeds(setDoc(doc(admin(), 'audit_logs', 'log-admin'), {
      taskId: 'task-b', changedBy: 'admin-uid', timestamp: NOW,
    }));
  });

  it('bildirim oluşturabilir ve silebilir', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'notifications', 'notif-admin'), {
      userId: 'staff-a', title: 'Duyuru', message: 'Test', type: 'Info',
      timestamp: NOW, isRead: false,
    }));
    await assertSucceeds(deleteDoc(doc(admin(), 'notifications', 'notif-a')));
  });

  it('system/settings dokümanını yazabilir', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'system', 'settings'), { sessionTimeoutMs: 15 * 60 * 1000 }));
  });

  it('system_logs okuyabilir', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'system_logs', 'syslog-a')));
  });

  it('error_logs okuyabilir ve silebilir', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'error_logs', 'err-a')));
    await assertSucceeds(deleteDoc(doc(admin(), 'error_logs', 'err-a')));
  });

  it('denetim izini DEĞİŞTİREMEZ (kanıt bütünlüğü — Admin dahil)', async () => {
    await assertFails(updateDoc(doc(admin(), 'audit_logs', 'log-a'), { newValue: 'DEĞİŞTİRİLDİ' }));
  });

  it('denetim izini SİLEMEZ (kanıt bütünlüğü — Admin dahil)', async () => {
    await assertFails(deleteDoc(doc(admin(), 'audit_logs', 'log-a')));
  });

  it('system_logs oluşturamaz (yalnızca Admin SDK yazar)', async () => {
    await assertFails(setDoc(doc(admin(), 'system_logs', 'syslog-fake'), {
      type: 'sahte', timestamp: NOW,
    }));
  });
});

// =============================================================================
// 3. Manager — departman izolasyonu
// =============================================================================
describe('Manager departman izolasyonu', () => {
  it('kendi departmanındaki görevi okuyabilir', async () => {
    await assertSucceeds(getDoc(doc(managerA(), 'tasks', 'task-a')));
  });

  it('BAŞKA departmanın görevini OKUYAMAZ', async () => {
    await assertFails(getDoc(doc(managerA(), 'tasks', 'task-b')));
  });

  it('kendisine atanmış başka departman görevini okuyabilir (atama, departmanı ezer)', async () => {
    await assertSucceeds(getDoc(doc(managerB(), 'tasks', 'task-b-for-c')));
  });

  it('kendi departmanında görev oluşturabilir', async () => {
    await assertSucceeds(setDoc(doc(managerA(), 'tasks', 'yeni-dept-a'), taskDoc({ creatorId: 'mgr-a' })));
  });

  it('BAŞKA departman için görev oluşturamaz', async () => {
    await assertFails(setDoc(doc(managerA(), 'tasks', 'yeni-dept-b'), taskDoc({
      creatorId: 'mgr-a', departmentId: 'dept-b',
    })));
  });

  it('yeni görevi ASSIGNED dışında bir durumla oluşturamaz', async () => {
    await assertFails(setDoc(doc(managerA(), 'tasks', 'yeni-inprogress'), taskDoc({
      creatorId: 'mgr-a', status: 'IN_PROGRESS',
    })));
  });

  it('kendi departmanındaki görevi güncelleyebilir', async () => {
    await assertSucceeds(updateDoc(doc(managerA(), 'tasks', 'task-a'), { priority: 'High', updatedAt: NOW + 1 }));
  });

  it('BAŞKA departmanın görevini güncelleyemez', async () => {
    await assertFails(updateDoc(doc(managerB(), 'tasks', 'task-a'), { priority: 'High', updatedAt: NOW + 1 }));
  });

  it('görevi kendi departmanı dışına TAŞIYAMAZ', async () => {
    await assertFails(updateDoc(doc(managerA(), 'tasks', 'task-a'), { departmentId: 'dept-b', updatedAt: NOW + 1 }));
  });

  it('görev SİLEMEZ (yalnızca Admin)', async () => {
    await assertFails(deleteDoc(doc(managerA(), 'tasks', 'task-a')));
  });

  it('kendi departmanındaki göreve bağlı engeli güncelleyebilir', async () => {
    await assertSucceeds(updateDoc(doc(managerA(), 'blockers', 'blocker-a'), {
      isResolved: true, resolvedAt: NOW + 1,
    }));
  });

  it('BAŞKA departmanın engelini güncelleyemez', async () => {
    await assertFails(updateDoc(doc(managerB(), 'blockers', 'blocker-a'), {
      isResolved: true, resolvedAt: NOW + 1,
    }));
  });

  it('engel SİLEMEZ (yalnızca Admin)', async () => {
    await assertFails(deleteDoc(doc(managerA(), 'blockers', 'blocker-a')));
  });

  it('kullanıcı silemez / rol değiştiremez', async () => {
    await assertFails(deleteDoc(doc(managerA(), 'users', 'staff-a')));
    await assertFails(updateDoc(doc(managerA(), 'users', 'staff-a'), { role: 'Admin' }));
  });
});

// =============================================================================
// 4. Staff — atama bazlı erişim
// =============================================================================
describe('Staff yetkileri', () => {
  it('kendisine atanan görevi okuyabilir', async () => {
    await assertSucceeds(getDoc(doc(staffA(), 'tasks', 'task-a')));
  });

  it('kendisine atanan görevin izinli alanlarını güncelleyebilir', async () => {
    await assertSucceeds(updateDoc(doc(staffA(), 'tasks', 'task-a'), {
      status: 'IN_PROGRESS', updatedAt: NOW + 1,
    }));
  });

  it('kendisine atanan görevin İZİNSİZ alanını (title) güncelleyemez — alan bazlı kilit', async () => {
    await assertFails(updateDoc(doc(staffA(), 'tasks', 'task-a'), {
      title: 'Yeniden adlandırıldı', updatedAt: NOW + 1,
    }));
  });

  it('kendisine atanan görevin sorumlusunu (assigneeId) değiştiremez', async () => {
    await assertFails(updateDoc(doc(staffA(), 'tasks', 'task-a'), {
      assigneeId: 'staff-c', updatedAt: NOW + 1,
    }));
  });

  it('kendisine atanan görevin öncelik/deadline alanlarını değiştiremez', async () => {
    await assertFails(updateDoc(doc(staffA(), 'tasks', 'task-a'), {
      priority: 'Urgent', updatedAt: NOW + 1,
    }));
    await assertFails(updateDoc(doc(staffA(), 'tasks', 'task-a'), {
      deadline: NOW + 30 * DAY, updatedAt: NOW + 1,
    }));
  });

  it('BAŞKA departmandaki, kendisine atanmamış görevi okuyamaz', async () => {
    await assertFails(getDoc(doc(staffC(), 'tasks', 'task-a')));
  });

  it('BAŞKA departmandaki görevi güncelleyemez', async () => {
    await assertFails(updateDoc(doc(staffC(), 'tasks', 'task-a'), {
      status: 'IN_PROGRESS', updatedAt: NOW + 1,
    }));
  });

  it('görev oluşturamaz (yalnızca Admin/Manager)', async () => {
    await assertFails(setDoc(doc(staffA(), 'tasks', 'staff-gorev'), taskDoc({ creatorId: 'staff-a' })));
  });

  it('görev silemez', async () => {
    await assertFails(deleteDoc(doc(staffA(), 'tasks', 'task-a')));
  });

  it('kendi kullanıcı dokümanında yalnızca profil alanlarını değiştirebilir', async () => {
    await assertSucceeds(updateDoc(doc(staffA(), 'users', 'staff-a'), { fullName: 'Yeni İsim' }));
  });

  it('kendi ROLÜNÜ yükseltemez (yetki yükseltme reddi)', async () => {
    await assertFails(updateDoc(doc(staffA(), 'users', 'staff-a'), { role: 'Admin' }));
  });

  it('kendi departmanını değiştiremez (departman izolasyonunu atlatma reddi)', async () => {
    await assertFails(updateDoc(doc(staffA(), 'users', 'staff-a'), { departmentId: 'dept-b' }));
  });

  it('başka bir kullanıcının profilini değiştiremez', async () => {
    await assertFails(updateDoc(doc(staffA(), 'users', 'staff-c'), { fullName: 'Ele geçirildi' }));
  });

  it('system_logs okuyamaz', async () => {
    await assertFails(getDoc(doc(staffA(), 'system_logs', 'syslog-a')));
  });

  it('error_logs okuyamaz ama oluşturabilir', async () => {
    await assertFails(getDoc(doc(staffA(), 'error_logs', 'err-a')));
    await assertSucceeds(setDoc(doc(staffA(), 'error_logs', 'err-staff'), {
      message: 'İstemci hatası', source: 'ErrorBoundary', timestamp: NOW,
      appVersion: '2.3.0', userId: 'staff-a',
    }));
  });

  it('başka bir kullanıcı adına sahte error_log yazamaz', async () => {
    await assertFails(setDoc(doc(staffA(), 'error_logs', 'err-sahte'), {
      message: 'Sahte', source: 'manual', timestamp: NOW,
      appVersion: '2.3.0', userId: 'mgr-a',
    }));
  });
});

// =============================================================================
// 5. P0-1 REGRESYONU — departmansız görev artık organizasyona AÇIK DEĞİL
// =============================================================================
describe('P0-1 REGRESYONU: departmentId olmayan/boş görev artık herkese açık DEĞİL', () => {
  // Bu blok, Faz 1'de "bilinçli olarak mevcut açık davranışı doğruluyoruz"
  // notuyla eklenmiş testlerin TERSİNE ÇEVRİLMİŞ hâlidir. O testler
  // `assertSucceeds` ile P0-1'i KANITLIYORDU: firestore.rules `tasks` read
  // kuralındaki `!('departmentId' in existing())` / `== null` / `== ""`
  // fallback'leri, departmanı atanmamış her görevi TÜM oturum açmış
  // kullanıcılara okunur kılıyordu. Fallback'ler kaldırıldı; aşağıdaki
  // `assertFails`'ler boşluğun gerçekten kapandığının kanıtıdır.
  //
  // Aynı zamanda bir ÜST SINIR testi: bu görevlerin sorumlusu (mgr-b) onları
  // hâlâ okuyabilmelidir — sıkılaştırma, meşru erişimi kesmemelidir.

  it('departmentId alanı HİÇ OLMAYAN görevi, alakasız departmandaki Staff artık OKUYAMAZ', async () => {
    await assertFails(getDoc(doc(staffC(), 'tasks', 'task-no-dept')));
  });

  it('departmentId alanı BOŞ STRING olan görevi, alakasız departmandaki Staff artık OKUYAMAZ', async () => {
    await assertFails(getDoc(doc(staffC(), 'tasks', 'task-empty-dept')));
  });

  it('departmanı BOŞ olan görev, departmanı ATANMAMIŞ bir kullanıcıyla ("" == "") eşleşerek de açılmaz', async () => {
    // getUserDepartment() departmanı olmayan kullanıcı için boş dize döner —
    // kural `!= ''` kapısı olmadan bu iki boş değeri eşitleyip görevi
    // açardı. staff-nodept'in departmanı hiç yok.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'staff-nodept'), userDoc('staff-nodept', 'Staff'));
    });
    const noDeptStaff = testEnv
      .authenticatedContext('staff-nodept', { email: 'staff-nodept@makam.test', email_verified: true })
      .firestore();
    await assertFails(getDoc(doc(noDeptStaff, 'tasks', 'task-empty-dept')));
  });

  it('departmansız görevin SORUMLUSU onu hâlâ okuyabilir (sıkılaştırma meşru erişimi kesmez)', async () => {
    await assertSucceeds(getDoc(doc(managerB(), 'tasks', 'task-no-dept')));
  });

  it('denetim izindeki aynı sızıntı da kapandı: departmansız göreve ait audit_log okunamaz', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'audit_logs', 'log-no-dept'), {
        taskId: 'task-no-dept', changedBy: 'mgr-b', oldValue: 'ASSIGNED',
        newValue: 'IN_PROGRESS', timestamp: NOW,
      });
    });
    await assertFails(getDoc(doc(staffC(), 'audit_logs', 'log-no-dept')));
  });

  it('departmansız göreve bağlı engel (blocker) de artık alakasız kullanıcıya açık değil', async () => {
    // taskGrantsAccess() içindeki AYNI üç fallback kaldırıldı — aksi halde
    // P0-1 sızıntısı tasks kapatılsa bile blockers üzerinden sürerdi.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'blockers', 'blocker-no-dept'), {
        id: 'blocker-no-dept', taskId: 'task-no-dept', reason: 'Departmansız görev engeli',
        severity: 'Low', isResolved: false, createdAt: NOW,
      });
    });
    await assertFails(getDoc(doc(staffC(), 'blockers', 'blocker-no-dept')));
  });

  it('departmansız görev artık OLUŞTURULAMAZ (Admin dahil): departmentId zorunlu alandır', async () => {
    const noDept: Record<string, unknown> = taskDoc({ creatorId: 'admin-uid' });
    delete noDept.departmentId;
    await assertFails(setDoc(doc(admin(), 'tasks', 'yeni-departmansiz'), noDept));
  });

  it('boş departmanlı görev de oluşturulamaz', async () => {
    await assertFails(setDoc(doc(admin(), 'tasks', 'yeni-bos-departman'), taskDoc({
      creatorId: 'admin-uid', departmentId: '',
    })));
  });

  it('Müdür artık departmanı boş bırakarak organizasyon geneline açık görev oluşturamaz', async () => {
    const noDept: Record<string, unknown> = taskDoc({ creatorId: 'mgr-a' });
    delete noDept.departmentId;
    await assertFails(setDoc(doc(managerA(), 'tasks', 'mgr-departmansiz'), noDept));
  });
});

// =============================================================================
// 5b. P0-2 — departments referans varlığı
// =============================================================================
describe('departments koleksiyonu (P0-2 referans varlığı)', () => {
  const validDept = (id: string) => ({ name: id, createdAt: NOW, createdBy: 'admin-uid' });

  it('oturum açmış herkes departman listesini okuyabilir (atama/filtre sözlüğü)', async () => {
    await assertSucceeds(getDoc(doc(staffC(), 'departments', 'dept-a')));
  });

  it('oturum açmamış kullanıcı departman okuyamaz', async () => {
    await assertFails(getDoc(doc(anon(), 'departments', 'dept-a')));
  });

  it('Admin yeni departman oluşturabilir', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'departments', 'Operasyon'), validDept('Operasyon')));
  });

  it('doküman ID\'sinde Türkçe karakter ve boşluk kabul edilir (isValidId KULLANILMAZ)', async () => {
    // Mevcut üretim değerleri serbest metindir ve AYNEN ID olarak kullanılır —
    // isValidId()'nin ASCII regex'i burada uygulansaydı gerçek departmanların
    // çoğu taşınamazdı (bkz. firestore.rules isValidDepartmentId yorumu).
    await assertSucceeds(setDoc(doc(admin(), 'departments', 'İnsan Kaynakları'), validDept('İnsan Kaynakları')));
  });

  it('Müdür departman oluşturamaz', async () => {
    await assertFails(setDoc(doc(managerA(), 'departments', 'Yeni Birim'), validDept('Yeni Birim')));
  });

  it('Memur departman oluşturamaz', async () => {
    await assertFails(setDoc(doc(staffA(), 'departments', 'Yeni Birim'), validDept('Yeni Birim')));
  });

  it('name, doküman ID\'sinden farklı olamaz (hayalet departman koruması)', async () => {
    await assertFails(setDoc(doc(admin(), 'departments', 'Operasyon'), validDept('Operasyonn')));
  });

  it('şema dışı alan eklenemez (hasOnly alan kilidi)', async () => {
    await assertFails(setDoc(doc(admin(), 'departments', 'Operasyon'), {
      ...validDept('Operasyon'), yetkiSeviyesi: 'sinirsiz',
    }));
  });

  it('zorunlu alan eksikse reddedilir', async () => {
    await assertFails(setDoc(doc(admin(), 'departments', 'Operasyon'), { name: 'Operasyon' }));
  });

  it('Admin departman silebilir', async () => {
    // dept-z hiçbir kullanıcıya/göreve atanmamıştır (bkz. seed yorumu).
    await assertSucceeds(deleteDoc(doc(admin(), 'departments', 'dept-z')));
  });

  it('Müdür departman silemez', async () => {
    await assertFails(deleteDoc(doc(managerA(), 'departments', 'dept-z')));
  });

  it('Memur departman silemez', async () => {
    await assertFails(deleteDoc(doc(staffA(), 'departments', 'dept-z')));
  });

  it('kurallar HÂLÂ kullanımdaki bir departmanın silinmesini engelleyemez (referans kontrolü istemcidedir)', async () => {
    // Bu test bir GÜVENLİK GARANTİSİ DEĞİL, bilinçli bir tasarım sınırının
    // kaydıdır: kural dilinde koleksiyon geneli sorgu/agregasyon yoktur, bu
    // yüzden "bu departmana referans veren görev var mı" sorusu burada
    // sorulamaz. dept-a'ya task-a ve üç kullanıcı referans verdiği hâlde silme
    // BAŞARILI olur — yetim referansları önleyen tek katman
    // departmentService.deleteDepartment'ın count() ön-kontrolüdür (Spark
    // planda Cloud Function tetikleyicisi kullanılamıyor; bkz. firestore.rules
    // departments bloğu ve o fonksiyonun yarış koşulu notu).
    await assertSucceeds(deleteDoc(doc(admin(), 'departments', 'dept-a')));
  });

  it('createdAt/createdBy güncellemeyle değiştirilemez', async () => {
    await assertFails(updateDoc(doc(admin(), 'departments', 'dept-a'), { createdAt: NOW + 1 }));
    await assertFails(updateDoc(doc(admin(), 'departments', 'dept-b'), { createdBy: 'mgr-a' }));
  });

  it('var olmayan bir departmana referans veren görev OLUŞTURULAMAZ', async () => {
    await assertFails(setDoc(doc(admin(), 'tasks', 'hayalet-dept-gorev'), taskDoc({
      creatorId: 'admin-uid', departmentId: 'Bu-Birim-Yok',
    })));
  });

  it('görev, var olmayan bir departmana TAŞINAMAZ', async () => {
    await assertFails(updateDoc(doc(admin(), 'tasks', 'task-a'), {
      departmentId: 'Bu-Birim-Yok', updatedAt: NOW + 1,
    }));
  });

  it('Admin, görevi var olan başka bir departmana taşıyabilir', async () => {
    await assertSucceeds(updateDoc(doc(admin(), 'tasks', 'task-a'), {
      departmentId: 'dept-z', updatedAt: NOW + 1,
    }));
  });

  it('Admin, kullanıcıyı var olmayan bir departmana atayamaz', async () => {
    await assertFails(updateDoc(doc(admin(), 'users', 'staff-a'), { departmentId: 'Bu-Birim-Yok' }));
  });

  it('Admin, kullanıcıyı var olan bir departmana atayabilir', async () => {
    await assertSucceeds(updateDoc(doc(admin(), 'users', 'staff-a'), { departmentId: 'dept-z' }));
  });

  it('Admin kullanıcısı departmansız KALABİLİR (org geneli çalışır)', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'users', 'yeni-admin'), {
      uid: 'yeni-admin', fullName: 'Yeni Yönetici', email: 'yeni-admin@makam.test', role: 'Admin',
    }));
  });
});

// =============================================================================
// 5c. Departman yeniden adlandırma = referans TAŞIMASI
// =============================================================================
/**
 * `name == doküman ID` invaryantı yüzünden bir departman YERİNDE yeniden
 * adlandırılamaz; departmentService.renameDepartment bunun yerine üç adımlı bir
 * taşıma yapar. Bu blok, o adımların kurallar tarafından GERÇEKTEN kabul
 * edildiğini ve sıranın neden zorunlu olduğunu emulator'a karşı kanıtlar.
 */
describe('departman yeniden adlandırma (referans taşıması)', () => {
  const validDept = (id: string) => ({ name: id, createdAt: NOW, createdBy: 'admin-uid' });

  it('taşıma yazımı yalnızca departmentId içerir — updatedAt/lockVersion olmadan da kabul edilir', async () => {
    // renameDepartment tam olarak bunu yazar: updatedAt/lockVersion'a bilinçli
    // olarak DOKUNULMAZ (yönetim taşıması, kullanıcı eylemi değil — bkz.
    // functions/src/departmentBackfillCore.ts'teki aynı gerekçe). Diğer
    // departman testleri updatedAt'i de gönderdiğinden bu yol ayrıca
    // doğrulanmalı: `isValidTaskUpdate`/`isValidTaskBusinessRules` bu minimal
    // yazımı da geçirmek zorunda.
    await assertSucceeds(updateDoc(doc(admin(), 'tasks', 'task-a'), { departmentId: 'dept-z' }));
    await assertSucceeds(updateDoc(doc(admin(), 'users', 'staff-a'), { departmentId: 'dept-z' }));
  });

  it('yeni departman AYNI batch içinde oluşturulursa referans güncellemesi REDDEDİLİR', async () => {
    // Kuralların `exists()` çağrıları batch ÖNCESİ durumu okur — aynı batch'te
    // yazılan departman dokümanı görünmez. renameDepartment'ın yeni dokümanı
    // referans batch'lerinden ÖNCE ayrı bir yazımla commit etmesinin nedeni
    // budur; bu test o gerekçenin hâlâ geçerli olduğunu kanıtlar.
    const db = admin();
    const batch = writeBatch(db);
    batch.set(doc(db, 'departments', 'Taşınan Birim'), validDept('Taşınan Birim'));
    batch.update(doc(db, 'tasks', 'task-a'), { departmentId: 'Taşınan Birim' });
    await assertFails(batch.commit());
  });

  it('doğru sırada (önce yeni doküman, sonra referanslar, en son silme) taşıma tamamlanır', async () => {
    // (1) yeni doküman — ayrı commit
    await assertSucceeds(setDoc(doc(admin(), 'departments', 'Taşınan Birim'), validDept('Taşınan Birim')));

    // (2) referanslar — tek batch (gerçek akışta 450'lik parçalar)
    const db = admin();
    const batch = writeBatch(db);
    batch.update(doc(db, 'tasks', 'task-a'), { departmentId: 'Taşınan Birim' });
    batch.update(doc(db, 'users', 'staff-a'), { departmentId: 'Taşınan Birim' });
    // (3) eski dokümanın silinmesi AYNI batch'in sonunda
    batch.delete(doc(db, 'departments', 'dept-a'));
    await assertSucceeds(batch.commit());
  });

  it('Müdür bu taşımayı yapamaz (yeni birim oluşturamaz, eskisini silemez)', async () => {
    await assertFails(setDoc(doc(managerA(), 'departments', 'Taşınan Birim'), validDept('Taşınan Birim')));
    await assertFails(deleteDoc(doc(managerA(), 'departments', 'dept-a')));
  });
});

// =============================================================================
// 6. Durum makinesi (isValidTransition)
// =============================================================================
describe('Durum makinesi — geçerli geçişler', () => {
  const ok = (from: string, to: string) =>
    it(`${from} → ${to} kabul edilir`, async () => {
      await assertSucceeds(updateDoc(doc(staffA(), 'tasks', `sm-${from}`), {
        status: to, updatedAt: NOW + 1,
      }));
    });

  ok('ASSIGNED', 'IN_PROGRESS');
  ok('ASSIGNED', 'BLOCKED');
  ok('ASSIGNED', 'CANCELLED');
  ok('PENDING_DELEGATION', 'IN_PROGRESS');
  ok('PENDING_DELEGATION', 'BLOCKED');
  ok('PENDING_DELEGATION', 'CANCELLED');
  ok('IN_PROGRESS', 'BLOCKED');
  ok('IN_PROGRESS', 'AWAITING_APPROVAL');
  ok('IN_PROGRESS', 'COMPLETED');
  ok('IN_PROGRESS', 'CANCELLED');
  ok('IN_PROGRESS', 'CRISIS');
  ok('BLOCKED', 'IN_PROGRESS');
  ok('BLOCKED', 'CANCELLED');
  ok('AWAITING_APPROVAL', 'COMPLETED');
  ok('AWAITING_APPROVAL', 'IN_PROGRESS');
  ok('AWAITING_APPROVAL', 'CANCELLED');
  ok('CRISIS', 'IN_PROGRESS');
  ok('CRISIS', 'COMPLETED');
  ok('CRISIS', 'AWAITING_APPROVAL');
  ok('CRISIS', 'CANCELLED');

  it('aynı duruma yazma (no-op) kabul edilir', async () => {
    await assertSucceeds(updateDoc(doc(staffA(), 'tasks', 'sm-COMPLETED'), {
      status: 'COMPLETED', updatedAt: NOW + 1,
    }));
  });

  // PENDING_DELEGATION yalnızca Müdür → Müdür yapılabilir (hasValidDelegationTarget),
  // bu yüzden bu iki geçiş sorumlusu Manager olan görevler üzerinden test edilir.
  it('ASSIGNED → PENDING_DELEGATION kabul edilir (sorumlu Müdür ise)', async () => {
    await assertSucceeds(updateDoc(doc(managerA(), 'tasks', 'sm-mgr-ASSIGNED'), {
      status: 'PENDING_DELEGATION', updatedAt: NOW + 1,
    }));
  });

  it('IN_PROGRESS → PENDING_DELEGATION kabul edilir (sorumlu Müdür ise)', async () => {
    await assertSucceeds(updateDoc(doc(managerA(), 'tasks', 'sm-mgr-IN_PROGRESS'), {
      status: 'PENDING_DELEGATION', updatedAt: NOW + 1,
    }));
  });

  it('PENDING_DELEGATION, sorumlusu Memur olan bir görevde reddedilir', async () => {
    await assertFails(updateDoc(doc(managerA(), 'tasks', 'sm-ASSIGNED'), {
      status: 'PENDING_DELEGATION', updatedAt: NOW + 1,
    }));
  });
});

describe('Durum makinesi — geçersiz geçişler', () => {
  const denied = (from: string, to: string) =>
    it(`${from} → ${to} reddedilir`, async () => {
      await assertFails(updateDoc(doc(staffA(), 'tasks', `sm-${from}`), {
        status: to, updatedAt: NOW + 1,
      }));
    });

  // COMPLETED ve CANCELLED terminaldir — hiçbir hedefe (CANCELLED dahil) çıkış yok.
  denied('COMPLETED', 'IN_PROGRESS');
  denied('COMPLETED', 'CANCELLED');
  denied('COMPLETED', 'AWAITING_APPROVAL');
  denied('CANCELLED', 'IN_PROGRESS');
  denied('CANCELLED', 'COMPLETED');
  denied('CANCELLED', 'ASSIGNED');
  // Aktif durumlar arasındaki tanımsız kısayollar
  denied('ASSIGNED', 'COMPLETED');
  denied('ASSIGNED', 'AWAITING_APPROVAL');
  denied('ASSIGNED', 'CRISIS');
  denied('BLOCKED', 'COMPLETED');
  denied('BLOCKED', 'AWAITING_APPROVAL');
  denied('BLOCKED', 'CRISIS');
  denied('PENDING_DELEGATION', 'COMPLETED');
  denied('AWAITING_APPROVAL', 'CRISIS');

  it('geçersiz bir durum değeri hiç kabul edilmez', async () => {
    await assertFails(updateDoc(doc(staffA(), 'tasks', 'sm-ASSIGNED'), {
      status: 'YOK_BOYLE_DURUM', updatedAt: NOW + 1,
    }));
  });

  it('Admin, terminal durumdan çıkışı override edebilir (kasıtlı istisna)', async () => {
    await assertSucceeds(updateDoc(doc(admin(), 'tasks', 'sm-COMPLETED'), {
      status: 'IN_PROGRESS', updatedAt: NOW + 1,
    }));
  });
});

// =============================================================================
// 7. Optimistic locking (lockVersion) alan kısıtı
// =============================================================================
describe('lockVersion optimistic locking kısıtı', () => {
  // task-lock: lockVersion === 3
  it('lockVersion yalnızca +1 artabilir', async () => {
    await assertSucceeds(updateDoc(doc(staffA(), 'tasks', 'task-lock'), {
      status: 'IN_PROGRESS', lockVersion: 4, updatedAt: NOW + 1,
    }));
  });

  it('lockVersion sıçraması reddedilir', async () => {
    await assertFails(updateDoc(doc(staffA(), 'tasks', 'task-lock'), {
      status: 'IN_PROGRESS', lockVersion: 7, updatedAt: NOW + 1,
    }));
  });

  it('lockVersion geri alınamaz', async () => {
    await assertFails(updateDoc(doc(staffA(), 'tasks', 'task-lock'), {
      status: 'IN_PROGRESS', lockVersion: 2, updatedAt: NOW + 1,
    }));
  });

  it('Admin lockVersion kısıtının dışındadır (restoreBackup toplu yazımı)', async () => {
    await assertSucceeds(updateDoc(doc(admin(), 'tasks', 'task-lock'), {
      lockVersion: 42, updatedAt: NOW + 1,
    }));
  });
});

// =============================================================================
// 7b. Gerçekçi alan genişliği + ifade bütçesi (eski "P0-6" bulgusunun düzeltmesi)
// =============================================================================
describe('gerçekçi alan genişliğinde (24 alan) görev güncellemeleri', () => {
  // ── Eski "P0-6" iddiası ve neden YANLIŞ olduğu ────────────────────────────
  // Bu blok eskiden "10 alan geçer, 11 alan Firestore'un 1000 ifade bütçesini
  // aşar; yani üretimdeki tipik (geniş) görevler Müdür/Memur tarafından hiç
  // güncellenemiyor" diyordu. Emulator'a karşı yapılan ölçüm bunu ÇÜRÜTTÜ:
  //
  //  1) Oradaki 11. alan `lockVersion`'dı. lockVersion taşıyan bir görevde
  //     Admin olmayan her güncelleme bu alanı +1 artırmak ZORUNDADIR
  //     (optimistic locking, bkz. aşağıdaki bölüm 7). Test payload'ı artırmadığı
  //     için ret, ifade bütçesinden değil KURALIN KENDİSİNDEN geliyordu.
  //  2) lockVersion doğru şekilde artırıldığında, Admin olmayan güncellemeler
  //     9'dan 24 alana kadar HER genişlikte geçiyor. Alan sayısı bir eşik
  //     oluşturmuyor — aşağıdaki testler bunu sabitliyor.
  //
  // Ölçümün gerçekten gösterdiği şey: ifade bütçesi aşımı yalnızca REDDEDİLEN
  // (izin verilmeyen) güncellemelerde oluşuyordu; izin verilen hiçbir yolda
  // oluşmuyordu. Reddedilen istek zaten reddedileceği için (fail-closed)
  // gözlemlenebilir bir DAVRANIŞ farkı yoktu, ama ret gerekçesi belirsiz
  // kalıyordu.
  //
  // Bu aşım ARTIK YOK (bkz. firestore.rules → canUpdateTask "İFADE BÜTÇESİ"
  // yorumu): `written` kapıları ve iş kurallarındaki tek doküman okuması
  // toplam maliyeti bütçenin altına indirdi. Aşağıdaki ret testleri bu yüzden
  // yalnızca "reddedilir"i değil, "DOĞRU NEDENLE reddedilir"i de doğrular
  // (assertFailsForRuleReason).

  /** Üretimdeki bir görevin taşıyabileceği TÜM alanlar (24 alan). */
  const wideTaskDoc = (over: Record<string, unknown> = {}) => ({
    id: 'task-wide',
    parentId: 'parent-1',
    title: 'Geniş Talimat',
    description: 'tüm opsiyonel alanları taşıyan görev',
    creatorId: 'mgr-a',
    assigneeId: 'staff-a',
    coordinatorId: 'mgr-b',
    status: 'ASSIGNED',
    priority: 'Medium',
    deadline: NOW + 7 * DAY,
    createdAt: NOW,
    updatedAt: NOW,
    evidence: 'kanit metni',
    evidenceType: 'text',
    pausedAt: null,
    totalPausedTime: 0,
    comments: [],
    lockVersion: 3,
    departmentId: 'dept-a',
    completedAt: NOW,
    estimatedHours: 4,
    tags: ['acil'],
    checklist: [],
    changedBy: 'mgr-a',
    ...over,
  });

  const seedWide = async (id: string, over: Record<string, unknown> = {}) => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'tasks', id), wideTaskDoc(over));
    });
  };

  it('24 alanlı görevin TÜM alanları beklenen şemaya uyar (test verisi kendini doğrular)', async () => {
    // Bu test, aşağıdakilerin "yanlışlıkla dar bir doküman" üzerinde
    // çalışmadığını garanti eder.
    const keys = Object.keys(wideTaskDoc());
    expect(keys.length).toBe(24);
  });

  it('Müdür, 24 alanlı kendi departman görevini güncelleyebilir', async () => {
    await seedWide('wide-mgr');
    await assertSucceeds(updateDoc(doc(managerA(), 'tasks', 'wide-mgr'), {
      priority: 'High', updatedAt: NOW + 1, lockVersion: 4,
    }));
  });

  it('Memur, 24 alanlı kendi görevini (izinli alanlarla) güncelleyebilir', async () => {
    await seedWide('wide-staff');
    await assertSucceeds(updateDoc(doc(staffA(), 'tasks', 'wide-staff'), {
      status: 'IN_PROGRESS', updatedAt: NOW + 1, lockVersion: 4, changedBy: 'staff-a',
    }));
  });

  it('Memur, 24 alanlı görevde durum geçişi + kanıt yazabilir', async () => {
    await seedWide('wide-staff-2', { status: 'IN_PROGRESS' });
    await assertSucceeds(updateDoc(doc(staffA(), 'tasks', 'wide-staff-2'), {
      status: 'AWAITING_APPROVAL', evidence: 'tamamlandı', evidenceType: 'text',
      updatedAt: NOW + 1, lockVersion: 4,
    }));
  });

  it('Admin, 24 alanlı görevi güncelleyebilir (lockVersion kısıtının dışında)', async () => {
    await seedWide('wide-admin');
    await assertSucceeds(updateDoc(doc(admin(), 'tasks', 'wide-admin'), {
      priority: 'Urgent', updatedAt: NOW + 1,
    }));
  });

  // ── Güvenlik regresyonu: genişlik yetkilendirmeyi GEVŞETMEMELİ ────────────
  it('BAŞKA departmanın Müdürü 24 alanlı görevi güncelleyemez', async () => {
    await seedWide('wide-deny-mgr');
    await assertFailsForRuleReason(updateDoc(doc(managerB(), 'tasks', 'wide-deny-mgr'), {
      priority: 'High', updatedAt: NOW + 1, lockVersion: 4,
    }));
  });

  it('başkasının 24 alanlı görevini Memur güncelleyemez', async () => {
    await seedWide('wide-deny-staff');
    await assertFailsForRuleReason(updateDoc(doc(staffC(), 'tasks', 'wide-deny-staff'), {
      status: 'IN_PROGRESS', updatedAt: NOW + 1, lockVersion: 4,
    }));
  });

  it('Memur, 24 alanlı görevde İZİNSİZ alanı (title) değiştiremez', async () => {
    await seedWide('wide-deny-title');
    await assertFailsForRuleReason(updateDoc(doc(staffA(), 'tasks', 'wide-deny-title'), {
      title: 'Yeniden adlandırıldı', updatedAt: NOW + 1, lockVersion: 4,
    }));
  });

  it('24 alanlı görevde geçersiz durum geçişi hâlâ reddedilir', async () => {
    await seedWide('wide-deny-transition', { status: 'COMPLETED' });
    await assertFailsForRuleReason(updateDoc(doc(staffA(), 'tasks', 'wide-deny-transition'), {
      status: 'IN_PROGRESS', updatedAt: NOW + 1, lockVersion: 4,
    }));
  });

  it('24 alanlı görevde lockVersion artırılmazsa reddedilir', async () => {
    await seedWide('wide-deny-lock');
    await assertFailsForRuleReason(updateDoc(doc(staffA(), 'tasks', 'wide-deny-lock'), {
      status: 'IN_PROGRESS', updatedAt: NOW + 1,
    }));
  });

  it('24 alanlı görevde şema dışı alan enjekte edilemez', async () => {
    await seedWide('wide-deny-extra');
    await assertFailsForRuleReason(updateDoc(doc(staffA(), 'tasks', 'wide-deny-extra'), {
      keyfiAlan: 'x', updatedAt: NOW + 1, lockVersion: 4,
    }));
  });
});

// =============================================================================
// 7c. İfade bütçesi regresyonu + `changed` / `written` ayrımı
// =============================================================================
describe('ifade bütçesi: 24 alanlı istekler 1000 ifade sınırını AŞMAZ', () => {
  const wideTaskDoc = (over: Record<string, unknown> = {}) => ({
    id: 'task-wide', parentId: 'parent-1', title: 'Geniş Talimat',
    description: 'tüm opsiyonel alanları taşıyan görev',
    creatorId: 'mgr-a', assigneeId: 'staff-a', coordinatorId: 'mgr-b',
    status: 'ASSIGNED', priority: 'Medium', deadline: NOW + 7 * DAY,
    createdAt: NOW, updatedAt: NOW, evidence: 'kanit metni', evidenceType: 'text',
    pausedAt: null, totalPausedTime: 0, comments: [], lockVersion: 3,
    departmentId: 'dept-a', completedAt: NOW, estimatedHours: 4,
    tags: ['acil'], checklist: [], changedBy: 'mgr-a', ...over,
  });
  const seedWide = async (id: string, over: Record<string, unknown> = {}) => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'tasks', id), wideTaskDoc(over));
    });
  };

  // ── Bütçe ────────────────────────────────────────────────────────────────
  // REDDEDİLEN yol, kuralın TÜM ifade ağacını (kısa devre yapmadan)
  // değerlendirdiği için izin verilen yoldan pahalıdır; bütçe aşımı bu yüzden
  // ÖNCE burada görülürdü. İzin verilen yolda ayrı bir iddiaya gerek yoktur:
  // aşım fail-closed olduğundan isteği reddederdi, yani BAŞARI = aşım yok.
  it('reddedilen 24 alanlı istek, bütçe aşımıyla DEĞİL kural mantığıyla reddedilir', async () => {
    await seedWide('budget-deny');
    const message = await assertFailsForRuleReason(
      updateDoc(doc(staffC(), 'tasks', 'budget-deny'), {
        status: 'IN_PROGRESS', updatedAt: NOW + 1, lockVersion: 4,
      })
    );
    // Yardımcının iddiası tersine dönerse (ör. regex hiçbir şeye uymaz hale
    // gelirse) sessiz yanlış-yeşil olmasın diye mesajın gerçekten kuralı
    // işaret ettiğini de doğrula.
    expect(message).toMatch(/for 'update'/);
  });

  it('izin verilen 24 alanlı istek geçer (aşım olsaydı fail-closed reddedilirdi)', async () => {
    await seedWide('budget-allow');
    await assertSucceeds(updateDoc(doc(managerA(), 'tasks', 'budget-allow'), {
      priority: 'High', updatedAt: NOW + 1, lockVersion: 4,
    }));
  });

  // ── `changed` (affectedKeys) ile `written` (added ∪ changed) ayrımı ───────
  // Tip/şema doğrulaması `written` kapılarını kullanır (silinen alana tip
  // kontrolü uygulanamaz); yetki zincirindeki alan kilidi ise `changed`
  // kullanmak ZORUNDADIR. Aşağıdaki iki test bu ayrımı sabitler: ikisi de
  // alan SİLME işlemidir ve yalnızca doğru kümeyle doğru sonucu verir.
  it('Memur, yazma izni OLMAYAN bir alanı SİLEREK alan kilidini atlatamaz', async () => {
    // `tags` Memur'un yazabileceği alanlar listesinde değil. Silme işlemi
    // affectedKeys'te görünür ama added∪changed'de GÖRÜNMEZ — alan kilidi
    // `written` üzerinden kurulsaydı bu istek sessizce GEÇERDİ.
    await seedWide('del-forbidden');
    await assertFailsForRuleReason(
      updateDoc(doc(staffA(), 'tasks', 'del-forbidden'), {
        tags: deleteField(), updatedAt: NOW + 1, lockVersion: 4,
      })
    );
  });

  it('Memur, yazma izni OLAN bir alanı silebilir (tip kontrolü yok olan alana uygulanmaz)', async () => {
    await seedWide('del-allowed');
    await assertSucceeds(updateDoc(doc(staffA(), 'tasks', 'del-allowed'), {
      evidence: deleteField(), updatedAt: NOW + 1, lockVersion: 4,
    }));
  });
});

describe('changedBy: sahtecilik koruması korunur, kilitlenme düzeltilir', () => {
  // Eskiden isValidTaskUpdate `!('changedBy' in data) || data.changedBy ==
  // request.auth.uid` diyordu. `data` bir güncellemede dokümanın BİRLEŞTİRİLMİŞ
  // hâli olduğundan, changedBy bir kez yazıldıktan sonra o alan hep önceki
  // yazarın uid'ini taşıyordu ve BAŞKA hiçbir kullanıcı görevi
  // güncelleyemiyordu. Kontrol artık yalnızca changedBy bu istekte GERÇEKTEN
  // değiştiğinde uygulanır.
  it('changedBy başkasına aitken, sorumlusu görevi güncelleyebilir', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'tasks', 'cb-task'), taskDoc({ changedBy: 'mgr-a' }));
    });
    await assertSucceeds(updateDoc(doc(staffA(), 'tasks', 'cb-task'), {
      status: 'IN_PROGRESS', updatedAt: NOW + 1,
    }));
  });

  it('başka bir kullanıcı adına sahte changedBy YAZILAMAZ', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'tasks', 'cb-task-2'), taskDoc());
    });
    await assertFails(updateDoc(doc(staffA(), 'tasks', 'cb-task-2'), {
      status: 'IN_PROGRESS', changedBy: 'mgr-a', updatedAt: NOW + 1,
    }));
  });

  it('kendi uid’ini changedBy olarak yazabilir', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'tasks', 'cb-task-3'), taskDoc());
    });
    await assertSucceeds(updateDoc(doc(staffA(), 'tasks', 'cb-task-3'), {
      status: 'IN_PROGRESS', changedBy: 'staff-a', updatedAt: NOW + 1,
    }));
  });
});

describe('users/{uid} dokümanı olmayan sorumlu (ilk giriş öncesi)', () => {
  // canUpdateTask()'teki `let` bağlamaları TEMBELDİR ve kimlik dokümanı tek bir
  // get() ile okunur. Kullanıcı dokümanı YOKSA bu okuma null döner ve kural
  // Müdür dalını atlayıp sorumlu (assignee) dalına düşer. Bu test, o tembelliği
  // ve null-güvenliğini sabitler: eskiden geniş dokümanlarda bu yol ifade
  // bütçesini aşıp meşru bir güncellemeyi reddedebiliyordu.
  const ghost = () =>
    testEnv.authenticatedContext('ghost-uid', {
      email: 'ghost@makam.test', email_verified: true,
    }).firestore();

  it('users dokümanı olmayan sorumlu, kendi görevini güncelleyebilir', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'tasks', 'ghost-task'), taskDoc({ assigneeId: 'ghost-uid' }));
    });
    await assertSucceeds(updateDoc(doc(ghost(), 'tasks', 'ghost-task'), {
      status: 'IN_PROGRESS', updatedAt: NOW + 1,
    }));
  });

  it('users dokümanı olmayan kullanıcı, kendisine ait OLMAYAN görevi güncelleyemez', async () => {
    await assertFails(updateDoc(doc(ghost(), 'tasks', 'task-a'), {
      status: 'IN_PROGRESS', updatedAt: NOW + 1,
    }));
  });
});

// =============================================================================
// 8. audit_logs — sahtecilik ve değişmezlik
// =============================================================================
describe('audit_logs kanıt bütünlüğü', () => {
  it('kendi işlemi için denetim kaydı oluşturabilir', async () => {
    await assertSucceeds(setDoc(doc(staffA(), 'audit_logs', 'log-yeni'), {
      taskId: 'task-a', changedBy: 'staff-a', oldValue: 'ASSIGNED',
      newValue: 'IN_PROGRESS', timestamp: NOW + 1,
    }));
  });

  // taskTitle: kaydın yazıldığı andaki görev başlığının donmuş kopyası
  // (bkz. taskService.auditTaskTitle, P1-14). ŞEMA AÇISINDAN OPSİYONELDİR —
  // alanı taşıyan yeni kayıtlar da, taşımayan eski kayıtlar/yollar da
  // yazılabilmelidir; aşağıdaki üç test bu sözleşmenin üç kenarını tutar.
  it('denetim kaydı denormalize taskTitle alanıyla yazılabilir', async () => {
    await assertSucceeds(setDoc(doc(staffA(), 'audit_logs', 'log-baslikli'), {
      taskId: 'task-a', taskTitle: 'A Görevi', changedBy: 'staff-a',
      oldValue: 'ASSIGNED', newValue: 'IN_PROGRESS', timestamp: NOW + 1,
    }));
  });

  it('taskTitle OLMADAN da yazılabilir (geriye dönük uyumluluk — backfill yok)', async () => {
    // Bu alan yalnızca bundan sonra yazılan kayıtlarda dolu olacak; eski
    // kayıtlara geriye dönük backfill YAPILMADI. Kural bu yüzden alanı zorunlu
    // kılmamalı, aksi halde başlığı bilinmeyen her yol (ör. görev başlığını
    // elinde tutmayan bir çağıran) sunucudan reddedilirdi.
    await assertSucceeds(setDoc(doc(staffA(), 'audit_logs', 'log-basliksiz'), {
      taskId: 'task-a', changedBy: 'staff-a',
      oldValue: 'ASSIGNED', newValue: 'IN_PROGRESS', timestamp: NOW + 1,
    }));
  });

  it('taskTitle 200 karakter sınırını aşamaz / string olmalı', async () => {
    // Sınır, isValidTask'taki title sınırıyla (<=200) BİLEREK aynıdır —
    // meşru hiçbir görev başlığı bu kapıya takılamaz, yalnızca şişirme
    // denemeleri takılır (audit_logs silinemediği için kalıcı yük olurdu).
    await assertFails(setDoc(doc(staffA(), 'audit_logs', 'log-uzun-baslik'), {
      taskId: 'task-a', taskTitle: 'x'.repeat(201), changedBy: 'staff-a', timestamp: NOW + 1,
    }));
    await assertFails(setDoc(doc(staffA(), 'audit_logs', 'log-sayi-baslik'), {
      taskId: 'task-a', taskTitle: 42, changedBy: 'staff-a', timestamp: NOW + 1,
    }));
  });

  // logType: kaydın yazım anında belirlenen işlem tipi (bkz.
  // taskService.auditLogType, P2-22). taskTitle ile AYNI sözleşme — şema
  // açısından opsiyoneldir — ama ek olarak DEĞER KÜMESİ de kısıtlanır:
  // audit_logs silinemediği için şemaya uymayan bir değer sonsuza dek kalır ve
  // `where` eşitliğiyle hiçbir tip filtresine düşmeyen "görünmez" bir kayıt
  // üretirdi.
  it('denetim kaydı logType: STATUS ile yazılabilir', async () => {
    await assertSucceeds(setDoc(doc(staffA(), 'audit_logs', 'log-tip-status'), {
      taskId: 'task-a', logType: 'STATUS', changedBy: 'staff-a',
      oldValue: 'ASSIGNED', newValue: 'IN_PROGRESS', timestamp: NOW + 1,
    }));
  });

  it('denetim kaydı logType: FIELD ile yazılabilir', async () => {
    await assertSucceeds(setDoc(doc(staffA(), 'audit_logs', 'log-tip-field'), {
      taskId: 'task-a', logType: 'FIELD', changedBy: 'staff-a',
      oldValue: 'Kısmi Güncelleme', newValue: 'Kısmi Güncelleme', timestamp: NOW + 1,
      changes: { description: { old: 'a', new: 'b' } },
    }));
  });

  it('logType OLMADAN da yazılabilir (geriye dönük uyumluluk — backfill yok)', async () => {
    // Alanı zorunlu kılmak, bu alandan önce kuyruğa alınmış bekleyen offline
    // mutasyonların senkronunu da sunucudan reddettirirdi (bkz.
    // offlineQueue.writeWithAuditLog'daki opsiyonel logType).
    await assertSucceeds(setDoc(doc(staffA(), 'audit_logs', 'log-tipsiz'), {
      taskId: 'task-a', changedBy: 'staff-a',
      oldValue: 'ASSIGNED', newValue: 'IN_PROGRESS', timestamp: NOW + 1,
    }));
  });

  it('logType yalnızca STATUS/FIELD olabilir — keyfi değer veya yanlış tip reddedilir', async () => {
    await assertFails(setDoc(doc(staffA(), 'audit_logs', 'log-tip-keyfi'), {
      taskId: 'task-a', logType: 'KEYFI', changedBy: 'staff-a', timestamp: NOW + 1,
    }));
    await assertFails(setDoc(doc(staffA(), 'audit_logs', 'log-tip-sayi'), {
      taskId: 'task-a', logType: 7, changedBy: 'staff-a', timestamp: NOW + 1,
    }));
    // Küçük/büyük harf duyarlıdır: istemcinin yazdığı değer, sorgunun
    // aradığı değerle BİREBİR aynı olmalı, aksi halde kayıt filtreye düşmez.
    await assertFails(setDoc(doc(staffA(), 'audit_logs', 'log-tip-kucuk'), {
      taskId: 'task-a', logType: 'status', changedBy: 'staff-a', timestamp: NOW + 1,
    }));
  });

  it('BAŞKA bir kullanıcı adına sahte denetim kaydı yazamaz', async () => {
    await assertFails(setDoc(doc(staffA(), 'audit_logs', 'log-sahte'), {
      taskId: 'task-a', changedBy: 'mgr-a', timestamp: NOW + 1,
    }));
  });

  it('erişimi olmayan bir görev için denetim kaydı yazamaz', async () => {
    await assertFails(setDoc(doc(staffC(), 'audit_logs', 'log-yabanci'), {
      taskId: 'task-a', changedBy: 'staff-c', timestamp: NOW + 1,
    }));
  });

  it('şemada tanımsız bir alan enjekte edilemez (hasOnly alan kilidi)', async () => {
    await assertFails(setDoc(doc(staffA(), 'audit_logs', 'log-ekalan'), {
      taskId: 'task-a', changedBy: 'staff-a', timestamp: NOW + 1,
      keyfiAlan: 'x'.repeat(50),
    }));
  });

  it('kendi kaydını okuyabilir; alakasız departmandaki bir kullanıcı okuyamaz', async () => {
    await assertSucceeds(getDoc(doc(staffA(), 'audit_logs', 'log-a')));
    await assertFails(getDoc(doc(staffC(), 'audit_logs', 'log-a')));
  });
});

// =============================================================================
// 9. notifications — sahiplik ve alan kilidi
// =============================================================================
describe('notifications sahiplik kuralları', () => {
  it('kendi bildirimini okuyabilir', async () => {
    await assertSucceeds(getDoc(doc(staffA(), 'notifications', 'notif-a')));
  });

  it('başkasının bildirimini okuyamaz', async () => {
    await assertFails(getDoc(doc(staffC(), 'notifications', 'notif-a')));
  });

  it('yalnızca isRead alanını güncelleyebilir', async () => {
    await assertSucceeds(updateDoc(doc(staffA(), 'notifications', 'notif-a'), { isRead: true }));
  });

  it('bildirim metnini değiştiremez (alan bazlı kilit)', async () => {
    await assertFails(updateDoc(doc(staffA(), 'notifications', 'notif-a'), { title: 'Değiştirildi' }));
  });

  it('başka bir kullanıcı için bildirim oluşturamaz', async () => {
    await assertFails(setDoc(doc(staffA(), 'notifications', 'notif-sahte'), {
      userId: 'mgr-a', title: 'Sahte', message: 'Test', type: 'Info',
      timestamp: NOW, isRead: false,
    }));
  });

  it('bildirim silemez (yalnızca Admin)', async () => {
    await assertFails(deleteDoc(doc(staffA(), 'notifications', 'notif-a')));
  });
});

// =============================================================================
// 10. system/{docId} — dar sayaç istisnası
// =============================================================================
describe('system koleksiyonu yazma kısıtları', () => {
  it('oturum açmış herkes system dokümanlarını okuyabilir', async () => {
    await assertSucceeds(getDoc(doc(staffA(), 'system', 'settings')));
  });

  it('Admin olmayan kullanıcı yalnızca system/stats sayaç alanlarını yazabilir', async () => {
    await assertSucceeds(setDoc(doc(staffA(), 'system', 'stats'), {
      totalTasks: 6, status_ASSIGNED: 4,
    }));
  });

  it('Admin olmayan kullanıcı system/stats dokümanına sayaç dışı alan yazamaz', async () => {
    await assertFails(setDoc(doc(staffA(), 'system', 'stats'), {
      totalTasks: 6, keyfiAlan: true,
    }));
  });

  it('Admin olmayan kullanıcı system/settings dokümanını yazamaz', async () => {
    await assertFails(setDoc(doc(staffA(), 'system', 'settings'), { sessionTimeoutMs: 999 }));
  });

  it('Admin olmayan kullanıcı system/sla_config dokümanını yazamaz', async () => {
    await assertFails(setDoc(doc(managerA(), 'system', 'sla_config'), {
      Low: { value: 1, unit: 'days' },
    }));
  });
});

// =============================================================================
// 11. users — ilk giriş taşıması ve yetki yükseltme reddi
// =============================================================================
describe('users ilk giriş taşıması (davet dokümanı)', () => {
  const invited = () =>
    testEnv.authenticatedContext('yeni-uid', {
      email: 'davet@makam.test',
      email_verified: true,
    }).firestore();

  it('davet dokümanıyla BİREBİR aynı rol ve departmanla kendi dokümanını oluşturabilir', async () => {
    await assertSucceeds(setDoc(doc(invited(), 'users', 'yeni-uid'), {
      uid: 'yeni-uid', fullName: 'Yeni Personel', email: 'davet@makam.test',
      role: 'Staff', departmentId: 'dept-a',
    }));
  });

  it('davetteki rolden farklı (yükseltilmiş) bir rolle oluşturamaz', async () => {
    await assertFails(setDoc(doc(invited(), 'users', 'yeni-uid'), {
      uid: 'yeni-uid', fullName: 'Yeni Personel', email: 'davet@makam.test',
      role: 'Admin', departmentId: 'dept-a',
    }));
  });

  it('davetteki departmandan farklı bir departmanla oluşturamaz', async () => {
    await assertFails(setDoc(doc(invited(), 'users', 'yeni-uid'), {
      uid: 'yeni-uid', fullName: 'Yeni Personel', email: 'davet@makam.test',
      role: 'Staff', departmentId: 'dept-b',
    }));
  });

  it('davet dokümanı olmayan bir e-posta ile kullanıcı oluşturulamaz', async () => {
    const stranger = testEnv.authenticatedContext('yabanci-uid', {
      email: 'yabanci@makam.test', email_verified: true,
    }).firestore();
    await assertFails(setDoc(doc(stranger, 'users', 'yabanci-uid'), {
      uid: 'yabanci-uid', fullName: 'Yabancı', email: 'yabanci@makam.test', role: 'Staff',
    }));
  });
});

// =============================================================================
// 12. Belgelenmiş davranışlar — kural metninin GERÇEKTE ne yaptığı
// =============================================================================
describe('Belgelenmiş (sürpriz olabilecek) mevcut davranışlar', () => {
  it('Staff, kendi departmanındaki BAŞKASINA ait görevi de okuyabilir (departman görünürlüğü rol bazlı daraltılmaz)', async () => {
    // firestore.rules `tasks` read kuralı departmanı role bakmadan açar:
    // aynı departmandaki her kullanıcı (Memur dahil) o departmanın tüm
    // görevlerini görebilir. Bu KASITLI bir tasarım (ekip görünürlüğü) —
    // burada test edilmesinin nedeni, ileride "Memur yalnızca kendi görevini
    // görsün" gibi bir daraltma yapılırsa bu testin bilinçli bir kararla
    // güncellenmesi gerektiğini garanti altına almaktır.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'tasks', 'task-a-baskasi'), taskDoc({ assigneeId: 'mgr-a' }));
    });
    await assertSucceeds(getDoc(doc(staffA(), 'tasks', 'task-a-baskasi')));
  });

  it('oturum açmış herkes TÜM kullanıcı dokümanlarını okuyabilir (personel dizini)', async () => {
    await assertSucceeds(getDoc(doc(staffC(), 'users', 'admin-uid')));
  });

  it('users update kuralı updatedAt alanına izin verirken isValidUser onu reddeder (tutarsızlık)', async () => {
    // `allow update` affectedKeys listesinde 'updatedAt' var, ama isValidUser'ın
    // hasOnly() alan kilidinde YOK — bu yüzden updatedAt taşıyan bir profil
    // güncellemesi pratikte HER ZAMAN reddedilir. Zararsız (fail-closed) ama
    // gerçek bir tutarsızlık; testle sabitleniyor ki düzeltilirse fark edilsin.
    await assertFails(updateDoc(doc(staffA(), 'users', 'staff-a'), {
      fullName: 'Yeni İsim', updatedAt: NOW + 1,
    }));
  });
});
