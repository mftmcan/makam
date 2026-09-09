import { Bell, Smartphone, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { createAudioContext } from '../../lib/audio';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { logger } from '../../lib/logger';
import { useUIStore } from '../../store/uiStore';
import { SettingsCard } from '../ui/SettingsCard';
import { ActionButton } from '../ui/ActionButton';
import type { ImportStatus } from './DataTab';

interface GeneralTabProps {
  triggerToast?: (title: string, body: string, type?: 'info' | 'success' | 'warning' | 'danger') => void;
  setImportStatus: (status: ImportStatus | null) => void;
}

/** Genel & Görünüm sekmesi — bildirim/ses testi + PWA kurulumu. */
export function GeneralTab({ triggerToast, setImportStatus }: GeneralTabProps) {
  const soundEnabled = useUIStore((state) => state.soundEnabled);
  const setSoundEnabled = useUIStore((state) => state.setSoundEnabled);
  const { isInstallable, isInstalled, install } = usePWAInstall();

  const handleTestNotifications = async () => {
    // 1. Play the synthesis sound instantly
    try {
      const audioCtx = createAudioContext();
      if (!audioCtx) throw new Error('AudioContext desteklenmiyor');

      // Auto-resume context on click if suspended by browser autoplay policy
      if (audioCtx.state === 'suspended') {
        const resumeAudio = () => {
          audioCtx.resume();
          document.removeEventListener('click', resumeAudio);
        };
        document.addEventListener('click', resumeAudio);
      }

      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      const gain2 = audioCtx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(554.37, audioCtx.currentTime); // C#5 (Root tone)
      gain1.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 (Harmonic overtone)
      gain2.gain.setValueAtTime(0.03, audioCtx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);

      osc1.connect(gain1);
      osc2.connect(gain2);
      gain1.connect(audioCtx.destination);
      gain2.connect(audioCtx.destination);

      osc1.start();
      osc2.start();
      osc1.stop(audioCtx.currentTime + 0.8);
      osc2.stop(audioCtx.currentTime + 0.6);
    } catch {
      logger.warn('Audio feedback blocked by browser autoplay policy');
    }

    // 2. Trigger the In-App Toast visual notification
    if (triggerToast) {
      triggerToast(
        'BİLDİRİM TESTİ',
        'Makam ses ve yazılı bildirim sentezleyici motoru başarıyla test edildi.',
        'success'
      );
    }

    // 3. Try to trigger native browser notification if allowed
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Makam Kurumsal Bildirim', {
          body: 'Dizge arka plan ve yerel bildirim altyapısı aktiftir.',
          icon: '/favicon.ico'
        });
      } catch (err) {
        logger.warn('Native notification failed:', err);
      }
    } else {
      setImportStatus({
        type: 'success',
        message: 'Uygulama içi görsel ve sesli bildirim test edildi! Tarayıcı push izni etkin değil.'
      });
      setTimeout(() => setImportStatus(null), 5000);
    }
  };

  const handleInstallClick = async () => {
    const success = await install();
    if (success) {
      setImportStatus({ type: 'success', message: 'Uygulama başarıyla kuruluyor...' });
    } else {
      setImportStatus({ type: 'error', message: 'Yükleme başlatılamadı veya iptal edildi.' });
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

      {/* Notification and Audio System Test */}
      <SettingsCard title="Bildirim & Ses Testi" description="Akustik & görsel doğrulaması" icon={Bell} accentColor="amber" index={0}>
        <p className="text-caption text-text-muted font-light leading-relaxed">
          Dizge ses sentezleyici çanını ve yerel bildirim motorunun (In-App Toast ve PWA Push) çalışma durumunu anında test edin.
        </p>
        <div className="flex items-center justify-between gap-3 p-2.5 bg-surface-glass border border-surface-border rounded-xl">
          <span className="text-micro font-medium text-text-heading uppercase tracking-label">
            Bildirim Sesi
          </span>
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            role="switch"
            aria-checked={soundEnabled}
            aria-label="Bildirim sesini aç/kapat"
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2',
              soundEnabled ? 'bg-executive-blue' : 'bg-surface-border'
            )}
          >
            <span className={cn(
              'pointer-events-none inline-block h-4 w-4 rounded-full bg-surface-elevated shadow-sm ring-0 transition duration-300',
              soundEnabled ? 'translate-x-4' : 'translate-x-0'
            )} />
          </button>
        </div>
        <ActionButton
          variant="warning"
          onClick={handleTestNotifications}
          label={<><Bell className="w-3.5 h-3.5 stroke-[2]" />Bildirimleri Test Et</>}
        />
      </SettingsCard>

      {/* PWA Installation */}
      <SettingsCard title="Cihaza Yükle (PWA)" description="Masaüstü & Mobil Uygulama" icon={Smartphone} accentColor="gold" index={1}>
        <div className="flex flex-col gap-2.5">
          <p className="text-caption text-text-muted font-light leading-relaxed">
            MAKAM dizgesini bilgisayarınıza veya telefonunuza bağımsız bir uygulama olarak yükleyebilirsiniz. Bu sayede daha hızlı erişim sağlar ve tam ekran deneyimi yaşarsınız.
          </p>

          {isInstalled ? (
            <div className="flex items-center gap-2 p-2.5 bg-status-success/10 border border-status-success/20 rounded-xl">
              <CheckCircle2 className="w-3.5 h-3.5 text-status-success flex-shrink-0" />
              <span className="text-micro text-status-success font-medium uppercase tracking-caps">
                Uygulama zaten yüklü ve aktif!
              </span>
            </div>
          ) : isInstallable ? (
            <ActionButton
              variant="primary"
              onClick={handleInstallClick}
              label={<><Smartphone className="w-3.5 h-3.5 stroke-[2]" />Uygulamayı Şimdi Yükle</>}
            />
          ) : (
            <div className="flex flex-col gap-2 p-3 bg-surface-glass border border-surface-border rounded-xl text-micro text-text-muted font-normal leading-relaxed">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-[color:var(--gold-text)] flex-shrink-0 mt-0.5 animate-pulse" />
                <div>
                  <span className="font-semibold text-text-heading block mb-0.5">Yükleme Kılavuzu</span>
                  <span>Tarayıcınız otomatik yükleme butonunu şu an desteklemiyor olabilir. Alternatif yükleme adımları:</span>
                </div>
              </div>
              <div className="h-px bg-executive-blue/[0.04] my-1" />
              <ul className="list-disc pl-4 flex flex-col gap-1 text-micro text-text-tertiary">
                <li><strong>iOS (iPhone/iPad):</strong> Safari tarayıcısında alt menüdeki <span className="text-text-muted font-semibold">Paylaş</span> butonuna tıklayıp, gelen menüden <span className="text-text-muted font-semibold">"Ana Ekrana Ekle"</span> seçeneğini seçin.</li>
                <li><strong>Android (Chrome):</strong> Sağ üstteki üç noktaya tıklayıp <span className="text-text-muted font-semibold">"Uygulamayı yükle"</span> veya <span className="text-text-muted font-semibold">"Ana ekrana ekle"</span> seçeneğini seçin.</li>
                <li><strong>Masaüstü (Chrome/Edge):</strong> Adres çubuğunun sağ tarafındaki <span className="text-text-muted font-semibold">"Yükle" (küçük monitör/ok)</span> simgesine tıklayın.</li>
              </ul>
            </div>
          )}
        </div>
      </SettingsCard>

    </div>
  );
}
