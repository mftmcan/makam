import React from 'react';
import { cn } from '../../lib/utils';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';
  withPulse?: boolean;
  icon?: React.ReactNode;
}

export const Badge = ({ 
  variant = 'default', 
  className, 
  children, 
  withPulse = false,
  icon,
  ...props 
}: BadgeProps) => {
  // whitespace-nowrap: uzun etiketler (ör. "İCRA AŞAMASINDA", "YETKİ DEVRİ
  // BEKLENİYOR") dar konteynerlerde çift satıra sarılıp rozeti diğer
  // modüllerdeki tek satırlık rozetlerden görsel olarak farklı bir bileşen
  // gibi gösteriyordu (bkz. kod denetimi) — rozetler artık her zaman tek
  // satır, gerekirse konteynerini taşırarak.
  const baseStyle = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-micro font-medium uppercase tracking-caps shadow-sm backdrop-blur-xl transition-all duration-300 select-none whitespace-nowrap';

  // Glow renkleri eskiden hardcoded rgb literalleriydi (ör. success:
  // rgba(16,185,129,…) = emerald-500) — --status-success'ın gerçek AA
  // token değerinden (light #047857, dark #34D399) her iki temada da
  // SAPMIŞTI, karanlık modda rozetler "kirli" bir halo ile basıyordu (bkz.
  // tasarım denetimi). color-mix ile gerçek token rengine bağlandı; iç
  // parlaklık --shadow-badge-inset ile 4 varyantta tekilleşti.
  const variants = {
    default: 'bg-makam-glass border-text-muted/20 text-text-muted shadow-[var(--shadow-badge-inset)]',
    success: 'bg-status-success/[0.04] border-status-success/25 text-status-success shadow-[0_4px_16px_color-mix(in_oklab,var(--color-status-success)_14%,transparent),var(--shadow-badge-inset)]',
    // text-executive-gold DEĞİL text-[color:var(--gold-text)]: aydınlık modda
    // #C5A059 metin, kart zeminine karşı ~2.1-2.5:1 kontrast veriyordu (WCAG AA
    // eşiği 4.5:1'in altında) — index.css'te tam bu senaryo için tanımlı
    // --gold-text (#78350F) token'ı burada kullanılmıyordu (bkz. kod denetimi).
    // Karanlık modda --gold-text zaten standart altın tonun (#C5A059) kendisi
    // olduğundan görsel bir değişiklik yaratmaz.
    warning: 'bg-executive-gold/[0.06] border-executive-gold/30 text-[color:var(--gold-text)] shadow-[0_4px_16px_color-mix(in_oklab,var(--color-executive-gold)_14%,transparent),var(--shadow-badge-inset)]',
    danger: 'bg-gradient-to-br from-status-danger/20 via-status-danger/5 to-transparent border-status-danger/30 text-status-danger shadow-[0_4px_20px_color-mix(in_oklab,var(--color-status-danger)_20%,transparent),inset_0_1px_1.5px_rgba(255,255,255,0.06)]',
    info: 'bg-status-info/[0.04] border-status-info/20 text-status-info shadow-[0_4px_16px_color-mix(in_oklab,var(--color-status-info)_14%,transparent),var(--shadow-badge-inset)]',
    primary: 'bg-executive-blue/[0.05] border-executive-blue/15 text-executive-blue shadow-[var(--shadow-badge-inset)]',
  };

  return (
    <span
      className={cn(baseStyle, variants[variant], className)}
      {...props}
    >
      {/* Organic Pulsing Core */}
      {withPulse && (
        <span className="relative flex h-1.5 w-1.5 mr-0.5">
          <span className={cn(
            "animate-ping absolute inline-flex h-full w-full rounded-full opacity-60",
            variant === 'danger' ? "bg-status-danger" :
            variant === 'warning' ? "bg-executive-gold" :
            variant === 'success' ? "bg-status-success" : "bg-status-info"
          )} />
          <span className={cn(
            "relative inline-flex rounded-full h-1.5 w-1.5",
            variant === 'danger' ? "bg-status-danger shadow-[0_0_6px_var(--color-status-danger)]" :
            variant === 'warning' ? "bg-executive-gold shadow-[0_0_6px_var(--color-executive-gold)]" :
            variant === 'success' ? "bg-status-success shadow-[0_0_6px_var(--color-status-success)]" :
            "bg-status-info shadow-[0_0_6px_var(--color-status-info)]"
          )} />
        </span>
      )}
      
      {icon && <span className="flex-shrink-0 opacity-80 flex items-center justify-center">{icon}</span>}
      <span className="leading-none">{children}</span>
    </span>
  );
};
