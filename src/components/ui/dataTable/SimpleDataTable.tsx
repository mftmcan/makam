import type React from 'react';
import { cn } from '../../../lib/utils';
import { DataTableHeader } from './DataTableHeader';
import type { DataTableColumn, SortState } from './types';

interface SimpleDataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  sort?: SortState;
  onSortChange?: (next: SortState) => void;
  /** Boş liste durumunda `<tbody>` içine tek bir `colSpan` satırı olarak basılır. */
  emptyState?: React.ReactNode;
  /**
   * Satırı saran component/prop'ları çağıran belirler (`motion.tr`,
   * onClick/role/aria-label, giriş animasyonu vb.) — DataTable satır
   * seviyesinde bir etkileşim biçimi DAYATMAZ, yalnızca hücre içeriğini
   * (`cells`) üretir. Verilmezse düz `<tr>` kullanılır.
   */
  renderRow?: (row: T, index: number, cells: React.ReactNode) => React.ReactNode;
}

/**
 * Native `<table>` tabanlı, sanallaştırmasız DataTable — `Reports.tsx`'in
 * yönetici performans tablosu gibi onlarca satırlık, react-window
 * gerektirmeyen veriler için. Sanallaştırılmış büyük listeler (TaskBoard,
 * TeamList'in >30 kişi dalı) için `GridDataTable` kullanılır — react-window'un
 * absolute-positioned satırları native `<table>` ile hizalanamadığından iki
 * ayrı render stratejisi bilinçli olarak korunur (bkz. tasarım denetimi).
 */
export function SimpleDataTable<T>({
  columns, rows, rowKey, sort, onSortChange, emptyState, renderRow,
}: SimpleDataTableProps<T>) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <DataTableHeader columns={columns} sort={sort} onSortChange={onSortChange} />
      </thead>
      <tbody className="divide-y divide-makam-border/30">
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="p-0">
              {emptyState}
            </td>
          </tr>
        ) : (
          rows.map((row, index) => {
            const cells = columns.map((col) => (
              <td
                key={col.id}
                className={cn(
                  'px-4 py-3',
                  col.align === 'center' && 'text-center',
                  col.align === 'right' && 'text-right'
                )}
              >
                {col.cell?.(row, index)}
              </td>
            ));
            return renderRow
              ? renderRow(row, index, cells)
              : <tr key={rowKey(row, index)}>{cells}</tr>;
          })
        )}
      </tbody>
    </table>
  );
}
