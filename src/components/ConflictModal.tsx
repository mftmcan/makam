import { AlertTriangle } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { STATUS_LABELS } from '../constants';
import type { ConflictInfo } from '../services/conflictDetectionService';
import type { Task } from '../types';

interface ConflictModalProps {
  info: ConflictInfo | null;
  onClose: () => void;
  /** taskId ile tasksRef.current'tan bulunan EN GÜNCEL yerel kopya — Firestore'un
   *  onSnapshot dinleyicisi çakışmaya neden olan sunucu yazımını zaten
   *  bindirmiş olmalı, bu yüzden pratikte "sunucudaki mevcut durum"u temsil eder. */
  currentTask?: Task;
}

/**
 * Optimistic locking çakışması (VERSION_MISMATCH) yakalandığında gösterilir —
 * eskiden yalnızca "sayfayı yenileyin" diyen bir toast vardı, kullanıcının
 * denediği değişiklik sessizce kayboluyordu (bkz. tasarım denetimi F7).
 */
export function ConflictModal({ info, onClose, currentTask }: ConflictModalProps) {
  return (
    <Modal isOpen={!!info} onClose={onClose} title="Düzenleme Çakışması">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-status-warning flex-shrink-0 mt-0.5" />
          <p className="text-body text-text-muted font-light leading-relaxed">
            <strong className="text-text-heading font-medium">{info?.taskTitle}</strong> talimatı siz düzenlerken başka
            bir kullanıcı tarafından değiştirildi. Aşağıdan hangi değişikliğin geçerli olacağını seçin.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 p-3 bg-executive-blue/[0.03] border border-executive-blue/10 rounded-xl">
            <span className="text-micro font-medium text-text-tertiary uppercase tracking-caps">Sizin Değişikliğiniz</span>
            <span className="text-body-sm font-medium text-executive-blue text-right">{info?.attemptedChangeSummary}</span>
          </div>
          <div className="flex items-center justify-between gap-3 p-3 bg-status-success/[0.04] border border-status-success/15 rounded-xl">
            <span className="text-micro font-medium text-text-tertiary uppercase tracking-caps">Güncel (Sunucudaki) Durum</span>
            <span className="text-body-sm font-medium text-status-success text-right">
              {currentTask ? STATUS_LABELS[currentTask.status] : 'Bilinmiyor'}
            </span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
          <Button variant="secondary" onClick={onClose}>
            Sunucudakini Al
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              info?.retry();
              onClose();
            }}
          >
            Benimkini Uygula
          </Button>
        </div>
      </div>
    </Modal>
  );
}
