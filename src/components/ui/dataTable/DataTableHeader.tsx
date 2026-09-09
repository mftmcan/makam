import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { nextSortState, type DataTableColumn, type SortState } from './types';

interface DataTableHeaderProps<T> {
  columns: DataTableColumn<T>[];
  sort?: SortState;
  onSortChange?: (next: SortState) => void;
}

/**
 * `TaskBoard.tsx`'in masaüstü tablo başlığının genelleştirilmesi (aria-sort,
 * chevron ikonları, sıralama döngüsü, focus ring — birebir taşındı). Native
 * `<th scope="col">` zaten implicit `role="columnheader"` taşıdığından ayrıca
 * atanmaz.
 */
export function DataTableHeader<T>({ columns, sort, onSortChange }: DataTableHeaderProps<T>) {
  return (
    <tr className="bg-surface-glass">
      {columns.map((col) => {
        const isSorted = Boolean(col.sortField && sort?.sortBy === col.sortField);
        return (
          <th
            key={col.id}
            scope="col"
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
                  col.align === 'center' && 'mx-auto',
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
          </th>
        );
      })}
    </tr>
  );
}
