/**
 * settingsService testleri (P0-4).
 *
 * restoreBackup, uygulamadaki tek GERİ DÖNÜŞÜ OLMAYAN toplu veritabanı
 * işlemidir: mevcut personel/talimat/engel dokümanlarının üzerine chunk'lar
 * halinde yazar ve system/stats agregat sayaçlarını elle hesapladığı delta ile
 * düzeltir. Buna rağmen hiç birim testi yoktu (bkz. kod denetimi) — bu dosya
 * şema reddi, chunk sınırı ve sayaç deltası davranışlarını sabitler.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { settingsService } from './settingsService';
import * as firebase from '../firebase';
import { SESSION_TIMEOUT_STORAGE_KEY } from '../hooks/useSessionTimeout';
import {
  DEFAULT_SESSION_TIMEOUT_MS, SESSION_TIMEOUT_MIN_MS, SESSION_TIMEOUT_MAX_MS,
} from '../constants';

interface FakeBatch {
  set: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
}

let batches: FakeBatch[] = [];
/** getDoc'un doküman yolu → mevcut veri eşlemesi (yoksa exists()=false). */
let existingDocs: Record<string, Record<string, unknown>> = {};

const pathOf = (ref: unknown) => (ref as { __path: string }).__path;

const makeBackup = (over: Record<string, unknown> = {}) => ({
  system: 'MAKAM Stratejik Yönetim',
  users: [],
  tasks: [],
  blockers: [],
  ...over,
});

const validUser = (over: Record<string, unknown> = {}) => ({
  uid: 'user-1', fullName: 'Ali Veli', email: 'ali@makam.test', role: 'Staff', ...over,
});

const validTask = (over: Record<string, unknown> = {}) => ({
  id: 'task-1', title: 'Talimat', description: 'Açıklama',
  creatorId: 'mgr-1', assigneeId: 'user-1', status: 'ASSIGNED', priority: 'Medium',
  deadline: 1_700_000_000_000, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  batches = [];
  existingDocs = {};

  // doc(db, 'tasks', 'task-1') → { __path: 'tasks/task-1' }
  vi.mocked(firebase.doc).mockImplementation(
    ((_db: any, ...segments: string[]) => ({ __path: segments.join('/') })) as any
  );
  vi.mocked(firebase.collection).mockImplementation(((_db: any, name: string) => ({ __path: name })) as any);
  vi.mocked(firebase.increment).mockImplementation(((n: number) => ({ __increment: n })) as any);
  vi.mocked(firebase.setDoc).mockResolvedValue(undefined as any);
  vi.mocked(firebase.addDoc).mockResolvedValue({ id: 'log-1' } as any);
  vi.mocked(firebase.getDoc).mockImplementation((async (ref: any) => {
    const data = existingDocs[pathOf(ref)];
    return { exists: () => data !== undefined, data: () => data };
  }) as any);

  // setup.ts'teki global writeBatch mock'u `set` içermiyor (restoreBackup
  // yalnızca set kullanır) — burada her batch'i yakalayan bir sahte ile
  // değiştirilir ki chunk sınırı ve chunk başına stats deltası ölçülebilsin.
  vi.mocked(firebase.writeBatch).mockImplementation((() => {
    const batch: FakeBatch = {
      set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn().mockResolvedValue(undefined),
    };
    batches.push(batch);
    return batch;
  }) as any);
});

// ── Şema doğrulama / reddi ───────────────────────────────────────────────────
describe('restoreBackup — yedek şeması reddi', () => {
  it('geçersiz JSON metni için hata fırlatır', async () => {
    await expect(settingsService.restoreBackup('{ bozuk json', 'u1', 'x.json')).rejects.toThrow();
  });

  it('MAKAM yedeği olmayan bir JSON reddedilir', async () => {
    await expect(
      settingsService.restoreBackup(JSON.stringify({ hello: 'world' }), 'u1', 'x.json')
    ).rejects.toThrow('Yedek dosyası formatı geçersiz (MAKAM verisi değil).');
  });

  it('system alanı tanınmayan bir değer taşıyorsa reddedilir', async () => {
    await expect(
      settingsService.restoreBackup(JSON.stringify({ system: 'BAŞKA SİSTEM' }), 'u1', 'x.json')
    ).rejects.toThrow('Yedek dosyası formatı geçersiz (MAKAM verisi değil).');
  });

  it('eski marka adını (MAKAM Executive Control) taşıyan yedekler geriye dönük kabul edilir', async () => {
    const res = await settingsService.restoreBackup(
      JSON.stringify(makeBackup({ system: 'MAKAM Executive Control' })), 'u1', 'eski.json'
    );
    expect(res).toEqual({ userCount: 0, taskCount: 0, blockerCount: 0 });
  });

  it('geçersiz bir personel kaydı, hangi personel olduğunu söyleyerek reddedilir', async () => {
    const backup = makeBackup({ users: [validUser({ email: 'gecersiz-eposta', fullName: 'Hatalı Kayıt' })] });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json'))
      .rejects.toThrow(/Personel verisi doğrulanamadı \(Hatalı Kayıt\)/);
  });

  it('tanınmayan bir rol taşıyan personel kaydı reddedilir', async () => {
    const backup = makeBackup({ users: [validUser({ role: 'SuperAdmin' })] });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json'))
      .rejects.toThrow(/Personel verisi doğrulanamadı/);
  });

  it('geçersiz bir talimat kaydı, hangi talimat olduğunu söyleyerek reddedilir', async () => {
    const backup = makeBackup({ tasks: [validTask({ status: 'YOK_BOYLE_DURUM', title: 'Bozuk Talimat' })] });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json'))
      .rejects.toThrow(/Talimat verisi doğrulanamadı \(Bozuk Talimat\)/);
  });

  it('doğrulama başarısız olursa HİÇBİR yazma yapılmaz (kısmi geri yükleme yok)', async () => {
    const backup = makeBackup({
      users: [validUser()],
      tasks: [validTask(), validTask({ id: 'task-2', priority: 'YOK' })],
    });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json')).rejects.toThrow();
    // Doğrulama TÜM kayıtlar için yazmadan önce yapılır — tek bozuk kayıt
    // geçerli olanların da yazılmasını engellemeli.
    expect(batches).toHaveLength(0);
    expect(firebase.addDoc).not.toHaveBeenCalled();
  });
});

// ── Chunk sınırı ─────────────────────────────────────────────────────────────
describe('restoreBackup — chunk sınırı', () => {
  it('50 kayıtlık chunk sınırını aşmaz ve her chunk ayrı batch olarak commit edilir', async () => {
    const tasks = Array.from({ length: 120 }, (_, i) => validTask({ id: `task-${i}` }));
    await settingsService.restoreBackup(JSON.stringify(makeBackup({ tasks })), 'u1', 'x.json');

    expect(batches).toHaveLength(3); // 50 + 50 + 20
    // İlk iki batch: 50 görev + 1 stats yazımı; son batch: 20 görev + 1 stats
    expect(batches[0]!.set).toHaveBeenCalledTimes(51);
    expect(batches[1]!.set).toHaveBeenCalledTimes(51);
    expect(batches[2]!.set).toHaveBeenCalledTimes(21);
    batches.forEach(b => expect(b.commit).toHaveBeenCalledOnce());
  });

  it('tam 50 kayıt tek bir chunk olarak yazılır', async () => {
    const tasks = Array.from({ length: 50 }, (_, i) => validTask({ id: `task-${i}` }));
    await settingsService.restoreBackup(JSON.stringify(makeBackup({ tasks })), 'u1', 'x.json');
    expect(batches).toHaveLength(1);
  });

  it('kayıt yoksa hiç batch açılmaz ama denetim izi yine de düşülür', async () => {
    await settingsService.restoreBackup(JSON.stringify(makeBackup()), 'u1', 'bos.json');
    expect(batches).toHaveLength(0);
    expect(firebase.addDoc).toHaveBeenCalledOnce();
  });

  it('ilerleme yüzdesi her chunk sonunda ve en son %100 olarak bildirilir', async () => {
    const tasks = Array.from({ length: 120 }, (_, i) => validTask({ id: `task-${i}` }));
    const progress: number[] = [];
    await settingsService.restoreBackup(
      JSON.stringify(makeBackup({ tasks })), 'u1', 'x.json', p => progress.push(p)
    );
    expect(progress).toEqual([42, 83, 100]);
  });

  it('kullanıcı, görev ve engeller AYRI gruplarda, users → tasks → blockers sırasıyla yazılır', async () => {
    // Firestore kuralları bir batch İÇİNDEKİ yazımları görmez (get()/exists()
    // batch ÖNCESİ durumu okur) — bu yüzden users/tasks/blockers tek bir
    // karışık kuyrukta DEĞİL, üç ayrı grup/batch'te ve bu sırada commit edilir
    // (bkz. restoreBackup'taki writeGroup yorumu). Aksi halde AYNI batch'te
    // hem yeni bir kullanıcı hem onu assigneeId olarak referans eden bir görev
    // yazılırsa, görev tarafı o kullanıcıyı henüz YOK sayardı.
    const backup = makeBackup({
      users: [validUser()],
      tasks: [validTask()],
      blockers: [{ id: 'blk-1', taskId: 'task-1', reason: 'Engel', isResolved: false, createdAt: 1 }],
    });
    const res = await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    expect(res).toEqual({ userCount: 1, taskCount: 1, blockerCount: 1 });
    expect(batches).toHaveLength(3);
    expect(batches[0]!.set.mock.calls.map(([ref]) => pathOf(ref))).toContain('users/user-1');
    expect(batches[1]!.set.mock.calls.map(([ref]) => pathOf(ref))).toContain('tasks/task-1');
    expect(batches[2]!.set.mock.calls.map(([ref]) => pathOf(ref))).toContain('blockers/blk-1');
  });

  it('uid/id taşımayan kayıtlar sessizce atlanır (yazma hedefi yok)', async () => {
    const backup = makeBackup({
      users: [validUser({ uid: '' })],
      blockers: [{ taskId: 'task-1', reason: 'Engel', isResolved: false, createdAt: 1 }],
    });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');
    expect(batches).toHaveLength(0);
  });

  it('10\'dan fazla fcmTokens taşıyan bir kullanıcı EN YENİ 10 token\'a kırpılır (firestore.rules isValidUser sınırı)', async () => {
    const manyTokens = Array.from({ length: 96 }, (_, i) => `token-${i}`);
    const backup = makeBackup({ users: [validUser({ fcmTokens: manyTokens })] });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    const written = batches[0]!.set.mock.calls.find(([ref]) => pathOf(ref) === 'users/user-1');
    expect(written![1].fcmTokens).toEqual(manyTokens.slice(-10));
    expect(written![1].fcmTokens).toHaveLength(10);
  });

  it('10 veya daha az fcmTokens taşıyan bir kullanıcı olduğu gibi yazılır', async () => {
    const fewTokens = ['a', 'b', 'c'];
    const backup = makeBackup({ users: [validUser({ fcmTokens: fewTokens })] });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    const written = batches[0]!.set.mock.calls.find(([ref]) => pathOf(ref) === 'users/user-1');
    expect(written![1].fcmTokens).toEqual(fewTokens);
  });
});

// ── Departman referans bütünlüğü ─────────────────────────────────────────────
// firestore.rules userDepartmentIsValid / isValidTaskBusinessRules.hasValidDepartment
// bir departmentId'nin departments koleksiyonunda GERÇEKTEN var olmasını Admin
// dahil hiçbir istisna olmadan zorunlu kılar. Yedek, departments koleksiyonunu
// TAŞIMAZ — bu yüzden restoreBackup, referans edilen eksik departmanları
// users/tasks yazımından ÖNCE kendisi oluşturmak zorundadır (2026-09-12,
// muftim'e proje göçü sonrası "Missing or insufficient permissions" kök nedeni).
describe('restoreBackup — departman referans bütünlüğü', () => {
  it('yedekte referans edilen ama hedef projede olmayan departman, users/tasks yazımından ÖNCE oluşturulur', async () => {
    const backup = makeBackup({ users: [validUser({ departmentId: 'Operasyon' })] });
    await settingsService.restoreBackup(JSON.stringify(backup), 'admin-1', 'x.json');

    const deptCall = vi.mocked(firebase.setDoc).mock.calls.find(([ref]) => pathOf(ref) === 'departments/Operasyon');
    expect(deptCall).toBeDefined();
    expect(deptCall![1]).toMatchObject({ name: 'Operasyon', createdBy: 'admin-1' });
  });

  it('departman zaten varsa yeniden oluşturulmaz', async () => {
    existingDocs['departments/Operasyon'] = { name: 'Operasyon', createdAt: 1, createdBy: 'eski' };
    const backup = makeBackup({ tasks: [validTask({ departmentId: 'Operasyon' })] });
    await settingsService.restoreBackup(JSON.stringify(backup), 'admin-1', 'x.json');

    const deptCall = vi.mocked(firebase.setDoc).mock.calls.find(([ref]) => pathOf(ref) === 'departments/Operasyon');
    expect(deptCall).toBeUndefined();
  });

  it('users ve tasks içindeki aynı departmentId için departman yalnızca BİR kez oluşturulur', async () => {
    const backup = makeBackup({
      users: [validUser({ departmentId: 'Operasyon' })],
      tasks: [validTask({ departmentId: 'Operasyon' })],
    });
    await settingsService.restoreBackup(JSON.stringify(backup), 'admin-1', 'x.json');

    const deptCalls = vi.mocked(firebase.setDoc).mock.calls.filter(([ref]) => pathOf(ref) === 'departments/Operasyon');
    expect(deptCalls).toHaveLength(1);
  });
});

// ── system/stats delta hesabı ────────────────────────────────────────────────
describe('restoreBackup — system/stats delta hesabı', () => {
  const statsPayloadOf = (batch: FakeBatch) => {
    const call = batch.set.mock.calls.find(([ref]) => pathOf(ref) === 'system/stats');
    return call?.[1] as Record<string, { __increment: number }> | undefined;
  };

  it('veritabanında olmayan görev için totalTasks ve status sayacı +1 artar', async () => {
    const backup = makeBackup({ tasks: [validTask({ status: 'IN_PROGRESS' })] });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    expect(statsPayloadOf(batches[0]!)).toEqual({
      totalTasks: { __increment: 1 },
      status_IN_PROGRESS: { __increment: 1 },
    });
  });

  it('mevcut görevin durumu DEĞİŞMİYORSA hiç stats yazımı yapılmaz', async () => {
    existingDocs['tasks/task-1'] = { status: 'ASSIGNED' };
    const backup = makeBackup({ tasks: [validTask({ status: 'ASSIGNED' })] });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    expect(statsPayloadOf(batches[0]!)).toBeUndefined();
    expect(batches[0]!.set).toHaveBeenCalledTimes(1); // yalnızca görevin kendisi
  });

  it('mevcut görevin durumu değişiyorsa eski durum -1, yeni durum +1 olur (totalTasks sabit)', async () => {
    existingDocs['tasks/task-1'] = { status: 'ASSIGNED' };
    const backup = makeBackup({ tasks: [validTask({ status: 'COMPLETED' })] });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    const payload = statsPayloadOf(batches[0]!)!;
    expect(payload.status_ASSIGNED).toEqual({ __increment: -1 });
    expect(payload.status_COMPLETED).toEqual({ __increment: 1 });
    expect(payload.totalTasks).toBeUndefined();
  });

  it('aynı chunk içindeki birden fazla görevin deltası toplanır', async () => {
    existingDocs['tasks/t1'] = { status: 'ASSIGNED' };
    const backup = makeBackup({
      tasks: [
        validTask({ id: 't1', status: 'COMPLETED' }),
        validTask({ id: 't2', status: 'COMPLETED' }),
        validTask({ id: 't3', status: 'COMPLETED' }),
      ],
    });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    const payload = statsPayloadOf(batches[0]!)!;
    expect(payload.status_COMPLETED).toEqual({ __increment: 3 });
    expect(payload.status_ASSIGNED).toEqual({ __increment: -1 });
    expect(payload.totalTasks).toEqual({ __increment: 2 }); // t2, t3 yeni
  });

  it('net etkisi sıfır olan bir sayaç alanı hiç yazılmaz', async () => {
    existingDocs['tasks/t1'] = { status: 'ASSIGNED' };
    const backup = makeBackup({
      tasks: [
        validTask({ id: 't1', status: 'COMPLETED' }), // ASSIGNED -1, COMPLETED +1
        validTask({ id: 't2', status: 'ASSIGNED' }),  // totalTasks +1, ASSIGNED +1
      ],
    });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    const payload = statsPayloadOf(batches[0]!)!;
    expect(payload.status_ASSIGNED).toBeUndefined(); // -1 + 1 = 0
    expect(payload.status_COMPLETED).toEqual({ __increment: 1 });
  });

  it('her chunk KENDİ deltasını KENDİ batch\'inde taşır (yarıda kesilme sayaçları kaydırmaz)', async () => {
    // Bu, P0-4'ün asıl bulgusuydu: delta eskiden TÜM görevler için tek seferde
    // yalnızca SON chunk'a ekleniyordu; restore yarıda kesilirse önceki
    // chunk'ların görev yazımları commit edilmiş ama telafi edici delta hiç
    // uygulanmamış olurdu ve sayaçlar kalıcı olarak saparddı.
    const tasks = Array.from({ length: 120 }, (_, i) => validTask({ id: `task-${i}`, status: 'ASSIGNED' }));
    await settingsService.restoreBackup(JSON.stringify(makeBackup({ tasks })), 'u1', 'x.json');

    expect(batches).toHaveLength(3);
    expect(statsPayloadOf(batches[0]!)).toEqual({
      totalTasks: { __increment: 50 }, status_ASSIGNED: { __increment: 50 },
    });
    expect(statsPayloadOf(batches[1]!)).toEqual({
      totalTasks: { __increment: 50 }, status_ASSIGNED: { __increment: 50 },
    });
    expect(statsPayloadOf(batches[2]!)).toEqual({
      totalTasks: { __increment: 20 }, status_ASSIGNED: { __increment: 20 },
    });
  });

  it('kullanıcı ve engel kayıtları stats deltasına katkı yapmaz', async () => {
    const backup = makeBackup({
      users: [validUser()],
      blockers: [{ id: 'blk-1', taskId: 'task-1', reason: 'E', isResolved: false, createdAt: 1 }],
    });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');
    expect(statsPayloadOf(batches[0]!)).toBeUndefined();
  });
});

// ── Denetim izi ──────────────────────────────────────────────────────────────
describe('restoreBackup — denetim izi', () => {
  it('hangi dosyadan kaç kayıt geri yüklendiği audit_logs\'a yazılır', async () => {
    const backup = makeBackup({
      users: [validUser()],
      tasks: [validTask(), validTask({ id: 'task-2' })],
    });
    await settingsService.restoreBackup(JSON.stringify(backup), 'admin-1', 'MAKAM-Backup.json');

    const [, payload] = vi.mocked(firebase.addDoc).mock.calls[0] as any;
    expect(payload).toMatchObject({
      taskId: 'system_backup_restore',
      changedBy: 'admin-1',
      oldValue: 'Yedek dosyası: MAKAM-Backup.json',
      newValue: '1 kullanıcı, 2 talimat, 0 engel geri yüklendi',
    });
  });
});

// ── saveSessionTimeout ───────────────────────────────────────────────────────
describe('saveSessionTimeout', () => {
  it('system/settings dokümanına MERGE ile yazar (SLA/stats alanlarını ezmez)', async () => {
    await settingsService.saveSessionTimeout(45 * 60_000, 'admin-1');
    const [ref, payload, options] = vi.mocked(firebase.setDoc).mock.calls[0] as any;
    expect(pathOf(ref)).toBe('system/settings');
    expect(payload).toMatchObject({ sessionTimeoutMs: 45 * 60_000, updatedBy: 'admin-1' });
    expect(options).toEqual({ merge: true });
  });

  it('alt sınırın altındaki bir değer 5 dakikaya çekilir', async () => {
    const saved = await settingsService.saveSessionTimeout(30_000, 'admin-1');
    expect(saved).toBe(SESSION_TIMEOUT_MIN_MS);
  });

  it('üst sınırın üstündeki bir değer 8 saate çekilir', async () => {
    const saved = await settingsService.saveSessionTimeout(24 * 60 * 60_000, 'admin-1');
    expect(saved).toBe(SESSION_TIMEOUT_MAX_MS);
  });

  it('sayı olmayan/geçersiz bir değer varsayılana düşer', async () => {
    const saved = await settingsService.saveSessionTimeout(Number.NaN, 'admin-1');
    expect(saved).toBe(DEFAULT_SESSION_TIMEOUT_MS);
  });

  it('normalize edilmiş değeri localStorage\'a yazar (çevrimdışı ilk açılış için)', async () => {
    await settingsService.saveSessionTimeout(45 * 60_000, 'admin-1');
    expect(localStorage.getItem(SESSION_TIMEOUT_STORAGE_KEY)).toBe(String(45 * 60_000));
  });

  it('değişikliği dakika cinsinden audit_logs\'a düşürür', async () => {
    await settingsService.saveSessionTimeout(45 * 60_000, 'admin-1');
    const [, payload] = vi.mocked(firebase.addDoc).mock.calls[0] as any;
    expect(payload).toMatchObject({
      taskId: 'system_settings',
      changedBy: 'admin-1',
      oldValue: 'Oturum Zaman Aşımı Değiştirildi',
      newValue: '45 dakika',
    });
  });
});

// ── saveSlaConfig ────────────────────────────────────────────────────────────
describe('saveSlaConfig', () => {
  const config = {
    Low: { value: 15, unit: 'days' as const },
    Medium: { value: 5, unit: 'days' as const },
    High: { value: 2, unit: 'days' as const },
    Urgent: { value: 4, unit: 'hours' as const },
  };

  it('system/sla_config dokümanına yazar, kimin güncellediğini kaydeder', async () => {
    await settingsService.saveSlaConfig(config, 'admin-1', 'özet');
    const [ref, payload] = vi.mocked(firebase.setDoc).mock.calls[0] as any;
    expect(pathOf(ref)).toBe('system/sla_config');
    expect(payload).toMatchObject({ ...config, updatedBy: 'admin-1' });
    expect(typeof payload.updatedAt).toBe('number');
  });

  it('localStorage\'ı yalnızca öncelik girdileriyle senkronlar (meta alanlar sızmaz)', async () => {
    await settingsService.saveSlaConfig(config, 'admin-1', 'özet');
    const stored = JSON.parse(localStorage.getItem('makam_sla_config')!);
    expect(stored).toEqual(config);
    expect(stored.updatedBy).toBeUndefined();
  });

  it('değişikliği audit_logs\'a düşürür', async () => {
    await settingsService.saveSlaConfig(config, 'admin-1', 'Rutin: 15 days');
    const [, payload] = vi.mocked(firebase.addDoc).mock.calls[0] as any;
    expect(payload).toMatchObject({
      taskId: 'system_settings',
      changedBy: 'admin-1',
      oldValue: 'SLA Yapılandırması Değiştirildi',
      newValue: 'Rutin: 15 days',
    });
  });
});
