import React, { useCallback, useState, useMemo, useEffect, useRef, type ReactElement } from 'react';
import { Plus, Search, Layers, Clock, ArrowRight, CheckCircle2, AlertTriangle, AlertCircle, ShieldCheck, Zap, Info, Filter, X, Loader2, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { List, type RowComponentProps } from 'react-window';
import { Task, User, TaskStatus, TaskPriority } from '../types';
import { cn, buildUsersById } from '../lib/utils';
import { STATUS_LABELS, PRIORITY_LABELS, PRIORITY_BADGE_VARIANT, STATUS_BADGE_VARIANT } from '../constants';
import { VALID_TRANSITIONS } from '../lib/taskStateMachine';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { motion } from 'motion/react';
import { Avatar } from './ui/Avatar';
import { TaskCardSkeleton } from './ui/Skeleton';
import { Badge } from './ui/Badge';
import { EmptyState } from './ui/EmptyState';
import { Button } from './ui/Button';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useDataStore } from '../store/dataStore';
import { useUIStore } from '../store/uiStore';
import type { TaskBoardFilters, TaskBoardSortField } from '../hooks/useTaskBoardFilters';
import { isTaskInCrisis } from '../lib/executiveMetrics';

// Sanallaştırma (react-window) sabitleri — büyük görev listelerinde (ör.
// Admin'in ilk yüklemede gördüğü 200+ görev) her satırı DOM'a basmak yerine
// yalnızca görünür pencereyi render eder. Yükseklikler mevcut hücre
// padding/font boyutlarına göre ölçülüp tarayıcıda doğrulanmıştır.
const DESKTOP_ROW_HEIGHT = 64;
const DESKTOP_LIST_MAX_HEIGHT = 640;
// Durum sütunu 150px'ten 180px'e genişletildi — "İCRA AŞAMASINDA"/"YETKİ
// DEVRİ BEKLENİYOR" gibi uzun rozet etiketleri artık (Badge.tsx'teki
// whitespace-nowrap ile birlikte) taşmadan tek satırda sığıyor (bkz. kod
// denetimi).
// 40px'lik ilk sütun toplu seçim checkbox'ı için (P2-18) — mevcut beş sütun +
// sondaki boş ok sütunu aynen korunur, yalnızca başa eklenir.
const DESKTOP_GRID_TEMPLATE = '40px 180px minmax(0,1fr) 190px 130px 160px 64px';

// Sütun başlığına tıklayarak sıralama (bkz. tasarım denetimi 3.4) — bu sıra
// firestore.rules'taki isValidTransition ile İLGİSİZDİR, yalnızca tabloda
// "en acil önce" görsel sıralaması için tanımlıdır. Artan (asc) yön bu
// sırayı, azalan (desc) yön tersini gösterir.
const STATUS_SORT_ORDER: Record<TaskStatus, number> = {
  CRISIS: 0,
  BLOCKED: 1,
  PENDING_DELEGATION: 2,
  ASSIGNED: 3,
  IN_PROGRESS: 4,
  AWAITING_APPROVAL: 5,
  COMPLETED: 6,
  CANCELLED: 7,
};
const PRIORITY_SORT_ORDER: Record<TaskPriority, number> = {
  Urgent: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

// DESKTOP_GRID_TEMPLATE'teki 7 sütunla BİREBİR sırayla eşleşir — checkbox ve
// ok sütunlarının sortField'ı yoktur (sıralanamaz).
const DESKTOP_COLUMNS: { label: string; sortField?: TaskBoardSortField }[] = [
  { label: '' },
  { label: 'Durum', sortField: 'status' },
  { label: 'Talimat Tanımı', sortField: 'title' },
  { label: 'Sorumlu', sortField: 'assignee' },
  { label: 'Önem', sortField: 'priority' },
  { label: 'Mühlet', sortField: 'deadline' },
  { label: '' },
];

const MOBILE_ROW_HEIGHT = 80;
const MOBILE_LIST_MAX_HEIGHT = 560;
// pendingTaskIds verilmediğinde (ör. testlerde) her render'da YENİ bir Set
// oluşturmamak için paylaşılan sabit — aksi halde referans her seferinde
// değişip aşağıdaki useMemo'ların hiç önbelleklenmesini engellerdi.
const EMPTY_PENDING_TASK_IDS = new Set<string>();

interface TaskRowData {
  tasks: Task[];
  usersById: Map<string, User>;
  onViewTask: (task: Task) => void;
  /** Toplu seçim (P2-18) — seçili görev id'leri ve tekil satır toggle'ı. */
  selectedIds: Set<string>;
  onToggleSelect: (taskId: string) => void;
  /** Çevrimdışı kuyrukta bu talimatı hedefleyen bekleyen bir mutasyon varsa
   *  (bkz. tasarım denetimi F8) — satırda "Senkron Bekliyor" rozeti gösterir.
   *  Eskiden iyimser olarak listeye bindirilen bu değişiklikler sunucuya
   *  ulaşmamış olsa bile "kesinleşmiş" görünüyordu. */
  pendingTaskIds: Set<string>;
}

function SyncPendingBadge() {
  return (
    <span
      title="Senkron bekliyor — bu değişiklik henüz sunucuya ulaşmadı"
      className="inline-flex items-center gap-1 text-micro font-bold uppercase tracking-[0.15em] px-1.5 py-0.5 rounded-full bg-executive-gold/10 text-[color:var(--gold-text)] border border-executive-gold/20 flex-shrink-0"
    >
      <span className="w-1 h-1 rounded-full bg-executive-gold animate-pulse" aria-hidden="true" />
      Senkron Bekliyor
    </span>
  );
}

function MobileTaskRow({ index, style, ariaAttributes, tasks, usersById, onViewTask, selectedIds, onToggleSelect, pendingTaskIds }: RowComponentProps<TaskRowData>): ReactElement | null {
  const task = tasks[index];
  if (!task) return null;
  const assignee = usersById.get(task.assigneeId);
  const isCrisis = isTaskInCrisis(task, Date.now());
  const isSelected = selectedIds.has(task.id);
  return (
    <div style={style} {...ariaAttributes}>
      <div
        role="button"
        tabIndex={0}
        aria-label={task.title}
        onClick={() => onViewTask(task)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onViewTask(task);
          }
        }}
        className={cn(
          'flex items-start gap-3 p-3.5 h-full box-border cursor-pointer hover:bg-makam-glass transition-all group relative overflow-hidden border-b border-makam-border/30',
          isCrisis && 'bg-status-danger/[0.04]'
        )}
      >
        {/* Toplu seçim checkbox'ı (P2-18) — click/keydown durdurulur ki satırın
            geri kalanına ait onClick/onKeyDown (onViewTask'ı tetikleyen) devreye
            girmesin; gerçek <input type="checkbox"> kullanılır (jsx-a11y +
            Lighthouse a11y gate'i div-tabanlı sahte checkbox'ları reddeder). */}
        <input
          type="checkbox"
          checked={isSelected}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={() => onToggleSelect(task.id)}
          aria-label={isSelected ? `${task.title} seçildi` : `${task.title} seçilmedi`}
          className="mt-1.5 w-3.5 h-3.5 flex-shrink-0 rounded border-surface-border accent-executive-blue cursor-pointer"
        />
        {/* Status dot */}
        <div className={cn(
          'w-2 h-2 rounded-full mt-1.5 flex-shrink-0',
          task.status === 'COMPLETED'       ? 'bg-status-success' :
          task.status === 'BLOCKED'         ? 'bg-status-danger' :
          task.status === 'AWAITING_APPROVAL'? 'bg-executive-gold' :
          task.status === 'IN_PROGRESS'     ? 'bg-executive-blue' :
          'bg-surface-border'
        )} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-body font-medium text-executive-blue line-clamp-1 tracking-tight font-serif group-hover:text-executive-blue min-w-0">
              {task.title}
            </p>
            {pendingTaskIds.has(task.id) && <SyncPendingBadge />}
          </div>
          <div className="flex items-center gap-2 mt-1 min-w-0">
            <span className="text-micro text-text-tertiary truncate min-w-0">{assignee?.fullName || 'Atanmamış'}</span>
            <span className={cn(
              'text-micro font-medium uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-md whitespace-nowrap flex-shrink-0',
              isCrisis ? 'bg-status-danger/10 text-status-danger' : 'bg-surface-glass text-text-tertiary'
            )}>
              {isCrisis ? 'SLA İhlali' : format(task.deadline, 'd MMM', { locale: tr })}
            </span>
          </div>
        </div>
        <ArrowRight className="w-3.5 h-3.5 text-text-tertiary group-hover:text-executive-blue mt-1 flex-shrink-0" />
      </div>
    </div>
  );
}

function DesktopTaskRow({ index, style, tasks, usersById, onViewTask, selectedIds, onToggleSelect, pendingTaskIds }: RowComponentProps<TaskRowData>): ReactElement | null {
  const task = tasks[index];
  if (!task) return null;
  const assignee = usersById.get(task.assigneeId);
  const isCrisis = isTaskInCrisis(task, Date.now());
  const isSelected = selectedIds.has(task.id);
  // react-window'un ariaAttributes'ı (role="listitem" + aria-posinset/
  // aria-setsize) BİLİNÇLİ OLARAK hiç spread edilmez: role aşağıda "row"a
  // çevrilir ve posinset/setsize yalnızca listitem/treegrid satırları için
  // geçerlidir — role="row" ile birlikte kullanıldığında "aria-allowed-attr"
  // (serious) ihlaline dönüşüyordu (bkz. tasarım denetimi F3, canlı taramada
  // bulundu).
  return (
    <div
      role="row"
      tabIndex={0}
      onClick={() => onViewTask(task)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onViewTask(task);
        }
      }}
      style={{ ...style, gridTemplateColumns: DESKTOP_GRID_TEMPLATE }}
      className={cn(
        'grid items-center border-b border-l-2 border-transparent border-b-makam-border/30 cursor-pointer transition-colors duration-200 hover:bg-makam-glass group',
        // SLA ihlalli satırlar eskiden yalnızca %3 opaklıkta bir zemin tonuyla
        // ayrışıyordu — sayfa taranırken fark edilmesi zordu. Sol kenarlıktaki
        // kırmızı şerit, Harekat Merkezi'ndeki kriz kartlarıyla aynı deseni
        // kullanarak ihlali satırı taramadan görünür kılar (bkz. kod denetimi).
        // %3→%6 zemin ve 2px→3px kenarlık: canlı ortamda karanlık modda
        // karşılaştırıldığında %3 neredeyse görünmüyordu (bkz. tasarım denetimi).
        isCrisis && 'bg-status-danger/[0.06] border-l-[3px] border-l-status-danger'
      )}
    >
      {/* Toplu seçim checkbox'ı (P2-18) — MobileTaskRow'daki AYNI stopPropagation
          gerekçesi: satırın kendi onClick/onKeyDown'ı (onViewTask) tetiklenmesin. */}
      <div role="cell" className="px-2 py-3 flex items-center justify-center">
        <input
          type="checkbox"
          checked={isSelected}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={() => onToggleSelect(task.id)}
          aria-label={isSelected ? `${task.title} seçildi` : `${task.title} seçilmedi`}
          className="w-3.5 h-3.5 rounded border-surface-border accent-executive-blue cursor-pointer"
        />
      </div>

      {/* Status */}
      <div role="cell" className="px-4 py-3">
        <Badge
          variant={STATUS_BADGE_VARIANT[task.status] ?? 'default'}
          withPulse={task.status === 'BLOCKED'}
          icon={
            task.status === 'COMPLETED' ? <CheckCircle2 className="w-3.5 h-3.5 stroke-[1.3]" /> :
            task.status === 'BLOCKED' ? <AlertTriangle className="w-3.5 h-3.5 stroke-[1.3]" /> :
            task.status === 'AWAITING_APPROVAL' ? <ShieldCheck className="w-3.5 h-3.5 stroke-[1.3]" /> :
            task.status === 'IN_PROGRESS' ? <Zap className="w-3.5 h-3.5 stroke-[1.3]" /> :
            <Info className="w-3.5 h-3.5 stroke-[1.3]" />
          }
        >
          {STATUS_LABELS[task.status]}
        </Badge>
      </div>

      {/* Title + description */}
      <div role="cell" className="px-4 py-3 min-w-0">
        <div className="flex flex-col gap-0.5 max-w-[320px]">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-body font-medium text-executive-blue group-hover:text-executive-blue tracking-tight font-serif line-clamp-1 min-w-0">
              {task.title}
            </span>
            {pendingTaskIds.has(task.id) && <SyncPendingBadge />}
          </div>
          <span className="text-micro text-text-tertiary font-light line-clamp-1">{task.description}</span>
        </div>
      </div>

      {/* Assignee */}
      <div role="cell" className="px-4 py-3">
        <div className="flex items-center gap-2">
          {/* #10 — Avatar */}
          <Avatar
            name={assignee?.fullName ?? '?'}
            photoURL={assignee?.photoURL}
            size="xs"
          />
          <span className="text-caption font-normal text-executive-blue tracking-tight whitespace-nowrap">
            {assignee?.fullName || 'Atanmamış'}
          </span>
        </div>
      </div>

      {/* Priority */}
      <div role="cell" className="px-4 py-3">
        <Badge
          variant={PRIORITY_BADGE_VARIANT[task.priority]}
          icon={
            task.priority === 'Urgent' ? <AlertCircle className="w-2.5 h-2.5 stroke-[1.5]" /> :
            task.priority === 'High' ? <AlertTriangle className="w-2.5 h-2.5 stroke-[1.5]" /> :
            <Zap className="w-2.5 h-2.5 stroke-[1.5]" />
          }
        >
          {PRIORITY_LABELS[task.priority]}
        </Badge>
      </div>

      {/* Deadline */}
      <div role="cell" className="px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <Clock className={cn('w-3 h-3 stroke-[1.2]', isCrisis ? 'text-status-danger animate-pulse' : 'text-text-tertiary')} />
            <span className={cn('text-caption font-light tabular-nums tracking-tight', isCrisis ? 'text-status-danger' : 'text-executive-blue')}>
              {format(task.deadline, 'd MMM yyyy', { locale: tr })}
            </span>
          </div>
          {isCrisis && <span className="text-micro font-medium text-status-danger uppercase tracking-[0.2em]">SLA İhlali</span>}
        </div>
      </div>

      {/* Arrow — yalnızca dekoratif: satırın kendisi zaten role="row" + onClick
          ile tıklanabilir/klavye-erişilebilir, bu ok ayrı bir eylem taşımaz.
          <button> olması axe-core'da "button-name" (critical) ihlaliydi —
          erişilebilir adı yoktu (bkz. tasarım denetimi, F1'in canlı ortamda
          bulunan yan etkisi). */}
      <div role="cell" className="px-4 py-3 text-right">
        <div aria-hidden="true" className="w-7 h-7 rounded-full bg-makam-glass border border-executive-blue/[0.05] flex items-center justify-center text-text-tertiary group-hover:bg-executive-gold group-hover:text-[color:var(--btn-primary-text)] group-hover:border-transparent transition-all duration-300 shadow-sm ml-auto">
          <ArrowRight className="w-3 h-3 stroke-[2]" />
        </div>
      </div>
    </div>
  );
}

interface TaskBoardProps {
  tasks: Task[];
  users: User[];
  currentUser: User | null;
  onAddTask: () => void;
  onViewTask: (task: Task) => void;
  /** Firestore'dan ilk veri yüklenene kadar true */
  isLoading?: boolean;
  /** Toplu durum değişikliği (P2-18) — useAppHandlers.updateTaskStatus, kendi
   *  transaction/optimistic-locking/durum-makinesi mantığıyla AYNEN kullanılır. */
  updateTaskStatus: (
    taskId: string,
    newStatus: TaskStatus,
    evidence?: string,
    evidenceType?: Task['evidenceType'],
    options?: { silent?: boolean }
  ) => Promise<void>;
  /** Toplu yeniden atama (P2-18) — useAppHandlers.updateTask, AYNEN kullanılır. */
  updateTask: (taskId: string, data: Partial<Task>, options?: { silent?: boolean }) => Promise<void>;
  /** Arama/öncelik/durum/sorumlu filtreleri — AuthenticatedApp'te
   *  `useTaskBoardFilters` (URL tabanlı) tarafından yönetilir ve buraya
   *  kontrollü prop olarak geçirilir. TaskBoard kendisi router'dan BİLİNÇLİ
   *  OLARAK habersiz kalır (bkz. CLAUDE.md — testleri Router sarmalayıcısı
   *  gerektirmesin diye); bu yüzden useSearchParams burada DEĞİL, çağıranda
   *  kullanılır (bkz. tasarım denetimi F20 — eskiden bileşen-içi useState'ti,
   *  sekme değiştirip dönünce veya Reports'tan bir sorumluya filtrelenmiş
   *  gelindiğinde (bkz. F12) sıfırlanıyordu). */
  filters: TaskBoardFilters;
  onFiltersChange: (partial: Partial<TaskBoardFilters>) => void;
  /** Çevrimdışı kuyrukta bekleyen mutasyonların hedef talimat id'leri (bkz.
   *  tasarım denetimi F8) — verilmezse hiçbir satırda rozet gösterilmez. */
  pendingTaskIds?: Set<string>;
}

export const TaskBoard = ({
  tasks, users, currentUser,
  onAddTask, onViewTask,
  isLoading = false,
  updateTaskStatus, updateTask,
  filters, onFiltersChange,
  pendingTaskIds = EMPTY_PENDING_TASK_IDS,
}: TaskBoardProps) => {
  const { search, priority: priorityFilter, status: statusFilter, assignee: assigneeFilter, sortBy, sortDir } = filters;
  const setSearch = useCallback((value: string) => onFiltersChange({ search: value }), [onFiltersChange]);
  const setPriorityFilter = useCallback((value: string) => onFiltersChange({ priority: value }), [onFiltersChange]);
  const setStatusFilter = useCallback((value: string) => onFiltersChange({ status: value }), [onFiltersChange]);
  const setAssigneeFilter = useCallback((value: string) => onFiltersChange({ assignee: value }), [onFiltersChange]);
  // Sütun başlığına tıklama döngüsü: kapalı → artan → azalan → kapalı. Aynı
  // sütuna üçüncü tıklama sıralamayı tamamen kaldırır (bkz. tasarım denetimi
  // 3.4) — ayrı bir "sıralamayı temizle" kontrolü İCAT EDİLMEDİ.
  const toggleSort = useCallback((field: TaskBoardSortField) => {
    if (sortBy !== field) { onFiltersChange({ sortBy: field, sortDir: 'asc' }); return; }
    if (sortDir === 'asc') { onFiltersChange({ sortDir: 'desc' }); return; }
    onFiltersChange({ sortBy: 'none', sortDir: 'asc' });
  }, [sortBy, sortDir, onFiltersChange]);
  const [showSubtasks, setShowSubtasks] = useState(true);
  // Selector bazlı okuma — whole-store `useDataStore()` tasks/stats/blockers
  // gibi ilgisiz her alan değişiminde gereksiz yeniden render'a yol açıyordu
  // (bkz. AppHeader.tsx'teki aynı desen / kod denetimi).
  const loadMoreTasks = useDataStore(s => s.loadMoreTasks);
  const taskLimit = useDataStore(s => s.taskLimit);

  // "Daha Fazla Talimat Yükle" bir promise DÖNDÜRMÜYOR — loadMoreTasks yalnızca
  // taskLimit'i artıran senkron bir Zustand action'ı, gerçek veri Firestore'un
  // reaktif onSnapshot dinleyicisi (useFirestoreData) yeni limitle yeniden
  // abone olunca akar. Bu yüzden burada yerel bir "yükleniyor" bayrağı tutulup
  // tasks prop'u büyüdüğünde (ya da mantıklı bir sürede büyümezse) kapatılır —
  // aksi halde buton, Denetim İzleri'ndeki eşdeğerinin aksine, tıklandığında
  // hiçbir görsel geri bildirim vermiyordu (bkz. tasarım denetimi).
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const taskCountAtClickRef = useRef(tasks.length);
  useEffect(() => {
    if (isLoadingMore && tasks.length !== taskCountAtClickRef.current) {
      setIsLoadingMore(false);
    }
  }, [tasks.length, isLoadingMore]);
  const handleLoadMore = () => {
    taskCountAtClickRef.current = tasks.length;
    setIsLoadingMore(true);
    loadMoreTasks();
  };

  // O(tasks × users) yerine tek geçişte kurulan O(1) lookup — hem uid hem
  // email ile eşleşme aranabildiği için (Firestore'da assigneeId bazen uid,
  // bazen email olabiliyor) her iki alan da anahtar olarak eklenir.
  const usersById = useMemo(() => buildUsersById(users), [users]);
  const assigneeFilterEmail = assigneeFilter === 'All' ? null : (usersById.get(assigneeFilter)?.email ?? null);

  const filteredTasks = useMemo(() => tasks.filter(task => {
    // #12 — Genişletilmiş arama: başlık, açıklama, sorumlu adı, durum
    const assignee = usersById.get(task.assigneeId);
    const statusLabel = STATUS_LABELS[task.status]?.toLowerCase() ?? '';
    const searchLower = search.toLowerCase();
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
    const matchesStatus   = statusFilter   === 'All' || task.status === statusFilter;

    // NOT: Rol bazlı ek bir kısıtlama burada uygulanmıyor — `tasks` prop'u zaten
    // Firestore kurallarınca departman bazlı filtrelenmiş geliyor (Manager kendi
    // departmanının tamamını görebilir, Dashboard ile aynı kapsam). Manager'ı
    // yalnızca "bana atanan/benim oluşturduğum" ile sınırlamak departman gözetimi
    // rolünü işlevsiz kılardı.
    return matchesSearch && isVisible && matchesPriority && matchesAssignee && matchesStatus;
  }), [tasks, search, currentUser, showSubtasks, priorityFilter, assigneeFilter, assigneeFilterEmail, statusFilter, usersById]);

  // `filteredTasks`'ı KOPYALAYIP sıralar — `sortBy === 'none'` iken (varsayılan)
  // orijinal Firestore/onSnapshot sırası (oluşturulma sırası) hiç bozulmadan
  // korunur, çağıranın davranışı bu özellik eklenmeden ÖNCEKİYLE birebir aynı
  // kalır (bkz. tasarım denetimi 3.4).
  const sortedTasks = useMemo(() => {
    if (sortBy === 'none') return filteredTasks;
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
    return [...filteredTasks].sort((a, b) => {
      const ka = withKey(a);
      const kb = withKey(b);
      if (ka < kb) return -1 * dir;
      if (ka > kb) return 1 * dir;
      return 0;
    });
  }, [filteredTasks, sortBy, sortDir, usersById]);

  const hasActiveFilter = priorityFilter !== 'All' || assigneeFilter !== 'All' || statusFilter !== 'All' || search !== '';

  const resetFilters = useCallback(() => {
    onFiltersChange({ priority: 'All', assignee: 'All', status: 'All', search: '' });
  }, [onFiltersChange]);

  // ── Toplu Seçim / Toplu İşlem (P2-18) ─────────────────────────────────────
  // NOT: Ek bir rol bazlı seçim kısıtlaması burada UYGULANMIYOR — yukarıdaki
  // filteredTasks NOT'uyla AYNI gerekçe: `tasks` prop'u AuthenticatedApp.tsx'te
  // zaten role göre önceden filtrelenmiş gelir (bkz. useFirestoreData.ts
  // tasksQuery — Admin tümü, Staff yalnızca kendine atananlar, Manager kendi
  // departmanı + kendine atananlar). Bu listede görünen HER görev,
  // firestore.rules'taki canUpdateTask() ile kullanıcının en azından durum
  // güncelleyebileceği bir görevdir — ikinci bir istemci-taraflı filtre burada
  // YAGNI olurdu.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkStatusTarget, setBulkStatusTarget] = useState<TaskStatus | ''>('');
  const [bulkAssigneeTarget, setBulkAssigneeTarget] = useState<string>('');
  // COMPLETED/CANCELLED terminal (geri dönüşsüz) durumlar — en yüksek etkili
  // toplu işlem eskiden en zayıf korumaya sahipti (tekil silme modal onayı
  // isterken N görevi toplu terminal duruma geçirmek hiç onay istemiyordu,
  // bkz. tasarım denetimi F9). Yalnızca terminal hedeflerde yazarak doğrulama
  // araya girer; geri alınabilir geçişler (BLOCKED/IN_PROGRESS vb.) eskisi
  // gibi doğrudan uygulanır.
  const [isBulkTerminalConfirmOpen, setIsBulkTerminalConfirmOpen] = useState(false);
  const addToast = useUIStore(s => s.addToast);

  const toggleSelect = useCallback((taskId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelectedIds(new Set(filteredTasks.map(t => t.id)));
  }, [filteredTasks]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // selectedIds, filtre değiştirildikten SONRA görünümden çıkmış görevleri de
  // (kullanıcı önce seçip sonra filtreyi değiştirdiyse) içerebilir — toplu
  // işlem gerçek Task nesnelerini bu yüzden tam (rol bazlı) `tasks`
  // listesinden çözer, yalnızca `filteredTasks`'tan değil.
  const selectedTasks = useMemo(
    () => tasks.filter(t => selectedIds.has(t.id)),
    [tasks, selectedIds]
  );

  // Toplu durum değişikliği yalnızca seçili TÜM görevler AYNI mevcut durumdaysa
  // etkin — karışık durumlu bir seçimde "hangi hedef durumlar geçerli"
  // belirsizleşir (bkz. görev tanımı: karmaşık kesişim mantığı kurulmuyor,
  // YAGNI).
  const commonStatus = useMemo<TaskStatus | null>(() => {
    if (selectedTasks.length === 0) return null;
    const first = selectedTasks[0]!.status;
    return selectedTasks.every(t => t.status === first) ? first : null;
  }, [selectedTasks]);
  const bulkStatusOptions = commonStatus ? VALID_TRANSITIONS[commonStatus] : [];

  // Seçim (dolayısıyla commonStatus) değiştiğinde eski hedef durum artık
  // geçerli bir seçenek olmayabilir — kullanıcı yeniden seçmeye zorlanır,
  // aksi halde stale bir hedefle yanlışlıkla "Uygula"ya basılabilirdi.
  useEffect(() => {
    setBulkStatusTarget('');
  }, [commonStatus]);

  // Toplu yeniden atama yalnızca atama yetkisi olan rollere gösterilir —
  // TaskFormModal.tsx'teki getAssignableRoles ile AYNI mantık (bkz. görev
  // tanımı). Staff hiç görmez: firestore.rules'taki canUpdateTask() zaten
  // Staff'ın assigneeId dışındaki alanları (assigneeId dahil) değiştirmesine
  // izin vermiyor.
  const canBulkReassign = currentUser?.role === 'Admin' || currentUser?.role === 'Manager';
  const assignableRoles: string[] =
    currentUser?.role === 'Admin' ? ['Admin', 'Manager', 'Staff'] :
    currentUser?.role === 'Manager' ? ['Manager', 'Staff'] : [];
  const assignableUsers = users.filter(u => assignableRoles.includes(u.role));

  // Kısmi başarı raporlaması: Promise.allSettled sonuçlarını işleyip başarılı
  // görevleri seçimden çıkarır (başarısızlar tekrar deneme için SEÇİLİ kalır)
  // ve tek bir özet toast'ı gösterir — mevcut useUIStore addToast deseni.
  // VERSION_MISMATCH ayrıca sayılır ki kullanıcı "başka biri değiştirmiş
  // olabilir" nedenini görsün (bkz. görev tanımı).
  const summarizeBulkResult = useCallback((label: string, targets: Task[], results: PromiseSettledResult<void>[]) => {
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
    setSelectedIds(prev => {
      const next = new Set(prev);
      succeededIds.forEach(id => next.delete(id));
      return next;
    });
    const successCount = succeededIds.size;
    const failCount = targets.length - successCount;
    if (failCount === 0) {
      addToast({ title: `✅ ${label}`, body: `${successCount}/${targets.length} talimat güncellendi.`, type: 'success' });
    } else {
      const versionNote = versionMismatchCount > 0
        ? ` ${versionMismatchCount} talimat başka bir kullanıcı tarafından değiştirilmiş olabilir (VERSION_MISMATCH) — sayfayı yenileyip tekrar deneyin.`
        : ' Kalan talimatlar tekrar deneyebilmeniz için seçili bırakıldı.';
      addToast({
        title: `⚠️ ${label} — Kısmi Başarı`,
        body: `${successCount}/${targets.length} talimat güncellendi.${versionNote}`,
        type: 'warning',
      });
    }
  }, [addToast]);

  const handleBulkStatusApply = useCallback(async () => {
    if (!bulkStatusTarget || selectedTasks.length === 0) return;
    const targets = selectedTasks;
    const target = bulkStatusTarget;
    setIsBulkProcessing(true);
    try {
      // Mevcut, zaten yetkilendirilmiş updateTaskStatus (kendi transaction'ı +
      // optimistic locking + durum makinesi doğrulaması + audit log — bkz.
      // taskService.transitionTaskInTransaction) bir DÖNGÜDE çağrılır; yeni
      // bir Firestore batch-write yolu İCAT EDİLMEZ (bkz. görev tanımı).
      const results = await Promise.allSettled(
        targets.map(t => updateTaskStatus(t.id, target, undefined, undefined, { silent: true }))
      );
      summarizeBulkResult('Toplu Durum Güncellemesi', targets, results);
    } finally {
      setIsBulkProcessing(false);
      setBulkStatusTarget('');
    }
  }, [bulkStatusTarget, selectedTasks, updateTaskStatus, summarizeBulkResult]);

  const isBulkStatusTargetTerminal = bulkStatusTarget === 'COMPLETED' || bulkStatusTarget === 'CANCELLED';
  const bulkTerminalConfirmPhrase = bulkStatusTarget
    ? `${selectedTasks.length} TALİMATI ${STATUS_LABELS[bulkStatusTarget].toUpperCase()}`
    : '';

  const handleBulkStatusButtonClick = useCallback(() => {
    if (isBulkStatusTargetTerminal) {
      setIsBulkTerminalConfirmOpen(true);
      return;
    }
    void handleBulkStatusApply();
  }, [isBulkStatusTargetTerminal, handleBulkStatusApply]);

  const handleBulkReassignApply = useCallback(async () => {
    if (!bulkAssigneeTarget || selectedTasks.length === 0) return;
    const targets = selectedTasks;
    const target = bulkAssigneeTarget;
    setIsBulkProcessing(true);
    try {
      const results = await Promise.allSettled(
        targets.map(t => updateTask(t.id, { assigneeId: target }, { silent: true }))
      );
      summarizeBulkResult('Toplu Yeniden Atama', targets, results);
    } finally {
      setIsBulkProcessing(false);
      setBulkAssigneeTarget('');
    }
  }, [bulkAssigneeTarget, selectedTasks, updateTask, summarizeBulkResult]);

  // "İlk Talimatı Oluştur" CTA'sı yalnızca gerçekten görev oluşturabilecek
  // rollere gösterilir — firestore.rules'taki tasks create kuralı yalnızca
  // Admin/Manager'a izin verir (Staff'a değil), bu yüzden burada Staff'a da
  // gösterilseydi tıklandığında sunucu tarafında reddedilen, kullanıcıyı
  // yanıltan bir buton yaratılırdı (bkz. görev tanımı P2-17).
  const canCreateTask = currentUser?.role === 'Admin' || currentUser?.role === 'Manager';

  // Boş durum yalnızca hiçbir filtre uygulanmamışken "gerçekten hiç görev yok"
  // anlamına gelir — bir filtre sonucu boşsa aktivasyon CTA'sı (görev oluştur)
  // yanlış olurdu, kullanıcının asıl ihtiyacı filtreyi temizlemektir.
  const emptyStateNode = (
    <EmptyState
      icon={<Layers className="w-8 h-8" />}
      message={hasActiveFilter ? 'Filtrelerinize uygun talimat bulunamadı' : 'Henüz talimat bulunmuyor'}
      className="border-none"
      action={
        hasActiveFilter ? (
          <Button variant="secondary" size="sm" onClick={resetFilters}>
            Filtreyi Temizle
          </Button>
        ) : canCreateTask ? (
          <Button variant="gold" size="sm" onClick={onAddTask}>
            <Plus className="w-3.5 h-3.5 stroke-[2]" />
            İlk Talimatı Oluştur
          </Button>
        ) : undefined
      }
    />
  );

  const rowKey = useCallback((index: number, data: TaskRowData) => data.tasks[index]?.id ?? index, []);
  const mobileRowProps = useMemo<TaskRowData>(
    () => ({ tasks: sortedTasks, usersById, onViewTask, selectedIds, onToggleSelect: toggleSelect, pendingTaskIds }),
    [sortedTasks, usersById, onViewTask, selectedIds, toggleSelect, pendingTaskIds]
  );
  const desktopRowProps = useMemo<TaskRowData>(
    () => ({ tasks: sortedTasks, usersById, onViewTask, selectedIds, onToggleSelect: toggleSelect, pendingTaskIds }),
    [sortedTasks, usersById, onViewTask, selectedIds, toggleSelect, pendingTaskIds]
  );
  const mobileListHeight = Math.min(filteredTasks.length * MOBILE_ROW_HEIGHT, MOBILE_LIST_MAX_HEIGHT);
  const desktopListHeight = Math.min(filteredTasks.length * DESKTOP_ROW_HEIGHT, DESKTOP_LIST_MAX_HEIGHT);

  return (
    <div className="flex flex-col gap-4 py-4 max-w-[1440px] mx-auto font-sans">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-executive-blue/[0.04]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-executive-blue flex items-center justify-center shadow-lg">
            <Layers className="w-4 h-4 text-[color:var(--executive-blue-text)] stroke-[1.5]" />
          </div>
          <div>
            <span className="text-micro font-semibold text-executive-blue uppercase tracking-[0.22em] block leading-none">
              OPERASYONEL DENETİM
            </span>
            <span className="text-micro text-text-tertiary uppercase tracking-[0.18em]">
              {filteredTasks.length} Talimat
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Subtask toggle — compact pill */}
          <div className="flex items-center gap-2 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-full px-3 h-9 shadow-sm">
            <Layers className={cn('w-3.5 h-3.5 stroke-[1.5] transition-colors', showSubtasks ? 'text-executive-blue' : 'text-text-tertiary')} />
            <span className="text-micro font-medium text-text-tertiary uppercase tracking-[0.25em] hidden sm:block">Alt Talimatlar</span>
            <button
              onClick={() => setShowSubtasks(!showSubtasks)}
              role="switch"
              aria-checked={showSubtasks}
              aria-label="Alt talimatları göster"
              className={cn(
                'relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2',
                showSubtasks ? 'bg-executive-blue' : 'bg-surface-border'
              )}
            >
              <span className={cn(
                'pointer-events-none inline-block h-3 w-3 rounded-full bg-surface-elevated shadow-sm ring-0 transition duration-300',
                showSubtasks ? 'translate-x-3' : 'translate-x-0'
              )} />
            </button>
          </div>

          {/* Add task button */}
          <button
            onClick={onAddTask}
            className="flex items-center gap-1.5 px-4 h-9 rounded-full bg-executive-gold text-[color:var(--btn-primary-text)] text-micro font-semibold uppercase tracking-[0.16em] shadow-lg shadow-executive-gold/15 hover:shadow-xl hover:bg-executive-gold-hover hover:scale-[1.01] active:scale-[0.98] transition-all duration-300"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2]" />
            <span className="hidden sm:block">Yeni Talimat</span>
            <span className="sm:hidden">Yeni</span>
          </button>
        </div>
      </div>

      {/* ── Filter Bar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 bg-makam-glass backdrop-blur-xl border border-surface-border p-2.5 rounded-2xl shadow-sm">
        {/* Search */}
        <div className="relative flex-[1_1_100%] sm:flex-1 sm:min-w-[200px] group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary group-focus-within:text-executive-blue transition-colors stroke-[1.5]" />
          <input
            placeholder="Ara..."
            aria-label="Talimatları ara"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 h-8 bg-makam-glass border border-executive-blue/[0.05] rounded-xl focus:ring-4 focus:ring-executive-blue/[0.04] focus:border-executive-blue/20 transition-all text-body-sm font-light text-executive-blue placeholder:text-text-tertiary outline-none"
          />
        </div>

        {/* Priority filter */}
        {/* min-w-0 + flex-1 üçünü de tek satıra sıkıştırıp native <select>
            metnini (ör. "TÜM ÖNCELİKLER") elipsissiz ortadan kesiyordu (bkz.
            mobil tasarım denetimi) — flex-[1_1_46%] iki filtreyi bir satırda
            tutacak kadar yer bırakır, sığmayan üçüncüsü/dördüncüsü elipsis
            yerine okunaklı biçimde bir sonraki satıra sarar. */}
        <div className="flex items-center gap-2 bg-makam-glass px-2.5 sm:px-3 rounded-xl border border-executive-blue/[0.05] h-8 min-w-0 flex-[1_1_46%] sm:flex-none">
          <Filter className="w-3 h-3 text-text-tertiary stroke-[1.5]" />
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            aria-label="Öncelik filtresi"
            className="bg-transparent border-none text-micro font-medium text-text-muted uppercase tracking-[0.12em] sm:tracking-[0.25em] focus:ring-0 cursor-pointer outline-none min-w-0 w-full"
          >
            <option value="All" className="bg-surface-base text-text-heading">TÜM ÖNCELİKLER</option>
            {Object.entries(PRIORITY_LABELS).map(([val, label]) => (
              <option key={val} value={val} className="bg-surface-base text-text-heading">{label.toUpperCase()}</option>
            ))}
          </select>
        </div>

        {/* #12 — Durum filtresi */}
        {/* min-w-0 + flex-1 üçünü de tek satıra sıkıştırıp native <select>
            metnini (ör. "TÜM ÖNCELİKLER") elipsissiz ortadan kesiyordu (bkz.
            mobil tasarım denetimi) — flex-[1_1_46%] iki filtreyi bir satırda
            tutacak kadar yer bırakır, sığmayan üçüncüsü/dördüncüsü elipsis
            yerine okunaklı biçimde bir sonraki satıra sarar. */}
        <div className="flex items-center gap-2 bg-makam-glass px-2.5 sm:px-3 rounded-xl border border-executive-blue/[0.05] h-8 min-w-0 flex-[1_1_46%] sm:flex-none">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Durum filtresi"
            className="bg-transparent border-none text-micro font-medium text-text-muted uppercase tracking-[0.12em] sm:tracking-[0.25em] focus:ring-0 cursor-pointer outline-none min-w-0 w-full"
          >
            <option value="All" className="bg-surface-base text-text-heading">TÜM DURUMLAR</option>
            {Object.entries(STATUS_LABELS).map(([val, label]) => (
              <option key={val} value={val} className="bg-surface-base text-text-heading">{label.toUpperCase()}</option>
            ))}
          </select>
        </div>

        {/* Assignee filter */}
        {/* min-w-0 + flex-1 üçünü de tek satıra sıkıştırıp native <select>
            metnini (ör. "TÜM ÖNCELİKLER") elipsissiz ortadan kesiyordu (bkz.
            mobil tasarım denetimi) — flex-[1_1_46%] iki filtreyi bir satırda
            tutacak kadar yer bırakır, sığmayan üçüncüsü/dördüncüsü elipsis
            yerine okunaklı biçimde bir sonraki satıra sarar. */}
        <div className="flex items-center gap-2 bg-makam-glass px-2.5 sm:px-3 rounded-xl border border-executive-blue/[0.05] h-8 min-w-0 flex-[1_1_46%] sm:flex-none">
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            aria-label="Sorumlu filtresi"
            className="bg-transparent border-none text-micro font-medium text-text-muted uppercase tracking-[0.12em] sm:tracking-[0.25em] focus:ring-0 cursor-pointer outline-none min-w-0 w-full"
          >
            <option value="All" className="bg-surface-base text-text-heading">TÜM SORUMLULAR</option>
            {users.map(u => (
              <option key={u.uid} value={u.uid} className="bg-surface-base text-text-heading">{u.fullName.toUpperCase()}</option>
            ))}
          </select>
        </div>

        {hasActiveFilter && (
          <button
            onClick={resetFilters}
            className="text-micro font-medium text-status-danger/70 hover:text-status-danger px-3 uppercase tracking-[0.12em] sm:tracking-[0.25em] transition-colors h-8 flex items-center justify-center gap-1 flex-1 sm:flex-none"
          >
            <X className="w-3 h-3" /> Sıfırla
          </button>
        )}

        {/* Toplu seçim kısayolları (P2-18) — "Tümünü Seç" yalnızca o an
            FİLTRELENMİŞ görünür listeyi seçer, filtre dışındaki görevleri DEĞİL
            (bkz. görev tanımı). */}
        {filteredTasks.length > 0 && (
          <div className="flex items-center gap-1 flex-1 sm:flex-none justify-end sm:justify-start">
            <button
              onClick={selectAllFiltered}
              disabled={filteredTasks.every(t => selectedIds.has(t.id))}
              className="text-micro font-medium text-executive-blue/70 hover:text-executive-blue px-2.5 h-8 rounded-lg hover:bg-executive-blue/5 uppercase tracking-[0.12em] sm:tracking-[0.2em] transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap"
            >
              Tümünü Seç
            </button>
            <button
              onClick={clearSelection}
              disabled={selectedIds.size === 0}
              className="text-micro font-medium text-text-tertiary hover:text-status-danger px-2.5 h-8 rounded-lg hover:bg-status-danger/5 uppercase tracking-[0.12em] sm:tracking-[0.2em] transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap"
            >
              Seçimi Temizle
            </button>
          </div>
        )}
      </div>

      {/* ── Table ─────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 28, delay: 0.1 }}
        className="bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl overflow-hidden shadow-card"
      >
        {/* Mobile card list for xs screens */}
        <div className="sm:hidden">
          {isLoading ? (
            <div className="flex flex-col gap-3 p-3">
              {[...Array(5)].map((_, i) => <TaskCardSkeleton key={i} />)}
            </div>
          ) : filteredTasks.length === 0 ? (
            emptyStateNode
          ) : (
            <List
              rowComponent={MobileTaskRow}
              rowCount={filteredTasks.length}
              rowHeight={MOBILE_ROW_HEIGHT}
              rowProps={mobileRowProps}
              rowKey={rowKey}
              style={{ height: mobileListHeight }}
            />
          )}
        </div>

        {/* Desktop / tablet table (CSS Grid tabanlı — react-window virtualization
            native <table>/<tbody> ile absolute-positioned satırları
            hizalayamadığı için grid'e çevrildi; header ve satırlar aynı
            DESKTOP_GRID_TEMPLATE'i paylaşarak sütun hizasını korur) */}
        <div className="hidden sm:block overflow-x-auto custom-scrollbar" role="table">
          <div
            role="row"
            style={{ gridTemplateColumns: DESKTOP_GRID_TEMPLATE }}
            className="grid bg-surface-glass border-b border-executive-blue/[0.04]"
          >
            {DESKTOP_COLUMNS.map((col, i) => {
              const isSorted = col.sortField && sortBy === col.sortField;
              return (
                <div
                  key={`${col.label}-${i}`}
                  role="columnheader"
                  aria-sort={col.sortField ? (isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                  className={cn(
                    'px-4 py-3 text-micro font-semibold text-text-tertiary uppercase tracking-[0.18em]',
                    col.label === '' && i > 0 && 'text-right'
                  )}
                >
                  {col.sortField ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.sortField!)}
                      className="flex items-center gap-1 hover:text-executive-blue transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue rounded"
                    >
                      {col.label}
                      {isSorted ? (
                        sortDir === 'asc'
                          ? <ChevronUp className="w-3 h-3" aria-hidden="true" />
                          : <ChevronDown className="w-3 h-3" aria-hidden="true" />
                      ) : (
                        <ChevronsUpDown className="w-3 h-3 opacity-30" aria-hidden="true" />
                      )}
                    </button>
                  ) : col.label}
                </div>
              );
            })}
          </div>
          {isLoading ? (
            // Dekoratif yükleme iskeleti — gerçek satır/sütun verisi taşımaz,
            // bu yüzden role="rowgroup"/"row" ATANMAZ (bkz. tasarım denetimi:
            // react-window'un kendi role="list" varsayılanının BENZER şekilde
            // role="table" içinde geçersiz olması). Ekran okuyucudan tamamen gizlenir.
            <div aria-hidden="true">
              {[...Array(7)].map((_, i) => (
                <div key={i} style={{ gridTemplateColumns: DESKTOP_GRID_TEMPLATE }} className="grid animate-pulse">
                  {[...Array(7)].map((__, j) => (
                    <div key={j} className="px-4 py-3.5">
                      <div className="h-3 bg-executive-blue/[0.04] rounded-lg" style={{ width: j === 2 ? '60%' : (j === 0 || j === 6) ? '16px' : '80px' }} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : filteredTasks.length === 0 ? (
            <div role="rowgroup">
              <div role="row"><div role="cell">{emptyStateNode}</div></div>
            </div>
          ) : (
            // role="rowgroup" doğrudan List'e VERİLİR (react-window'un kendi
            // hardcoded role="list" varsayılanını ezer) — eskiden bu List'i
            // saran ayrı bir <div role="rowgroup"> vardı ve List'in kendi
            // role="list" konteyneri bunun İÇİNE yerleşiyordu: role="row"
            // çocukları role="list" için geçersiz (list yalnızca listitem
            // kabul eder) VE role="table" > role="rowgroup" > role="list"
            // zincirinde "row" için gereken doğrudan grid/rowgroup/table
            // atası kayboluyordu — axe-core'un ilk kez taradığı bu ekranda
            // (bkz. tasarım denetimi F3) iki ayrı "critical" ihlal olarak
            // çıktı (aria-required-children, aria-required-parent).
            <List
              role="rowgroup"
              rowComponent={DesktopTaskRow}
              rowCount={filteredTasks.length}
              rowHeight={DESKTOP_ROW_HEIGHT}
              rowProps={desktopRowProps}
              rowKey={rowKey}
              style={{ height: desktopListHeight }}
            />
          )}
        </div>
      </motion.div>

      {/* Daha Fazla Yükle Butonu */}
      {tasks.length >= taskLimit && (
        <div className="flex justify-center mt-4">
          <button
            onClick={handleLoadMore}
            disabled={isLoadingMore}
            className="flex items-center gap-2 px-6 py-2 bg-makam-glass backdrop-blur-xl border border-executive-blue/10 rounded-full text-micro font-medium text-executive-blue uppercase tracking-widest hover:bg-executive-blue hover:text-[color:var(--executive-blue-text)] transition-all shadow-sm disabled:opacity-60 disabled:pointer-events-none"
          >
            {isLoadingMore && <Loader2 className="w-3 h-3 animate-spin" />}
            Daha Fazla Talimat Yükle
          </button>
        </div>
      )}

      {/* ── Toplu İşlem Çubuğu (P2-18) ────────────────────────────────
          MobileDock (bottom-4, z-[60], lg:hidden) ile çakışmasın diye mobilde
          bottom-24 (dock'un üstünde), lg:'de dock hiç render edilmediği için
          bottom-6 kullanılır. Toast bölgesi (top-12, z-[150]) zaten ayrı bir
          köşede olduğundan onunla bir çakışma söz konusu değil. */}
      {selectedIds.size > 0 && (
        <div
          role="region"
          aria-label="Toplu İşlem Çubuğu"
          className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-[55] w-[calc(100%-2rem)] max-w-md px-0"
        >
          <div className="flex flex-col gap-3 bg-makam-glass backdrop-blur-[30px] backdrop-saturate-[180%] border border-surface-border rounded-2xl shadow-[0_12px_40px_-10px_rgba(22,21,19,0.14),0_0_0_0.5px_rgba(22,21,19,0.04)] p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-caption font-semibold text-executive-blue uppercase tracking-[0.14em]">
                {selectedIds.size} Talimat Seçildi
              </span>
              <button
                onClick={clearSelection}
                disabled={isBulkProcessing}
                aria-label="Seçimi temizle"
                className="text-text-tertiary hover:text-status-danger transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Toplu durum değişikliği */}
            {commonStatus ? (
              <div className="flex items-center gap-2">
                <select
                  value={bulkStatusTarget}
                  onChange={(e) => setBulkStatusTarget(e.target.value as TaskStatus | '')}
                  disabled={isBulkProcessing || bulkStatusOptions.length === 0}
                  aria-label="Toplu durum hedefi"
                  className="flex-1 min-w-0 h-9 px-3 rounded-xl bg-makam-glass border border-executive-blue/[0.08] text-caption text-executive-blue outline-none disabled:opacity-50"
                >
                  <option value="">
                    {bulkStatusOptions.length === 0 ? 'Bu durumdan geçiş yok' : 'Durum seçin…'}
                  </option>
                  {bulkStatusOptions.map(s => (
                    <option key={s} value={s} className="bg-surface-base text-text-heading">{STATUS_LABELS[s]}</option>
                  ))}
                </select>
                <Button
                  size="sm" variant="secondary"
                  isLoading={isBulkProcessing}
                  disabled={!bulkStatusTarget}
                  onClick={handleBulkStatusButtonClick}
                >
                  Uygula
                </Button>
              </div>
            ) : (
              <p className="text-micro text-text-tertiary leading-relaxed">
                Seçili talimatlar farklı durumlarda — toplu durum değişikliği yalnızca hepsi AYNI mevcut durumdayken kullanılabilir.
              </p>
            )}

            {/* Toplu yeniden atama — yalnızca atama yetkisi olan roller (Admin/Manager) */}
            {canBulkReassign && (
              <div className="flex items-center gap-2">
                <select
                  value={bulkAssigneeTarget}
                  onChange={(e) => setBulkAssigneeTarget(e.target.value)}
                  disabled={isBulkProcessing}
                  aria-label="Toplu yeniden atama hedefi"
                  className="flex-1 min-w-0 h-9 px-3 rounded-xl bg-makam-glass border border-executive-blue/[0.08] text-caption text-executive-blue outline-none disabled:opacity-50"
                >
                  <option value="">Yeniden ata…</option>
                  {assignableUsers.map(u => (
                    <option key={u.uid} value={u.uid} className="bg-surface-base text-text-heading">{u.fullName}</option>
                  ))}
                </select>
                <Button
                  size="sm" variant="secondary"
                  isLoading={isBulkProcessing}
                  disabled={!bulkAssigneeTarget}
                  onClick={handleBulkReassignApply}
                >
                  Ata
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Terminal (COMPLETED/CANCELLED) toplu geçişler geri alınamaz ve durum
          makinesinde bu iki durumdan çıkış yoktur — yazarak doğrulama, bu en
          yüksek etkili toplu işleme en az tekil silme kadar sürtünme ekler. */}
      <ConfirmDialog
        isOpen={isBulkTerminalConfirmOpen}
        onClose={() => setIsBulkTerminalConfirmOpen(false)}
        onConfirm={() => { setIsBulkTerminalConfirmOpen(false); void handleBulkStatusApply(); }}
        title="Toplu Durum Değişikliğini Onayla"
        message={bulkStatusTarget ? `${selectedTasks.length} talimatı "${STATUS_LABELS[bulkStatusTarget]}" durumuna geçirmek üzeresiniz. Bu durum geri dönüşsüzdür — talimatlar bu işlemden sonra yeniden açılamaz.` : ''}
        confirmLabel="Toplu Geçişi Uygula"
        confirmPhrase={bulkTerminalConfirmPhrase}
      />
    </div>
  );
};
