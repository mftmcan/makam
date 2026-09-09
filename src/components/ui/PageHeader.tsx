import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * PageHeader — 6 ekranın (AuditLogList, Reports, Settings, TaskBoard,
 * TeamList, BlockerList) neredeyse birebir kopyaladığı "ikon çipi + eyebrow +
 * alt-etiket" başlık kalıbının tek kaynağı (bkz. tasarım denetimi: 7 ekranda
 * 6 farklı kopya + Dashboard'da hiç yoktu). Aynı zamanda eskiden altı ekranda
 * 0.4em iken TaskBoard'da 0.22em olan eyebrow harf aralığını (bkz.
 * index.css --tracking-eyebrow) tek noktadan zorunlu kılar.
 */

interface ToneStyle {
  iconBg: string;
  iconText: string;
}

const TONE_STYLES: Record<'ink' | 'gold' | 'danger' | 'success', ToneStyle> = {
  ink:     { iconBg: 'bg-executive-blue',    iconText: 'text-[color:var(--executive-blue-text)]' },
  gold:    { iconBg: 'bg-executive-gold',    iconText: 'text-[color:var(--btn-primary-text)]' },
  danger:  { iconBg: 'bg-status-danger',     iconText: 'text-[color:var(--status-danger-text)]' },
  success: { iconBg: 'bg-status-success/15', iconText: 'text-status-success' },
};

const TITLE_TONE_STYLES: Record<'ink' | 'danger' | 'heading', string> = {
  ink: 'text-executive-blue',
  danger: 'text-status-danger',
  heading: 'text-text-heading',
};

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: React.ReactNode;
  /** İkon çipinin zemin/metin rengi. Varsayılan 'ink' (executive-blue). */
  tone?: 'ink' | 'gold' | 'danger' | 'success';
  /** Başlığın kendi rengi — BlockerList'te aktif engel durumuna göre değişir. */
  titleTone?: 'ink' | 'danger' | 'heading';
  /** Sağ taraftaki filtre/buton kümesi (verilmezse başlık tek başına ortalanır). */
  actions?: React.ReactNode;
}

export const PageHeader = ({
  icon: Icon,
  title,
  subtitle,
  tone = 'ink',
  titleTone = 'ink',
  actions,
}: PageHeaderProps) => {
  const toneStyle = TONE_STYLES[tone];

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-executive-blue/[0.04]">
      <div className="flex items-center gap-2.5">
        <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center shadow-lg', toneStyle.iconBg)}>
          <Icon className={cn('w-4 h-4 stroke-[1.5]', toneStyle.iconText)} aria-hidden="true" />
        </div>
        <div>
          <span className={cn('text-micro font-medium uppercase tracking-eyebrow block leading-none', TITLE_TONE_STYLES[titleTone])}>
            {title}
          </span>
          {subtitle && (
            <span className="text-micro text-text-tertiary uppercase tracking-eyebrow">
              {subtitle}
            </span>
          )}
        </div>
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
};
