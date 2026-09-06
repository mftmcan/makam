import React from 'react';
import { cn } from '../../lib/utils';
import { ChevronDown } from 'lucide-react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
  error?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, options, error, id, ...props }, ref) => {
    const generatedId = React.useId();
    const selectId = id ?? generatedId;
    const errorId = `${selectId}-error`;
    return (
      <div className="flex flex-col gap-1.5 w-full relative">
        {label && (
          <label htmlFor={selectId} className="text-micro font-medium text-text-muted uppercase tracking-[0.2em] px-1">
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
