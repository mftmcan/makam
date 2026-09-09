import React from 'react';
import { cn } from '../../lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'gold' | 'success' | 'warning';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading, children, ...props }, ref) => {
    const variants = {
      primary: 'makam-button-primary',
      secondary: 'makam-button-secondary',
      // Tema-duyarlı: status-danger/status-success token'ları .dark altında
      // otomatik olarak daha açık bir tona geçer (bkz. index.css)
      danger: 'bg-status-danger/10 text-status-danger hover:bg-status-danger/15 border border-status-danger/20 shadow-sm',
      ghost: 'bg-transparent hover:bg-executive-blue/[0.02] text-text-muted hover:text-executive-blue border-transparent',
      // text-white yerine tema-duyarlı token'lar kullanılır: altın zemin
      // (--color-executive-gold) her iki temada da AYNI kalır ama light modda
      // sabit beyaz metin ~2.5:1 kontrast verirdi (bkz. .makam-button-primary'nin
      // kullandığı --btn-primary-text); success zemini ise dark modda pastel bir
      // tona (#34D399) döndüğünden sabit beyaz orada ~1.92:1'e düşerdi (bkz.
      // --status-success-text). İkisi de index.css'te AA-uyumlu tanımlı.
      gold: 'bg-executive-gold text-[color:var(--btn-primary-text)] hover:bg-executive-gold-hover shadow-lg shadow-executive-gold/20',
      success: 'bg-status-success text-[color:var(--status-success-text)] hover:opacity-90 shadow-lg shadow-status-success/10',
      // ui/ActionButton'ın 'warning' varyantıyla aynı ton — Button'da eskiden
      // yoktu (bkz. tasarım denetimi: ActionButton'ın taşınma vesilesiyle
      // eklendi, gelecekte iki ayrı bileşen yerine tek noktadan kullanılabilsin).
      // text-executive-gold DEĞİL text-[color:var(--gold-text)]: tint zemin
      // üzerinde düz altın metin AA'yı ihlal ediyordu (bkz. ui/Badge.tsx).
      warning: 'bg-executive-gold/10 text-[color:var(--gold-text)] border border-executive-gold/20 hover:bg-executive-gold/20',
    };

    // Üçü de tracking-caps'e sabit: eskiden sm=0.2em/md=0.3em/lg=0.18em idi —
    // lg, md'den DAHA DAR harf aralığına sahipti (ters sıralama, sürüklenme
    // — bkz. tracking ölçeği denetimi).
    const sizes = {
      sm: 'px-5 py-2.5 text-micro tracking-caps',
      md: 'px-8 py-4 text-caption tracking-caps',
      lg: 'px-12 py-5 text-body tracking-caps',
    };

    return (
      <button
        ref={ref}
        className={cn(
          'makam-button inline-flex items-center justify-center gap-3 transition-all duration-500 rounded-full',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2',
          variants[variant],
          sizes[size],
          (isLoading || props.disabled) && 'opacity-60 cursor-not-allowed',
          className
        )}
        disabled={isLoading || props.disabled}
        aria-busy={isLoading ? true : undefined}
        aria-disabled={isLoading || props.disabled ? true : undefined}
        {...props}
      >
        {isLoading && (
          <svg
            className="animate-spin h-4 w-4 text-current"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);
