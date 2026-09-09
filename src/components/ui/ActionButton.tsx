import React from 'react';
import { cn } from '../../lib/utils';

// components/settings/SharedUI.tsx içindeydi (bkz. tasarım denetimi) — ui/'a
// taşındı. ui/Button'dan BİLİNÇLİ olarak ayrı bir bileşen: Button her zaman
// bir <button>, ActionButton ise `htmlFor` verildiğinde tıklanabilir bir
// <label>'a dönüşebiliyor (ör. gizli bir dosya input'unu tetiklemek için) —
// bu, Button'ın API'sine polymorphic bir `as` prop'u eklemeden karşılanamayan
// gerçek bir davranış farkı, bu yüzden birleştirilmedi.
export interface ActionButtonProps {
  onClick?: () => void;
  label?: React.ReactNode;
  htmlFor?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'warning';
  disabled?: boolean;
  className?: string;
}

export const ActionButton = ({ onClick, label, htmlFor, variant = 'primary', disabled, className }: ActionButtonProps) => {
  const styles = {
    primary:   'bg-executive-gold text-[color:var(--btn-primary-text)] hover:bg-executive-gold-hover shadow-lg shadow-executive-gold/20',
    // text-executive-gold DEĞİL text-[color:var(--gold-text)]: bu iki varyant
    // dolgu değil, tint/glass zemin kullanıyor — düz altın metin aydınlık
    // modda ~2.1-2.5:1 kontrast veriyordu (bkz. ui/Badge.tsx aynı gerekçe).
    secondary: 'bg-makam-glass text-[color:var(--gold-text)] border border-executive-gold/[0.15] hover:bg-surface-elevated hover:shadow-sm',
    danger:    'bg-surface-elevated text-status-danger border border-status-danger/20 hover:bg-status-danger/10',
    warning:   'bg-executive-gold/10 text-[color:var(--gold-text)] border border-executive-gold/20 hover:bg-executive-gold/20',
  }[variant];

  const cls = cn(
    'flex items-center justify-center gap-2 px-4 h-9 rounded-xl text-micro font-medium uppercase tracking-caps',
    'transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2',
    styles, className
  );

  if (htmlFor) {
    return <label htmlFor={htmlFor} className={cn(cls, 'cursor-pointer')}>{label}</label>;
  }

  return (
    <button onClick={onClick} disabled={disabled} className={cls}>
      {label}
    </button>
  );
};
