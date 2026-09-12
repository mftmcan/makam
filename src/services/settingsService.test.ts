/**
 * settingsService testleri (P0-4 + 2026-09-12 kural-uyumu sertleştirmesi).
 *
 * restoreBackup, uygulamadaki tek GERİ DÖNÜŞÜ OLMAYAN toplu veritabanı
 * işlemidir: mevcut personel/talimat/engel dokümanlarının üzerine chunk'lar
 * halinde yazar ve system/stats agregat sayaçlarını elle hesapladığı delta ile
 * düzeltir. Bu dosya şema reddi, normalizasyon, çapraz-referans iş kuralı
 * doğrulaması, chunk sınırı ve sayaç deltası davranışlarını sabitler.
 *
 * KÖK NEDEN (2026-09-12, muftim projesi canlı hataları): restoreBackup,
 * yazdığı veriyi firestore.rules'ın create-path kısıtlarına göre hiç
 * şekillendirmiyordu — dört ayrı üretim hatası (departman referans bütünlüğü,
 * görev durumu ASSIGNED-only kısıtı, fcmTokens>10 sınırı, aynı sınıftan
 * changedBy/null-alan/iş-kuralı ihlalleri) hep bu yüzden oluştu. Şemalar artık
 * firestore.rules'taki uzunluk/enum/zorunlu-alan sınırlarıyla BİREBİR eşleşir.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { settingsService, RestoreValidationError } from './settingsService';
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
  // ZORUNLU (firestore.rules requiredFields) — bkz. kod denetimi 2026-09-12.
  departmentId: 'dept-a',
  deadline: 1_700_000_000_000, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
  ...over,
});

const validBlocker = (over: Record<string, unknown> = {}) => ({
  id: 'blk-1', taskId: 'task-1', reason: 'Engel', isResolved: false, createdAt: 1, ...over,
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

  it('boş Ad Soyad taşıyan personel kaydı reddedilir', async () => {
    const backup = makeBackup({ users: [validUser({ fullName: '' })] });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json'))
      .rejects.toThrow(/Ad Soyad boş olamaz/);
  });

  it('uid alanı eksik/boş olan personel kaydı BLOKE EDİLİR (artık sessizce atlanmaz)', async () => {
    // Kullanıcı kararı (2026-09-12): sessiz veri kaybı yerine açık, kayıt
    // bazlı bir hata — bkz. plan "Kullanıcı kararı" bölümü.
    const backup = makeBackup({ users: [validUser({ uid: '' })] });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json'))
      .rejects.toThrow(/Kimlik alanı boş olamaz/);
    expect(batches).toHaveLength(0);
  });

  it('geçersiz bir talimat kaydı, hangi talimat olduğunu söyleyerek reddedilir', async () => {
    const backup = makeBackup({ tasks: [validTask({ status: 'YOK_BOYLE_DURUM', title: 'Bozuk Talimat' })] });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json'))
      .rejects.toThrow(/Talimat verisi doğrulanamadı \(Bozuk Talimat\)/);
  });

  it('departmentId taşımayan bir talimat kaydı reddedilir (firestore.rules requiredFields)', async () => {
    const backup = makeBackup({ tasks: [{ ...validTask(), departmentId: undefined }] });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json'))
      .rejects.toThrow(/Talimat verisi doğrulanamadı/);
  });

  it('id alanı eksik/boş olan bir talimat BLOKE EDİLİR', async () => {
    const backup = makeBackup({ tasks: [validTask({ id: '' })] });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json'))
      .rejects.toThrow(/Kimlik alanı boş olamaz/);
    expect(batches).toHaveLength(0);
  });

  it.each([
    ['title', 'a'.repeat(201), /Başlık 200 karakteri aşamaz/],
    ['description', '', /Açıklama boş olamaz/],
    ['description', 'a'.repeat(2001), /Açıklama 2000 karakteri aşamaz/],
    ['evidence', 'a'.repeat(1001), /Kanıt metni 1000 karakteri aşamaz/],
    ['comments', Array.from({ length: 201 }, () => ({})), /Yorum sayısı 200'ü aşamaz/],
    ['tags', Array.from({ length: 11 }, (_, i) => `t${i}`), /Etiket sayısı 10'u aşamaz/],
    ['checklist', Array.from({ length: 101 }, () => ({})), /Kontrol listesi 100 maddeyi aşamaz/],
  ])('firestore.rules uzunluk/adet sınırını aşan %s alanı reddedilir', async (field, value, expected) => {
    const backup = makeBackup({ tasks: [validTask({ [field]: value })] });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json'))
      .rejects.toThrow(expected as RegExp);
  });

  it('isValidId regex\'ini karşılamayan bir assigneeId reddedilir (ör. boşluk içeren ad)', async () => {
    const backup = makeBackup({ tasks: [validTask({ assigneeId: 'ali veli' })] });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json'))
      .rejects.toThrow(/Kimlik yalnızca harf, rakam/);
  });

  it('engel verisi zod doğrulamasından geçer — eskiden HİÇ doğrulanmıyordu', async () => {
    const backup = makeBackup({ blockers: [validBlocker({ reason: '' })] });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json'))
      .rejects.toThrow(/Engel verisi doğrulanamadı/);
  });

  it('geçersiz severity taşıyan bir engel reddedilir', async () => {
    const backup = makeBackup({ blockers: [validBlocker({ severity: 'Kritik' })] });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json'))
      .rejects.toThrow(/Engel verisi doğrulanamadı/);
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

// ── Normalizasyon (şema geçer, ama alan sessizce düzeltilir/düşürülür) ───────
describe('restoreBackup — normalizasyon (veri anlamını DEĞİŞTİRMEYEN sessiz düzeltmeler)', () => {
  it('changedBy alanı görevden tamamen kaldırılır (create allowlist\'inde yok)', async () => {
    const backup = makeBackup({ tasks: [validTask({ changedBy: 'birisi' })] });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    const written = batches[0]!.set.mock.calls.find(([ref]) => pathOf(ref) === 'tasks/task-1');
    expect(written![1]).not.toHaveProperty('changedBy');
  });

  it('parentId: null alanı düşürülür (kuralda null kaçışı yok)', async () => {
    const backup = makeBackup({ tasks: [validTask({ parentId: null })] });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    const written = batches[0]!.set.mock.calls.find(([ref]) => pathOf(ref) === 'tasks/task-1');
    expect(written![1]).not.toHaveProperty('parentId');
  });

  it('completedAt: null alanı düşürülür, Date.now() UYDURULMAZ', async () => {
    const backup = makeBackup({ tasks: [validTask({ completedAt: null })] });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    const written = batches[0]!.set.mock.calls.find(([ref]) => pathOf(ref) === 'tasks/task-1');
    expect(written![1]).not.toHaveProperty('completedAt');
  });

  it('completedAt ISO string ise epoch ms\'e çevrilir', async () => {
    const backup = makeBackup({ tasks: [validTask({ completedAt: '2026-01-01T00:00:00.000Z' })] });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    const written = batches[0]!.set.mock.calls.find(([ref]) => pathOf(ref) === 'tasks/task-1');
    expect(written![1].completedAt).toBe(new Date('2026-01-01T00:00:00.000Z').getTime());
  });

  it('coordinatorId: null alanı KORUNUR (kuralda açık null kaçışı var)', async () => {
    const backup = makeBackup({ tasks: [validTask({ coordinatorId: null })] });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    const written = batches[0]!.set.mock.calls.find(([ref]) => pathOf(ref) === 'tasks/task-1');
    expect(written![1].coordinatorId).toBeNull();
  });

  it('coordinatorId: "" boş dizesi null\'a normalize edilir (şema regex\'ini gereksiz yere reddetmesin diye)', async () => {
    const backup = makeBackup({ tasks: [validTask({ coordinatorId: '' })] });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    const written = batches[0]!.set.mock.calls.find(([ref]) => pathOf(ref) === 'tasks/task-1');
    expect(written![1].coordinatorId).toBeNull();
  });

  it('pausedAt: null alanı KORUNUR (completedAt ile ASİMETRİ, kuralda tip kontrolü bile yok)', async () => {
    const backup = makeBackup({ tasks: [validTask({ pausedAt: null })] });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    const written = batches[0]!.set.mock.calls.find(([ref]) => pathOf(ref) === 'tasks/task-1');
    expect(written![1].pausedAt).toBeNull();
  });

  it('users departmentId: null alanı KORUNUR (userDepartmentIsValid null\'u açıkça kabul eder)', async () => {
    const backup = makeBackup({ users: [validUser({ departmentId: null })] });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    const written = batches[0]!.set.mock.calls.find(([ref]) => pathOf(ref) === 'users/user-1');
    expect(written![1].departmentId).toBeNull();
  });

  it('şema dışı (allowlist dışı) bir alan sessizce düşürülür', async () => {
    const backup = makeBackup({ tasks: [{ ...validTask(), keyfiAlan: 'x' } as Record<string, unknown>] });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    const written = batches[0]!.set.mock.calls.find(([ref]) => pathOf(ref) === 'tasks/task-1');
    expect(written![1]).not.toHaveProperty('keyfiAlan');
  });

  it('engelde resolvedAt: null alanı düşürülür', async () => {
    const backup = makeBackup({ blockers: [validBlocker({ isResolved: true, resolvedAt: null })] });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    const written = batches[0]!.set.mock.calls.find(([ref]) => pathOf(ref) === 'blockers/blk-1');
    expect(written![1]).not.toHaveProperty('resolvedAt');
  });

  it('engelde \'id\' alanı doküman verisine YAZILMAZ (doküman ID\'si olarak kullanılıyor)', async () => {
    const backup = makeBackup({ blockers: [validBlocker()] });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    const written = batches[0]!.set.mock.calls.find(([ref]) => pathOf(ref) === 'blockers/blk-1');
    expect(written![1]).not.toHaveProperty('id');
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

// ── Çapraz-referans iş kuralı doğrulaması ────────────────────────────────────
// firestore.rules isValidTaskBusinessRules'ın hasNoAdminCoordinator /
// hasValidSubtaskAssignee / hasValidDelegationTarget dallarının HİÇBİRİNDE
// Admin istisnası yoktur (bkz. tests/rules "restoreBackup CREATE yolu"
// belgeleme bloğu) — restoreBackup bu yüzden yazmadan ÖNCE kendisi tespit
// edip RestoreValidationError ile raporlamak zorundadır.
describe('restoreBackup — çapraz-referans iş kuralı doğrulaması (yazmadan ÖNCE bloke eder)', () => {
  it('koordinatörü YEDEKTEKİ bir Admin olan görev bloke edilir ve raporda id\'si geçer', async () => {
    const backup = makeBackup({
      users: [validUser({ uid: 'admin-1', role: 'Admin' })],
      tasks: [validTask({ coordinatorId: 'admin-1' })],
    });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json'))
      .rejects.toThrow(RestoreValidationError);
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json'))
      .rejects.toThrow(/Koordinatörü Admin olan 1 talimat: task-1/);
    expect(batches).toHaveLength(0);
  });

  it('koordinatörü VERİTABANINDAKİ (yedekte olmayan) bir Admin olan görev bloke edilir', async () => {
    existingDocs['users/admin-1'] = { role: 'Admin' };
    const backup = makeBackup({ tasks: [validTask({ coordinatorId: 'admin-1' })] });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json'))
      .rejects.toThrow(/Koordinatörü Admin olan/);
  });

  it('koordinatörü Müdür olan görev İZİN VERİLİR (karşılaştırma)', async () => {
    const backup = makeBackup({
      users: [validUser({ uid: 'mgr-1', role: 'Manager' })],
      tasks: [validTask({ coordinatorId: 'mgr-1' })],
    });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json')).resolves.toBeDefined();
  });

  it('koordinatörü yedekte de veritabanında da hiç olmayan görev İZİN VERİLİR (coordDoc==null kuralda geçerli)', async () => {
    const backup = makeBackup({ tasks: [validTask({ coordinatorId: 'hic-yok' })] });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json')).resolves.toBeDefined();
  });

  it('sorumlusu Memur OLMAYAN bir alt görev (parentId dolu) bloke edilir', async () => {
    const backup = makeBackup({
      users: [validUser({ uid: 'mgr-1', role: 'Manager' })],
      tasks: [validTask({ parentId: 'ust-gorev', assigneeId: 'mgr-1' })],
    });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json'))
      .rejects.toThrow(/Sorumlusu Memur OLMAYAN 1 alt talimat: task-1/);
  });

  it('sorumlusu Memur olan bir alt görev İZİN VERİLİR (karşılaştırma)', async () => {
    const backup = makeBackup({
      users: [validUser({ uid: 'user-1', role: 'Staff' })],
      tasks: [validTask({ parentId: 'ust-gorev' })],
    });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json')).resolves.toBeDefined();
  });

  it('sorumlusu hiç VAR OLMAYAN bir alt görev bloke edilir (assigneeDoc==null)', async () => {
    const backup = makeBackup({ tasks: [validTask({ parentId: 'ust-gorev', assigneeId: 'hic-yok' })] });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json'))
      .rejects.toThrow(/Sorumlusu Memur OLMAYAN/);
  });

  it('devir hedefi (PENDING_DELEGATION) Memur olan görev bloke edilir', async () => {
    const backup = makeBackup({
      users: [validUser({ uid: 'user-1', role: 'Staff' })],
      tasks: [validTask({ status: 'PENDING_DELEGATION' })],
    });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json'))
      .rejects.toThrow(/Devir bekleyen \(PENDING_DELEGATION\) ama sorumlusu Müdür olmayan 1 talimat: task-1/);
  });

  it('devir hedefi Müdür olan PENDING_DELEGATION görevi İZİN VERİLİR (karşılaştırma)', async () => {
    const backup = makeBackup({
      users: [validUser({ uid: 'mgr-1', role: 'Manager' })],
      tasks: [validTask({ status: 'PENDING_DELEGATION', assigneeId: 'mgr-1' })],
    });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json')).resolves.toBeDefined();
  });

  it('birden fazla kategori aynı anda ihlal edilirse TEK raporda hepsi listelenir', async () => {
    const backup = makeBackup({
      users: [
        validUser({ uid: 'admin-1', role: 'Admin' }),
        validUser({ uid: 'mgr-1', role: 'Manager' }),
      ],
      tasks: [
        validTask({ id: 'task-a', coordinatorId: 'admin-1' }),
        validTask({ id: 'task-b', parentId: 'ust', assigneeId: 'mgr-1' }),
        validTask({ id: 'task-c', status: 'PENDING_DELEGATION', assigneeId: 'user-1' }),
      ],
    });
    const err = await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json').catch(e => e);
    expect(err).toBeInstanceOf(RestoreValidationError);
    expect(err.message).toMatch(/Koordinatörü Admin olan 1 talimat: task-a/);
    expect(err.message).toMatch(/Sorumlusu Memur OLMAYAN 1 alt talimat: task-b/);
    expect(err.message).toMatch(/PENDING_DELEGATION.*task-c/);
  });

  it('5\'ten fazla ihlal varsa rapor "ve N kayıt daha" ile kısaltılır', async () => {
    const backup = makeBackup({
      users: [validUser({ uid: 'admin-1', role: 'Admin' })],
      tasks: Array.from({ length: 7 }, (_, i) => validTask({ id: `task-${i}`, coordinatorId: 'admin-1' })),
    });
    const err = await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json').catch(e => e);
    expect(err.message).toMatch(/task-0, task-1, task-2, task-3, task-4 ve 2 kayıt daha/);
  });
});

// ── Chunk sınırı ─────────────────────────────────────────────────────────────
describe('restoreBackup — chunk sınırı', () => {
  it('görev grubu TASK_CHUNK=15 sınırını aşmaz ve her chunk ayrı batch olarak commit edilir', async () => {
    // Görev grubu, users/blockers'tan (CHUNK=50) FARKLI ve daha küçük bir
    // chunk boyutu (15) kullanır — bkz. settingsService.ts'teki TASK_CHUNK
    // yorumu: her görev CREATE'i assignee/coordinator/department dokümanlarına
    // erişir ve bunlar farklı dokümanlardır; emulator'da ölçülen batched-write
    // doküman-erişim kotası 20'de kesin başarısız oluyordu (bkz. tests/rules).
    const tasks = Array.from({ length: 32 }, (_, i) => validTask({ id: `task-${i}` }));
    await settingsService.restoreBackup(JSON.stringify(makeBackup({ tasks })), 'u1', 'x.json');

    expect(batches).toHaveLength(3); // 15 + 15 + 2
    expect(batches[0]!.set).toHaveBeenCalledTimes(16); // 15 görev + 1 stats
    expect(batches[1]!.set).toHaveBeenCalledTimes(16);
    expect(batches[2]!.set).toHaveBeenCalledTimes(3);  // 2 görev + 1 stats
    batches.forEach(b => expect(b.commit).toHaveBeenCalledOnce());
  });

  it('tam TASK_CHUNK (15) görev tek bir chunk olarak yazılır', async () => {
    const tasks = Array.from({ length: 15 }, (_, i) => validTask({ id: `task-${i}` }));
    await settingsService.restoreBackup(JSON.stringify(makeBackup({ tasks })), 'u1', 'x.json');
    expect(batches).toHaveLength(1);
  });

  it('users grubu CHUNK=50 sınırını kullanır (görev grubundan FARKLI, üretimde kanıtlanmış yol)', async () => {
    const users = Array.from({ length: 51 }, (_, i) => validUser({ uid: `user-${i}` }));
    await settingsService.restoreBackup(JSON.stringify(makeBackup({ users })), 'u1', 'x.json');
    expect(batches).toHaveLength(2); // 50 + 1
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
    // 120 / TASK_CHUNK(15) = tam 8 chunk: 15,30,...,120.
    expect(progress).toEqual([13, 25, 38, 50, 63, 75, 88, 100]);
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
      blockers: [validBlocker()],
    });
    const res = await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');

    expect(res).toEqual({ userCount: 1, taskCount: 1, blockerCount: 1 });
    expect(batches).toHaveLength(3);
    expect(batches[0]!.set.mock.calls.map(([ref]) => pathOf(ref))).toContain('users/user-1');
    expect(batches[1]!.set.mock.calls.map(([ref]) => pathOf(ref))).toContain('tasks/task-1');
    expect(batches[2]!.set.mock.calls.map(([ref]) => pathOf(ref))).toContain('blockers/blk-1');
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

  it('departman getDoc\'u bir kez reddedip sonra başarılı olursa restore yine tamamlanır (runWithRetry)', async () => {
    let call = 0;
    vi.mocked(firebase.getDoc).mockImplementation((async (ref: any) => {
      if (pathOf(ref) === 'departments/Operasyon' && call++ === 0) {
        throw new firebase.FirebaseError('unavailable', 'Geçici hata');
      }
      const data = existingDocs[pathOf(ref)];
      return { exists: () => data !== undefined, data: () => data };
    }) as any);

    const backup = makeBackup({ users: [validUser({ departmentId: 'Operasyon' })] });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'admin-1', 'x.json')).resolves.toBeDefined();
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
    const tasks = Array.from({ length: 32 }, (_, i) => validTask({ id: `task-${i}`, status: 'ASSIGNED' }));
    await settingsService.restoreBackup(JSON.stringify(makeBackup({ tasks })), 'u1', 'x.json');

    expect(batches).toHaveLength(3);
    expect(statsPayloadOf(batches[0]!)).toEqual({
      totalTasks: { __increment: 15 }, status_ASSIGNED: { __increment: 15 },
    });
    expect(statsPayloadOf(batches[1]!)).toEqual({
      totalTasks: { __increment: 15 }, status_ASSIGNED: { __increment: 15 },
    });
    expect(statsPayloadOf(batches[2]!)).toEqual({
      totalTasks: { __increment: 2 }, status_ASSIGNED: { __increment: 2 },
    });
  });

  it('kullanıcı ve engel kayıtları stats deltasına katkı yapmaz', async () => {
    const backup = makeBackup({
      users: [validUser()],
      blockers: [validBlocker()],
    });
    await settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json');
    expect(statsPayloadOf(batches[0]!)).toBeUndefined();
  });

  it('görev delta getDoc\'u bir kez reddedip sonra başarılı olursa restore yine tamamlanır (runWithRetry)', async () => {
    let call = 0;
    vi.mocked(firebase.getDoc).mockImplementation((async (ref: any) => {
      if (pathOf(ref) === 'tasks/task-1' && call++ === 0) {
        throw new firebase.FirebaseError('unavailable', 'Geçici hata');
      }
      const data = existingDocs[pathOf(ref)];
      return { exists: () => data !== undefined, data: () => data };
    }) as any);

    const backup = makeBackup({ tasks: [validTask()] });
    await expect(settingsService.restoreBackup(JSON.stringify(backup), 'u1', 'x.json')).resolves.toBeDefined();
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
