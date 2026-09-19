/**
 * useStaleTaskEscalation — Atıl Görev Eskalasyonu (Kriz)
 *
 * SPARK PLANI KALICI TELAFİSİ: bu işi yapması gereken
 * `functions/scheduledAudit.ts` (her gün 08:00, Admin SDK ile rules'ı bypass
 * ederek) Blaze gerektirdiğinden hiç deploy edilmedi ve MAKAM Spark planında
 * KALICI olarak kalacağından (bkz. CLAUDE.md) asla deploy edilmeyecek. Bu
 * hook aynı işi client tarafında, bir Admin oturumu açıkken üstlenir: 24
 * saattir güncellenmeyen, terminal olmayan görevleri CRISIS'e yükseltir ve
 * ilgili tarafları (sorumlu/koordinatör) bilgilendirir.
 *
 * useSelfHealing (BLOCKED onarımı) ile AYNI mimari aile: rol kapısı +
 * sessiz VERSION_MISMATCH toleransı + onError üzerinden hata bildirimi.
 * İKİ önemli farkla:
 *  1. Yalnızca Admin için aktiftir — BLOCKED/AWAITING_APPROVAL/
 *     PENDING_DELEGATION'dan CRISIS'e geçiş firestore.rules'ta yalnızca
 *     `isAdmin()` override'ıyla mümkündür (bkz. taskStateMachine.ts
 *     isValidStaleEscalationTransition, taskService.ts escalateStaleTask).
 *  2. Zaman tabanlı bir süpürmedir (görev/blocker İÇERİK değişikliğine değil,
 *     saate bağlıdır) — bu yüzden useSelfHealing'in 5sn debounce'u yerine
 *     localStorage tabanlı "günde ~bir kez" kısıtlaması + periyodik bir
 *     setInterval kontrolü kullanılır (sekme günler boyu açık kalsa bile
 *     sayfa yenilenmeden zamanı yakalayabilsin diye).
 */
import { useEffect, useRef } from 'react';
import { taskService } from '../services/taskService';
import { notificationService } from '../services/notificationService';
import { logger } from '../lib/logger';
import {
  STALE_TASK_ESCALATION_THRESHOLD_MS,
  STALE_TASK_ESCALATION_SWEEP_INTERVAL_MS,
  STALE_TASK_ESCALATION_MAX_PER_SWEEP,
} from '../constants';
import type { Task, User } from '../types';

export const STALE_ESCALATION_SWEEP_STORAGE_KEY = 'makam_last_stale_escalation_sweep_at';

// CRISIS'e zaten girmiş ya da terminal (COMPLETED/CANCELLED) görevler asla
// yeniden değerlendirilmez.
const EXCLUDED_STATUSES = new Set(['COMPLETED', 'CANCELLED', 'CRISIS']);

// setInterval'in kontrol sıklığı — gerçek bir süpürme yalnızca throttle
// penceresi (STALE_TASK_ESCALATION_SWEEP_INTERVAL_MS) dolduğunda tetiklenir;
// bu yalnızca uzun süre açık kalan bir sekmenin sayfa yenilenmeden de zamanı
// yakalamasını sağlar.
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

function readLastSweepAt(): number {
  try {
    const raw = localStorage.getItem(STALE_ESCALATION_SWEEP_STORAGE_KEY);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

function writeLastSweepAt(value: number): void {
  try {
    localStorage.setItem(STALE_ESCALATION_SWEEP_STORAGE_KEY, String(value));
  } catch {
    // Depolama kotası/gizli mod — kritik değil, yalnızca throttle önbelleği.
  }
}

interface UseStaleTaskEscalationOptions {
  user: User | null;
  tasks: Task[];
  onError?: (err: unknown, type: string, path: string) => void;
}

export function useStaleTaskEscalation({ user, tasks, onError }: UseStaleTaskEscalationOptions) {
  // uid/role'e (primitive) bağımlı — useSelfHealing'teki AYNI gerekçe: `user`
  // nesnesi onarımla alakasız her değişiklikte yeni referans alır.
  const uid = user?.uid;
  const role = user?.role;

  // Süpürme callback'i tasks'ın GÜNCEL içeriğine bir ref üzerinden erişir —
  // setInterval kapanışının (closure) her tetiklemede en son listeyi görmesi
  // için (aksi halde yalnızca mount anındaki tasks donmuş kalırdı).
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  useEffect(() => {
    // Yalnızca Admin: bkz. dosya başlığı — diğer roller için rules zaten
    // reddeder, burada erkenden çıkmak gereksiz bir yazma denemesini
    // (ve onun hata gürültüsünü) önler.
    if (!uid || role !== 'Admin') return;

    const sweep = async () => {
      const now = Date.now();
      if (now - readLastSweepAt() < STALE_TASK_ESCALATION_SWEEP_INTERVAL_MS) return;
      // Süpürmeyi HEMEN işaretle: aşağıdaki yazımlar yavaş/kısmen başarısız
      // olsa bile aynı görev seti aynı gün içinde tekrar tekrar denenmez
      // (Spark yazma kotası korunur). Zaman tabanlı olduğundan bir sonraki
      // pencerede otomatik olarak yeniden değerlendirilir.
      writeLastSweepAt(now);

      const staleTasks = tasksRef.current
        .filter(t => !EXCLUDED_STATUSES.has(t.status) && now - t.updatedAt > STALE_TASK_ESCALATION_THRESHOLD_MS)
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .slice(0, STALE_TASK_ESCALATION_MAX_PER_SWEEP);

      for (const task of staleTasks) {
        try {
          await taskService.escalateStaleTask(task.id, uid, task.lockVersion);
          logger.debug(`[StaleEscalation] "${task.title}" — 24 saattir güncellenmedi, Kriz'e yükseltildi.`);

          const targets = [task.assigneeId, task.coordinatorId]
            .filter((target, index, all): target is string => !!target && all.indexOf(target) === index);
          await Promise.all(targets.map(targetUserId => notificationService.notifyTaskParty({
            targetUserId,
            actorUserId: uid,
            taskId: task.id,
            title: '🚨 Talimat Kriz Durumuna Yükseltildi',
            message: `"${task.title}" 24 saattir güncellenmediği için otomatik olarak Kriz durumuna alındı.`,
            type: 'Crisis',
          })));
        } catch (e) {
          // VERSION_MISMATCH beklenen bir durumdur (görev bu süpürme sırasında
          // başka bir yerden değişti) — sessizce atlanır, bir sonraki
          // süpürmede güncel veriyle yeniden değerlendirilir (useSelfHealing
          // ile AYNI tolerans).
          if (e instanceof Error && e.message.includes('VERSION_MISMATCH')) continue;
          logger.warn('[StaleEscalation] Yükseltme başarısız:', e);
          onError?.(e, 'update', `tasks/${task.id}`);
        }
      }
    };

    void sweep();
    const interval = setInterval(() => { void sweep(); }, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [uid, role, onError]);
}
