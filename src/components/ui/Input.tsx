import React from 'react';
import { cn } from '../../lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  /**
   * 'default' (pill, h-14) — form alanları. 'sm' (h-8, rounded-xl) — filtre
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
  ({ className, label, error, id, variant = 'default', icon, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;

    if (variant === 'sm') {
      return (
        <div className={cn('relative group', !icon && 'w-full')}>
          {icon && (
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-executive-blue transition-colors pointer-events-none">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn(
              'h-8 bg-makam-glass border border-executive-blue/[0.05] rounded-xl focus:ring-4 focus:ring-executive-blue/[0.04] focus:border-executive-blue/20 transition-all text-body-sm font-light text-executive-blue placeholder:text-text-tertiary outline-none',
              icon ? 'pl-9 pr-3 w-full' : 'px-3',
              className
            )}
            {...props}
          />
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={inputId} className="text-micro font-medium text-text-muted uppercase tracking-caps px-1">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            'w-full h-14 px-6 bg-makam-glass border border-makam-border/5 rounded-full text-[15px] font-light text-text-heading placeholder:text-text-muted/30 transition-all outline-none focus:border-executive-blue/20 focus:ring-8 focus:ring-executive-blue/5 shadow-inner',
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
