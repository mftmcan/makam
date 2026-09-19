/**
 * useStaleTaskEscalation testleri.
 *
 * Bu hook, Spark planında kalıcı olarak deploy edilemeyecek olan
 * functions/scheduledAudit.ts'in yerini alır — yanlış çalışması ya atıl
 * görevlerin sonsuza dek fark edilmemesi (eski davranış) ya da Admin
 * olmayan bir rolde beklenmedik/reddedilecek yazma denemeleri anlamına
 * gelir. Bu yüzden rol kapısı, eşik/kapasite filtrelemesi ve throttle
 * (localStorage) davranışı burada ayrı ayrı doğrulanır.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStaleTaskEscalation, STALE_ESCALATION_SWEEP_STORAGE_KEY } from './useStaleTaskEscalation';
import { taskService } from '../services/taskService';
import { notificationService } from '../services/notificationService';
import { STALE_TASK_ESCALATION_THRESHOLD_MS, STALE_TASK_ESCALATION_MAX_PER_SWEEP } from '../constants';
import type { Task, User } from '../types';

vi.mock('../services/taskService', () => ({
  taskService: { escalateStaleTask: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../services/notificationService', () => ({
  notificationService: { notifyTaskParty: vi.fn().mockResolvedValue(undefined) },
}));

const ADMIN: User = { uid: 'admin-1', role: 'Admin' } as User;
const MANAGER: User = { uid: 'mgr-1', role: 'Manager' } as User;

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 't-1', title: 'Denetim Hedefi', status: 'IN_PROGRESS',
    updatedAt: Date.now(), lockVersion: 0, assigneeId: 'staff-1', coordinatorId: undefined,
    ...overrides,
  } as Task;
}

// jsdom localStorage her testte kalıcı — açıkça temizlenmezse throttle
// bir sonraki teste sızar.
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const STALE_UPDATED_AT = () => Date.now() - STALE_TASK_ESCALATION_THRESHOLD_MS - 1000;

describe('useStaleTaskEscalation', () => {
  it('Admin OLMAYAN roller için hiçbir şey yapmaz (rules zaten reddeder — gereksiz deneme yok)', async () => {
    const tasks = [makeTask({ updatedAt: STALE_UPDATED_AT() })];
    renderHook(() => useStaleTaskEscalation({ user: MANAGER, tasks }));

    await vi.runOnlyPendingTimersAsync();

    expect(taskService.escalateStaleTask).not.toHaveBeenCalled();
  });

  it('kullanıcı yoksa hiçbir şey yapmaz', async () => {
    const tasks = [makeTask({ updatedAt: STALE_UPDATED_AT() })];
    renderHook(() => useStaleTaskEscalation({ user: null, tasks }));

    await vi.runOnlyPendingTimersAsync();

    expect(taskService.escalateStaleTask).not.toHaveBeenCalled();
  });

  it('24 saatten YENİ görevleri yükseltmez', async () => {
    const tasks = [makeTask({ updatedAt: Date.now() - 1000 })];
    renderHook(() => useStaleTaskEscalation({ user: ADMIN, tasks }));

    await vi.runOnlyPendingTimersAsync();

    expect(taskService.escalateStaleTask).not.toHaveBeenCalled();
  });

  it('COMPLETED/CANCELLED/CRISIS durumundaki atıl görevleri asla yükseltmez', async () => {
    const tasks = [
      makeTask({ id: 't-completed', status: 'COMPLETED', updatedAt: STALE_UPDATED_AT() }),
      makeTask({ id: 't-cancelled', status: 'CANCELLED', updatedAt: STALE_UPDATED_AT() }),
      makeTask({ id: 't-crisis', status: 'CRISIS', updatedAt: STALE_UPDATED_AT() }),
    ];
    renderHook(() => useStaleTaskEscalation({ user: ADMIN, tasks }));

    await vi.runOnlyPendingTimersAsync();

    expect(taskService.escalateStaleTask).not.toHaveBeenCalled();
  });

  it('24 saattir güncellenmeyen aktif bir görevi Admin oturumunda yükseltir ve tarafları bilgilendirir', async () => {
    const tasks = [makeTask({ updatedAt: STALE_UPDATED_AT(), assigneeId: 'staff-1', coordinatorId: 'mgr-2', lockVersion: 3 })];
    renderHook(() => useStaleTaskEscalation({ user: ADMIN, tasks }));

    await vi.runOnlyPendingTimersAsync();

    expect(taskService.escalateStaleTask).toHaveBeenCalledWith('t-1', 'admin-1', 3);
    // Hem sorumlu hem koordinatör bilgilendirilir (farklı kişiler oldukları için)
    expect(notificationService.notifyTaskParty).toHaveBeenCalledTimes(2);
    expect(notificationService.notifyTaskParty).toHaveBeenCalledWith(
      expect.objectContaining({ targetUserId: 'staff-1', type: 'Crisis' })
    );
    expect(notificationService.notifyTaskParty).toHaveBeenCalledWith(
      expect.objectContaining({ targetUserId: 'mgr-2', type: 'Crisis' })
    );
  });

  it('sorumlu ve koordinatör AYNI kişiyse yalnızca bir kez bilgilendirilir', async () => {
    const tasks = [makeTask({ updatedAt: STALE_UPDATED_AT(), assigneeId: 'staff-1', coordinatorId: 'staff-1' })];
    renderHook(() => useStaleTaskEscalation({ user: ADMIN, tasks }));

    await vi.runOnlyPendingTimersAsync();

    expect(notificationService.notifyTaskParty).toHaveBeenCalledTimes(1);
  });

  it('tek süpürmede en fazla STALE_TASK_ESCALATION_MAX_PER_SWEEP görev işlenir, en eski önce', async () => {
    const now = Date.now();
    const tasks = Array.from({ length: STALE_TASK_ESCALATION_MAX_PER_SWEEP + 5 }, (_, i) => makeTask({
      id: `t-${i}`,
      // Her görev farklı derecede atıl — en küçük updatedAt (en eski) ilk sırada beklenir.
      updatedAt: now - STALE_TASK_ESCALATION_THRESHOLD_MS - 1000 - i,
    }));
    renderHook(() => useStaleTaskEscalation({ user: ADMIN, tasks }));

    await vi.runOnlyPendingTimersAsync();

    expect(taskService.escalateStaleTask).toHaveBeenCalledTimes(STALE_TASK_ESCALATION_MAX_PER_SWEEP);
    // En eski (en büyük i, en küçük updatedAt) ilk işlenmeli.
    const lastTaskId = `t-${STALE_TASK_ESCALATION_MAX_PER_SWEEP + 5 - 1}`;
    expect(taskService.escalateStaleTask).toHaveBeenNthCalledWith(1, lastTaskId, 'admin-1', 0);
  });

  it('throttle: aynı gün içinde ikinci bir süpürme tetiklenmez', async () => {
    const tasks = [makeTask({ updatedAt: STALE_UPDATED_AT() })];
    const { rerender } = renderHook(
      ({ tasks }) => useStaleTaskEscalation({ user: ADMIN, tasks }),
      { initialProps: { tasks } }
    );
    await vi.runOnlyPendingTimersAsync();
    expect(taskService.escalateStaleTask).toHaveBeenCalledTimes(1);

    // localStorage'a yazılmış throttle damgası var mı?
    expect(localStorage.getItem(STALE_ESCALATION_SWEEP_STORAGE_KEY)).not.toBeNull();

    // Yeni bir atıl görevle yeniden render — throttle penceresi dolmadığından
    // hiçbir yeni çağrı olmamalı.
    rerender({ tasks: [...tasks, makeTask({ id: 't-2', updatedAt: STALE_UPDATED_AT() })] });
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    expect(taskService.escalateStaleTask).toHaveBeenCalledTimes(1);
  });

  it('VERSION_MISMATCH sessizce atlanır, diğer görevler işlenmeye devam eder', async () => {
    vi.mocked(taskService.escalateStaleTask)
      .mockRejectedValueOnce(new Error('VERSION_MISMATCH: Beklenen Versiyon 1, Sunucu Versiyonu 2'))
      .mockResolvedValueOnce({} as Task);
    const tasks = [
      makeTask({ id: 't-a', updatedAt: STALE_UPDATED_AT() - 10 }),
      makeTask({ id: 't-b', updatedAt: STALE_UPDATED_AT() }),
    ];
    const onError = vi.fn();

    renderHook(() => useStaleTaskEscalation({ user: ADMIN, tasks, onError }));
    await vi.runOnlyPendingTimersAsync();

    expect(taskService.escalateStaleTask).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it('VERSION_MISMATCH dışındaki hatalar onError\'a iletilir', async () => {
    vi.mocked(taskService.escalateStaleTask).mockRejectedValueOnce(new Error('permission-denied'));
    const tasks = [makeTask({ updatedAt: STALE_UPDATED_AT() })];
    const onError = vi.fn();

    renderHook(() => useStaleTaskEscalation({ user: ADMIN, tasks, onError }));
    await vi.runOnlyPendingTimersAsync();

    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'update', 'tasks/t-1');
  });
});
