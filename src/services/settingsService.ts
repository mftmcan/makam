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

// ── Yedek Doğrulama Şemaları (Restore) ──────────────────────────────────────
// role/status/priority değerleri types.ts'teki KANONİK enum'lardan alınır —
// burada elle kopyalanmış bağımsız bir liste tutulursa, types.ts'e yeni bir
// durum eklendiğinde bu şema güncellenmediği sürece tamamen geçerli, güncel
// bir MAKAM yedeği bile reddedilir (bkz. settingsService.restoreBackup).
export const userBackupSchema = z.object({
  uid: z.string(),
  fullName: z.string(),
  email: z.string().email(),
  role: UserRoleSchema
});

export const taskBackupSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  creatorId: z.string(),
  assigneeId: z.string(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  deadline: z.any(),
  createdAt: z.any(),
  updatedAt: z.any()
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

const toTs = (val: unknown, fb?: number): number => {
  if (val == null) return fb ?? Date.now();
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return new Date(val).getTime() || (fb ?? Date.now());
  if (typeof val === 'object' && 'seconds' in val) return (val as { seconds: number }).seconds * 1000;
  return fb ?? Date.now();
};

const pick = (obj: BackupRecord, keys: string[]) => {
  const r: BackupRecord = {};
  keys.forEach(k => { if (k in obj && obj[k] !== undefined) r[k] = obj[k]; });
  return r;
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
   *  yüzdesini (0-100) onProgress ile bildirir. Doğrulama hatası veya
   *  format hatası durumunda Error fırlatır. */
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
      data.tasks.forEach((t: BackupRecord) => {
        const parsed = taskBackupSchema.safeParse(t);
        if (!parsed.success) {
          throw new Error(`Talimat verisi doğrulanamadı (${(t.title as string) || 'Bilinmeyen'}). Hata: ${parsed.error.issues[0]?.message || parsed.error.message}`);
        }
      });
    }

    const userItems: { ref: DocumentReference; data: BackupRecord }[] = [];
    if (Array.isArray(data.users)) {
      data.users.forEach((u: BackupRecord) => {
        if (u.uid) userItems.push({ ref: doc(db, 'users', u.uid as string), data: pick(cleanDataObj(u) as BackupRecord, ['uid', 'fullName', 'email', 'role', 'departmentId', 'photoURL', 'fcmTokens']) });
      });
    }
    const taskItems: { id: string; ref: DocumentReference; data: BackupRecord }[] = [];
    if (Array.isArray(data.tasks)) {
      data.tasks.forEach((t: BackupRecord) => {
        if (t.id) {
          const s = cleanDataObj(t) as BackupRecord;
          s.deadline  = toTs(s.deadline);
          s.createdAt = toTs(s.createdAt);
          s.updatedAt = toTs(s.updatedAt);
          taskItems.push({ id: t.id as string, ref: doc(db, 'tasks', t.id as string), data: s });
        }
      });
    }
    const blockerItems: { ref: DocumentReference; data: BackupRecord }[] = [];
    if (Array.isArray(data.blockers)) {
      data.blockers.forEach((b: BackupRecord) => {
        if (b.id) {
          const { id, ...rest } = cleanDataObj(b) as BackupRecord;
          rest.createdAt = toTs(rest.createdAt);
          if (rest.resolvedAt) rest.resolvedAt = toTs(rest.resolvedAt);
          blockerItems.push({ ref: doc(db, 'blockers', id as string), data: rest });
        }
      });
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
      const prevSnap = await getDoc(item.ref);
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

    const items = [...userItems, ...taskItems, ...blockerItems];
    const CHUNK = 50;
    for (let i = 0; i < items.length; i += CHUNK) {
      const chunk = items.slice(i, i + CHUNK);

      const chunkStatsDelta: Record<string, number> = {};
      chunk.forEach(it => {
        const itemId = (it as { id?: string }).id;
        if (!itemId) return;
        const delta = taskDeltaById.get(itemId);
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
      onProgress?.(Math.round(((i + chunk.length) / items.length) * 100));
    }

    // Register restore audit log — hangi dosyadan, kaç kayıt geri yüklendiği kaydedilir
    await runWithRetry(() => addDoc(collection(db, 'audit_logs'), {
      taskId: 'system_backup_restore',
      // Dizge düzeyinde bir OLAY (toplu geri yükleme), tek tek alanların
      // düzenlenmesi değil — bkz. taskService.auditLogType sınıflandırması.
      ...auditLogType('STATUS'),
      changedBy: userId,
      oldValue: `Yedek dosyası: ${fileName}`,
      newValue: `${data.users?.length ?? 0} kullanıcı, ${data.tasks?.length ?? 0} talimat, ${data.blockers?.length ?? 0} engel geri yüklendi`,
      timestamp: Date.now()
    }));

    return { userCount: data.users?.length ?? 0, taskCount: data.tasks?.length ?? 0, blockerCount: data.blockers?.length ?? 0 };
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
