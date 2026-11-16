import type React from 'react';
import { cn } from '../../lib/utils';

interface PageShellProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * 13 ekranda (7 gerçek ekran + 6 skeleton) birebir tekrarlanan sayfa
 * konteyner kalıbının tek kaynağı. Dock boşluğu uygulama kabuğunda ayrılır.
 */
export const PageShell = ({ children, className, ...rest }: PageShellProps) => (
  <div
    className={cn(
      'flex flex-col gap-5 max-w-[1440px] mx-auto font-sans py-4',
      className
    )}
    {...rest}
  >
    {children}
  </div>
);
