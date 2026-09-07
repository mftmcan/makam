import React from 'react';
import { cn } from '../../lib/utils';

/**
 * Dashboard/Reports'ta 7 kez birebir aynı şekilde elle yazılmış "cam panel"
 * kalıbının (bkz. tasarım denetimi F19) tek kaynağı. `ui/Card` (spotlight/fare
 * takipli parlama efektli, ayrı bir görsel dil) BİLİNÇLİ OLARAK farklı bir
 * bileşendi ve üretimde hiç kullanılmıyordu (yalnızca a11y.test.tsx) — silindi.
 * `.makam-card` CSS sınıfı da (daha büyük blur/saturate, farklı zemin/gölge
 * token'ları) ayrı bir üçüncü kalıptı; bu üçünü tek görsele indirmek yerine
 * ÜRETİMDE GERÇEKTEN kullanılan kalıp tek kaynak yapıldı.
 *
 * `PANEL_CLASSNAME` ayrıca dışa aktarılır çünkü tüm 7 çağıran `motion.div`
 * (giriş animasyonu taşıyor) — bu bileşen düz bir `<div>` render eder,
 * `motion.div`'e onun kendi animasyon prop'larını bozmadan uygulanabilsin
 * diye `cn(PANEL_CLASSNAME, ...)` olarak kullanılır.
 */
export const PANEL_CLASSNAME = 'bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl p-4 shadow-card';

interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const Panel = ({ className, children, ...props }: PanelProps) => (
  <div className={cn(PANEL_CLASSNAME, className)} {...props}>
    {children}
  </div>
);
