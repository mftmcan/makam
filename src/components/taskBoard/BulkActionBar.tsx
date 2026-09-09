import { X } from 'lucide-react';
import type { TaskStatus, User } from '../../types';
import { STATUS_LABELS } from '../../constants';
import { Button } from '../ui/Button';

interface BulkActionBarProps {
  selectedCount: number;
  clearSelection: () => void;
  isBulkProcessing: boolean;
  commonStatus: TaskStatus | null;
  bulkStatusTarget: TaskStatus | '';
  setBulkStatusTarget: (value: TaskStatus | '') => void;
  bulkStatusOptions: TaskStatus[];
  handleBulkStatusButtonClick: () => void;
  canBulkReassign: boolean;
  bulkAssigneeTarget: string;
  setBulkAssigneeTarget: (value: string) => void;
  assignableUsers: User[];
  handleBulkReassignApply: () => void;
}

/**
 * Toplu işlem çubuğu (P2-18) — MobileDock (bottom-4, z-[60], lg:hidden) ile
 * çakışmasın diye mobilde bottom-24 (dock'un üstünde), lg:'de dock hiç
 * render edilmediği için bottom-6 kullanılır. Toast bölgesi (top-12, z-[150])
 * zaten ayrı bir köşede olduğundan onunla bir çakışma söz konusu değil.
 */
export function BulkActionBar({
  selectedCount, clearSelection, isBulkProcessing, commonStatus,
  bulkStatusTarget, setBulkStatusTarget, bulkStatusOptions, handleBulkStatusButtonClick,
  canBulkReassign, bulkAssigneeTarget, setBulkAssigneeTarget, assignableUsers, handleBulkReassignApply,
}: BulkActionBarProps) {
  return (
    <div
      role="region"
      aria-label="Toplu İşlem Çubuğu"
      className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-[55] w-[calc(100%-2rem)] max-w-md px-0"
    >
      <div className="flex flex-col gap-3 bg-makam-glass backdrop-blur-[30px] backdrop-saturate-[180%] border border-surface-border rounded-2xl shadow-[0_12px_40px_-10px_rgba(22,21,19,0.14),0_0_0_0.5px_rgba(22,21,19,0.04)] p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption font-semibold text-executive-blue uppercase tracking-label">
            {selectedCount} Talimat Seçildi
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
  );
}

