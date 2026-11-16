import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Shared visible section heading beneath the application's route h1.
 * Actions wrap below the title until there is enough horizontal space.
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
  /** Yeterli alanda sağda, dar alanda başlık altında gösterilen aksiyonlar. */
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
    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-5 border-b border-surface-border">
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn('w-10 h-10 shrink-0 rounded-xl flex items-center justify-center', toneStyle.iconBg)}>
          <Icon className={cn('w-5 h-5 stroke-[1.5]', toneStyle.iconText)} aria-hidden="true" />
        </div>
        <div>
          <h2 className={cn('text-[22px] sm:text-[26px] font-display font-medium tracking-tight leading-tight [overflow-wrap:anywhere]', TITLE_TONE_STYLES[titleTone])}>
            {title}
          </h2>
          {subtitle && (
            <span className="block mt-1 text-body text-text-muted leading-relaxed">
              {subtitle}
            </span>
          )}
        </div>
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-2 min-w-0 xl:shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
};
