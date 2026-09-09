import React, { useState, useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Edit2, ShieldCheck, Trash2 } from 'lucide-react';
import { Task, TaskBlocker, User } from '../types';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { Badge } from './ui/Badge';
import { PageHeader } from './ui/PageHeader';
import { PageShell } from './ui/PageShell';
import { SPRING_ROW, staggerDelay } from '../lib/motion';
import { Skeleton, TableRowSkeleton } from './ui/Skeleton';
import { cn, formatTimeAgo, formatDate, buildUsersById } from '../lib/utils';
import { motion } from 'motion/react';
import { PRIORITY_BADGE_VARIANT, PRIORITY_LABELS } from '../constants';
import { getTimeLeft } from './taskDetails/helpers';

const PRIORITY_WEIGHTS: Record<string, number> = { Urgent: 3, High: 2, Medium: 1, Low: 0 };

// SLA rozeti/durumu ARTIK getTimeLeft (taskDetails/helpers.ts) üzerinden —
// bu, totalPausedTime/pausedAt'i hesaba katan TEK doğru kaynak (bkz.
// lib/sla.ts getRemainingTime). BlockerList tam olarak "engelli/BLOCKED"
// görevleri listeliyor — yani pause mekanizmasının en çok devrede olduğu
// senaryo — eskiden burada saf `deadline - Date.now()` farkına dayanan
// bağımsız bir hesaplama vardı; bu, TaskDetails'teki (daha önce düzeltilen)
// aynı sınıf hatanın burada tekrarı niteliğindeydi (bkz. kod denetimi).
const SLA_BADGE_VARIANT: Record<string, 'danger' | 'warning' | 'default'> = {
  expired: 'danger',
  warning: 'warning',
  paused: 'default',
  safe: 'default',
};

interface BlockerCardProps {
  blocker: TaskBlocker;
  index: number;
  tasksById: Map<string, Task>;
  usersById: Map<string, User>;
  isAdmin: boolean;
  isSystemAdmin: boolean;
  onViewTask: (task: Task) => void;
  onResolve: (blockerId: string) => void;
  onRequestEdit: (blocker: TaskBlocker) => void;
  onRequestDelete: (blockerId: string) => void;
}

// Modül seviyesinde tanımlanır (parent'ın içinde DEĞİL) — aksi halde her
// render'da yeni bir component tipi olarak yaratılır, bu da React'in DOM'u
// reconcile etmesini engelleyip her state güncellemesinde (ör. bir engel
// çözüldüğünde) TÜM kartların yeniden mount olmasına ve giriş animasyonlarının
// baştan oynamasına yol açardı.
const BlockerCard = ({ blocker, index, tasksById, usersById, isAdmin, isSystemAdmin, onViewTask, onResolve, onRequestEdit, onRequestDelete }: BlockerCardProps) => {
  const task     = tasksById.get(blocker.taskId);
  const assignee = task ? usersById.get(task.assigneeId) : undefined;
  const severity = blocker.severity ?? task?.priority ?? 'Medium';
  const isUrgentOrHigh = severity === 'Urgent' || severity === 'High';

  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-label={task?.title ?? blocker.reason}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING_ROW, delay: staggerDelay(index, 0.05) }}
      onClick={() => task && onViewTask(task)}
      onKeyDown={(e) => {
        // e.target === e.currentTarget: içteki Düzenle/Sil/Çözüldü butonlarına
        // Enter/Space basılınca sentezlenen click zaten kendi stopPropagation'ını
        // taşıyor, ama köpüren keydown burada tekrar tetiklenip görevi açmasın
        // diye yalnızca doğrudan bu kart odaktayken tetiklenir (bkz. ExecutiveToast'taki aynı desen).
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          if (task) onViewTask(task);
        }
      }}
      className={cn(
        'flex flex-col gap-3 p-3.5 rounded-2xl border cursor-pointer group transition-all duration-300',
        !blocker.isResolved
          ? cn(
              'bg-status-danger/[0.04] border-status-danger/20 hover:bg-status-danger/10 hover:shadow-sm',
              isUrgentOrHigh ? 'animate-makam-flash border-status-danger/50 hover:border-status-danger/60' : 'border-status-danger/15 hover:border-status-danger/25'
            )
          : 'bg-makam-glass border-surface-border opacity-60 grayscale hover:grayscale-0 hover:opacity-100 hover:bg-makam-glass'
      )}
    >
      {/* Top row: icon + reason + date */}
      <div className="flex items-start gap-3">
        <div className={cn(
          'w-8 h-8 flex-shrink-0 rounded-xl flex items-center justify-center border transition-all group-hover:scale-105',
          blocker.isResolved
            ? 'bg-status-success/10 text-status-success border-status-success/20'
            : 'bg-surface-elevated text-status-danger border-status-danger/25'
        )}>
          {blocker.isResolved
            ? <CheckCircle2 className="w-4 h-4 stroke-[1.3]" />
            : <AlertTriangle className="w-4 h-4 stroke-[1.3]" />}
        </div>
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <p className={cn(
            'text-body-sm font-medium line-clamp-2 leading-snug tracking-tight font-display',
            blocker.isResolved ? 'text-text-muted' : 'text-executive-blue group-hover:text-status-danger'
          )}>
            {blocker.reason}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <span className="text-micro text-text-tertiary font-medium uppercase tracking-caps truncate">
              {task?.title || 'Bilinmeyen Talimat'}
            </span>
            <span className="text-micro text-text-tertiary/40">•</span>
            <Badge variant={PRIORITY_BADGE_VARIANT[severity]}>
              {PRIORITY_LABELS[severity]}
            </Badge>
            {task && task.deadline > 0 && (() => {
              const timeLeft = getTimeLeft(task, Date.now());
              if (!timeLeft) return null;
              return (
                <Badge variant={SLA_BADGE_VARIANT[timeLeft.status]} icon={<Clock className="w-2.5 h-2.5" />}>
                  {timeLeft.label}
                </Badge>
              );
            })()}
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
          <span className="text-micro text-text-tertiary font-medium uppercase tracking-label">
            {formatDate(blocker.createdAt)}
          </span>
          <span className="text-micro text-text-tertiary">{formatTimeAgo(blocker.createdAt)}</span>
        </div>
      </div>

      {/* Bottom row: assignee + actions */}
      <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-executive-blue/[0.04]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-executive-blue/[0.04] border border-executive-blue/[0.08] flex items-center justify-center text-micro font-light text-executive-blue">
            {assignee?.fullName?.charAt(0) || '?'}
          </div>
          <span className="text-micro text-text-muted font-medium tracking-tight">
            {assignee?.fullName || 'Atanmamış'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {isAdmin && (
            <div className="flex items-center bg-makam-glass rounded-lg p-0.5 border border-executive-blue/[0.05] gap-0.5">
              <button
                className="w-7 h-7 flex items-center justify-center text-text-tertiary hover:text-executive-blue hover:bg-surface-elevated rounded-md transition-all"
                onClick={(e) => { e.stopPropagation(); onRequestEdit(blocker); }}
                title="Düzenle"
              >
                <Edit2 className="w-3 h-3 stroke-[1.5]" />
              </button>
              {isSystemAdmin && (
                <button
                  className="w-7 h-7 flex items-center justify-center text-text-tertiary hover:text-status-danger hover:bg-status-danger/10 rounded-md transition-all"
                  onClick={(e) => { e.stopPropagation(); onRequestDelete(blocker.id); }}
                  title="Sil"
                >
                  <Trash2 className="w-3 h-3 stroke-[1.5]" />
                </button>
              )}
            </div>
          )}
          {!blocker.isResolved && isAdmin && (
            <button
              className="px-3 py-1.5 text-micro bg-status-success hover:opacity-90 text-[color:var(--status-success-text)] font-medium uppercase tracking-caps rounded-lg shadow-sm transition-all active:scale-95"
              onClick={(e) => { e.stopPropagation(); onResolve(blocker.id); }}
            >
              Çözüldü
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};

interface BlockerListProps {
  tasks: Task[];
  blockers: TaskBlocker[];
  /** Son çözülen engeller — ayrı bir Firestore sorgusundan gelir (bkz.
   *  useFirestoreData.ts). `blockers` yalnızca AKTİF engelleri taşır, bu
   *  yüzden "Çözüme Ulaşanlar" paneli eskiden olduğu gibi `blockers`'tan
   *  türetilemez (bkz. kod denetimi: eskiden bu panel bu yüzden hep boştu). */
  resolvedBlockers: TaskBlocker[];
  users: User[];
  isAdmin: boolean;
  isSystemAdmin?: boolean;
  isLoading?: boolean;
  onResolve: (blockerId: string) => void;
  onEditBlocker: (blockerId: string, reason: string) => void;
  onDeleteBlocker: (blockerId: string) => void;
  onViewTask: (task: Task) => void;
}

// Firestore verisi gelene kadar (tasks/blockers dizileri henüz boş) sayfa
// kısa süre tamamen boş kalıyordu — "0 aktif engel" boş-durumuyla ayırt
// edilemediğinden "uygulama çöktü" izlenimi veriyordu (bkz. tasarım denetimi).
const BlockerListSkeleton = () => (
  <PageShell aria-label="Yükleniyor..." role="status">
    <div className="flex items-center gap-2.5 pb-4 border-b border-executive-blue/[0.04]">
      <Skeleton className="w-8 h-8" rounded="lg" />
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-2.5 w-24" />
      </div>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-5">
      {[0, 1].map(col => (
        <div key={col} className="flex flex-col gap-3">
          <Skeleton className="h-3 w-32" />
          <div className="makam-card p-4 flex flex-col gap-3">
            {[...Array(3)].map((_, i) => <TableRowSkeleton key={i} cols={3} />)}
          </div>
        </div>
      ))}
    </div>
  </PageShell>
);

export const BlockerList = ({ tasks, blockers, resolvedBlockers, users, isAdmin, isSystemAdmin = false, isLoading = false, onResolve, onEditBlocker, onDeleteBlocker, onViewTask }: BlockerListProps) => {
  const tasksById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const usersById = useMemo(() => buildUsersById(users), [users]);

  const activeBlockers = useMemo(() => {
    const taskPriorityWeightById = new Map<string, number>();
    for (const t of tasks) {
      taskPriorityWeightById.set(t.id, PRIORITY_WEIGHTS[t.priority] ?? 0);
    }
    // Engelin kendi ciddiyeti varsa (bkz. severity alanı) bağlı görevin
    // önceliğinden önceliklidir — engel, görevden bağımsız olarak daha
    // ciddi/hafif işaretlenebilir.
    const weightOf = (blocker: TaskBlocker) =>
      blocker.severity ? (PRIORITY_WEIGHTS[blocker.severity] ?? 0) : (taskPriorityWeightById.get(blocker.taskId) ?? -1);

    return blockers
      .filter(b => !b.isResolved)
      .sort((a, b) => {
        const weightA = weightOf(a);
        const weightB = weightOf(b);
        if (weightB !== weightA) return weightB - weightA;
        return b.createdAt - a.createdAt;
      });
  }, [blockers, tasks]);

  const resolvedLast30Days = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return resolvedBlockers.filter(b => b.resolvedAt && b.resolvedAt >= cutoff).length;
  }, [resolvedBlockers]);

  const trackedTaskCount = useMemo(
    () => tasks.filter(t => t.status !== 'COMPLETED' && t.status !== 'CANCELLED').length,
    [tasks]
  );

  const [editingBlocker, setEditingBlocker]   = useState<TaskBlocker | null>(null);
  const [editReason, setEditReason]           = useState('');
  const [deletingBlockerId, setDeletingBlockerId] = useState<string | null>(null);

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingBlocker && editReason.trim()) {
      onEditBlocker(editingBlocker.id, editReason.trim());
      setEditingBlocker(null);
    }
  };

  const handleRequestEdit = (blocker: TaskBlocker) => {
    setEditingBlocker(blocker);
    setEditReason(blocker.reason);
  };

  if (isLoading) return <BlockerListSkeleton />;

  return (
    <PageShell>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <PageHeader
        icon={AlertTriangle}
        tone={activeBlockers.length > 0 ? 'danger' : 'success'}
        titleTone={activeBlockers.length > 0 ? 'danger' : 'heading'}
        title="OPERASYONEL KRİZ YÖNETİMİ"
        subtitle={`${activeBlockers.length} Aktif Engel`}
      />

      {/* ── Two-column blocker panels ────────────────────────────── */}
      {/* Mobile: stacked | Desktop: 2 col */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-5">

        {/* Active blockers */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className={cn("w-3.5 h-3.5 stroke-[1.5]", activeBlockers.length > 0 ? "text-status-danger" : "text-text-tertiary")} />
            <h3 className={cn("text-micro font-medium uppercase tracking-eyebrow", activeBlockers.length > 0 ? "text-status-danger" : "text-text-tertiary")}>
              Aktif Kriz Engelleri
            </h3>
            <span className={cn(
              "px-2 py-0.5 rounded-full text-micro font-bold border",
              activeBlockers.length > 0 ? "bg-status-danger/10 text-status-danger border-status-danger/20" : "bg-surface-base text-text-tertiary border-surface-border"
            )}>
              {activeBlockers.length}
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            {activeBlockers.length > 0 ? (
              activeBlockers.map((b, i) => (
                <BlockerCard
                  key={b.id}
                  blocker={b}
                  index={i}
                  tasksById={tasksById}
                  usersById={usersById}
                  isAdmin={isAdmin}
                  isSystemAdmin={isSystemAdmin}
                  onViewTask={onViewTask}
                  onResolve={onResolve}
                  onRequestEdit={handleRequestEdit}
                  onRequestDelete={setDeletingBlockerId}
                />
              ))
            ) : (
              <div className="min-h-[260px] flex flex-col items-center justify-center bg-makam-glass border border-dashed border-executive-blue/[0.05] rounded-2xl gap-3">
                <CheckCircle2 className="w-10 h-10 text-text-tertiary/50 stroke-[1]" />
                <span className="text-body text-text-tertiary">Aktif engel bulunmuyor</span>
              </div>
            )}
          </div>
        </div>

        {/* Resolved blockers */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-text-tertiary stroke-[1.5]" />
            <h3 className="text-micro font-medium text-text-tertiary uppercase tracking-eyebrow">
              Çözüme Ulaşanlar
            </h3>
            <span className="px-2 py-0.5 rounded-full bg-surface-base text-text-tertiary border border-surface-border text-micro font-bold">
              {resolvedBlockers.length}
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            {resolvedBlockers.length > 0 ? (
              resolvedBlockers.map((b, i) => (
                <BlockerCard
                  key={b.id}
                  blocker={b}
                  index={i}
                  tasksById={tasksById}
                  usersById={usersById}
                  isAdmin={isAdmin}
                  isSystemAdmin={isSystemAdmin}
                  onViewTask={onViewTask}
                  onResolve={onResolve}
                  onRequestEdit={handleRequestEdit}
                  onRequestDelete={setDeletingBlockerId}
                />
              ))
            ) : (
              <div className="min-h-[260px] flex flex-col items-center justify-center bg-makam-glass border border-dashed border-executive-blue/[0.05] rounded-2xl gap-3">
                <Clock className="w-10 h-10 text-text-tertiary/50 stroke-[1]" />
                <span className="text-body text-text-tertiary">Arşivlenmiş kayıt yok</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Özet şeridi ────────────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-2 py-3 border-t border-executive-blue/[0.04]">
        <ShieldCheck className="w-3.5 h-3.5 text-status-success/60 stroke-[1.5]" />
        <span className="text-micro text-text-tertiary uppercase tracking-eyebrow">
          Son 30 günde {resolvedLast30Days} engel çözüldü · {trackedTaskCount} talimat izleniyor
        </span>
      </div>

      {/* ── Edit Modal ─────────────────────────────────────────────── */}
      <Modal isOpen={!!editingBlocker} onClose={() => setEditingBlocker(null)} title="Engeli Düzenle">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
          <Input label="Engel Sebebi" value={editReason} onChange={(e) => setEditReason(e.target.value)} required />
          <div className="flex justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
            <Button variant="secondary" type="button" onClick={() => setEditingBlocker(null)}>İptal</Button>
            <Button type="submit">Kaydet</Button>
          </div>
        </form>
      </Modal>

      {/* ── Delete Modal ───────────────────────────────────────────── */}
      <ConfirmDialog
        isOpen={!!deletingBlockerId}
        onClose={() => setDeletingBlockerId(null)}
        title="Engeli Sil"
        message="Bu engeli silmek istediğinize emin misiniz?"
        confirmLabel="Sil"
        onConfirm={() => {
          if (deletingBlockerId) {
            onDeleteBlocker(deletingBlockerId);
            setDeletingBlockerId(null);
          }
        }}
      />
    </PageShell>
  );
};
