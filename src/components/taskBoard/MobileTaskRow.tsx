import type { ReactElement } from 'react';
import type { RowComponentProps } from 'react-window';
import { ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { Task, User } from '../../types';
import { cn } from '../../lib/utils';
import { isTaskInCrisis } from '../../lib/executiveMetrics';

export interface TaskRowData {
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

export function SyncPendingBadge() {
  return (
    <span
      title="Senkron bekliyor — bu değişiklik henüz sunucuya ulaşmadı"
      className="inline-flex items-center gap-1 text-micro font-bold uppercase tracking-label px-1.5 py-0.5 rounded-full bg-executive-gold/10 text-[color:var(--gold-text)] border border-executive-gold/20 flex-shrink-0"
    >
      <span className="w-1 h-1 rounded-full bg-executive-gold animate-pulse" aria-hidden="true" />
      Senkron Bekliyor
    </span>
  );
}

export function MobileTaskRow({ index, style, ariaAttributes, tasks, usersById, onViewTask, selectedIds, onToggleSelect, pendingTaskIds }: RowComponentProps<TaskRowData>): ReactElement | null {
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
            <p className="text-body font-medium text-executive-blue line-clamp-1 tracking-tight font-display group-hover:text-executive-blue min-w-0">
              {task.title}
            </p>
            {pendingTaskIds.has(task.id) && <SyncPendingBadge />}
          </div>
          <div className="flex items-center gap-2 mt-1 min-w-0">
            <span className="text-micro text-text-tertiary truncate min-w-0">{assignee?.fullName || 'Atanmamış'}</span>
            <span className={cn(
              'text-micro font-medium uppercase tracking-label px-1.5 py-0.5 rounded-md whitespace-nowrap flex-shrink-0',
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
