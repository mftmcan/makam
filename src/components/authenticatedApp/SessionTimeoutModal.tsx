import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface SessionTimeoutModalProps {
  isOpen: boolean;
  remainingMs: number;
  onContinue: () => void;
  onLogout: () => Promise<void>;
}

/** ── Oturum Zaman Aşımı Uyarısı ────────────────────────────────────────────
 *  AuthenticatedApp.tsx'ten ayrıştırıldı (bkz. kod denetimi — dosya bölme).
 *  Kapanmadan ~60sn önce görünür. onClose olarak `onContinue` verilir:
 *  Escape/arka plan tıklaması da AÇIK bir kullanıcı eylemidir, oturumu
 *  uzatmalıdır. Aksi halde modal kapanır ama sayaç işlemeye devam eder ve
 *  kullanıcı hiçbir uyarı görmeden saniyeler içinde dışarı atılırdı. */
export const SessionTimeoutModal = ({ isOpen, remainingMs, onContinue, onLogout }: SessionTimeoutModalProps) => (
  <Modal
    isOpen={isOpen}
    onClose={onContinue}
    title="Oturum Sonlanmak Üzere"
    size="sm"
  >
    <div className="flex flex-col gap-4">
      <p className="text-body text-text-muted font-light leading-relaxed">
        Uzun süredir işlem yapılmadığı için oturumunuz{' '}
        <strong className="text-status-danger font-medium" aria-live="polite">
          {Math.ceil(remainingMs / 1000)} saniye
        </strong>{' '}
        içinde güvenlik gereği kapatılacaktır. Çalışmaya devam etmek için aşağıdaki
        butonu kullanın.
      </p>
      <div className="flex justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
        <Button variant="secondary" onClick={() => { void onLogout(); }}>Şimdi Çıkış Yap</Button>
        <Button variant="primary" onClick={onContinue}>Devam Et</Button>
      </div>
    </div>
  </Modal>
);
