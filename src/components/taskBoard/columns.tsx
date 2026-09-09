import type { Task } from '../../types';
import type { DataTableColumn } from '../ui/dataTable';

/**
 * Masaüstü tablo başlığının sütun tanımı — `GridDataTable` `cell` KULLANMAZ
 * (satır içeriği react-window'un `rowComponent`'ine bırakılır, bkz.
 * `DesktopTaskRow.tsx`), yalnızca `header`/`width`/`align`/`sortField`
 * kullanılır. `width`'ler eskiden `DESKTOP_GRID_TEMPLATE` adında AYRI, elle
 * senkron tutulan bir string olarak yaşıyordu (gerçek sürüklenme riski, bkz.
 * tasarım denetimi) — artık `GridDataTable` bunları buradan türetir.
 */
export const TASK_BOARD_COLUMNS: DataTableColumn<Task>[] = [
  { id: 'select', header: '', width: '40px' },
  { id: 'status', header: 'Durum', width: '180px', sortField: 'status' },
  { id: 'title', header: 'Talimat Tanımı', width: 'minmax(0,1fr)', sortField: 'title' },
  { id: 'assignee', header: 'Sorumlu', width: '190px', sortField: 'assignee' },
  { id: 'priority', header: 'Önem', width: '130px', sortField: 'priority' },
  { id: 'deadline', header: 'Mühlet', width: '160px', sortField: 'deadline' },
  { id: 'arrow', header: '', width: '64px', align: 'right' },
];
