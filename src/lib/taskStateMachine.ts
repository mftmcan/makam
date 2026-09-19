import type { TaskStatus } from '../types';

/**
 * Görev durum makinesi — firestore.rules'taki isValidTransition fonksiyonuyla
 * BİREBİR AYNI kurallar. Admin override (rules'ta Admin her geçişi bypass
 * edebilir) burada KASITLI olarak modellenmez: normal kullanıcı akışlarının
 * (bkz. taskDetails/helpers.ts getPrimaryAction) hiçbiri buna ihtiyaç duymaz.
 * TEK istisna aşağıdaki `isValidStaleEscalationTransition` — o, bilinçli
 * olarak AYRI, dar bir fonksiyondur ve yalnızca useStaleTaskEscalation
 * tarafından çağrılır; `isValidTaskTransition`'ı GEVŞETMEZ. Bu, client
 * tarafında ikinci bir savunma hattıdır; ikisini değiştirirken diğerini de
 * güncelleyin (bkz. CLAUDE.md "Görev durum makinesi").
 *
 * COMPLETED ve CANCELLED terminal durumlardır: her ikisinin de listesi
 * kasıtlı olarak boş — CANCELLED, aşağıdaki her aktif durumun kendi
 * listesinde AYRI AYRI hedef olarak yer alıyor (evrensel bir kısayol değil).
 * Eskiden `isValidTaskTransition` içinde `to === 'CANCELLED'` için ayrı bir
 * kısayol vardı; bu, oldStatus'tan bağımsız çalıştığından COMPLETED bir
 * görevin bile CANCELLED'a çekilmesine izin veriyordu (bkz. kod denetimi).
 */
// export edilmesinin TEK nedeni parity testidir (taskStateMachine.parity.test.ts,
// firestore.rules'taki isValidTransition tablosuyla makine-okunur karşılaştırma).
// Üretim kodu bu tabloya doğrudan erişmemeli, yalnızca isValidTaskTransition()
// üzerinden sorgulamalı.
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  ASSIGNED: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED', 'PENDING_DELEGATION'],
  PENDING_DELEGATION: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['BLOCKED', 'AWAITING_APPROVAL', 'COMPLETED', 'CANCELLED', 'CRISIS', 'PENDING_DELEGATION'],
  BLOCKED: ['IN_PROGRESS', 'CANCELLED'],
  AWAITING_APPROVAL: ['COMPLETED', 'IN_PROGRESS', 'CANCELLED'],
  CRISIS: ['IN_PROGRESS', 'CANCELLED', 'COMPLETED', 'AWAITING_APPROVAL'],
  COMPLETED: [],
  CANCELLED: [],
};

export function isValidTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Atıl görev eskalasyonu (bkz. hooks/useStaleTaskEscalation.ts) için DAR,
 * kasıtlı bir istisna — firestore.rules'taki `isValidTransition(...) ||
 * isAdmin()` override'ının client karşılığı. `VALID_TRANSITIONS` tablosunda
 * BLOCKED/AWAITING_APPROVAL/PENDING_DELEGATION → CRISIS yoktur (yalnızca
 * IN_PROGRESS → CRISIS izinlidir) çünkü bu üç durum SLA sayacını zaten
 * durdurmuştur; ama 24 saattir hiç güncellenmeyen bir görev, hangi durumda
 * olursa olsun, dikkat gerektirir. Cloud Functions'ın karşılığı
 * (`functions/scheduledAudit.ts`) bunu Admin SDK ile rules'ı bypass ederek
 * yapıyordu, ama Spark planında hiç deploy edilmedi ve MAKAM Spark'ta kalıcı
 * kalacağından (bkz. CLAUDE.md) asla deploy edilmeyecek — bu fonksiyon AYNI
 * istisnayı, gerçek bir Admin oturumu altında ve rules'ın zaten izin verdiği
 * `isAdmin()` yolundan uygular.
 *
 * `isValidTaskTransition`'dan tamamen AYRI tutulur (aynı tabloya eklenmez):
 * bu istisna yalnızca useStaleTaskEscalation'ın çağırdığı
 * `taskService.escalateStaleTask` içinde kullanılır — `isValidTaskTransition`
 * her yerde (getPrimaryAction, updateTask, vb.) kullanıldığından oraya
 * eklemek bu istisnayı normal kullanıcı akışlarına da sessizce açardı.
 */
export function isValidStaleEscalationTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (to !== 'CRISIS') return false;
  return from === 'IN_PROGRESS' || from === 'BLOCKED' || from === 'AWAITING_APPROVAL' || from === 'PENDING_DELEGATION';
}
