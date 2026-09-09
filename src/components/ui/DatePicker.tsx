import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  format, parse, addMonths, subMonths, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, addDays, isSameDay, isSameMonth, isToday, isBefore, startOfDay
} from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '../../lib/utils';
import { pushModalStack, popModalStack, isTopOfModalStack } from './Modal';

const WEEKDAY_LABELS: { short: string; full: string }[] = [
  { short: 'Pt', full: 'Pazartesi' },
  { short: 'Sa', full: 'Salı' },
  { short: 'Ça', full: 'Çarşamba' },
  { short: 'Pe', full: 'Perşembe' },
  { short: 'Cu', full: 'Cuma' },
  { short: 'Ct', full: 'Cumartesi' },
  { short: 'Pz', full: 'Pazar' },
];
const VALUE_FORMAT = 'yyyy-MM-dd';

/** [[gün, gün, ...×7], ...] — WAI-ARIA "grid" deseninin her satırı (role="row")
 *  tam olarak bir haftaya karşılık gelmeli (bkz. tasarım denetimi 2.6: bu
 *  restructuring önceden role="gridcell"nin erişilebilir rolü "button"dan
 *  değiştirip mevcut getByRole('button', ...) test sorgularını kırdığı için
 *  tamamen geri alınmıştı — bu kez testler de yeni role'e göre güncellendi). */
function chunkIntoWeeks(days: Date[]): Date[][] {
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

const parseValue = (value: string): Date | null => {
  const d = parse(value, VALUE_FORMAT, new Date());
  return Number.isNaN(d.getTime()) ? null : d;
};

interface DatePickerProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  /** Verilirse tetikleyici buton içinde etiketten önce render edilir (ör. boyalı kutu tetikleyicileri). */
  icon?: React.ReactNode;
  /** Tetikleyici butonun kendi className'ine eklenir — dış, tıklamaya tepki vermeyen bir "kutu" sarmalayıcısı yerine kutu stilini doğrudan tıklanabilir alana uygulamak için. */
  triggerClassName?: string;
  /** Form validasyon hatası varken tetikleyici butona aria-invalid uygular. */
  ariaInvalid?: boolean;
  /** Hata mesajı `<span>`'inin id'si — tetikleyici butona aria-describedby olarak bağlanır. */
  ariaDescribedBy?: string;
  /** VALUE_FORMAT ('yyyy-MM-dd') biçiminde alt sınır — bu tarihten önceki
   *  günler seçilemez olarak işaretlenir (bkz. tasarım denetimi F26: SLA
   *  mühleti gibi alanlarda geçmiş tarihe mühlet verilebiliyordu). */
  minDate?: string;
}

/** Markaya özgü, bağımlılıksız açılır takvim — native `<input type="date">`'in
 *  tarayıcıdan tarayıcıya değişen OS takvim popup'ının yerini alır. */
export const DatePicker = ({ id, value, onChange, ariaLabel, className, icon, triggerClassName, ariaInvalid, ariaDescribedBy, minDate }: DatePickerProps) => {
  const selected = parseValue(value);
  const minDateObj = minDate ? parseValue(minDate) : null;
  const isDayDisabled = (day: Date) => !!minDateObj && isBefore(startOfDay(day), startOfDay(minDateObj));
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selected ?? new Date()));
  // WAI-ARIA date-picker deseni: takvim ızgarasında Tab yalnızca TEK bir
  // durağa (roving tabindex) karşılık gelmeli, günler arası gezinme ok
  // tuşlarıyla yapılmalı. Önceden 42 gün hücresi arasında yalnızca Tab ile
  // dolaşılabiliyordu — ayın son günlerine ulaşmak klavye kullanıcıları için
  // onlarca Tab basışı gerektirebiliyordu (bkz. kod denetimi).
  const [focusedDay, setFocusedDay] = useState<Date | null>(null);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const stackIdRef = useRef<symbol | null>(null);
  if (stackIdRef.current === null) stackIdRef.current = Symbol('date-picker');
  // Takvim gövdesinin yaklaşık yüksekliği (başlık + hafta günleri + 6 satır gün hücresi).
  // Modal gibi `overflow-y-auto` ile kırpılan konteynerler içinde tetikleyicinin altında
  // yeterli yer yoksa (ör. formun en alt alanı), takvim yukarı açılır (bkz. kod denetimi:
  // "SLA mühlet tarihi modal içinde kırpılıyor").
  const POPUP_HEIGHT_ESTIMATE = 300;
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    // Modal içine yerleştirilen bir DatePicker açıkken Esc, dış Modal'ın da
    // kendini kapatmasına yol açmasın diye paylaşılan modalStack'e katılıyoruz
    // (bkz. Modal.tsx: yalnızca stack'in tepesindeki Esc'i işler).
    const stackId = stackIdRef.current!;
    pushModalStack(stackId);
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopOfModalStack(stackId)) {
        setIsOpen(false);
        // Escape'te odak tetikleyiciye döner — kapanıştan sonra odağın
        // DOM'dan (kaldırılan takvim gövdesinden) tamamen düşmesi klavye
        // kullanıcısını sayfanın başına fırlatırdı (bkz. tasarım denetimi F26).
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      popModalStack(stackId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const openPicker = () => {
    const initialDay = selected ?? new Date();
    setViewMonth(startOfMonth(initialDay));
    setFocusedDay(initialDay);
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const roomBelow = window.innerHeight - rect.bottom;
      const roomAbove = rect.top;
      setPlacement(roomBelow < POPUP_HEIGHT_ESTIMATE && roomAbove > roomBelow ? 'top' : 'bottom');
    }
    setIsOpen(true);
  };

  const handleSelect = (day: Date) => {
    if (isDayDisabled(day)) return;
    onChange(format(day, VALUE_FORMAT));
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  // focusedDay değiştiğinde (açılış veya ok tuşu navigasyonu) DOM odağını
  // ilgili gün butonuna taşır. Ay sınırını aşan bir hareket (ör. ayın 1'inde
  // sola gitmek) `moveFocus` içinde viewMonth'u da güncellediğinden, bu
  // effect viewMonth değiştiğinde de tekrar çalışıp yeni ayın ızgarası DOM'a
  // yazıldıktan SONRA odağı doğru hücreye taşır.
  useEffect(() => {
    if (!isOpen || !focusedDay) return;
    const key = format(focusedDay, VALUE_FORMAT);
    dayRefs.current.get(key)?.focus();
  }, [isOpen, focusedDay, viewMonth]);

  const moveFocus = (deltaDays: number) => {
    setFocusedDay(prev => {
      const base = prev ?? selected ?? new Date();
      const next = addDays(base, deltaDays);
      if (!isSameMonth(next, viewMonth)) setViewMonth(startOfMonth(next));
      return next;
    });
  };

  const handleDayKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); moveFocus(-1); break;
      case 'ArrowRight': e.preventDefault(); moveFocus(1); break;
      case 'ArrowUp': e.preventDefault(); moveFocus(-7); break;
      case 'ArrowDown': e.preventDefault(); moveFocus(7); break;
      default: break;
    }
  };

  const days: Date[] = [];
  const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
  for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }
  const weeks = chunkIntoWeeks(days);

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid ? true : undefined}
        aria-describedby={ariaDescribedBy}
        className={cn(
          "text-caption text-text-heading bg-transparent outline-none border-none cursor-pointer font-medium rounded focus-visible:ring-2 focus-visible:ring-executive-blue",
          triggerClassName
        )}
      >
        {icon}
        {selected ? format(selected, 'd MMM yyyy', { locale: tr }) : '—'}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            role="dialog"
            aria-label={ariaLabel}
            initial={{ opacity: 0, scale: 0.96, y: placement === 'bottom' ? -6 : 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: placement === 'bottom' ? -6 : 6 }}
            transition={{ type: 'spring', damping: 28, stiffness: 380 }}
            className={cn(
              'absolute z-50 left-0 w-64 p-3 rounded-2xl bg-surface-elevated backdrop-blur-xl border border-surface-border shadow-popover',
              placement === 'bottom' ? 'top-[calc(100%+8px)]' : 'bottom-[calc(100%+8px)]'
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setViewMonth(m => subMonths(m, 1))}
                aria-label="Önceki ay"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-executive-blue hover:bg-surface-glass transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-caption font-medium text-text-heading uppercase tracking-widest font-display">
                {format(viewMonth, 'LLLL yyyy', { locale: tr })}
              </span>
              <button
                type="button"
                onClick={() => setViewMonth(m => addMonths(m, 1))}
                aria-label="Sonraki ay"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-executive-blue hover:bg-surface-glass transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* WAI-ARIA "grid" deseni (APG date-picker dialog örneği): grid >
                row > (columnheader | gridcell). gridcell'in kendisi doğrudan
                odaklanabilir/tıklanabilir <button> — ayrı bir sarmalayıcıya
                role="gridcell" verip İÇİNE gerçek bir <button> koymak
                "nested-interactive" ihlaline yol açardı (bkz. tasarım
                denetimi: TeamList kartlarında aynı hatanın bulunup düzeltildiği
                AYNI ilke). aria-pressed yerine aria-selected: gridcell rolü
                pressed state'i değil seçili hücreyi ifade eder. */}
            <div role="grid" aria-label={format(viewMonth, 'LLLL yyyy', { locale: tr })} className="flex flex-col gap-0.5">
              <div role="row" className="grid grid-cols-7 gap-0.5 mb-0.5">
                {WEEKDAY_LABELS.map(d => (
                  <span
                    key={d.short}
                    role="columnheader"
                    aria-label={d.full}
                    className="text-micro text-text-tertiary uppercase tracking-widest text-center py-1"
                  >
                    {d.short}
                  </span>
                ))}
              </div>

              {weeks.map((week, weekIdx) => (
                <div key={weekIdx} role="row" className="grid grid-cols-7 gap-0.5">
                  {week.map(day => {
                    const isSelected = !!selected && isSameDay(day, selected);
                    const inMonth = isSameMonth(day, viewMonth);
                    const dayKey = format(day, VALUE_FORMAT);
                    const isFocused = !!focusedDay && isSameDay(day, focusedDay);
                    const isDisabled = isDayDisabled(day);
                    return (
                      <button
                        key={dayKey}
                        ref={el => {
                          if (el) dayRefs.current.set(dayKey, el);
                          else dayRefs.current.delete(dayKey);
                        }}
                        type="button"
                        role="gridcell"
                        onClick={() => handleSelect(day)}
                        onKeyDown={handleDayKeyDown}
                        onFocus={() => setFocusedDay(day)}
                        tabIndex={isFocused ? 0 : -1}
                        aria-current={isToday(day) ? 'date' : undefined}
                        aria-selected={isSelected}
                        aria-disabled={isDisabled ? true : undefined}
                        className={cn(
                          'w-7 h-7 flex items-center justify-center rounded-lg text-micro font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue',
                          isDisabled
                            ? 'text-text-tertiary/30 cursor-not-allowed hover:bg-transparent'
                            : isSelected
                              ? 'bg-executive-blue text-[color:var(--executive-blue-text)] shadow-sm'
                              : inMonth
                                ? 'text-text-heading hover:bg-surface-glass'
                                : 'text-text-tertiary/40 hover:bg-surface-glass',
                          !isSelected && isToday(day) && 'ring-1 ring-executive-blue/40'
                        )}
                      >
                        {format(day, 'd')}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
