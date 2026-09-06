import React from 'react';
import { cn } from '../../lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={inputId} className="text-micro font-medium text-text-muted uppercase tracking-[0.2em] px-1">
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
