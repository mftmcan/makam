import type React from 'react';

/**
 * DataTable ailesinin ortak sütun modeli — Table/DataTable birincil bileşeni
 * eksikti (bkz. tasarım denetimi): TaskBoard/Reports/TeamList kendi tablo
 * düzenlerini elle kuruyordu, aynı başlık/sıralama davranışı üç yerde
 * bağımsız yazılmıştı. Burada ortak olan MARKUP değil — TaskBoard'un
 * sanallaştırılmış CSS Grid'i ile Reports'un native `<table>`'ı farklı render
 * stratejileri gerektiriyor (bkz. GridDataTable/SimpleDataTable) — ortak olan
 * sütun tanımı, başlık davranışı ve çerçevedir.
 */
export interface DataTableColumn<T> {
  id: string;
  /** '' = başlıksız sütun (checkbox/ok gibi). */
  header: string;
  /** Yalnızca GridDataTable kullanır (grid-template-columns türetimi). */
  width?: string;
  align?: 'left' | 'center' | 'right';
  /** Verilirse sütun sıralanabilir. Sıralama DURUMU dışarıdan (sort/onSortChange) kontrol edilir. */
  sortField?: string;
  /**
   * `SimpleDataTable` kullanır (zorunlu — hücre içeriğini üretir).
   * `GridDataTable` KULLANMAZ: satır içeriği react-window'un kendi
   * `rowComponent`'ine bırakılır (sanallaştırılmış satırlar çok özelleşmiş,
   * bkz. GridDataTable.tsx) — bu yüzden burada opsiyonel.
   */
  cell?: (row: T, index: number) => React.ReactNode;
}

export type SortDir = 'asc' | 'desc';

export interface SortState {
  sortBy: string;
  sortDir: SortDir;
}

/**
 * Sütun başlığına tıklama döngüsü: kapalı → artan → azalan → kapalı (bkz.
 * TaskBoard.tsx'teki AYNI desen, tasarım denetimi 3.4) — ayrı bir "sıralamayı
 * temizle" kontrolü İCAT EDİLMEDİ. `current` yoksa (hiç sıralama seçili
 * değilse) yeni alan artan sırayla başlar.
 */
export function nextSortState(current: SortState | undefined, field: string): SortState {
  if (!current || current.sortBy !== field) return { sortBy: field, sortDir: 'asc' };
  if (current.sortDir === 'asc') return { sortBy: field, sortDir: 'desc' };
  return { sortBy: 'none', sortDir: 'asc' };
}
