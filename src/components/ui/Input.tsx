import React from 'react';
import { cn } from '../../lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  /**
   * 'default' (h-12) — form alanları. 'sm' (mobil 44px, masaüstü 40px) — filtre
   * çubuğu gibi kompakt bağlamlar (bkz. TaskBoard arama input'u, eskiden
   * native `<input>` olarak elle tekrarlanıyordu). `icon` yalnızca 'sm' ile
   * anlamlı biçimde konumlanır (sol tarafta, `group-focus-within` rengini
   * miras alır). İsim `size` DEĞİL `variant`: native `<input size>`
   * (karakter genişliği, number) ile çakışıyordu.
   */
  variant?: 'default' | 'sm';
  icon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, variant = 'default', icon, 'aria-describedby': describedBy, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    const description = [describedBy, error ? errorId : undefined].filter(Boolean).join(' ') || undefined;

    if (variant === 'sm') {
      return (
        <div className={cn('relative group', !icon && 'w-full')}>
          {label && <label htmlFor={inputId} className="sr-only">{label}</label>}
          {icon && (
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-executive-blue transition-colors pointer-events-none">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            aria-invalid={error ? true : undefined}
            aria-describedby={description}
            className={cn(
              'h-11 sm:h-10 bg-surface-elevated border border-surface-border rounded-xl focus:ring-2 focus:ring-executive-blue/15 focus:border-executive-blue/40 transition-colors text-field sm:text-body font-normal text-executive-blue placeholder:text-text-tertiary outline-none',
              icon ? 'pl-9 pr-3 w-full' : 'px-3',
              className
            )}
            {...props}
          />
          {error && <span id={errorId} role="alert" className="text-micro text-status-danger">{error}</span>}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={inputId} className="text-body-sm font-medium text-text-body px-1">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={description}
          className={cn(
            'w-full h-12 px-4 bg-surface-elevated border border-surface-border rounded-xl text-title font-normal text-text-heading placeholder:text-text-muted transition-colors outline-none focus:border-executive-blue/40 focus:ring-2 focus:ring-executive-blue/15',
            error && 'border-status-danger/40 focus:border-status-danger focus:ring-status-danger/10',
            className
          )}
          {...props}
        />
        {error && <span id={errorId} role="alert" className="text-micro text-status-danger font-medium px-1 uppercase tracking-wider">{error}</span>}
      </div>
    );
  }
);
