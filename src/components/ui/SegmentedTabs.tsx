import React, { useRef } from 'react';
import { cn } from '../../lib/utils';

export interface SegmentedTabItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ElementType;
  /** Verilirse etiketin yanında "(N)" olarak gösterilir — 0 ise gizlenir. */
  count?: number;
}

export interface SegmentedTabsProps {
  tabs: SegmentedTabItem[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  /**
   * Görsel kalıp — üç ekranda BAĞIMSIZ GELİŞMİŞ üç farklı sekme tasarımının
   * (bkz. tasarım denetimi F14) aynı klavye/ARIA davranışını paylaşan ortak
   * gövdesi: 'underline' (TaskDetails — ikon + sayaç, alt çizgi vurgusu),
   * 'sidebar' (Settings — dolgu zeminli, mobilde yatay/masaüstünde dikey),
   * 'pill' (TeamList — kompakt hap anahtarı).
   */
  variant: 'underline' | 'sidebar' | 'pill';
  /** Verilirse her tab id={`${idPrefix}-tab-${id}`} + aria-controls={`${idPrefix}-tabpanel-${id}`} taşır. */
  idPrefix?: string;
  /** Dış konteynerin className'i — sayfa düzenine özgü genişlik/kenarlık/aralık burada verilir. */
  className?: string;
}

/**
 * Üç ekranda ayrı ayrı geliştirilmiş sekme implementasyonlarının (yalnızca
 * TaskDetails tam ARIA taşıyordu; Settings düz buton, TeamList hiç rol
 * taşımıyordu — bkz. tasarım denetimi F14) paylaştığı tek davranış katmanı:
 * role=tablist/tab, aria-selected, roving tabindex, ok tuşu + Home/End
 * navigasyonu. Görsel kalıp `variant` ile seçilir, davranış üçünde de aynıdır.
 */
export const SegmentedTabs = ({ tabs, activeId, onChange, ariaLabel, variant, idPrefix, className }: SegmentedTabsProps) => {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  const moveFocus = (fromId: string, delta: number) => {
    const index = tabs.findIndex(t => t.id === fromId);
    if (index === -1) return;
    const nextIndex = (index + delta + tabs.length) % tabs.length;
    const next = tabs[nextIndex]!;
    onChange(next.id);
    tabRefs.current.get(next.id)?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, tabId: string) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(tabId, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(tabId, -1);
        break;
      case 'Home': {
        e.preventDefault();
        const first = tabs[0]!;
        onChange(first.id);
        tabRefs.current.get(first.id)?.focus();
        break;
      }
      case 'End': {
        e.preventDefault();
        const last = tabs[tabs.length - 1]!;
        onChange(last.id);
        tabRefs.current.get(last.id)?.focus();
        break;
      }
      default:
        break;
    }
  };

  const containerBase = {
    underline: 'flex overflow-x-auto custom-scrollbar border-b border-makam-border/5 scroll-smooth',
    sidebar: 'flex flex-row md:flex-col gap-1.5 overflow-x-auto md:overflow-x-visible',
    pill: 'flex bg-surface-glass p-0.5 rounded-full border border-executive-blue/[0.04] items-center gap-0.5',
  }[variant];

  return (
    <div role="tablist" aria-label={ariaLabel} className={cn(containerBase, className)}>
      {tabs.map(tab => {
        const isActive = tab.id === activeId;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            ref={el => {
              if (el) tabRefs.current.set(tab.id, el);
              else tabRefs.current.delete(tab.id);
            }}
            id={idPrefix ? `${idPrefix}-tab-${tab.id}` : undefined}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-controls={idPrefix ? `${idPrefix}-tabpanel-${tab.id}` : undefined}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, tab.id)}
            className={cn(
              variant === 'underline' && [
                'px-6 py-4 text-micro font-medium uppercase tracking-caps transition-all border-b-2 whitespace-nowrap relative flex items-center gap-2',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-inset',
                isActive
                  ? 'border-executive-gold text-[color:var(--gold-text)]'
                  : 'border-transparent text-text-muted hover:text-text-heading hover:bg-makam-glass',
              ],
              variant === 'sidebar' && [
                'px-4 py-3 rounded-xl text-micro font-bold uppercase tracking-caps text-left transition-all shrink-0 w-auto whitespace-nowrap md:w-full md:whitespace-normal',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue',
                isActive
                  ? 'bg-executive-blue text-[color:var(--executive-blue-text)] shadow-[0_4px_12px_rgba(30,41,59,0.15)]'
                  : 'text-text-muted hover:text-text-heading hover:bg-executive-blue/[0.03]',
              ],
              variant === 'pill' && [
                'px-3 py-1.5 rounded-full text-micro uppercase tracking-wider font-bold transition-all duration-300 cursor-pointer',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue',
                isActive
                  ? 'bg-executive-blue text-[color:var(--executive-blue-text)] shadow-sm'
                  : 'text-text-muted hover:text-text-heading',
              ]
            )}
          >
            {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
            {tab.label}
            {!!tab.count && <span className="tabular-nums">({tab.count})</span>}
          </button>
        );
      })}
    </div>
  );
};
