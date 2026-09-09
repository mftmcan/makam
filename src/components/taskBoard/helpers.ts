import type { Task, TaskStatus, TaskPriority, User } from '../../types';
import { STATUS_LABELS } from '../../constants';
import type { TaskBoardSortField } from '../../hooks/useTaskBoardFilters';
import type { SortDir } from '../ui/dataTable';

// Sütun başlığına tıklayarak sıralama (bkz. tasarım denetimi 3.4) — bu sıra
// firestore.rules'taki isValidTransition ile İLGİSİZDİR, yalnızca tabloda
// "en acil önce" görsel sıralaması için tanımlıdır. Artan (asc) yön bu
// sırayı, azalan (desc) yön tersini gösterir.
export const STATUS_SORT_ORDER: Record<TaskStatus, number> = {
  CRISIS: 0,
  BLOCKED: 1,
  PENDING_DELEGATION: 2,
  ASSIGNED: 3,
  IN_PROGRESS: 4,
  AWAITING_APPROVAL: 5,
  COMPLETED: 6,
  CANCELLED: 7,
};
export const PRIORITY_SORT_ORDER: Record<TaskPriority, number> = {
  Urgent: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

export interface FilterTasksParams {
  tasks: Task[];
  search: string;
  currentUser: User | null;
  showSubtasks: boolean;
  priorityFilter: string;
  assigneeFilter: string;
  statusFilter: string;
  usersById: Map<string, User>;
}

/**
 * `TaskBoard.tsx`'teki `filteredTasks` useMemo'sunun saf hâli — arama
 * (başlık/açıklama/sorumlu adı/birim/durum), alt-talimat görünürlüğü,
 * öncelik/sorumlu/durum filtreleri. NOT: rol bazlı ek bir kısıtlama burada
 * uygulanmaz — `tasks` zaten Firestore kurallarınca departman bazlı
 * filtrelenmiş gelir (bkz. TaskBoard.tsx'teki aynı gerekçe).
 */
export function filterTasks(params: FilterTasksParams): Task[] {
  const { tasks, search, currentUser, showSubtasks, priorityFilter, assigneeFilter, statusFilter, usersById } = params;
  const assigneeFilterEmail = assigneeFilter === 'All' ? null : (usersById.get(assigneeFilter)?.email ?? null);
  const searchLower = search.toLowerCase();

  return tasks.filter(task => {
    const assignee = usersById.get(task.assigneeId);
    const statusLabel = STATUS_LABELS[task.status]?.toLowerCase() ?? '';
    const matchesSearch = !search.trim() || [
      task.title,
      task.description,
      assignee?.fullName ?? '',
      assignee?.departmentId ?? '',
      statusLabel,
    ].some(field => field.toLowerCase().includes(searchLower));

    const isTopLevel = !task.parentId;
    const isAssignedToMe = task.assigneeId === currentUser?.uid || task.assigneeId === currentUser?.email;
    const isVisible = showSubtasks || isTopLevel || isAssignedToMe;
    const matchesPriority = priorityFilter === 'All' || task.priority === priorityFilter;
    const matchesAssignee = assigneeFilter === 'All' || task.assigneeId === assigneeFilter || task.assigneeId === assigneeFilterEmail;
    const matchesStatus = statusFilter === 'All' || task.status === statusFilter;

    return matchesSearch && isVisible && matchesPriority && matchesAssignee && matchesStatus;
  });
}

/**
 * `TaskBoard.tsx`'teki `sortedTasks` useMemo'sunun saf hâli — `sortBy ===
 * 'none'` iken (varsayılan) orijinal Firestore/onSnapshot sırası (oluşturulma
 * sırası) hiç bozulmadan korunur.
 */
export function sortTasks(tasks: Task[], sortBy: TaskBoardSortField, sortDir: SortDir, usersById: Map<string, User>): Task[] {
  if (sortBy === 'none') return tasks;
  const dir = sortDir === 'asc' ? 1 : -1;
  const withKey = (task: Task): string | number => {
    switch (sortBy) {
      case 'status': return STATUS_SORT_ORDER[task.status];
      case 'priority': return PRIORITY_SORT_ORDER[task.priority];
      case 'deadline': return task.deadline;
      case 'assignee': return (usersById.get(task.assigneeId)?.fullName ?? '').toLowerCase();
      case 'title': return task.title.toLowerCase();
      default: return 0;
    }
  };
  return [...tasks].sort((a, b) => {
    const ka = withKey(a);
    const kb = withKey(b);
    if (ka < kb) return -1 * dir;
    if (ka > kb) return 1 * dir;
    return 0;
  });
}

export interface BulkResultSummary {
  succeededIds: Set<string>;
  successCount: number;
  failCount: number;
  versionMismatchCount: number;
  toastTitle: string;
  toastBody: string;
  toastType: 'success' | 'warning';
}

/**
 * `TaskBoard.tsx`'teki `summarizeBulkResult`'ın saf hâli — kısmi başarı
 * raporlaması (Promise.allSettled sonuçlarından succeeded/failed ayrımı +
 * toast metni). Yan etkiler (addToast, setSelectedIds) çağıranda kalır.
 */
export function summarizeBulkResult(label: string, targets: Task[], results: PromiseSettledResult<void>[]): BulkResultSummary {
  const succeededIds = new Set<string>();
  let versionMismatchCount = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      succeededIds.add(targets[i]!.id);
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      if (msg.includes('VERSION_MISMATCH')) versionMismatchCount++;
    }
  });
  const successCount = succeededIds.size;
  const failCount = targets.length - successCount;

  if (failCount === 0) {
    return {
      succeededIds, successCount, failCount, versionMismatchCount,
      toastTitle: `✅ ${label}`,
      toastBody: `${successCount}/${targets.length} talimat güncellendi.`,
      toastType: 'success',
    };
  }
  const versionNote = versionMismatchCount > 0
    ? ` ${versionMismatchCount} talimat başka bir kullanıcı tarafından değiştirilmiş olabilir (VERSION_MISMATCH) — sayfayı yenileyip tekrar deneyin.`
    : ' Kalan talimatlar tekrar deneyebilmeniz için seçili bırakıldı.';
  return {
    succeededIds, successCount, failCount, versionMismatchCount,
    toastTitle: `⚠️ ${label} — Kısmi Başarı`,
    toastBody: `${successCount}/${targets.length} talimat güncellendi.${versionNote}`,
    toastType: 'warning',
  };
}
