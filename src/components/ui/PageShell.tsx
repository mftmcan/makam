import type React from 'react';
import { cn } from '../../lib/utils';

interface PageShellProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** Dashboard'un sağ alttaki PWA "Çevrimdışı Hazır" toast'ıyla (ReloadPrompt,
   *  fixed bottom-6 right-6) çakışmaması için ekstra alt boşluk — yalnızca
   *  Dashboard bunu kullanır. */
  withMobileDockPadding?: boolean;
}

/**
 * 13 ekranda (7 gerçek ekran + 6 skeleton) birebir tekrarlanan sayfa
 * konteyner kalıbının tek kaynağı — eskiden `gap-5 py-4` (çoğu ekran),
 * `gap-4 py-4` (TaskBoard) ve `gap-5 pt-4 pb-24` (Dashboard) olmak üzere üç
 * farklı varyant vardı (bkz. tasarım denetimi). TaskBoard'un `gap-4`'ü
 * bilinçli olarak `gap-5`'e normalize edildi — diğer altı ekranla aynı dikey
 * ritim.
 */
export const PageShell = ({ children, withMobileDockPadding, className, ...rest }: PageShellProps) => (
  <div
    className={cn(
      'flex flex-col gap-5 max-w-[1440px] mx-auto font-sans',
      withMobileDockPadding ? 'pt-4 pb-24' : 'py-4',
      className
    )}
    {...rest}
  >
    {children}
  </div>
);
