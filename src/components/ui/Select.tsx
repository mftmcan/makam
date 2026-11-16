import React from 'react';
import { cn } from '../../lib/utils';
import { ChevronDown } from 'lucide-react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
  error?: string;
  /**
   * 'default' (h-12, rounded-xl, ChevronDown ikonlu) — form alanları.
   * 'ghost' — filtre çubuğu gibi KENDİ wrapper'ını (border/ikon/flex düzeni)
   * taşıyan bağlamlar için: yalnızca çıplak `<select>` render edilir, label/
   * error/ChevronDown/wrapper YOK — `className` tam olarak çağıranın verdiği
   * gibi uygulanır (bkz. TaskBoard/Reports/BlockerList filtre select'leri,
   * eskiden native `<select>` olarak elle tekrarlanıyordu).
   */
  variant?: 'default' | 'ghost';
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, options, error, id, variant = 'default', 'aria-describedby': describedBy, ...props }, ref) => {
    const generatedId = React.useId();
    const selectId = id ?? generatedId;
    const errorId = `${selectId}-error`;
    const description = [describedBy, error ? errorId : undefined].filter(Boolean).join(' ') || undefined;

    if (variant === 'ghost') {
      return (
        <>
        {label && <label htmlFor={selectId} className="sr-only">{label}</label>}
        <select ref={ref} id={selectId} className={className} aria-invalid={error ? true : undefined} aria-describedby={description} {...props}>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-surface-base text-text-heading">
              {opt.label}
            </option>
          ))}
        </select>
        {error && <span id={errorId} role="alert" className="text-micro text-status-danger">{error}</span>}
        </>
      );
    }

    return (
      <div className="flex flex-col gap-1.5 w-full relative">
        {label && (
          <label htmlFor={selectId} className="text-body-sm font-medium text-text-body px-1">
            {label}
          </label>
        )}
        <div className="relative group">
          <select
            ref={ref}
            id={selectId}
            aria-invalid={error ? true : undefined}
            aria-describedby={description}
            className={cn(
              'w-full h-12 pl-4 pr-12 bg-surface-elevated border border-surface-border rounded-xl text-title font-normal text-text-heading appearance-none cursor-pointer transition-colors outline-none focus:border-executive-blue/40 focus:ring-2 focus:ring-executive-blue/15',
              error && 'border-status-danger/40 focus:border-status-danger focus:ring-status-danger/10',
              className
            )}
            {...props}
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-surface-elevated text-text-heading">
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none group-focus-within:text-executive-blue transition-colors stroke-[1.5]" />
        </div>
        {error && <span id={errorId} role="alert" className="text-micro text-status-danger font-medium px-1 uppercase tracking-wider">{error}</span>}
      </div>
    );
  }
);
