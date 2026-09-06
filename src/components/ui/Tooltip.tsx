import React from 'react';
import { cn } from '../../lib/utils';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
}

/**
 * Hafif, bağımlılıksız ipucu balonu. Konumlandırma tamamen CSS ile
 * (group-hover/group-focus-within) yapılır — JS pozisyon hesaplama yok.
 * Fare ve klavye (Tab) erişimi ile aynı şekilde tetiklenir.
 */
export const Tooltip = ({ content, children, side = 'top', className }: TooltipProps) => {
  const id = React.useId();

  return (
    <span className={cn('relative flex group/tooltip', className)}>
      <span aria-describedby={id} className="flex min-w-0 flex-1">{children}</span>
      <span
        id={id}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 w-max max-w-[240px] whitespace-normal',
          'left-1/2 -translate-x-1/2',
          side === 'top' ? 'bottom-[calc(100%+9px)]' : 'top-[calc(100%+9px)]',
          'opacity-0 scale-95 group-hover/tooltip:opacity-100 group-hover/tooltip:scale-100',
          'group-focus-within/tooltip:opacity-100 group-focus-within/tooltip:scale-100',
          'transition-all duration-150',
          side === 'top' ? 'origin-bottom' : 'origin-top',
          'px-3 py-2 rounded-xl bg-brand-obsidian text-slate-50 text-micro leading-relaxed font-medium tracking-wide shadow-xl border border-white/[0.08]'
        )}
      >
        {content}
        <span
          aria-hidden="true"
          className={cn(
            'absolute left-1/2 -translate-x-1/2 w-2 h-2 bg-brand-obsidian rotate-45',
            side === 'top' ? '-bottom-1' : '-top-1'
          )}
        />
      </span>
    </span>
  );
};
