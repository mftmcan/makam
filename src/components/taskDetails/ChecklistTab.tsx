import React from 'react';
import { ListChecks, Trash2, Plus } from 'lucide-react';
import { Task } from '../../types';
import { cn } from '../../lib/utils';
import { EmptyState } from '../ui/EmptyState';
import type { ChecklistStats } from './helpers';

interface ChecklistTabProps {
  task: Task;
  checklistStats: ChecklistStats;
  isSubmittingChecklist: boolean;
  newChecklistItem: string;
  setNewChecklistItem: (value: string) => void;
  onAddChecklistItem: (e: React.FormEvent) => void;
  onToggleChecklistItem: (itemId: string) => void;
  onDeleteChecklistItem: (itemId: string) => void;
  canEditChecklist: boolean;
}

export const ChecklistTab = ({
  task, checklistStats, isSubmittingChecklist, newChecklistItem, setNewChecklistItem,
  onAddChecklistItem, onToggleChecklistItem, onDeleteChecklistItem, canEditChecklist,
}: ChecklistTabProps) => (
  <div role="tabpanel" id="task-tabpanel-checklist" aria-labelledby="task-tab-checklist" className="flex flex-col gap-5">
    {/* #8 - Alt Talimat / Alt İşlem ayrımı ipucu */}
    <p className="text-caption text-text-muted font-light leading-relaxed">
      Alt işlemler bu talimata bağlı kendi kontrol listenizdir — başkasına devredilmez, ayrı bir talimat oluşturmaz.
    </p>
    {/* Progress bar info */}
    <div className="flex flex-col gap-2.5 p-4 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl">
      <div className="flex justify-between items-center text-micro uppercase tracking-wider font-bold">
        <span className="text-text-muted">Alt İşlemler İlerlemesi</span>
        <span className="text-executive-blue">
          {checklistStats.percent}% ({checklistStats.completed} / {checklistStats.total})
        </span>
      </div>
      <div className="w-full h-2 bg-executive-blue/5 rounded-full overflow-hidden">
        <div
          className="h-full bg-status-success transition-all duration-300 rounded-full"
          style={{ width: `${checklistStats.percent}%` }}
        />
      </div>
    </div>

    {/* Checklist items list */}
    <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto custom-scrollbar">
      {(!task.checklist || task.checklist.length === 0) ? (
        <EmptyState icon={<ListChecks className="w-8 h-8" />} message="Henüz bir alt işlem eklenmemiş" />
      ) : (
        task.checklist.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between p-3.5 bg-makam-glass border border-surface-border rounded-xl group/item hover:bg-surface-elevated transition-all"
          >
            <label className="flex items-center gap-3 cursor-pointer flex-1 min-w-0">
              <input
                type="checkbox"
                checked={item.isCompleted}
                onChange={() => onToggleChecklistItem(item.id)}
                disabled={isSubmittingChecklist}
                className="w-4 h-4 rounded accent-status-success cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <span className={cn(
                "text-body-sm font-medium leading-snug tracking-tight truncate",
                item.isCompleted ? "line-through text-text-muted opacity-60" : "text-text-heading"
              )}>
                {item.text}
              </span>
            </label>

            {canEditChecklist && (
              <button
                onClick={() => onDeleteChecklistItem(item.id)}
                disabled={isSubmittingChecklist}
                className="w-7 h-7 flex items-center justify-center text-text-tertiary hover:text-status-danger hover:bg-status-danger/10 rounded-md opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger disabled:opacity-30 disabled:cursor-not-allowed"
                title="Alt İşlemi Sil"
                aria-label="Alt işlemi sil"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        ))
      )}
    </div>

    {/* Checklist Add Form */}
    {canEditChecklist && (
      <form onSubmit={onAddChecklistItem} className="flex gap-2 pt-4 border-t border-makam-border/5">
        <label htmlFor="checklist-item-input" className="sr-only">Yeni alt işlem</label>
        <input
          id="checklist-item-input"
          type="text"
          value={newChecklistItem}
          onChange={(e) => setNewChecklistItem(e.target.value)}
          placeholder="Yeni bir alt işlem yazın..."
          disabled={isSubmittingChecklist}
          className="flex-1 bg-makam-glass border border-makam-border/10 rounded-xl px-4 py-2 text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue/15 disabled:opacity-60"
          required
        />
        <button
          type="submit"
          disabled={!newChecklistItem.trim() || isSubmittingChecklist}
          className="px-4 py-2 bg-executive-blue text-[color:var(--executive-blue-text)] rounded-xl flex items-center gap-1 text-caption font-bold uppercase tracking-wider hover:bg-executive-blue/90 disabled:opacity-50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Ekle
        </button>
      </form>
    )}
  </div>
);
