import React from 'react';
import { Loader2, AlertTriangle, History, ArrowRight } from 'lucide-react';
import { AuditLog, User as UserType, TaskStatus } from '../../types';
import { STATUS_LABELS } from '../../constants';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Badge } from '../ui/Badge';
import { Avatar } from '../ui/Avatar';
import { EmptyState } from '../ui/EmptyState';
import { AUDIT_FIELD_LABELS, formatAuditValue } from '../../lib/auditLabels';

interface HistoryTabProps {
  loadingLogs: boolean;
  logsError: boolean;
  localLogs: AuditLog[];
  users: UserType[];
  onRetry: () => void;
}

export const HistoryTab = ({ loadingLogs, logsError, localLogs, users, onRetry }: HistoryTabProps) => (
  <div role="tabpanel" id="task-tabpanel-history" aria-labelledby="task-tab-history" className="flex flex-col gap-4">
    <h4 className="text-micro font-medium text-text-muted uppercase tracking-caps">Operasyonel Denetim İzleri</h4>
    <div className="flex flex-col gap-3">
      {loadingLogs ? (
        <div className="py-16 flex justify-center items-center">
          <Loader2 className="w-6 h-6 animate-spin text-executive-blue" />
        </div>
      ) : logsError ? (
        <div className="py-12 px-4 flex flex-col items-center justify-center gap-3 bg-status-danger/5 border border-dashed border-status-danger/20 rounded-2xl text-center">
          <AlertTriangle className="w-5 h-5 text-status-danger" aria-hidden="true" />
          <span className="text-micro text-status-danger font-medium uppercase tracking-caps">
            Denetim izleri yüklenemedi
          </span>
          <button
            onClick={onRetry}
            className="text-caption px-3 py-1.5 rounded-full text-executive-blue font-bold uppercase tracking-widest hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
          >
            Tekrar Dene
          </button>
        </div>
      ) : localLogs.length === 0 ? (
        <EmptyState icon={<History className="w-8 h-8" />} message="Denetim izi kaydı bulunamadı" />
      ) : (
        localLogs.map(log => {
          const actor = users.find(u => u.uid === log.changedBy || u.email === log.changedBy);
          const isSystemActor = log.changedBy?.startsWith('system:');
          const hasChanges = log.changes && Object.keys(log.changes).length > 0;
          return (
            <div key={log.id} className="flex gap-3 p-3 bg-makam-glass border border-surface-border rounded-xl">
              <div className="flex-shrink-0 pt-0.5">
                <Avatar
                  name={actor?.fullName ?? (isSystemActor ? 'Dizge' : log.changedBy) ?? 'Dizge'}
                  photoURL={actor?.photoURL}
                  size="sm"
                />
              </div>
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-body-sm font-medium text-text-heading">
                    {actor?.fullName || (isSystemActor ? 'Dizge' : log.changedBy) || 'Dizge'}
                  </span>
                  <span className="text-micro text-text-muted tabular-nums">
                    {format(log.timestamp, 'd MMM HH:mm', { locale: tr })}
                  </span>
                </div>
                {/* #7 - Field-level diff */}
                {hasChanges ? (
                  <div className="flex flex-col gap-1">
                    {Object.entries(log.changes!)
                      .filter(([field]) => field in AUDIT_FIELD_LABELS)
                      .map(([field, change]) => {
                      const label = AUDIT_FIELD_LABELS[field] ?? field;
                      return (
                        <div key={field} className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-micro font-medium text-text-tertiary uppercase tracking-caps bg-surface-glass px-1.5 py-0.5 rounded border border-surface-border">
                            {label}
                          </span>
                          <span className="text-micro text-status-danger/70 line-through">{formatAuditValue(field, change.old, users)}</span>
                          <ArrowRight className="w-2.5 h-2.5 text-text-tertiary flex-shrink-0" />
                          <span className="text-micro font-medium text-status-success">{formatAuditValue(field, change.new, users)}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Badge variant={
                    log.newValue === 'COMPLETED' ? 'success' :
                    log.newValue === 'BLOCKED' ? 'danger' :
                    log.newValue === 'IN_PROGRESS' ? 'info' :
                    log.newValue === 'AWAITING_APPROVAL' ? 'warning' :
                    'default'
                  }>
                    {STATUS_LABELS[log.newValue as TaskStatus] ?? String(log.newValue)}
                  </Badge>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  </div>
);
