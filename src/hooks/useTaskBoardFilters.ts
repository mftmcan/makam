import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface TaskBoardFilters {
  search: string;
  priority: string;
  status: string;
  assignee: string;
}

const DEFAULT_FILTERS: TaskBoardFilters = {
  search: '',
  priority: 'All',
  status: 'All',
  assignee: 'All',
};

// URL parametre adları alan adlarıyla birebir aynı DEĞİL: `search` tarayıcı
// geçmişinde/paylaşılan linkte "q" olarak daha kısa ve tanıdık okunur (ör.
// ?q=rapor&assignee=uid).
const PARAM_KEYS: Record<keyof TaskBoardFilters, string> = {
  search: 'q',
  priority: 'priority',
  status: 'status',
  assignee: 'assignee',
};

/**
 * TaskBoard'un arama/öncelik/durum/sorumlu filtrelerini URL'de tutar — eskiden
 * bileşen içi `useState`'ti (bkz. tasarım denetimi F20): sekme değiştirip geri
 * dönünce ya da bir raporun "bu sorumlunun talimatlarını gör" bağlantısından
 * gelindiğinde (bkz. F12) filtreler sıfırlanıyor, filtrelenmiş bir görünüm
 * paylaşılamıyordu. TaskBoard.tsx kendisi router'dan BİLİNÇLİ OLARAK habersiz
 * kalır (bkz. CLAUDE.md — testleri Router sarmalayıcısı gerektirmesin diye);
 * bu hook yalnızca AuthenticatedApp seviyesinde çağrılır, filtre durumu ve
 * setter'ı prop olarak aşağı geçirilir.
 */
export function useTaskBoardFilters(): [TaskBoardFilters, (partial: Partial<TaskBoardFilters>) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo<TaskBoardFilters>(() => ({
    search: searchParams.get(PARAM_KEYS.search) ?? DEFAULT_FILTERS.search,
    priority: searchParams.get(PARAM_KEYS.priority) ?? DEFAULT_FILTERS.priority,
    status: searchParams.get(PARAM_KEYS.status) ?? DEFAULT_FILTERS.status,
    assignee: searchParams.get(PARAM_KEYS.assignee) ?? DEFAULT_FILTERS.assignee,
  }), [searchParams]);

  const setFilters = useCallback((partial: Partial<TaskBoardFilters>) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      (Object.keys(partial) as (keyof TaskBoardFilters)[]).forEach(key => {
        const value = partial[key];
        const paramKey = PARAM_KEYS[key];
        // Varsayılan değer ('All' / boş arama) URL'e hiç yazılmaz — her
        // yüklemede ?priority=All&status=All&assignee=All gibi gürültülü,
        // paylaşılması can sıkıcı bir bağlantı üretmemek için.
        if (!value || value === DEFAULT_FILTERS[key]) next.delete(paramKey);
        else next.set(paramKey, value);
      });
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return [filters, setFilters];
}
