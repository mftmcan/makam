import { Target, Info } from 'lucide-react';
import { motion } from 'motion/react';
import { Tooltip as InfoTooltip } from '../ui/Tooltip';
import { SPRING_PANEL } from '../../lib/motion';
import { cn, formatTime } from '../../lib/utils';

interface HealthIndexBannerProps {
  healthScore: number;
  completionRatePercent: number;
  slaCompliancePercent: number;
  isPersonalView: boolean;
  /** Canlı SLA sayacının tazelendiği an — yalnızca "Canlı · HH:mm" göstergesi
   *  için, ek bir okuma tetiklemez (bkz. Dashboard.tsx tick state'i). */
  tick: number;
}

/** ── Stratejik Sağlık Endeksi Banner ──────────────────────────────────────
 *  Dashboard.tsx'ten ayrıştırıldı (bkz. kod denetimi — dosya bölme): saf
 *  sunum, kendi state'i yok. */
export const HealthIndexBanner = ({ healthScore, completionRatePercent, slaCompliancePercent, isPersonalView, tick }: HealthIndexBannerProps) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ ...SPRING_PANEL }}
    className="relative overflow-hidden p-5 rounded-3xl bg-makam-glass backdrop-blur-xl border border-surface-border shadow-md flex flex-col md:flex-row items-center justify-between gap-6"
  >
    {/* Ambient backglow matching health score state */}
    <div className={cn(
      "absolute -inset-10 opacity-30 blur-3xl pointer-events-none transition-all duration-1000",
      healthScore >= 80 ? "bg-status-success/[0.035]" :
      healthScore >= 50 ? "bg-status-warning/[0.04]" :
      "bg-status-danger/[0.04]"
    )} />

    <div className="relative z-10 flex items-center gap-4">
      <div className={cn(
        "w-12 h-12 rounded-2xl flex items-center justify-center border shadow-inner flex-shrink-0",
        healthScore >= 80 ? "bg-status-success/10 text-status-success border-status-success/20" :
        healthScore >= 50 ? "bg-status-warning/10 text-status-warning border-status-warning/20" :
        "bg-status-danger/10 text-status-danger border-status-danger/20"
      )}>
        <Target className="w-6 h-6 stroke-[1.2]" />
      </div>
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-body font-medium text-executive-blue tracking-tight font-display">Stratejik Sağlık Endeksi</h3>
          {/* Veri tazeliği göstergesi — tick state'inden türetilir, ek okuma yok */}
          <InfoTooltip content="Veriler canlı olarak izlenir; sayaçlar her dakika tazelenir." side="bottom">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-status-success/25 bg-status-success/10 text-status-success text-micro font-semibold uppercase tracking-label tabular-nums">
              <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" aria-hidden="true" />
              Canlı · {formatTime(tick)}
            </span>
          </InfoTooltip>
        </div>
        <p className="text-micro text-text-tertiary uppercase tracking-eyebrow mt-0.5">
          {isPersonalView ? 'Kişisel Performans & İcra Düzeyi' : 'Organizasyonel Performans & İcra Düzeyi'}
        </p>
      </div>
    </div>

    <div className="relative z-10 flex items-center gap-8 justify-between w-full md:w-auto">
      <div className="flex flex-col items-start md:items-end gap-1">
        <span className="text-micro text-text-tertiary uppercase tracking-caps font-medium">Dizge Durumu</span>
        <div className="flex items-center gap-2">
          <span className={cn(
            "w-2 h-2 rounded-full",
            healthScore >= 80 ? "bg-status-success shadow-[0_0_8px_var(--color-status-success)]" :
            healthScore >= 50 ? "bg-status-warning shadow-[0_0_8px_var(--color-status-warning)]" :
            "bg-status-danger shadow-[0_0_8px_var(--color-status-danger)]"
          )} />
          <span className={cn(
            "text-micro font-bold uppercase tracking-widest",
            // NOT: Semantik status token'ları kullanılır — light modda AA-uyumlu
            // koyu tonlar (#047857/#B45309/#DC2626), dark modda pastel tonlar.
            // (Eski emerald/amber-700 + dark: çifti aynı değerlere denk geliyordu.)
            healthScore >= 80 ? "text-status-success" :
            healthScore >= 50 ? "text-status-warning" :
            "text-status-danger"
          )}>
            {healthScore >= 80 ? "STABİL / GÜVENLİ" :
             healthScore >= 50 ? "GÖZETİM ALTINDA" :
             "ACİL PROTOKOL"}
           </span>
        </div>
        {/* Sub-metrics transparency indicators */}
        <div className="flex gap-2.5 text-micro text-text-tertiary font-bold uppercase mt-1">
          <span>İcra: %{completionRatePercent}</span>
          <span>SLA: %{slaCompliancePercent}</span>
        </div>
      </div>

      <div className="h-10 w-[1px] bg-executive-blue/10 hidden md:block" />

      <div className="flex items-center gap-3">
        <div className="flex flex-col items-center">
          {/* 24px'ten 32px'e büyütüldü — StatCard rakamlarıyla (20-22px)
              arasında sayfadaki EN önemli tekil metrik olduğunu belirgin
              kılan bir punto farkı yoktu (bkz. kod denetimi). */}
          <span className="text-[32px] font-display font-medium text-executive-blue tracking-tight tabular-nums leading-none">
            {healthScore}%
          </span>
          <InfoTooltip content="Hesap yöntemi: İcra Oranı (%60 ağırlık) + SLA Uyumu (%40 ağırlık). Lağvedilen görevler hesaba katılmaz." side="bottom">
            <span className="flex items-center gap-1 text-micro text-text-tertiary uppercase tracking-caps mt-1 cursor-help">
              SAĞLIK SKORU
              <Info className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
            </span>
          </InfoTooltip>
        </div>
      </div>
    </div>
  </motion.div>
);
