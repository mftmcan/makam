import React from 'react';
import { cn } from '../../lib/utils';

interface EmptyStateProps {
  /** Opsiyonel ikon (ör. <ListChecks className="w-8 h-8" />) */
  icon?: React.ReactNode;
  message: React.ReactNode;
  /** Opsiyonel aksiyon (buton/link) */
  action?: React.ReactNode;
  className?: string;
  /**
   * 'lg' (varsayılan) — sekme içi büyük boş alan: py-16, kesikli çerçeve,
   * ikon soluklaştırılır (dimIcon).
   * 'sm' — bir panel/liste İÇİNDEKİ küçük boş durum: py-10, kesikli çerçeve
   * + dolgu zemin, ikon kendi rengini korur (bkz. Dashboard müdahale
   * kuyruğu/yük matrisi — tasarım denetimi F22).
   */
  size?: 'sm' | 'lg';
  /**
   * İkonu component'in kendisi mi soluklaştırsın (varsayılan `true`) yoksa
   * çağıranın verdiği ikon zaten kendi anlamlı rengini mi taşısın (ör.
   * durum rengi bir ikon — soluklaştırma o anlamı siler).
   */
  dimIcon?: boolean;
}

/**
 * Sekmelerdeki/panellerdeki boş-durum kutuları için ortak bileşen. Eskiden
 * her ekran kendi boş-durum stilini/metnini elle yazıyordu (bkz. tasarım
 * denetimi F22 — Dashboard'da 3, Reports'ta birden çok farklı varyant) —
 * `size`/`dimIcon` bu farklı ama meşru bağlamları tek bileşende toplar.
 */
export const EmptyState = ({ icon, message, action, className, size = 'lg', dimIcon = true }: EmptyStateProps) => (
  <div
    className={cn(
      'flex flex-col items-center justify-center gap-2 text-center',
      'text-text-tertiary uppercase tracking-[0.18em] text-micro font-medium',
      'border border-dashed rounded-2xl',
      size === 'lg'
        ? 'py-16 px-4 border-makam-border/10'
        : 'py-10 px-4 gap-2 rounded-xl border-executive-blue/[0.05] bg-surface-glass',
      className
    )}
  >
    {icon && (
      <span aria-hidden="true" className={cn('flex items-center justify-center', dimIcon && 'opacity-30')}>
        {icon}
      </span>
    )}
    <span>{message}</span>
    {action}
  </div>
);
