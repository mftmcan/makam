import React from 'react';
import { cn } from '../../lib/utils';
import { ChevronDown } from 'lucide-react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
  error?: string;
  /**
   * 'default' (pill, h-14, ChevronDown ikonlu) — form alanları.
   * 'ghost' — filtre çubuğu gibi KENDİ wrapper'ını (border/ikon/flex düzeni)
   * taşıyan bağlamlar için: yalnızca çıplak `<select>` render edilir, label/
   * error/ChevronDown/wrapper YOK — `className` tam olarak çağıranın verdiği
   * gibi uygulanır (bkz. TaskBoard/Reports/BlockerList filtre select'leri,
   * eskiden native `<select>` olarak elle tekrarlanıyordu).
   */
  variant?: 'default' | 'ghost';
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, options, error, id, variant = 'default', ...props }, ref) => {
    const generatedId = React.useId();
    const selectId = id ?? generatedId;
    const errorId = `${selectId}-error`;

    if (variant === 'ghost') {
      return (
        <select ref={ref} id={selectId} className={className} {...props}>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-surface-base text-text-heading">
              {opt.label}
            </option>
          ))}
        </select>
      );
    }

    return (
      <div className="flex flex-col gap-1.5 w-full relative">
        {label && (
          <label htmlFor={selectId} className="text-micro font-medium text-text-muted uppercase tracking-caps px-1">
            {label}
          </label>
        )}
        <div className="relative group">
          <select
            ref={ref}
            id={selectId}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn(
              'w-full h-14 pl-6 pr-12 bg-makam-glass border border-makam-border/5 rounded-full text-[15px] font-light text-text-heading appearance-none cursor-pointer transition-all outline-none focus:border-executive-blue/20 focus:ring-8 focus:ring-executive-blue/5 shadow-inner',
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
          <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-text-muted/40 pointer-events-none group-focus-within:text-executive-blue transition-colors stroke-[1.2]" />
        </div>
        {error && <span id={errorId} role="alert" className="text-micro text-status-danger font-medium px-1 uppercase tracking-wider">{error}</span>}
      </div>
    );
  }
);
