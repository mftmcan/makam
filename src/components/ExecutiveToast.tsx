import React, { useEffect, useRef } from 'react';
import { X, Info, CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { createAudioContext } from '../lib/audio';
import { motion, useAnimationControls } from 'motion/react';
import { useUIStore } from '../store/uiStore';

const TOAST_DURATION_MS = 6000;

export interface ToastData {
  id: string;
  title: string;
  body: string;
  taskId?: string;
  type?: 'info' | 'success' | 'warning' | 'danger';
  onClick?: () => void;
}

interface ExecutiveToastProps {
  toast: ToastData;
  onClose: (id: string) => void;
  onClick: (taskId?: string) => void;
}

export const ExecutiveToast: React.FC<ExecutiveToastProps> = ({ toast, onClose, onClick }) => {
  const soundEnabled = useUIStore((state) => state.soundEnabled);

  const handleToastClick = () => {
    if (toast.onClick) {
      toast.onClick();
    } else {
      onClick(toast.taskId);
    }
  };

  const progressControls = useAnimationControls();
  const remainingRef = useRef(TOAST_DURATION_MS);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startTimer = (duration: number) => {
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => onClose(toast.id), duration);
    void progressControls.start({ width: '0%' }, { duration: duration / 1000, ease: 'linear' });
  };

  const pauseTimer = () => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    remainingRef.current = Math.max(remainingRef.current - (Date.now() - startedAtRef.current), 0);
    progressControls.stop();
  };

  const resumeTimer = () => {
    if (timerRef.current !== null) return;
    if (remainingRef.current <= 0) {
      onClose(toast.id);
      return;
    }
    startTimer(remainingRef.current);
  };

  useEffect(() => {
    // Her toast'ta yeni bir AudioContext açılıp hiç kapatılmıyordu — art arda
    // gelen bildirimlerde (ki bu ekranın asıl senaryosu: kriz bildirimleri)
    // tarayıcının sekme başına eşzamanlı AudioContext sınırına (Chrome'da
    // tarihsel olarak ~6) çarpılıp yenilerinin sessizce başlayamaması veya
    // bellek sızıntısı riski vardı (bkz. kod denetimi). Ses bittiğinde
    // (onended) VE toast beklenenden erken kapatılırsa (cleanup) context
    // kapatılır — ikisi de tetiklenirse close() ikinci çağrıda hata
    // fırlatabilir, bu yüzden sessizce yutulur.
    let audioCtx: AudioContext | null = null;
    if (soundEnabled) {
      try {
        audioCtx = createAudioContext();
        if (!audioCtx) throw new Error('AudioContext desteklenmiyor');
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
        gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.4);
        oscillator.onended = () => { audioCtx?.close().catch(() => {}); };
      } catch {
        console.warn('Audio feedback blocked');
      }
    }

    startTimer(TOAST_DURATION_MS);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      audioCtx?.close().catch(() => {});
    };
  }, [toast.id, onClose]);

  const icons = {
    info: <Info className="h-5 w-5 stroke-[1.2]" />,
    success: <CheckCircle2 className="h-5 w-5 stroke-[1.2]" />,
    warning: <AlertTriangle className="h-5 w-5 stroke-[1.2]" />,
    danger: <AlertCircle className="h-5 w-5 stroke-[1.2]" />,
  };

  const typeStyles = {
    info: "text-executive-blue bg-executive-blue/5 border-executive-blue/10",
    success: "text-status-success bg-status-success/[0.06] border-status-success/20",
    warning: "text-status-warning bg-status-warning/[0.06] border-status-warning/20",
    danger: "text-status-danger bg-status-danger/[0.06] border-status-danger/20",
  };

  return (
    <div
      role="alert"
      aria-live={toast.type === 'danger' ? 'assertive' : 'polite'}
      aria-atomic="true"
      tabIndex={0}
      className={cn(
        "pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl shadow-2xl",
        "bg-makam-glass backdrop-blur-[40px] border border-surface-border",
        "transform transition-all duration-700 ease-in-out",
        "animate-in slide-in-from-right-8 fade-in-0",
        "hover:bg-makam-glass cursor-pointer group",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
      )}
      onClick={handleToastClick}
      onKeyDown={(e) => {
        // e.target === e.currentTarget: alttaki "kapat" butonuna Enter/Space
        // basılınca native click sentezlenip yukarı köpüren keydown, buradan
        // tekrar handleToastClick tetiklemesin (aynı anda hem kapatıp hem
        // göreve gitmesin) — yalnızca doğrudan bu div odaktayken tetiklenir.
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          handleToastClick();
        }
      }}
      onMouseEnter={pauseTimer}
      onMouseLeave={resumeTimer}
      onFocus={pauseTimer}
      onBlur={(e) => {
        // Odak toast içindeki başka bir elemana (ör. kapat butonuna) taşınıyorsa
        // hâlâ toast'la etkileşimdeyiz demektir — yalnızca odak tamamen dışarı
        // çıktığında zamanlayıcıyı devam ettir.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          resumeTimer();
        }
      }}
    >
      <div className="p-6">
        <div className="flex items-start gap-5">
          <div className="flex-shrink-0" aria-hidden="true">
            <div className={cn(
              "h-10 w-10 rounded-2xl flex items-center justify-center border shadow-inner transition-transform group-hover:rotate-3",
              typeStyles[toast.type || 'info']
            )}>
              {icons[toast.type || 'info']}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-caption font-medium text-text-heading uppercase tracking-[0.2em] font-serif">
              {toast.title}
            </p>
            <p className="mt-1 text-body font-light text-text-muted leading-relaxed">
              {toast.body}
            </p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose(toast.id);
            }}
            aria-label="Bildirimi kapat"
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-xl text-text-muted/30 hover:text-status-danger hover:bg-status-danger/10 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger"
          >
            <X className="h-5 w-5 stroke-[1.2]" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="h-1 w-full bg-makam-border/5">
        <motion.div
          initial={{ width: "100%" }}
          animate={progressControls}
          className={cn(
            "h-full bg-gradient-to-r",
            toast.type === 'danger' ? "from-status-danger to-status-danger/40" : "from-executive-blue to-executive-gold"
          )}
        />
      </div>
    </div>
  );
};
