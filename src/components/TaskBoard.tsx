import React, { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import { Plus, Layers } from 'lucide-react';
import { List } from 'react-window';
import { Task, User, TaskStatus } from '../types';
import { cn, buildUsersById } from '../lib/utils';
import { STATUS_LABELS } from '../constants';
import { VALID_TRANSITIONS } from '../lib/taskStateMachine';
import { motion } from 'motion/react';
import { TaskCardSkeleton } from './ui/Skeleton';
import { EmptyState } from './ui/EmptyState';
import { PageHeader } from './ui/PageHeader';
import { PageShell } from './ui/PageShell';
import { PANEL_FRAME_CLASSNAME } from './ui/Panel';
import { Button } from './ui/Button';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { GridDataTable } from './ui/dataTable';
import { useDataStore } from '../store/dataStore';
import { useUIStore } from '../store/uiStore';
import type { TaskBoardFilters } from '../hooks/useTaskBoardFilters';
import { TASK_BOARD_COLUMNS } from './taskBoard/columns';
import { MobileTaskRow, type TaskRowData } from './taskBoard/MobileTaskRow';
import { DesktopTaskRow } from './taskBoard/DesktopTaskRow';
import { FilterBar } from './taskBoard/FilterBar';
import { BulkActionBar } from './taskBoard/BulkActionBar';
import { filterTasks, sortTasks, summarizeBulkResult } from './taskBoard/helpers';
import { SPRING_PANEL } from '../lib/motion';

// Sanallaştırma (react-window) sabitleri — büyük görev listelerinde (ör.
// Admin'in ilk yüklemede gördüğü 200+ görev) her satırı DOM'a basmak yerine
// yalnızca görünür pencereyi render eder. Yükseklikler mevcut hücre
// padding/font boyutlarına göre ölçülüp tarayıcıda doğrulanmıştır.
const DESKTOP_ROW_HEIGHT = 64;
const DESKTOP_LIST_MAX_HEIGHT = 640;
const MOBILE_ROW_HEIGHT = 80;
const MOBILE_LIST_MAX_HEIGHT = 560;
// pendingTaskIds verilmediğinde (ör. testlerde) her render'da YENİ bir Set
// oluşturmamak için paylaşılan sabit — aksi halde referans her seferinde
// değişip aşağıdaki useMemo'ların hiç önbelleklenmesini engellerdi.
const EMPTY_PENDING_TASK_IDS = new Set<string>();

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
  // Sütun başlığına tıklama döngüsü (kapalı → artan → azalan → kapalı, bkz.
  // tasarım denetimi 3.4) artık GridDataTable/DataTableHeader'ın kendi
  // `nextSortState`'inde yaşıyor (bkz. dataTable/types.ts) — burada yalnızca
  // sonucu URL state'ine (filters) yazan bir köprü kalır.
  const handleSortChange = useCallback((next: { sortBy: string; sortDir: 'asc' | 'desc' }) => {
    onFiltersChange({ sortBy: next.sortBy as TaskBoardFilters['sortBy'], sortDir: next.sortDir });
  }, [onFiltersChange]);
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

  const filteredTasks = useMemo(() => filterTasks({
    tasks, search, currentUser, showSubtasks, priorityFilter, assigneeFilter, statusFilter, usersById,
  }), [tasks, search, currentUser, showSubtasks, priorityFilter, assigneeFilter, statusFilter, usersById]);

  const sortedTasks = useMemo(
    () => sortTasks(filteredTasks, sortBy, sortDir, usersById),
    [filteredTasks, sortBy, sortDir, usersById]
  );

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
      const summary = summarizeBulkResult('Toplu Durum Güncellemesi', targets, results);
      setSelectedIds(prev => {
        const next = new Set(prev);
        summary.succeededIds.forEach(id => next.delete(id));
        return next;
      });
      addToast({ title: summary.toastTitle, body: summary.toastBody, type: summary.toastType });
    } finally {
      setIsBulkProcessing(false);
      setBulkStatusTarget('');
    }
  }, [bulkStatusTarget, selectedTasks, updateTaskStatus, addToast]);

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
      const summary = summarizeBulkResult('Toplu Yeniden Atama', targets, results);
      setSelectedIds(prev => {
        const next = new Set(prev);
        summary.succeededIds.forEach(id => next.delete(id));
        return next;
      });
      addToast({ title: summary.toastTitle, body: summary.toastBody, type: summary.toastType });
    } finally {
      setIsBulkProcessing(false);
      setBulkAssigneeTarget('');
    }
  }, [bulkAssigneeTarget, selectedTasks, updateTask, addToast]);

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
  const rowProps = useMemo<TaskRowData>(
    () => ({ tasks: sortedTasks, usersById, onViewTask, selectedIds, onToggleSelect: toggleSelect, pendingTaskIds }),
    [sortedTasks, usersById, onViewTask, selectedIds, toggleSelect, pendingTaskIds]
  );
  const mobileListHeight = Math.min(filteredTasks.length * MOBILE_ROW_HEIGHT, MOBILE_LIST_MAX_HEIGHT);
  const desktopListHeight = Math.min(filteredTasks.length * DESKTOP_ROW_HEIGHT, DESKTOP_LIST_MAX_HEIGHT);

  return (
    <PageShell>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <PageHeader
        icon={Layers}
        title="OPERASYONEL DENETİM"
        subtitle={`${filteredTasks.length} Talimat`}
        actions={<>
          {/* Subtask toggle — compact pill */}
          <div className="flex items-center gap-2 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-full px-3 h-9 shadow-sm">
            <Layers className={cn('w-3.5 h-3.5 stroke-[1.5] transition-colors', showSubtasks ? 'text-executive-blue' : 'text-text-tertiary')} />
            <span className="text-micro font-medium text-text-tertiary uppercase tracking-caps hidden sm:block">Alt Talimatlar</span>
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

          {/* Add task button — eskiden elle yazılmış, TeamList'in "Yeni Kadro"
              butonuyla farklı tracking taşıyordu (bkz. Faz 1 tracking
              denetimi); ikisi de artık AYNI Button varyantı. */}
          <Button variant="gold" size="sm" onClick={onAddTask}>
            <Plus className="w-3.5 h-3.5 stroke-[2]" />
            <span className="hidden sm:block">Yeni Talimat</span>
            <span className="sm:hidden">Yeni</span>
          </Button>
        </>}
      />

      {/* ── Filter Bar ─────────────────────────────────────────────── */}
      <FilterBar
        search={search} setSearch={setSearch}
        priorityFilter={priorityFilter} setPriorityFilter={setPriorityFilter}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
        assigneeFilter={assigneeFilter} setAssigneeFilter={setAssigneeFilter}
        users={users}
        hasActiveFilter={hasActiveFilter}
        resetFilters={resetFilters}
        filteredCount={filteredTasks.length}
        allFilteredSelected={filteredTasks.every(t => selectedIds.has(t.id))}
        selectedCount={selectedIds.size}
        selectAllFiltered={selectAllFiltered}
        clearSelection={clearSelection}
      />

      {/* ── Table ─────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING_PANEL, delay: 0.1 }}
        className={PANEL_FRAME_CLASSNAME}
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
              rowProps={rowProps}
              rowKey={rowKey}
              style={{ height: mobileListHeight }}
            />
          )}
        </div>

        {/* Desktop / tablet table (CSS Grid tabanlı — react-window virtualization
            native <table>/<tbody> ile absolute-positioned satırları
            hizalayamadığı için grid'e çevrildi; header ve satırlar aynı
            gridTemplateColumns'ı paylaşarak sütun hizasını korur) */}
        <div className="hidden sm:block">
          <GridDataTable
            columns={TASK_BOARD_COLUMNS}
            sort={sortBy === 'none' ? undefined : { sortBy, sortDir }}
            onSortChange={handleSortChange}
            isLoading={isLoading}
            isEmpty={filteredTasks.length === 0}
            emptyState={emptyStateNode}
            rowCount={filteredTasks.length}
            rowHeight={DESKTOP_ROW_HEIGHT}
            listHeight={desktopListHeight}
            rowComponent={DesktopTaskRow}
            rowProps={rowProps}
            rowKey={rowKey}
          />
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
            {isLoadingMore && <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />}
            Daha Fazla Talimat Yükle
          </button>
        </div>
      )}

      {/* ── Toplu İşlem Çubuğu (P2-18) ──────────────────────────────── */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          clearSelection={clearSelection}
          isBulkProcessing={isBulkProcessing}
          commonStatus={commonStatus}
          bulkStatusTarget={bulkStatusTarget}
          setBulkStatusTarget={setBulkStatusTarget}
          bulkStatusOptions={bulkStatusOptions}
          handleBulkStatusButtonClick={handleBulkStatusButtonClick}
          canBulkReassign={canBulkReassign}
          bulkAssigneeTarget={bulkAssigneeTarget}
          setBulkAssigneeTarget={setBulkAssigneeTarget}
          assignableUsers={assignableUsers}
          handleBulkReassignApply={handleBulkReassignApply}
        />
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
    </PageShell>
  );
};
