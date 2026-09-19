/**
 * useSelfHealing testleri.
 *
 * BLOCKED bir görevi aktif engeli yokken sessizce IN_PROGRESS'e döndüren
 * otomasyon — yanlış çalışması ya gerçekten engelli bir görevi erken açar
 * (SLA sayacını haksız yere yeniden başlatır) ya da hiç onarmaz (görev
 * sonsuza dek BLOCKED görünür kalır).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSelfHealing } from './useSelfHealing';
import { taskService } from '../services/taskService';
import type { Task, TaskBlocker, User } from '../types';

vi.mock('../services/taskService', () => ({
  taskService: { updateTaskStatus: vi.fn().mockResolvedValue(undefined) },
}));

const ADMIN: User = { uid: 'admin-1', role: 'Admin' } as User;
const STAFF: User = { uid: 'staff-1', role: 'Staff' } as User;

function makeTask(overrides: Partial<Task>): Task {
  return { id: 't-1', status: 'BLOCKED', lockVersion: 0, ...overrides } as Task;
}
function makeBlocker(overrides: Partial<TaskBlocker>): TaskBlocker {
  return { taskId: 't-1', isResolved: false, ...overrides } as TaskBlocker;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe('useSelfHealing', () => {
  it('Staff için hiç çalışmaz (yalnızca Admin/Manager)', async () => {
    const tasks = [makeTask({})];
    renderHook(() => useSelfHealing({ user: STAFF, tasks, blockers: [] }));

    await advance(5000);

    expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('kullanıcı yoksa çalışmaz', async () => {
    const tasks = [makeTask({})];
    renderHook(() => useSelfHealing({ user: null, tasks, blockers: [] }));

    await advance(5000);

    expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('aktif engeli olmayan BLOCKED görevi 5sn sonra IN_PROGRESS\'e döndürür', async () => {
    const tasks = [makeTask({})];
    renderHook(() => useSelfHealing({ user: ADMIN, tasks, blockers: [] }));

    await advance(4999);
    expect(taskService.updateTaskStatus).not.toHaveBeenCalled();

    await advance(1);
    expect(taskService.updateTaskStatus).toHaveBeenCalledWith('t-1', 'IN_PROGRESS', 'BLOCKED', 'admin-1', undefined, undefined, 0);
  });

  it('aktif (çözülmemiş) engeli olan BLOCKED görevi ONARMAZ', async () => {
    const tasks = [makeTask({})];
    const blockers = [makeBlocker({ isResolved: false })];
    renderHook(() => useSelfHealing({ user: ADMIN, tasks, blockers }));

    await advance(5000);

    expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('yalnızca ÇÖZÜLMÜŞ engeli olan (aktif engeli kalmamış) BLOCKED görevi onarır', async () => {
    const tasks = [makeTask({})];
    const blockers = [makeBlocker({ isResolved: true })];
    renderHook(() => useSelfHealing({ user: ADMIN, tasks, blockers }));

    await advance(5000);

    expect(taskService.updateTaskStatus).toHaveBeenCalledOnce();
  });

  it('BLOCKED olmayan görevlere dokunmaz', async () => {
    const tasks = [makeTask({ status: 'IN_PROGRESS' })];
    renderHook(() => useSelfHealing({ user: ADMIN, tasks, blockers: [] }));

    await advance(5000);

    expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('VERSION_MISMATCH sessizce yutulur (uygulama çökmez)', async () => {
    vi.mocked(taskService.updateTaskStatus).mockRejectedValueOnce(new Error('VERSION_MISMATCH: ...'));
    const tasks = [makeTask({})];

    expect(() => {
      renderHook(() => useSelfHealing({ user: ADMIN, tasks, blockers: [] }));
    }).not.toThrow();

    await advance(5000);
    expect(taskService.updateTaskStatus).toHaveBeenCalledOnce();
  });

  it('unmount olduğunda bekleyen zamanlayıcı iptal edilir', async () => {
    const tasks = [makeTask({})];
    const { unmount } = renderHook(() => useSelfHealing({ user: ADMIN, tasks, blockers: [] }));

    await advance(4000);
    unmount();
    await advance(5000);

    expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
  });
});
