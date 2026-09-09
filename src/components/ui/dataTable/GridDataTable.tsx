import type React from 'react';
import { List, type RowComponentProps } from 'react-window';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { GridTableRowSkeleton } from '../Skeleton';
import { nextSortState, type DataTableColumn, type SortState } from './types';

interface GridDataTableProps<T, TRowData extends object> {
  columns: DataTableColumn<T>[];
  sort?: SortState;
  onSortChange?: (next: SortState) => void;
  isLoading?: boolean;
  rowCount: number;
  rowHeight: number;
  listHeight: number;
  /** react-window'un kendi sanallaştırma API'si — satır içeriği bileşene
   *  özgü olduğundan (TaskBoard/TeamList çok farklı hücreler render eder)
   *  GENELLEŞTİRİLMEZ, çağıranın kendi `rowComponent`'i AYNEN geçirilir. */
  rowComponent: (props: RowComponentProps<TRowData>) => React.ReactElement | null;
  rowProps: TRowData;
  rowKey: (index: number, rowProps: TRowData) => React.Key;
  emptyState?: React.ReactNode;
  isEmpty?: boolean;
}

/**
 * TaskBoard.tsx'in sanallaştırılmış CSS Grid tablosunun genelleştirilmesi
 * (TeamList'in >30 kişi dalı da bunu kullanır). `gridTemplateColumns` artık
 * sütun `width`'lerinden türetilir — eskiden `DESKTOP_GRID_TEMPLATE` ve
 * `DESKTOP_COLUMNS` iki ayrı, elle senkron tutulan liste olarak yaşıyordu
 * (gerçek sürüklenme riski, bkz. tasarım denetimi).
 *
 * ARIA zinciri birebir korunur: dış `role="table"` → başlık `role="row"` +
 * `role="columnheader"` → `List`e doğrudan verilen `role="rowgroup"`
 * (react-window'un kendi `role="list"` varsayılanını ezer — eskiden bunu
 * SARAN ayrı bir `role="rowgroup"` div'i vardı ve `role="list"` onun İÇİNE
 * yerleşiyordu: "row" çocukları `role="list"` için geçersiz VE `role="table"`
 * > `rowgroup` > `list` zincirinde satır için gereken doğrudan grid/rowgroup
 * atası kayboluyordu — axe-core bunu iki ayrı "critical" ihlal olarak
 * bulmuştu: aria-required-children, aria-required-parent, bkz. tasarım
 * denetimi F3). Yükleme iskeleti `aria-hidden="true"` ile tamamen gizlenir
 * (dekoratif, gerçek satır/sütun verisi taşımaz).
 */
export function GridDataTable<T, TRowData extends object>({
  columns, sort, onSortChange, isLoading, rowCount, rowHeight, listHeight,
  rowComponent, rowProps, rowKey, emptyState, isEmpty,
}: GridDataTableProps<T, TRowData>) {
  const gridTemplateColumns = columns.map((c) => c.width ?? 'minmax(0,1fr)').join(' ');

  return (
    <div className="overflow-x-auto custom-scrollbar" role="table">
      <div
        role="row"
        style={{ gridTemplateColumns }}
        className="grid bg-surface-glass border-b border-executive-blue/[0.04]"
      >
        {columns.map((col) => {
          const isSorted = Boolean(col.sortField && sort?.sortBy === col.sortField);
          return (
            <div
              key={col.id}
              role="columnheader"
              aria-sort={col.sortField ? (isSorted ? (sort!.sortDir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
              className={cn(
                'px-4 py-3 text-micro font-medium text-text-tertiary uppercase tracking-caps',
                col.align === 'center' && 'text-center',
                col.align === 'right' && 'text-right'
              )}
            >
              {col.sortField && onSortChange ? (
                <button
                  type="button"
                  onClick={() => onSortChange(nextSortState(sort, col.sortField!))}
                  className={cn(
                    'flex items-center gap-1 hover:text-executive-blue transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue rounded',
                    col.align === 'right' && 'ml-auto'
                  )}
                >
                  {col.header}
                  {isSorted ? (
                    sort!.sortDir === 'asc'
                      ? <ChevronUp className="w-3 h-3" aria-hidden="true" />
                      : <ChevronDown className="w-3 h-3" aria-hidden="true" />
                  ) : (
                    <ChevronsUpDown className="w-3 h-3 opacity-30" aria-hidden="true" />
                  )}
                </button>
              ) : col.header}
            </div>
          );
        })}
      </div>

      {isLoading ? (
        <div aria-hidden="true">
          {[...Array(7)].map((_, i) => (
            <GridTableRowSkeleton key={i} gridTemplateColumns={gridTemplateColumns} cols={columns.length} />
          ))}
        </div>
      ) : isEmpty ? (
        <div role="rowgroup">
          <div role="row"><div role="cell">{emptyState}</div></div>
        </div>
      ) : (
        // react-window'un generic `rowProps` kısıtlaması (ExcludeForbiddenKeys,
        // dışa aktarılmayan internal bir tip) burada bir kütüphane sarmalayıcısı
        // içindeki generic `TRowData` ile KANITLANAMIYOR — `List`in DIŞINDAKİ
        // (GridDataTableProps) genel API tam tipli kalır, yalnızca bu iç
        // implementasyon detayında gevşetilir.
        <List
          role="rowgroup"
          rowComponent={rowComponent as (props: RowComponentProps<object>) => React.ReactElement | null}
          rowCount={rowCount}
          rowHeight={rowHeight}
          rowProps={rowProps}
          rowKey={rowKey as (index: number, rowProps: object) => React.Key}
          style={{ height: listHeight }}
        />
      )}
    </div>
  );
}
