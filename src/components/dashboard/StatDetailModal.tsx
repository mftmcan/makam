import { CheckCircle2, AlertTriangle, Activity, ArrowRight } from 'lucide-react';
import type { Task } from '../../types';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { cn, formatTimeAgo } from '../../lib/utils';
import { STATUS_LABELS, STATUS_BADGE_VARIANT } from '../../constants';
import type { StatCategory } from './helpers';

const STAT_MODAL_TITLE: Record<StatCategory, string> = {
  total: 'Toplam Talimatlar', waiting: 'Bekleyen Talimatlar', inProgress: 'İcra Aşamasındakiler',
  blocked: 'Engellenen Talimatlar', inReview: 'Onay Sürecindekiler',
  crisis: 'SLA İhlali (Kriz)', completed: 'İcra Edilenler',
};

interface StatDetailModalProps {
  category: StatCategory | null;
  tasks: Task[];
  onClose: () => void;
  onViewTask?: (task: Task) => void;
}

/** ── Stat Kartı Detay Modali ───────────────────────────────────────────────
 *  Dashboard.tsx'ten ayrıştırıldı (bkz. kod denetimi — dosya bölme): saf
 *  sunum, kendi state'i yok. Stat kartlarına tıklanınca o kategorideki
 *  görev listesini gösterir. */
export const StatDetailModal = ({ category, tasks, onClose, onViewTask }: StatDetailModalProps) => (
  <Modal
    isOpen={!!category}
    onClose={onClose}
    title={category ? STAT_MODAL_TITLE[category] ?? '' : ''}
    size="lg"
  >
    <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
      {tasks.length > 0 ? (
        tasks.map(task => (
          <div
            key={task.id}
            role="button"
            tabIndex={0}
            aria-label={task.title}
            className="flex items-center gap-3 p-3 bg-surface-elevated border border-surface-border rounded-xl group cursor-pointer hover:bg-makam-glass hover:border-executive-blue/10 transition-all duration-300 shadow-sm"
            onClick={() => { onClose(); onViewTask?.(task); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClose();
                onViewTask?.(task);
              }
            }}
          >
            <div className={cn(
              'w-8 h-8 rounded-xl flex items-center justify-center border flex-shrink-0',
              task.status === 'COMPLETED' ? 'bg-status-success/10 text-status-success border-status-success/20' :
              task.status === 'BLOCKED'   ? 'bg-status-danger/10 text-status-danger border-status-danger/20' :
              task.status === 'IN_PROGRESS'? 'bg-executive-blue/5 text-executive-blue border-executive-blue/10' :
              'bg-surface-border/20 text-text-muted border-surface-border'
            )}>
              {task.status === 'COMPLETED' ? <CheckCircle2 className="w-4 h-4 stroke-[1.3]" /> :
               task.status === 'BLOCKED'   ? <AlertTriangle className="w-4 h-4 stroke-[1.3]" /> :
               <Activity className="w-4 h-4 stroke-[1.3]" />}
            </div>
            <div className="flex flex-col flex-1 gap-1.5 min-w-0 items-start">
              <span className="text-body font-medium text-executive-blue tracking-tight line-clamp-1 font-display">{task.title}</span>
              <Badge variant={STATUS_BADGE_VARIANT[task.status] ?? 'default'}>
                {STATUS_LABELS[task.status] || task.status}
              </Badge>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className="text-micro text-text-tertiary uppercase tracking-caps hidden sm:block">
                {formatTimeAgo(task.updatedAt, task.status)}
              </span>
              <div className="w-7 h-7 rounded-full bg-surface-border/20 flex items-center justify-center group-hover:bg-executive-blue group-hover:text-[color:var(--executive-blue-text)] transition-all duration-300 opacity-0 group-hover:opacity-100">
                <ArrowRight className="w-3 h-3" />
              </div>
            </div>
          </div>
        ))
      ) : (
        <EmptyState
          dimIcon={false}
          className="border-none opacity-40"
          icon={<CheckCircle2 className="w-10 h-10 text-text-muted/50 stroke-[1]" />}
          message="Veri Bulunamadı"
        />
      )}
    </div>
  </Modal>
);
