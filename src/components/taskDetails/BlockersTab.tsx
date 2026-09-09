import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { TaskBlocker, TaskPriority } from '../../types';
import { PRIORITY_LABELS, PRIORITY_BADGE_VARIANT } from '../../constants';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';

interface BlockersTabProps {
  blockers: TaskBlocker[];
  isAdmin: boolean;
  isManager: boolean;
  onResolveBlocker: (blockerId: string) => void;
  blockerReason: string;
  setBlockerReason: (value: string) => void;
  blockerSeverity: TaskPriority;
  setBlockerSeverity: (value: TaskPriority) => void;
  isSubmittingBlocker: boolean;
  onAddBlocker: () => void;
}

export const BlockersTab = ({
  blockers, isAdmin, isManager, onResolveBlocker,
  blockerReason, setBlockerReason, blockerSeverity, setBlockerSeverity,
  isSubmittingBlocker, onAddBlocker,
}: BlockersTabProps) => (
  <div role="tabpanel" id="task-tabpanel-blockers" aria-labelledby="task-tab-blockers" className="flex flex-col gap-6">
    <div className="flex flex-col gap-4">
      <h4 className="text-micro font-medium text-text-muted uppercase tracking-caps">Aktif Engeller</h4>
      <div className="flex flex-col gap-3">
        {blockers.length === 0 ? (
          <EmptyState icon={<AlertTriangle className="w-8 h-8" />} message="Engel kaydı bulunamadı" />
        ) : (
          blockers.map(blocker => (
            <div key={blocker.id} className={cn(
              "flex items-center justify-between p-3 rounded-xl border transition-all",
              blocker.isResolved ? "opacity-50 grayscale bg-makam-glass border-surface-border" : "bg-status-danger/5 border-status-danger/15"
            )}>
              <div className="flex items-center gap-4">
                <AlertTriangle className={cn("w-5 h-5", blocker.isResolved ? "text-text-muted" : "text-status-danger")} />
                <div className="flex flex-col gap-1">
                  <span className="text-[14px] font-medium text-text-heading">{blocker.reason}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={PRIORITY_BADGE_VARIANT[blocker.severity ?? 'Medium']}>
                      {PRIORITY_LABELS[blocker.severity ?? 'Medium']}
                    </Badge>
                    <span className="text-micro text-text-muted uppercase tracking-widest">
                      {format(blocker.createdAt, 'd MMM HH:mm', { locale: tr })}
                    </span>
                  </div>
                </div>
              </div>
              {!blocker.isResolved && (isAdmin || isManager) && (
                <Button
                  variant="success"
                  size="sm"
                  onClick={() => onResolveBlocker(blocker.id)}
                  className="tracking-widest"
                >
                  ÇÖZÜLDÜ
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </div>

    <div className="pt-6 border-t border-makam-border/5">
      <div className="flex gap-2">
        <label htmlFor="blocker-reason-input" className="sr-only">Engel açıklaması</label>
        <input
          id="blocker-reason-input"
          value={blockerReason}
          onChange={(e) => setBlockerReason(e.target.value)}
          placeholder="Engeli tanımlayın..."
          disabled={isSubmittingBlocker}
          className="flex-1 bg-makam-glass border border-makam-border/10 rounded-full px-5 py-3 text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger/10 disabled:opacity-60"
        />
        <label htmlFor="blocker-severity-select" className="sr-only">Engel ciddiyeti</label>
        <select
          id="blocker-severity-select"
          value={blockerSeverity}
          onChange={(e) => setBlockerSeverity(e.target.value as TaskPriority)}
          disabled={isSubmittingBlocker}
          className="bg-makam-glass border border-makam-border/10 rounded-full px-4 py-3 text-body-sm font-medium text-text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger/10 disabled:opacity-60"
        >
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
            <option key={value} value={value} className="bg-surface-base text-text-heading">{label}</option>
          ))}
        </select>
        <button
          onClick={onAddBlocker}
          disabled={!blockerReason.trim() || isSubmittingBlocker}
          className="px-6 py-3 bg-status-danger text-[color:var(--status-danger-text)] rounded-full text-micro uppercase tracking-widest shadow-lg shadow-status-danger/10 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger focus-visible:ring-offset-2"
        >
          {isSubmittingBlocker ? 'EKLENİYOR…' : 'ENGEL EKLE'}
        </button>
      </div>
    </div>
  </div>
);
