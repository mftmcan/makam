import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Tek bir `?<paramName>=` sekme/alt-sekme durumunu URL'de tutan genel amaçlı
 * hook — TaskBoard'un çoklu filtre alanları için `useTaskBoardFilters` (bkz.
 * o dosyadaki gerekçe) neyse, tekil bir "hangi sekme açık" durumu için de bu
 * hook aynı işi görür (bkz. tasarım denetimi F20/F32: Settings'in "hangi alt
 * sekme" durumu eskiden yalnızca bileşen-içi state'ti, `?tab=` ile
 * paylaşılamıyor/yenilemede kaybediyordu). Yalnızca AuthenticatedApp
 * seviyesinde çağrılır — Settings/TaskDetails gibi içerik bileşenleri
 * router'dan bilinçli olarak habersiz kalır (bkz. CLAUDE.md).
 */
export function useTabSearchParam<T extends string>(paramName: string, defaultValue: T): [T, (value: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = (searchParams.get(paramName) as T | null) ?? defaultValue;

  const setValue = useCallback((next: T) => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (next === defaultValue) params.delete(paramName);
      else params.set(paramName, next);
      return params;
    }, { replace: true });
    // defaultValue kasıtlı olarak deps dışında bırakılır: çağıranlar genelde
    // sabit bir literal geçer, her render'da yeniden bağlamak gereksizdir.
  }, [paramName, setSearchParams]);

  return [value, setValue];
}
