import type { Task, User } from '../../types';
import { CertificateModal } from '../CertificateModal';
import { WarningModal } from '../WarningModal';

interface TaskDocumentModalsProps {
  users: User[];
  certificateTask: Task | null;
  onCloseCertificate: () => void;
  warningTask: Task | null;
  onCloseWarning: () => void;
}

/** ── Liyakat/İkaz Belgesi Modalları ────────────────────────────────────────
 *  AuthenticatedApp.tsx'ten ayrıştırıldı (bkz. kod denetimi — dosya bölme).
 *  Görev Detayı modalının DIŞINDA, bağımsız olarak açılırlar (bkz.
 *  TaskDetails.tsx'teki onShowCertificate/onShowWarning). */
export const TaskDocumentModals = ({ users, certificateTask, onCloseCertificate, warningTask, onCloseWarning }: TaskDocumentModalsProps) => (
  <>
    {certificateTask && (
      <CertificateModal
        task={certificateTask}
        assignee={users.find(u => u.uid === certificateTask.assigneeId || u.email === certificateTask.assigneeId)}
        onClose={onCloseCertificate}
      />
    )}

    {warningTask && (
      <WarningModal
        task={warningTask}
        assignee={users.find(u => u.uid === warningTask.assigneeId || u.email === warningTask.assigneeId)}
        onClose={onCloseWarning}
      />
    )}
  </>
);
