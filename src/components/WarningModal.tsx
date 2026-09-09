import React from 'react';
import { Task, User } from '../types';
import { FormalDocumentModal } from './ui/FormalDocumentModal';

interface WarningModalProps {
  task: Task;
  assignee: User | undefined;
  onClose: () => void;
}

export const WarningModal = ({ task, assignee, onClose }: WarningModalProps) => (
  <FormalDocumentModal variant="warning" onClose={onClose}>
    <p className="text-[14px] md:text-[16px] text-text-muted font-light font-display">İlgili Personel,</p>
    <p className="text-2xl md:text-4xl font-light text-text-heading tracking-tight font-display border-b-2 border-status-danger/10 pb-3 md:pb-4 w-fit mx-auto">
      {assignee?.fullName || 'İlgili Personel'}
    </p>
    <div className="flex flex-col gap-4 text-[14px] md:text-[15px] text-text-muted leading-relaxed max-w-lg mx-auto font-light text-left">
      <p>
        Tarafınıza verilen <span className="text-text-heading font-normal not-italic px-2 bg-status-danger/5 rounded-lg border border-status-danger/10 whitespace-nowrap">"{task.title}"</span> kodlu operasyonel sürecin, belirlenen süre içerisinde tamamlanamadığı görülmüştür. Kurum içi işleyiş ve hizmet standartları gereği bu durum, mevcut iş takip süreçlerimize bir bildirim olarak kaydedilmiştir.
      </p>
      <p>
        Gelecekteki planlamaların aksamaması için süreçlerin zamanında tamamlanmasına özen gösterilmesini rica eder, iyi çalışmalar dilerim.
      </p>
    </div>
  </FormalDocumentModal>
);
