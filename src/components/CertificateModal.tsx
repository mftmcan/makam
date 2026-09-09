import React from 'react';
import { Task, User } from '../types';
import { FormalDocumentModal } from './ui/FormalDocumentModal';

interface CertificateModalProps {
  task: Task;
  assignee: User | undefined;
  onClose: () => void;
}

export const CertificateModal = ({ task, assignee, onClose }: CertificateModalProps) => (
  <FormalDocumentModal variant="certificate" onClose={onClose}>
    <p className="text-[14px] md:text-[16px] text-text-muted font-light font-display">Sayın,</p>
    <p className="text-2xl md:text-4xl font-light text-text-heading tracking-tight font-display border-b-2 border-executive-gold/10 pb-3 md:pb-4 w-fit mx-auto">
      {assignee?.fullName || 'Başarılı Personel'}
    </p>
    <p className="text-[14px] md:text-[15px] text-text-muted leading-relaxed max-w-lg mx-auto font-light">
      Yüksek sorumluluk bilinci ve üstün gayret ile icra edilen <br/>
      <span className="text-text-heading font-normal not-italic px-2 bg-executive-blue/5 rounded-lg border border-executive-blue/10">"{task.title}"</span> <br/>
      operasyonel sürecindeki başarınız işbu belge ile tescil edilmiştir.
    </p>
  </FormalDocumentModal>
);
