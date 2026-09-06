import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  CheckCircle2, AlertTriangle,
  Edit2, Trash2, Activity, Info,
  GitCommit, Hourglass, ListChecks, Zap, Flag, History, MessageSquare,
} from 'lucide-react';
import { Task, User as UserType, TaskBlocker, AuditLog, TaskStatus, TaskPriority } from '../types';
import { STATUS_LABELS, STATUS_LABELS_SHORT, PRIORITY_LABELS, PRIORITY_BADGE_VARIANT, STATUS_BADGE_VARIANT } from '../constants';
import { cn, buildUsersById } from '../lib/utils';
import { logger } from '../lib/logger';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { SegmentedTabs } from './ui/SegmentedTabs';
import { auditLogService } from '../services/auditLogService';
import { getTimeLeft, computeChecklistStats, type TaskDetailsTabId } from './taskDetails/helpers';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { InfoTab } from './taskDetails/InfoTab';
import { ChecklistTab } from './taskDetails/ChecklistTab';
import { SubtasksTab } from './taskDetails/SubtasksTab';
import { BlockersTab } from './taskDetails/BlockersTab';
import { HistoryTab } from './taskDetails/HistoryTab';
import { CommentsTab } from './taskDetails/CommentsTab';

export type { PrimaryAction } from './taskDetails/helpers';
export { getPrimaryAction } from './taskDetails/helpers';
export { TaskDetailsFooter } from './taskDetails/Footer';

export const TaskDetails = ({
  task, tasks, users, currentUser, blockers,
  onAddBlocker, onResolveBlocker,
  onAddSubTask, onAddComment, onViewTask, onEdit, onDelete,
  onClearCoordinator, onShowCertificate, onShowWarning,
  onUpdateTask, onDelegateTask
}: {
  task: Task;
  tasks: Task[];
  users: UserType[];
  currentUser: UserType | null;
  blockers: TaskBlocker[];
  onAddBlocker: (reason: string, severity: TaskPriority) => void;
  onResolveBlocker: (blockerId: string) => void;
  onAddSubTask: (parentId: string, title: string) => void;
  onAddComment: (text: string) => void;
  onViewTask: (task: Task) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClearCoordinator?: () => void;
  onShowCertificate?: (task: Task) => void;
  onShowWarning?: (task: Task) => void;
  onUpdateTask?: (data: Partial<Task>) => void;
  onDelegateTask?: (newAssigneeId: string) => void;
}) => {
  const [activeTab, setActiveTab] = useState<TaskDetailsTabId>('info');
  const [newComment, setNewComment] = useState('');
  const [blockerReason, setBlockerReason] = useState('');
  const [blockerSeverity, setBlockerSeverity] = useState<TaskPriority>('Medium');
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  // Asenkron/fire-and-forget prop çağrıları sırasında çift gönderimi önlemek için
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isSubmittingBlocker, setIsSubmittingBlocker] = useState(false);
  const [isSubmittingChecklist, setIsSubmittingChecklist] = useState(false);

  const handleAddChecklistItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChecklistItem.trim() || !onUpdateTask || isSubmittingChecklist) return;
    const currentChecklist = task.checklist || [];
    const newItem = {
      id: crypto.randomUUID(),
      text: newChecklistItem.trim(),
      isCompleted: false
    };
    setIsSubmittingChecklist(true);
    try {
      await Promise.resolve(onUpdateTask({ checklist: [...currentChecklist, newItem] }));
      setNewChecklistItem('');
    } finally {
      setIsSubmittingChecklist(false);
    }
  };

  // handleAddChecklistItem'daki AYNI isSubmittingChecklist koruması —
  // eskiden yalnızca ekleme korunuyordu, hızlı ardışık checkbox tıklamaları/
  // silmeler korumasızdı. Veri kaybı riski yoktu (lockVersion optimistic
  // locking zaten çakışan yazımları VERSION_MISMATCH ile reddediyor), ama
  // gereksiz hata/toast riskini önlemek için tutarlı hale getirildi (bkz.
  // kod denetimi).
  const handleToggleChecklistItem = async (itemId: string) => {
    if (!onUpdateTask || isSubmittingChecklist) return;
    const currentChecklist = task.checklist || [];
    const updatedChecklist = currentChecklist.map(item =>
      item.id === itemId ? { ...item, isCompleted: !item.isCompleted } : item
    );
    setIsSubmittingChecklist(true);
    try {
      await Promise.resolve(onUpdateTask({ checklist: updatedChecklist }));
    } finally {
      setIsSubmittingChecklist(false);
    }
  };

  const handleDeleteChecklistItem = async (itemId: string) => {
    if (!onUpdateTask || isSubmittingChecklist) return;
    const currentChecklist = task.checklist || [];
    const updatedChecklist = currentChecklist.filter(item => item.id !== itemId);
    setIsSubmittingChecklist(true);
    try {
      await Promise.resolve(onUpdateTask({ checklist: updatedChecklist }));
    } finally {
      setIsSubmittingChecklist(false);
    }
  };

  const checklistStats = useMemo(() => computeChecklistStats(task.checklist), [task.checklist]);

  // #4 - Gerçek zamanlı SLA sayacı
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const [localLogs, setLocalLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState(false);
  const [logsRetryNonce, setLogsRetryNonce] = useState(0);
  // Aynı task için sekmeye her geçişte yeniden sorgu atmamak için in-memory cache
  const logsCacheRef = useRef<Record<string, AuditLog[]>>({});

  useEffect(() => {
    if (activeTab !== 'history') return;

    const cached = logsCacheRef.current[task.id];
    if (cached) {
      setLocalLogs(cached);
      setLogsError(false);
      return;
    }

    let cancelled = false;
    const fetchTaskLogs = async () => {
      setLoadingLogs(true);
      setLogsError(false);
      try {
        const list = await auditLogService.queryTaskLogs(task.id);
        if (cancelled) return;
        logsCacheRef.current[task.id] = list;
        setLocalLogs(list);
      } catch (err) {
        logger.error('Failed to fetch task audit logs:', err);
        if (!cancelled) setLogsError(true);
      } finally {
        if (!cancelled) setLoadingLogs(false);
      }
    };
    fetchTaskLogs();
    return () => { cancelled = true; };
  }, [activeTab, task.id, logsRetryNonce]);

  const usersById = useMemo(() => buildUsersById(users), [users]);
  const assignee = usersById.get(task.assigneeId);
  const creator  = usersById.get(task.creatorId);
  // Koordinatörü görevin coordinatorId alanına göre bul
  const coordinator = task.coordinatorId ? usersById.get(task.coordinatorId) : undefined;
  // İş kuralı ihlali: koordinatör Admin ise uyar
  const coordinatorIsAdmin = coordinator?.role === 'Admin';

  const isAdmin = useIsAdmin(currentUser);
  const isManager = currentUser?.role === 'Manager';

  // İzin/mazeret devri: yalnızca görevin mevcut sorumlusu olan Müdür,
  // henüz başlamamış/devam eden bir görevi başka bir Müdür'e devredebilir.
  const canDelegate = isManager
    && currentUser?.uid === task.assigneeId
    && (task.status === 'ASSIGNED' || task.status === 'IN_PROGRESS');
  const delegateCandidates = useMemo(
    () => users.filter(u => u.role === 'Manager' && u.uid !== currentUser?.uid),
    [users, currentUser?.uid]
  );
  const [isDelegateModalOpen, setIsDelegateModalOpen] = useState(false);
  const [delegateTargetId, setDelegateTargetId] = useState('');
  const [isSubmittingDelegate, setIsSubmittingDelegate] = useState(false);

  const handleDelegate = async () => {
    if (!delegateTargetId || !onDelegateTask || isSubmittingDelegate) return;
    setIsSubmittingDelegate(true);
    try {
      await Promise.resolve(onDelegateTask(delegateTargetId));
      setIsDelegateModalOpen(false);
      setDelegateTargetId('');
    } finally {
      setIsSubmittingDelegate(false);
    }
  };

  const subtasks = useMemo(() => tasks.filter(t => t.parentId === task.id), [tasks, task.id]);

  // #4 - Canlı SLA hesaplama (totalPausedTime ve pausedAt dahil)
  const timeLeft = getTimeLeft(task, now);

  // #5 - Durum akış pipeline sırası
  const STATUS_PIPELINE: TaskStatus[] = useMemo(() => {
    const interruption = task.status === 'BLOCKED' || task.status === 'CRISIS' ? task.status : null;
    // Yetki devri bekleyen talimatlar pipeline'da "Atandı" yerine kendi adımıyla gösterilir
    const first: TaskStatus = task.status === 'PENDING_DELEGATION' ? 'PENDING_DELEGATION' : 'ASSIGNED';
    return interruption
      ? [first, 'IN_PROGRESS', interruption, 'AWAITING_APPROVAL', 'COMPLETED']
      : [first, 'IN_PROGRESS', 'AWAITING_APPROVAL', 'COMPLETED'];
  }, [task.status]);
  const currentPipelineIdx = STATUS_PIPELINE.indexOf(task.status);

  const handleAddComment = async () => {
    if (!newComment.trim() || isSubmittingComment) return;
    setIsSubmittingComment(true);
    try {
      await Promise.resolve(onAddComment(newComment));
      setNewComment('');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleAddBlocker = async () => {
    if (!blockerReason.trim() || isSubmittingBlocker) return;
    setIsSubmittingBlocker(true);
    try {
      await Promise.resolve(onAddBlocker(blockerReason, blockerSeverity));
      setBlockerReason('');
      setBlockerSeverity('Medium');
    } finally {
      setIsSubmittingBlocker(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4 py-1 font-sans">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 px-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={STATUS_BADGE_VARIANT[task.status]}
              withPulse={task.status === 'BLOCKED' || task.status === 'CRISIS'}
              icon={task.status === 'PENDING_DELEGATION'
                ? <Hourglass className="w-3.5 h-3.5" />
                : <Activity className="w-3.5 h-3.5" />}
            >
              {STATUS_LABELS[task.status]}
            </Badge>
            {/* #2 - Öncelik göstergesi */}
            <Badge
              variant={PRIORITY_BADGE_VARIANT[task.priority]}
              icon={<Flag className="w-3 h-3" />}
            >
              {PRIORITY_LABELS[task.priority]}
            </Badge>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {(isAdmin || isManager) && (
              <div className="flex items-center bg-makam-glass backdrop-blur-2xl rounded-full p-1 border border-surface-border shadow-sm">
                <button onClick={onEdit} className="px-4 py-2 rounded-full text-micro font-medium text-text-muted hover:text-executive-blue transition-colors uppercase tracking-[0.2em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2">
                  <Edit2 className="w-3.5 h-3.5 inline mr-2" />
                  Düzenle
                </button>
                <div className="w-[1px] h-3 bg-makam-border/10 mx-1" />
                <button onClick={() => setIsDeleteConfirmOpen(true)} className="px-4 py-2 rounded-full text-micro font-medium text-text-muted hover:text-status-danger transition-colors uppercase tracking-[0.2em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger focus-visible:ring-offset-2">
                  <Trash2 className="w-3.5 h-3.5 inline mr-2" />
                  Sil
                </button>
              </div>
            )}
          </div>
        </div>

        <h2 className="text-[18px] font-medium text-executive-blue tracking-tight leading-tight font-display border-l-2 border-executive-gold/40 pl-4 py-1">
          {task.title}
        </h2>
      </div>

      {/* #5 - Durum Akış Pipeline Şeridi */}
      <div className="px-1 py-3">
        <div className="flex items-center gap-0">
          {STATUS_PIPELINE.map((status, idx) => {
            const isCompleted = currentPipelineIdx > idx;
            const isActive = currentPipelineIdx === idx;
            const isInterruption = status === 'BLOCKED' || status === 'CRISIS';
            const isDelegation = status === 'PENDING_DELEGATION';
            return (
              <React.Fragment key={status}>
                <div className="flex flex-col items-center gap-1">
                  <div className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all duration-500',
                    isCompleted ? 'bg-status-success border-status-success text-[color:var(--status-success-text)]' :
                    isActive && isInterruption ? 'bg-status-danger border-status-danger text-[color:var(--status-danger-text)] animate-pulse shadow-lg shadow-status-danger/15' :
                    isActive && isDelegation ? 'bg-executive-gold border-executive-gold text-[color:var(--btn-primary-text)] shadow-lg shadow-executive-gold/20' :
                    isActive ? 'bg-executive-blue border-executive-blue text-[color:var(--executive-blue-text)] shadow-lg shadow-executive-blue/20' :
                    'bg-surface-elevated border-text-muted/25 text-text-tertiary'
                  )}>
                    {isCompleted ? <CheckCircle2 className="w-3.5 h-3.5 stroke-[2.5]" /> :
                     isActive && isInterruption ? <AlertTriangle className="w-3.5 h-3.5 stroke-[2]" /> :
                     isActive && isDelegation ? <Hourglass className="w-3.5 h-3.5 stroke-[2]" /> :
                     isActive ? <Zap className="w-3.5 h-3.5 stroke-[2]" /> :
                     <span className="text-micro font-bold">{idx + 1}</span>}
                  </div>
                  <span className={cn(
                    'text-micro font-medium uppercase tracking-[0.18em] whitespace-nowrap',
                    isCompleted ? 'text-status-success' :
                    isActive && isInterruption ? 'text-status-danger' :
                    isActive && isDelegation ? 'text-[color:var(--gold-text)]' :
                    isActive ? 'text-executive-blue' : 'text-text-tertiary'
                  )}>{STATUS_LABELS_SHORT[status]}</span>
                </div>
                {idx < STATUS_PIPELINE.length - 1 && (
                  <div className={cn(
                    'flex-1 h-[2px] mx-1 mt-[-10px] rounded-full transition-all duration-500',
                    isCompleted ? 'bg-status-success' : 'bg-text-muted/15'
                  )} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <div className="relative">
        <SegmentedTabs
          variant="underline"
          ariaLabel="Talimat detay bölümleri"
          idPrefix="task"
          activeId={activeTab}
          onChange={(id) => setActiveTab(id as TaskDetailsTabId)}
          tabs={[
            { id: 'info', label: 'Detay', icon: Info, count: 0 },
            // #9 - Tamamlanmamış alt işlem sayısı
            { id: 'checklist', label: 'Alt İşlemler', icon: ListChecks, count: checklistStats.total - checklistStats.completed },
            { id: 'subtasks', label: 'Alt Talimatlar', icon: GitCommit, count: subtasks.length },
            // #9 - Çözülmemiş engel sayısı
            { id: 'blockers', label: 'Engeller', icon: AlertTriangle, count: blockers.filter(b => !b.isResolved).length },
            // #10 - Denetim izi yalnızca Admin/Manager rollerine görünür
            ...(isAdmin || isManager ? [{ id: 'history', label: 'Denetim İzi', icon: History, count: 0 }] : []),
            { id: 'comments', label: 'Yorumlar', icon: MessageSquare, count: task.comments?.length ?? 0 },
          ]}
        />
        {/* Taşan sekmeler için kenar fade ipucu */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-surface-elevated to-transparent"
        />
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {activeTab === 'info' && (
          <InfoTab
            task={task}
            creator={creator}
            assignee={assignee}
            coordinator={coordinator}
            coordinatorIsAdmin={coordinatorIsAdmin}
            isAdmin={isAdmin}
            isManager={isManager}
            canDelegate={canDelegate}
            timeLeft={timeLeft}
            onClearCoordinator={onClearCoordinator}
            onOpenDelegateModal={() => setIsDelegateModalOpen(true)}
            onDelegateTask={onDelegateTask}
            onShowCertificate={onShowCertificate}
            onShowWarning={onShowWarning}
            setActiveTab={setActiveTab}
          />
        )}

        {activeTab === 'subtasks' && (
          <SubtasksTab task={task} subtasks={subtasks} onAddSubTask={onAddSubTask} onViewTask={onViewTask} />
        )}

        {activeTab === 'blockers' && (
          <BlockersTab
            blockers={blockers}
            isAdmin={isAdmin}
            isManager={isManager}
            onResolveBlocker={onResolveBlocker}
            blockerReason={blockerReason}
            setBlockerReason={setBlockerReason}
            blockerSeverity={blockerSeverity}
            setBlockerSeverity={setBlockerSeverity}
            isSubmittingBlocker={isSubmittingBlocker}
            onAddBlocker={handleAddBlocker}
          />
        )}

        {activeTab === 'history' && (
          <HistoryTab
            loadingLogs={loadingLogs}
            logsError={logsError}
            localLogs={localLogs}
            users={users}
            onRetry={() => setLogsRetryNonce(n => n + 1)}
          />
        )}

        {activeTab === 'checklist' && (
          <ChecklistTab
            task={task}
            checklistStats={checklistStats}
            isSubmittingChecklist={isSubmittingChecklist}
            newChecklistItem={newChecklistItem}
            setNewChecklistItem={setNewChecklistItem}
            onAddChecklistItem={handleAddChecklistItem}
            onToggleChecklistItem={handleToggleChecklistItem}
            onDeleteChecklistItem={handleDeleteChecklistItem}
            canEditChecklist={Boolean(onUpdateTask)}
          />
        )}

        {activeTab === 'comments' && (
          <CommentsTab
            task={task}
            users={users}
            newComment={newComment}
            setNewComment={setNewComment}
            isSubmittingComment={isSubmittingComment}
            onAddComment={handleAddComment}
          />
        )}
      </div>
    </div>

    {/* ── Silme Onayı ────────────────────────────────────────────── */}
    <ConfirmDialog
      isOpen={isDeleteConfirmOpen}
      onClose={() => setIsDeleteConfirmOpen(false)}
      title="Talimatı Sil"
      message={<><strong className="text-status-danger font-medium">{task.title}</strong> talimatını kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.</>}
      confirmLabel="Kalıcı Olarak Sil"
      warning={subtasks.length > 0 ? `Bu talimatın ${subtasks.length} alt talimatı var. Bu işlem hepsini kademeli olarak silecektir.` : null}
      onConfirm={() => { setIsDeleteConfirmOpen(false); onDelete(); }}
    />

    <Modal isOpen={isDelegateModalOpen} onClose={() => setIsDelegateModalOpen(false)} title="Talimatı Devret">
      <div className="flex flex-col gap-4">
        <p className="text-body text-text-muted font-light leading-relaxed">
          <strong className="text-text-heading font-medium">{task.title}</strong> talimatını izin/mazeret durumunuz için başka bir müdüre devredin. Devredilen müdür kabul edip icraya alana kadar talimat "Yetki Devri Bekleniyor" durumunda kalır ve mühlet sayacı duraklar.
        </p>
        <select
          value={delegateTargetId}
          onChange={(e) => setDelegateTargetId(e.target.value)}
          aria-label="Devredilecek müdür"
          className="w-full bg-surface-elevated border border-makam-border/10 rounded-xl px-4 py-3 outline-none text-body font-medium text-text-heading transition-all focus:border-executive-blue/30 focus:ring-4 focus:ring-executive-blue/5"
        >
          <option value="" className="bg-surface-base text-text-heading">Müdür Seçiniz</option>
          {delegateCandidates.map(m => (
            <option key={m.uid} value={m.uid} className="bg-surface-base text-text-heading">{m.fullName}</option>
          ))}
        </select>
        <div className="flex justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
          <Button variant="secondary" onClick={() => setIsDelegateModalOpen(false)}>İptal</Button>
          <Button
            variant="gold"
            disabled={!delegateTargetId}
            isLoading={isSubmittingDelegate}
            onClick={handleDelegate}
          >
            Devret
          </Button>
        </div>
      </div>
    </Modal>
    </>
  );
};
