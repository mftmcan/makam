import React from 'react';
import { Plus, ChevronRight, Layers } from 'lucide-react';
import { Task } from '../../types';
import { STATUS_LABELS } from '../../constants';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';

interface SubtasksTabProps {
  task: Task;
  subtasks: Task[];
  onAddSubTask: (parentId: string, title: string) => void;
  onViewTask: (task: Task) => void;
}

export const SubtasksTab = ({ task, subtasks, onAddSubTask, onViewTask }: SubtasksTabProps) => (
  <div role="tabpanel" id="task-tabpanel-subtasks" aria-labelledby="task-tab-subtasks" className="flex flex-col gap-6">
    {/* #8 - Alt Talimat / Alt İşlem ayrımı ipucu */}
    <p className="text-caption text-text-muted font-light leading-relaxed">
      Alt talimatlar, ayrı bir sorumluya atanabilen; kendi durumu ve süresi olan bağımsız talimatlardır.
    </p>
    <div className="flex items-center justify-between">
      <h4 className="text-micro font-medium text-text-muted uppercase tracking-[0.18em]">Operasyonel Alt Birimler</h4>
      <Button
        variant="gold"
        size="sm"
        onClick={() => onAddSubTask(task.id, '')}
        className="gap-2 tracking-widest"
      >
        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        Yeni Alt Talimat
      </Button>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {subtasks.length === 0 ? (
        <EmptyState className="md:col-span-2" icon={<Layers className="w-8 h-8" />} message="Alt talimat bulunamadı" />
      ) : (
        subtasks.map(sub => (
          <div
            key={sub.id}
            role="button"
            tabIndex={0}
            aria-label={sub.title}
            onClick={() => onViewTask(sub)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onViewTask(sub);
              }
            }}
            className="flex items-center justify-between p-3 bg-makam-glass border border-surface-border rounded-xl group cursor-pointer hover:bg-makam-card hover:shadow-sm transition-all"
          >
            <div className="flex flex-col gap-1">
              <span className="text-body font-medium text-text-heading group-hover:text-executive-blue transition-colors">{sub.title}</span>
              <span className="text-micro text-text-muted uppercase tracking-widest">{STATUS_LABELS[sub.status]}</span>
            </div>
            <ChevronRight className="w-4 h-4 text-text-muted/20 group-hover:text-executive-blue group-hover:translate-x-1 transition-all" />
          </div>
        ))
      )}
    </div>
  </div>
);
