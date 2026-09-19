/**
 * useTaskBoardFilters testleri.
 *
 * Filtreler URL'de tutulur (bkz. kaynak dosyanın başlık yorumu — F20):
 * yanlış çalışması ya sekme değişiminde/derin linkte filtrelerin sessizce
 * sıfırlanması ya da varsayılan değerlerin ('All'/boş arama) URL'e gürültü
 * olarak yazılması anlamına gelir.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useTaskBoardFilters } from './useTaskBoardFilters';

const wrapperAt = (route: string) =>
  ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
  );

describe('useTaskBoardFilters', () => {
  it('URL parametresi yoksa varsayılan filtreleri döner', () => {
    const { result } = renderHook(() => useTaskBoardFilters(), { wrapper: wrapperAt('/tasks') });
    const [filters] = result.current;

    expect(filters).toEqual({
      search: '', priority: 'All', status: 'All', assignee: 'All', sortBy: 'none', sortDir: 'asc',
    });
  });

  it('mevcut URL parametrelerini (kısaltılmış anahtarlarla) okur', () => {
    const { result } = renderHook(() => useTaskBoardFilters(), {
      wrapper: wrapperAt('/tasks?q=rapor&priority=High&status=BLOCKED&assignee=uid-1&sort=title&dir=desc'),
    });
    const [filters] = result.current;

    expect(filters).toEqual({
      search: 'rapor', priority: 'High', status: 'BLOCKED', assignee: 'uid-1', sortBy: 'title', sortDir: 'desc',
    });
  });

  it('setFilters bir alanı günceller ve URL\'e yazar', () => {
    const { result } = renderHook(
      () => ({ state: useTaskBoardFilters(), params: useSearchParams()[0] }),
      { wrapper: wrapperAt('/tasks') }
    );

    act(() => { result.current.state[1]({ search: 'acil' }); });

    expect(result.current.params.get('q')).toBe('acil');
    expect(result.current.state[0].search).toBe('acil');
  });

  it('varsayılan değere ("All"/boş arama) dönüldüğünde parametre URL\'den SİLİNİR (gürültü üretmez)', () => {
    const { result } = renderHook(
      () => ({ state: useTaskBoardFilters(), params: useSearchParams()[0] }),
      { wrapper: wrapperAt('/tasks?priority=High') }
    );
    expect(result.current.params.get('priority')).toBe('High');

    act(() => { result.current.state[1]({ priority: 'All' }); });

    expect(result.current.params.has('priority')).toBe(false);
  });

  it('boş arama string\'i de URL\'den silinir', () => {
    const { result } = renderHook(
      () => ({ state: useTaskBoardFilters(), params: useSearchParams()[0] }),
      { wrapper: wrapperAt('/tasks?q=rapor') }
    );

    act(() => { result.current.state[1]({ search: '' }); });

    expect(result.current.params.has('q')).toBe(false);
  });

  it('birden fazla alan tek çağrıda güncellenebilir, diğer parametreler korunur', () => {
    const { result } = renderHook(
      () => ({ state: useTaskBoardFilters(), params: useSearchParams()[0] }),
      { wrapper: wrapperAt('/tasks?assignee=uid-1') }
    );

    act(() => { result.current.state[1]({ priority: 'Urgent', status: 'CRISIS' }); });

    expect(result.current.params.get('priority')).toBe('Urgent');
    expect(result.current.params.get('status')).toBe('CRISIS');
    // Önceki, ilgisiz parametre silinmeden korunur.
    expect(result.current.params.get('assignee')).toBe('uid-1');
  });
});
