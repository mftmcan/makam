import { z } from 'zod';
import type { DocumentReference } from 'firebase/firestore';
import { db, doc, setDoc, addDoc, collection, getDoc, writeBatch, increment } from '../firebase';
import { runWithRetry } from '../lib/retry';
import { auditLogType } from './taskService';
import { UserRoleSchema, TaskStatusSchema, TaskPrioritySchema } from '../types';
import { normalizeSessionTimeoutMs } from '../constants';
import { SESSION_TIMEOUT_STORAGE_KEY } from '../hooks/useSessionTimeout';
import type { SLAConfigEntry } from '../lib/sla';

// Yedek dosyasından gelen ham kayıtlar (kullanıcı/görev/engel) — dış bir JSON
// dosyasından okunduğu için alan kümesi zod şemalarının ötesine geçebilir
// (ör. departmentId/photoURL/fcmTokens), bu yüzden tek tip bir arayüz yerine
// açık bir kayıt tipi kullanılır.
type BackupRecord = Record<string, unknown>;

/** restoreBackup'ın ön-doğrulamasının (şema veya çapraz-referans iş kuralı)
 *  ürettiği, kullanıcıya AYNEN gösterilecek hata — mesaj zaten Türkçe ve
 *  kayıt-bazlıdır. Firebase/SDK hatalarından (DataTab'ta humanizeError'a giden)
 *  ayrılması için ayrı bir sınıf: bu hata insanlaştırılmaya ÇEVRİLMEMELİDİR. */
export class RestoreValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreValidationError';
  }
}

// ── firestore.rules'ın istemci tarafı EŞDEĞERLERİ ───────────────────────────
// Kural dosyası istemciden okunamadığından burada elle kopyalanmıştır. TEK
// senkronizasyon aracı tests/rules/firestore.rules.test.ts'teki "restoreBackup
// CREATE yolu: Admin istisnası OLMAYAN kısıtlar" belgeleme bloğudur — kural
// değişirse o test kırmızıya döner ve buradaki sabitlerin de güncellenmesi
// gerektiğini haber verir.
const RULES_ID_RE = /^[a-zA-Z0-9_.@+-]+$/;                                  // firestore.rules isValidId
const RULES_EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;  // firestore.rules isValidUser

const firestoreIdSchema = z.string()
  .min(1, 'Kimlik alanı boş olamaz')
  .max(128, 'Kimlik alanı 128 karakteri aşamaz')
  .regex(RULES_ID_RE, 'Kimlik yalnızca harf, rakam ve _ . @ + - içerebilir');

// Görevlerde departmentId ZORUNLU ve boş OLAMAZ (firestore.rules requiredFields
// + isValidDepartmentId). Kullanıcılarda ise boş dize/null/hiç yok = "organizasyon
// geneli" anlamına gelir ve AÇIKÇA geçerlidir (userDepartmentIsValid) — bu
// yüzden iki AYRI şema, tek bir departmentIdSchema ikisi için de YANLIŞ olurdu.
const taskDepartmentIdSchema = z.string().min(1, 'Departman boş olamaz').max(100, 'Departman adı 100 karakteri aşamaz');
const userDepartmentIdSchema = z.string().max(100, 'Departman adı 100 karakteri aşamaz').nullable().optional();

// ── Yedek Doğrulama Şemaları (Restore) ──────────────────────────────────────
// role/status/priority değerleri types.ts'teki KANONİK enum'lardan alınır —
// burada elle kopyalanmış bağımsız bir liste tutulursa, types.ts'e yeni bir
// durum eklendiğinde bu şema güncellenmediği sürece tamamen geçerli, güncel
// bir MAKAM yedeği bile reddedilir (bkz. settingsService.restoreBackup).
//
// Uzunluk/enum/zorunlu-alan sınırları BİLİNÇLİ olarak firestore.rules'taki
// isValidUser/isValidTaskCreate/isValidBlocker ile BİREBİR eşleşir: aksi
// halde istemci "geçerli" derken sunucu reddedip TÜM batch'i (bu kaydın
// bulunduğu grup) düşürür (bkz. kod denetimi, 2026-09-12 — fcmTokens/
// departmentId/changedBy vb. dört ayrı canlı hatanın ortak kök nedeni aynı
// sınıftandı: yedekteki veri, bu sınırlardan birini karşılamıyordu).
export const userBackupSchema = z.object({
  uid: firestoreIdSchema,
  fullName: z.string().min(1, 'Ad Soyad boş olamaz').max(100, 'Ad Soyad 100 karakteri aşamaz'),
  email: z.string().regex(RULES_EMAIL_RE, 'E-posta biçimi geçersiz'),
  role: UserRoleSchema,
  departmentId: userDepartmentIdSchema,
  photoURL: z.string().optional(),
  fcmTokens: z.array(z.string()).optional(),   // sınır (≤10) restoreBackup'ta KIRPILIR, reddedilmez
});

export const taskBackupSchema = z.object({
  id: firestoreIdSchema,
  title: z.string().min(1, 'Başlık boş olamaz').max(200, 'Başlık 200 karakteri aşamaz'),
  description: z.string().min(1, 'Açıklama boş olamaz').max(2000, 'Açıklama 2000 karakteri aşamaz'),
  creatorId: firestoreIdSchema,
  assigneeId: firestoreIdSchema,
  departmentId: taskDepartmentIdSchema,
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  // coordinatorId, firestore.rules'ta (boş dize İÇİN kaçış YOK) ya null ya da
  // geçerli bir kimlik olmak zorunda — restoreBackup boş dizeyi normalize
  // ederken (aşağıda) null'a çevirir, şema bu yüzden regex'li kalabilir.
  coordinatorId: firestoreIdSchema.nullable().optional(),
  // parentId'nin AKSİNE: firestore.rules yalnızca `is string` istiyor, isValidId
  // regex'i UYGULANMIYOR (boş dize dahil HER string geçerli — hasValidSubtaskAssignee
  // boş dizeyi de "alt görev değil" sayıyor). Regex'li firestoreIdSchema
  // kullanmak burada YANLIŞ olurdu.
  parentId: z.string().max(128, 'Üst talimat kimliği 128 karakteri aşamaz').nullable().optional(),
  evidence: z.string().max(1000, 'Kanıt metni 1000 karakteri aşamaz').nullable().optional(),
  evidenceType: z.string().max(100, 'Kanıt türü 100 karakteri aşamaz').nullable().optional(),
  comments: z.array(z.unknown()).max(200, "Yorum sayısı 200'ü aşamaz").nullable().optional(),
  tags: z.array(z.unknown()).max(10, "Etiket sayısı 10'u aşamaz").nullable().optional(),
  checklist: z.array(z.unknown()).max(100, 'Kontrol listesi 100 maddeyi aşamaz').nullable().optional(),
  estimatedHours: z.number().min(0).nullable().optional(),
  lockVersion: z.number().nullable().optional(),
  totalPausedTime: z.number().nullable().optional(),
  pausedAt: z.number().nullable().optional(),
  completedAt: z.unknown().optional(),   // toTsOrDrop normalize eder (Timestamp/ISO/null)
  deadline: z.any(),
  createdAt: z.any(),
  updatedAt: z.any(),
});

// YENİ — blockers artık users/tasks ile AYNI ön-doğrulamadan geçer
// (firestore.rules isValidBlocker) — eskiden hiç zod kontrolünden geçmiyordu.
export const blockerBackupSchema = z.object({
  id: firestoreIdSchema,
  taskId: firestoreIdSchema,
  reason: z.string().min(1, 'Engel gerekçesi boş olamaz').max(500, 'Engel gerekçesi 500 karakteri aşamaz'),
  severity: TaskPrioritySchema.nullable().optional(),
  isResolved: z.boolean(),
  createdAt: z.any(),
  resolvedAt: z.unknown().optional(),   // toTsOrDrop normalize eder
});

export const restoreBackupSchema = z.object({
  // Eski yedekler 'MAKAM Executive Control' değerini taşıyor — geriye
  // dönük uyumluluk için ikisi de kabul edilir (bkz. AboutModal/index.html
  // markasının Türkçeleştirilmesi).
  system: z.enum(['MAKAM Stratejik Yönetim', 'MAKAM Executive Control']),
  users: z.array(z.any()).optional(),
  tasks: z.array(z.any()).optional(),
  blockers: z.array(z.any()).optional(),
});

// ── Saf veri dönüştürme yardımcıları (restore akışı) ─────────────────────────
const cleanDataObj = (obj: unknown): unknown => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => cleanDataObj(item));
  const source = obj as BackupRecord;
  const n: BackupRecord = {};
  Object.keys(source).forEach(k => { if (source[k] !== undefined) n[k] = cleanDataObj(source[k]); });
  return n;
};

/** Yalnızca ÜST DÜZEY null alanları siler (nested null'lara dokunmaz — kurallar
 *  dizilerin yalnızca size()'ına bakar, içeriğine değil). `keepNullKeys`
 *  listesindeki alanlar için null KORUNUR — firestore.rules'ta bu alanlar için
 *  AÇIK bir null kaçışı vardır (ör. coordinatorId, pausedAt, users
 *  departmentId); diğer TÜM alanlarda null için kaçış YOKTUR ("değer yok" ile
 *  "alan yok" JSON açısından aynı anlama gelir, bu yüzden alan sessizce
 *  düşürülür — veri anlamını DEĞİŞTİRMEZ). */
const stripNulls = (obj: BackupRecord, keepNullKeys: string[]): BackupRecord => {
  const result: BackupRecord = {};
  Object.keys(obj).forEach(k => {
    if (obj[k] === null && !keepNullKeys.includes(k)) return;
    result[k] = obj[k];
  });
  return result;
};

const toTs = (val: unknown, fb?: number): number => {
  if (val == null) return fb ?? Date.now();
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return new Date(val).getTime() || (fb ?? Date.now());
  if (typeof val === 'object' && 'seconds' in val) return (val as { seconds: number }).seconds * 1000;
  return fb ?? Date.now();
};

/** null/parse edilemeyen değer için alanı DÜŞÜRÜR — toTs'in aksine Date.now()
 *  UYDURMAZ: completedAt/resolvedAt gibi "olay zamanı" alanları için "şimdi"
 *  yazmak o olayın gerçek zamanını sessizce bozardı (bkz. kod denetimi). */
const toTsOrDrop = (val: unknown): number | undefined => {
  if (val == null) return undefined;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const t = new Date(val).getTime();
    return Number.isNaN(t) ? undefined : t;
  }
  if (typeof val === 'object' && 'seconds' in val) return (val as { seconds: number }).seconds * 1000;
  return undefined;
};

const pick = (obj: BackupRecord, keys: string[]) => {
  const r: BackupRecord = {};
  keys.forEach(k => { if (k in obj && obj[k] !== undefined) r[k] = obj[k]; });
  return r;
};

// firestore.rules isValidUser/isValidTaskCreate/isValidBlocker'daki allowedFields
// ile BİREBİR — 'changedBy' bilinçli olarak TASK_ALLOWED_FIELDS'ta YOK: ne
// CREATE (isValidTaskCreate.allowedFields'ta hiç yok) ne UPDATE
// (data.changedBy == request.auth.uid şartı) yolunda restore edilen tarihi
// bir değer geçemez; audit_logs zaten geri yüklenemediğinden (bkz.
// restoreBackupSchema) bu alanın kalıcı bir anlamı kalmamıştır — sessizce ve
// zararsızca düşürülür.
const USER_ALLOWED_FIELDS = ['uid', 'fullName', 'email', 'role', 'departmentId', 'photoURL', 'fcmTokens'];
const TASK_ALLOWED_FIELDS = [
  'id', 'parentId', 'title', 'description', 'creatorId', 'assigneeId', 'coordinatorId',
  'status', 'priority', 'deadline', 'createdAt', 'updatedAt', 'evidence', 'evidenceType',
  'pausedAt', 'totalPausedTime', 'comments', 'lockVersion', 'departmentId',
  'completedAt', 'estimatedHours', 'tags', 'checklist',
];
// 'id' bilinçli olarak DIŞARIDA: doküman ID'si olarak kullanılıyor
// (blockerService.addBlocker ile AYNI davranış), ayrıca alan olarak yazmaya
// gerek yok.
const BLOCKER_ALLOWED_FIELDS = ['taskId', 'reason', 'severity', 'isResolved', 'createdAt', 'resolvedAt'];

interface TaskRuleViolations {
  adminCoordinator: string[];
  nonStaffSubtask: string[];
  nonManagerDelegation: string[];
}

/** isValidTaskBusinessRules'ın hasNoAdminCoordinator / hasValidSubtaskAssignee /
 *  hasValidDelegationTarget dallarının BİREBİR istemci kopyası (firestore.rules)
 *  — HİÇBİRİNDE Admin istisnası yoktur (bkz. tests/rules "restoreBackup CREATE
 *  yolu" belgeleme bloğu). Saf fonksiyon: rol çözümleyici dışarıdan verilir. */
function collectTaskRuleViolations(
  tasks: BackupRecord[],
  roleOf: (userId: string) => string | undefined
): TaskRuleViolations {
  const adminCoordinator: string[] = [];
  const nonStaffSubtask: string[] = [];
  const nonManagerDelegation: string[] = [];

  tasks.forEach(t => {
    const id = String(t.id);

    const coordinatorId = t.coordinatorId as string | undefined;
    if (coordinatorId && roleOf(coordinatorId) === 'Admin') adminCoordinator.push(id);

    const parentId = t.parentId as string | undefined;
    if (parentId && roleOf(t.assigneeId as string) !== 'Staff') nonStaffSubtask.push(id);

    if (t.status === 'PENDING_DELEGATION' && roleOf(t.assigneeId as string) !== 'Manager') {
      nonManagerDelegation.push(id);
    }
  });

  return { adminCoordinator, nonStaffSubtask, nonManagerDelegation };
}

/** Rolleri restore'un GÖRECEĞİ sırayla çözer: users grubu tasks'tan ÖNCE
 *  yazıldığından (bkz. restoreBackup) yedekteki rol GÜNCEL roldür ve
 *  önceliklidir; yedekte olmayan referanslar için veritabanı okunur —
 *  yalnızca GERÇEKTEN referans edilen id'ler için (gereksiz okuma yapılmaz). */
async function buildRoleResolver(
  backupUsers: BackupRecord[],
  referencedIds: Set<string>
): Promise<(userId: string) => string | undefined> {
  const roleByBackupUid = new Map<string, string>();
  backupUsers.forEach(u => {
    if (typeof u.uid === 'string' && typeof u.role === 'string') roleByBackupUid.set(u.uid, u.role);
  });

  const roleByDbUid = new Map<string, string | undefined>();
  for (const id of referencedIds) {
    if (roleByBackupUid.has(id)) continue;
    const snap = await runWithRetry(() => getDoc(doc(db, 'users', id)));
    roleByDbUid.set(id, snap.exists() ? (snap.data() as { role?: string }).role : undefined);
  }

  return (userId: string) => roleByBackupUid.get(userId) ?? roleByDbUid.get(userId);
}

const formatIds = (ids: string[]): string => {
  const shown = ids.slice(0, 5).join(', ');
  return ids.length > 5 ? `${shown} ve ${ids.length - 5} kayıt daha` : shown;
};

export interface SlaConfigInput {
  Low: SLAConfigEntry;
  Medium: SLAConfigEntry;
  High: SLAConfigEntry;
  Urgent: SLAConfigEntry;
}

export interface RestoreResult {
  userCount: number;
  taskCount: number;
  blockerCount: number;
}

export const settingsService = {
  /** SLA yapılandırmasını kaydeder, localStorage'ı senkronize eder ve
   *  audit_logs kaydı oluşturur — Settings.tsx bileşeni yalnızca form
   *  state'ini toplayıp bu fonksiyonu çağırır. */
  async saveSlaConfig(config: SlaConfigInput, userId: string, summaryLabel: string) {
    const newConfig = { ...config, updatedAt: Date.now(), updatedBy: userId };
    await runWithRetry(() => setDoc(doc(db, 'system', 'sla_config'), newConfig));

    localStorage.setItem('makam_sla_config', JSON.stringify({
      Low: config.Low, Medium: config.Medium, High: config.High, Urgent: config.Urgent
    }));

    await runWithRetry(() => addDoc(collection(db, 'audit_logs'), {
      taskId: 'system_settings',
      // Dizge YAPILANDIRMASININ içerik güncellemesi — bir yaşam döngüsü olayı
      // değil. userService'teki aynı gerekçe: `logType` yazılmazsa bu kayıt
      // her iki tip filtresinden de düşerdi (bkz. taskService.auditLogType).
      ...auditLogType('FIELD'),
      changedBy: userId,
      oldValue: 'SLA Yapılandırması Değiştirildi',
      newValue: summaryLabel,
      timestamp: Date.now()
    }));
  },

  /** Oturum zaman aşımını `system/settings` dokümanına yazar ve audit_logs
   *  kaydı oluşturur — saveSlaConfig ile BİREBİR aynı desen (system/{docId}
   *  yazımı + denetim izi). Değer, kaydedilmeden önce güvenli aralığa
   *  oturtulur: form doğrulaması atlansa bile "pratikte kapanmayan oturum"
   *  gibi bir değer dizgeye giremez. */
  async saveSessionTimeout(timeoutMs: number, userId: string) {
    const normalized = normalizeSessionTimeoutMs(timeoutMs);

    await runWithRetry(() => setDoc(
      doc(db, 'system', 'settings'),
      { sessionTimeoutMs: normalized, updatedAt: Date.now(), updatedBy: userId },
      { merge: true }
    ));

    localStorage.setItem(SESSION_TIMEOUT_STORAGE_KEY, String(normalized));

    await runWithRetry(() => addDoc(collection(db, 'audit_logs'), {
      taskId: 'system_settings',
      // saveSlaConfig ile AYNI desen: yapılandırma değeri güncellemesi.
      ...auditLogType('FIELD'),
      changedBy: userId,
      oldValue: 'Oturum Zaman Aşımı Değiştirildi',
      newValue: `${Math.round(normalized / 60000)} dakika`,
      timestamp: Date.now()
    }));

    return normalized;
  },

  /** Bir yedek JSON metnini doğrular ve dizgeye geri yükler; ilerleme
   *  yüzdesini (0-100) onProgress ile bildirir.
   *
   *  Doğrulama İKİ AŞAMALIDIR ve HİÇBİRİ tek bir yazım yapılmadan önce
   *  tamamlanmadan restore başlamaz ("kısmi geri yükleme yok" ilkesi):
   *   1) Şekil doğrulaması (zod) — uzunluk/enum/zorunlu-alan/kimlik biçimi.
   *   2) Çapraz-referans iş kuralı doğrulaması — koordinatör/alt-görev
   *      sorumlusu/devir hedefi rolleri (bkz. collectTaskRuleViolations).
   *  Şekil hataları Error, iş kuralı ihlalleri RestoreValidationError
   *  fırlatır (DataTab bu ikisini FARKLI gösterir, bkz. o dosyadaki catch). */
  async restoreBackup(rawJson: string, userId: string, fileName: string, onProgress?: (percent: number) => void): Promise<RestoreResult> {
    const data = JSON.parse(rawJson);

    const backupValidation = restoreBackupSchema.safeParse(data);
    if (!backupValidation.success) {
      throw new Error('Yedek dosyası formatı geçersiz (MAKAM verisi değil).');
    }

    if (Array.isArray(data.users)) {
      data.users.forEach((u: BackupRecord) => {
        const parsed = userBackupSchema.safeParse(u);
        if (!parsed.success) {
          throw new Error(`Personel verisi doğrulanamadı (${(u.fullName as string) || 'Bilinmeyen'}). Hata: ${parsed.error.issues[0]?.message || parsed.error.message}`);
        }
      });
    }

    if (Array.isArray(data.tasks)) {
      // parentId/coordinatorId için boş dize ("") ve null AYNI anlama gelir
      // ("ilişki yok") — ama coordinatorId şeması regex'li olduğundan (bkz.
      // yukarısı) "" değerini reddederdi. Şema değerlendirilmeden ÖNCE "" →
      // null normalize edilir ki bu meşru, çok yaygın tarihi veri deseni
      // gereksiz yere restore'u tamamen bloke etmesin.
      data.tasks.forEach((t: BackupRecord) => {
        if (t.coordinatorId === '') t.coordinatorId = null;
        if (t.parentId === '') t.parentId = null;
      });
      data.tasks.forEach((t: BackupRecord) => {
        const parsed = taskBackupSchema.safeParse(t);
        if (!parsed.success) {
          throw new Error(`Talimat verisi doğrulanamadı (${(t.title as string) || 'Bilinmeyen'}). Hata: ${parsed.error.issues[0]?.message || parsed.error.message}`);
        }
      });
    }

    if (Array.isArray(data.blockers)) {
      data.blockers.forEach((b: BackupRecord) => {
        const parsed = blockerBackupSchema.safeParse(b);
        if (!parsed.success) {
          throw new Error(`Engel verisi doğrulanamadı (${(b.reason as string) || 'Bilinmeyen'}). Hata: ${parsed.error.issues[0]?.message || parsed.error.message}`);
        }
      });
    }

    // ── Normalizasyon (YAZMA YOK, saf dönüşüm) ─────────────────────────────
    const userItems: { ref: DocumentReference; data: BackupRecord }[] = [];
    if (Array.isArray(data.users)) {
      data.users.forEach((u: BackupRecord) => {
        const cleaned = stripNulls(cleanDataObj(u) as BackupRecord, ['departmentId']);
        const picked = pick(cleaned, USER_ALLOWED_FIELDS);
        // firestore.rules isValidUser, fcmTokens'ı EN FAZLA 10 kayıtla sınırlar
        // (Admin için de istisnasız). Uzun süredir kullanılan hesaplarda
        // (her cihaz/tarayıcı yenilemesinde eklenip hiç temizlenmeyen FCM
        // token'ları) bu sınır aşılmış olabilir — yedekteki TEK bir kullanıcının
        // aşırı büyük dizisi, aynı batch'teki TÜM kullanıcı yazımlarını
        // "Missing or insufficient permissions" ile düşürür (bkz. kod
        // denetimi, 2026-09-12: muftum@gmail.com'un 96 fcmTokens girdisiyle
        // canlıda görüldü). En YENİ 10 token korunur.
        if (Array.isArray(picked.fcmTokens) && picked.fcmTokens.length > 10) {
          picked.fcmTokens = picked.fcmTokens.slice(-10);
        }
        userItems.push({ ref: doc(db, 'users', u.uid as string), data: picked });
      });
    }

    const taskItems: { id: string; ref: DocumentReference; data: BackupRecord }[] = [];
    if (Array.isArray(data.tasks)) {
      data.tasks.forEach((t: BackupRecord) => {
        const cleaned = stripNulls(cleanDataObj(t) as BackupRecord, ['coordinatorId', 'pausedAt']);
        const picked = pick(cleaned, TASK_ALLOWED_FIELDS);
        picked.deadline = toTs(picked.deadline);
        picked.createdAt = toTs(picked.createdAt);
        picked.updatedAt = toTs(picked.updatedAt);
        if ('completedAt' in picked) {
          const ts = toTsOrDrop(picked.completedAt);
          if (ts === undefined) delete picked.completedAt; else picked.completedAt = ts;
        }
        taskItems.push({ id: t.id as string, ref: doc(db, 'tasks', t.id as string), data: picked });
      });
    }

    const blockerItems: { ref: DocumentReference; data: BackupRecord }[] = [];
    if (Array.isArray(data.blockers)) {
      data.blockers.forEach((b: BackupRecord) => {
        const cleaned = stripNulls(cleanDataObj(b) as BackupRecord, []);
        const picked = pick(cleaned, BLOCKER_ALLOWED_FIELDS);
        picked.createdAt = toTs(picked.createdAt);
        if ('resolvedAt' in picked) {
          const ts = toTsOrDrop(picked.resolvedAt);
          if (ts === undefined) delete picked.resolvedAt; else picked.resolvedAt = ts;
        }
        blockerItems.push({ ref: doc(db, 'blockers', b.id as string), data: picked });
      });
    }

    // ── Çapraz-referans iş kuralı doğrulaması (YAZMA YOK) ──────────────────
    // firestore.rules isValidTaskBusinessRules'ın hasNoAdminCoordinator /
    // hasValidSubtaskAssignee / hasValidDelegationTarget dallarının HİÇBİRİNDE
    // Admin istisnası yoktur (bkz. tests/rules "restoreBackup CREATE yolu"
    // belgeleme bloğu) — bu yüzden yazmadan ÖNCE burada tespit edilip TEK bir
    // raporla bildirilir; aksi halde ilgili chunk sunucuda opak bir
    // "Missing or insufficient permissions" ile düşerdi (bkz. kod denetimi,
    // 2026-09-12).
    const referencedUserIds = new Set<string>();
    taskItems.forEach(({ data: t }) => {
      if (typeof t.coordinatorId === 'string') referencedUserIds.add(t.coordinatorId);
      if (typeof t.parentId === 'string' && typeof t.assigneeId === 'string') referencedUserIds.add(t.assigneeId);
      if (t.status === 'PENDING_DELEGATION' && typeof t.assigneeId === 'string') referencedUserIds.add(t.assigneeId);
    });
    const roleOf = await buildRoleResolver(Array.isArray(data.users) ? data.users : [], referencedUserIds);
    const violations = collectTaskRuleViolations(taskItems.map(i => i.data), roleOf);

    const violationLines: string[] = [];
    if (violations.adminCoordinator.length > 0) {
      violationLines.push(`• Koordinatörü Admin olan ${violations.adminCoordinator.length} talimat: ${formatIds(violations.adminCoordinator)} — koordinatör alanını boşaltın veya Admin olmayan bir kullanıcıya çevirin.`);
    }
    if (violations.nonStaffSubtask.length > 0) {
      violationLines.push(`• Sorumlusu Memur OLMAYAN ${violations.nonStaffSubtask.length} alt talimat: ${formatIds(violations.nonStaffSubtask)} — alt talimatların sorumlusu Memur olmalı ve dizgede kayıtlı olmalıdır.`);
    }
    if (violations.nonManagerDelegation.length > 0) {
      violationLines.push(`• Devir bekleyen (PENDING_DELEGATION) ama sorumlusu Müdür olmayan ${violations.nonManagerDelegation.length} talimat: ${formatIds(violations.nonManagerDelegation)}.`);
    }
    if (violationLines.length > 0) {
      throw new RestoreValidationError(
        `Geri yükleme BAŞLATILMADI (hiçbir veri yazılmadı) — aşağıdaki kayıtlar dizge iş kurallarını karşılamıyor:\n${violationLines.join('\n')}`
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ↓↓↓ BURADAN İTİBAREN YAZIM VAR — yukarısı tamamen saf/salt-okunurdu ↓↓↓
    // ═══════════════════════════════════════════════════════════════════════

    // Departman REFERANS bütünlüğü (bkz. firestore.rules userDepartmentIsValid
    // / isValidTaskBusinessRules.hasValidDepartment): departmentId taşıyan her
    // users/tasks yazımı, departments koleksiyonunda VAR OLAN bir dokümana
    // işaret etmek zorundadır — kural bunun için Admin'e bile istisna tanımaz
    // (P0-2, "hayalet departman" koruması, bkz. departmentService.ts). Yedeğin
    // kendisi departments koleksiyonunu TAŞIMAZ (restoreBackupSchema) ve bir
    // proje göçü sonrası (ör. muftim) hedef projede bu dokümanlar henüz hiç
    // yoktur. Bu yüzden referans edilen HER departmentId için eksik departman
    // dokümanı, aşağıdaki users/tasks yazımlarından ÖNCE burada oluşturulur —
    // aksi halde ilk chunk "Missing or insufficient permissions" ile
    // reddedilir (bkz. kod denetimi, 2026-09-12: muftim'e proje göçü sonrası
    // ilk restore denemesinde canlıda görüldü).
    const referencedDeptIds = new Set<string>();
    userItems.forEach(({ data: u }) => { if (typeof u.departmentId === 'string' && u.departmentId) referencedDeptIds.add(u.departmentId); });
    taskItems.forEach(({ data: t }) => { if (typeof t.departmentId === 'string' && t.departmentId) referencedDeptIds.add(t.departmentId); });
    for (const deptId of referencedDeptIds) {
      const deptRef = doc(db, 'departments', deptId);
      const deptSnap = await runWithRetry(() => getDoc(deptRef));
      if (!deptSnap.exists()) {
        // Şekil, firestore.rules isValidDepartment ile birebir eşleşir
        // (allowedFields hasOnly + name == departmentId) — bkz.
        // departmentService.createDepartment'taki aynı yazım.
        await runWithRetry(() => setDoc(deptRef, { name: deptId, createdAt: Date.now(), createdBy: userId }));
      }
    }

    // system/stats agregat sayaçları (Dashboard'un canlı okuduğu totalTasks/
    // status_*) taskService'in create/transitionTask/updateTask/deleteTask
    // fonksiyonlarında increment() ile güncellenir. Restore burada bunların
    // hiçbirini çağırmadan doğrudan writeBatch yazdığından, restore edilen
    // her görev için ESKİ durumu (varsa) okuyup gerçek delta'yı kendimiz
    // hesaplıyoruz. Delta, görevin YAZILDIĞI chunk'ın batch'ine AYNI batch
    // içinde ekleniyor (aşağıdaki chunk döngüsü) — önceden TÜM görevlerin
    // deltası tek seferde yalnızca SON chunk'a ekleniyordu; restore yarıda
    // kesilirse (ağ hatası, tarayıcı kapanması, runWithRetry tükenmesi) önceki
    // chunk'ların görev yazımları zaten commit edilmiş olurdu ama telafi edici
    // delta hiç uygulanmazdı ve sayaçlar kalıcı olarak sapardı (bkz. kod
    // denetimi). Her chunk kendi görevlerinin deltasını kendi batch'iyle
    // ATOMİK olarak taşıdığından, kesilme durumunda yalnızca commit edilmemiş
    // chunk'ların hem görev yazımı hem deltası birlikte eksik kalır — sayaçlar
    // hiçbir zaman gerçek veriden sapmaz.
    const taskDeltaById = new Map<string, Record<string, number>>();
    for (const item of taskItems) {
      const prevSnap = await runWithRetry(() => getDoc(item.ref));
      const newStatus = item.data.status as string | undefined;
      const delta: Record<string, number> = {};
      if (!prevSnap.exists()) {
        delta.totalTasks = 1;
        if (newStatus) delta[`status_${newStatus}`] = (delta[`status_${newStatus}`] ?? 0) + 1;
      } else {
        const prevStatus = (prevSnap.data() as { status?: string }).status;
        if (newStatus && prevStatus !== newStatus) {
          if (prevStatus) delta[`status_${prevStatus}`] = (delta[`status_${prevStatus}`] ?? 0) - 1;
          delta[`status_${newStatus}`] = (delta[`status_${newStatus}`] ?? 0) + 1;
        }
      }
      taskDeltaById.set(item.id, delta);
    }

    const CHUNK = 50;
    // Görev grubu AYRI ve daha KÜÇÜK bir chunk boyutu kullanır: her görev
    // CREATE'i isValidTaskBusinessRules içinde assignee/coordinator/department
    // dokümanlarına erişir ve bunlar (users grubunun aksine) görevler arasında
    // FARKLI dokümanlardır. Emulator'a karşı ikili arama ile ÖLÇÜLDÜ (bkz.
    // tests/rules "batched write: görev grubu için doküman-erişim kotası"
    // bloğu, 2026-09-12): 19 farklı sorumlulu görev TEK batch'te başarılı,
    // 20 KESİN başarısız (Firestore'un batched-write başına doküman-erişim
    // kotası). 15, ölçülen sınırın altında güvenli bir pay bırakır
    // (departmentService.ts MAX_BATCH_OPS=450'nin 500 sınırının altında
    // kalmasıyla AYNI gerekçe — sınırın dibinde çalışmak, ileride chunk
    // başına tek bir yardımcı yazım eklendiğinde sessizce taşardı).
    const TASK_CHUNK = 15;
    const totalItems = userItems.length + taskItems.length + blockerItems.length;
    let writtenCount = 0;

    // Kullanıcı/görev/engel yazımları ayrı chunk GRUPLARINDA commit edilir —
    // tek bir karışık diziyi parçalara bölmek yerine. Gerekçe: Firestore
    // kuralları bir batch İÇİNDEKİ yazımları görmez (get()/exists() her zaman
    // batch ÖNCESİ durumu okur — departmentService.renameDepartment'ta AYNI
    // kısıt nedeniyle adımlar ayrı commit'lere bölünmüştü). Karışık bir
    // chunk'ta AYNI batch'te hem yeni bir kullanıcı hem de onu assigneeId/
    // coordinatorId olarak referans eden bir görev yazılırsa,
    // isValidTaskBusinessRules'taki assignee/coordinator rol kontrolleri o
    // kullanıcıyı henüz YOK sayar ve görev reddedilirdi. Gruplar arası sıra
    // (users → tasks → blockers) bu yüzden kasıtlıdır: blockers taskId'ye,
    // tasks assigneeId/coordinatorId üzerinden users'a bağımlıdır.
    const writeGroup = async (
      list: { ref: DocumentReference; data: BackupRecord; id?: string }[],
      chunkSize: number
    ) => {
      for (let i = 0; i < list.length; i += chunkSize) {
        const chunk = list.slice(i, i + chunkSize);

        const chunkStatsDelta: Record<string, number> = {};
        chunk.forEach(it => {
          if (!it.id) return;
          const delta = taskDeltaById.get(it.id);
          if (!delta) return;
          Object.entries(delta).forEach(([key, value]) => {
            chunkStatsDelta[key] = (chunkStatsDelta[key] ?? 0) + value;
          });
        });

        // Batch, her deneme için runWithRetry closure'ının İÇİNDE yeniden
        // oluşturulur: Firestore SDK'sı commit() çağrılan bir WriteBatch'i,
        // istek ağ hatasıyla başarısız olsa bile kalıcı olarak "committed"
        // işaretler. Batch dışarıda oluşturulup yalnızca commit() retry
        // ediliyorsa, ilk deneme başarısız olduğunda ikinci deneme gerçek
        // ağ hatası yerine "A write batch can no longer be used after
        // commit() has been called" hatası fırlatırdı (bkz. kod denetimi —
        // departmentService.commitInChunks'taki desenle tutarlı hale getirildi).
        await runWithRetry(() => {
          const batch = writeBatch(db);
          chunk.forEach(it => batch.set(it.ref, it.data, { merge: true }));
          if (Object.keys(chunkStatsDelta).length > 0) {
            const statsPayload: Record<string, ReturnType<typeof increment>> = {};
            Object.entries(chunkStatsDelta).forEach(([key, value]) => {
              if (value !== 0) statsPayload[key] = increment(value);
            });
            if (Object.keys(statsPayload).length > 0) {
              batch.set(doc(db, 'system', 'stats'), statsPayload, { merge: true });
            }
          }
          return batch.commit();
        });
        writtenCount += chunk.length;
        onProgress?.(Math.round((writtenCount / totalItems) * 100));
      }
    };

    await writeGroup(userItems, CHUNK);
    await writeGroup(taskItems, TASK_CHUNK);
    await writeGroup(blockerItems, CHUNK);

    // Register restore audit log — hangi dosyadan, kaç kayıt geri yüklendiği kaydedilir
    await runWithRetry(() => addDoc(collection(db, 'audit_logs'), {
      taskId: 'system_backup_restore',
      // Dizge düzeyinde bir OLAY (toplu geri yükleme), tek tek alanların
      // düzenlenmesi değil — bkz. taskService.auditLogType sınıflandırması.
      ...auditLogType('STATUS'),
      changedBy: userId,
      oldValue: `Yedek dosyası: ${fileName}`,
      newValue: `${userItems.length} kullanıcı, ${taskItems.length} talimat, ${blockerItems.length} engel geri yüklendi`,
      timestamp: Date.now()
    }));

    // Artık sessiz atlama YOK (uid/id eksik kayıtlar şema aşamasında bloke
    // edilir) — bu sayımlar GERÇEKTEN yazılan kayıt sayısıdır.
    return { userCount: userItems.length, taskCount: taskItems.length, blockerCount: blockerItems.length };
  },

  /** Denetim izi dışa aktarımının kendisini audit_logs'a kaydeder — kayıtların
   *  hiçbiri silinmez, yalnızca "yerel dosyaya aktarıldı" izi düşülür. */
  async archiveAuditLogs(logCount: number, userId: string) {
    await runWithRetry(() => addDoc(collection(db, 'audit_logs'), {
      taskId: 'system_log_export',
      // restoreBackup ile AYNI gerekçe: dışa aktarma bir dizge olayıdır.
      ...auditLogType('STATUS'),
      changedBy: userId,
      oldValue: logCount + ' kayıt (veritabanında)',
      newValue: 'Yerel dosyaya aktarıldı',
      timestamp: Date.now()
    }));
  }
};
