import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './uiStore';

const initialState = useUIStore.getState();

describe('useUIStore', () => {
  beforeEach(() => {
    useUIStore.setState(initialState, true);
  });

  describe('toast yönetimi', () => {
    it('addToast benzersiz id ile ekler', () => {
      useUIStore.getState().addToast({ title: 'Başlık', body: 'Gövde', type: 'success' });
      const toasts = useUIStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0]).toMatchObject({ title: 'Başlık', body: 'Gövde', type: 'success' });
      expect(toasts[0]!.id).toBeTruthy();
    });

    it('removeToast yalnızca belirtilen id\'yi kaldırır', () => {
      useUIStore.getState().addToast({ title: 'A', body: '' });
      useUIStore.getState().addToast({ title: 'B', body: '' });
      const [first, second] = useUIStore.getState().toasts;

      useUIStore.getState().removeToast(first!.id);

      const remaining = useUIStore.getState().toasts;
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.id).toBe(second!.id);
    });
  });

  describe('App seviyesi modal aksiyonları', () => {
    it('closeAllModals modal state\'ini ve bağlı alanları sıfırlar', () => {
      useUIStore.setState({
        isCreateModalOpen: true,
        isEditModalOpen: true,
        parentTaskId: 'task-1',
        initialTitle: 'Ön Başlık',
      });

      useUIStore.getState().closeAllModals();

      const state = useUIStore.getState();
      expect(state.isCreateModalOpen).toBe(false);
      expect(state.isEditModalOpen).toBe(false);
      expect(state.parentTaskId).toBeUndefined();
      expect(state.initialTitle).toBeUndefined();
    });

    it('setIsNotificationsOpen diğer modal alanlarından bağımsız çalışır', () => {
      useUIStore.getState().setIsCreateModalOpen(true);
      useUIStore.getState().setIsNotificationsOpen(true);
      expect(useUIStore.getState().isCreateModalOpen).toBe(true);
      expect(useUIStore.getState().isNotificationsOpen).toBe(true);
    });
  });

  describe('navigasyon durumu (regresyon koruması)', () => {
    // Bu store eskiden `activeTab` + `selectedTaskId` de tutuyordu; routing
    // katmanıyla birlikte URL tek doğruluk kaynağı oldu (bkz. kod denetimi
    // P1-6). Bu test, "kolay olduğu için" birinin bunları store'a geri
    // eklemesini ve iki doğruluk kaynağının sessizce geri gelmesini engeller.
    it('aktif sekme/seçili görev alanları store\'da TUTULMAZ (URL tek kaynak)', () => {
      const state = useUIStore.getState() as Record<string, unknown>;
      expect(state.activeTab).toBeUndefined();
      expect(state.setActiveTab).toBeUndefined();
      expect(state.selectedTaskId).toBeUndefined();
      expect(state.setSelectedTaskId).toBeUndefined();
    });

    // TaskBoard filtreleri (arama/öncelik/durum/sorumlu) eskiden burada bir
    // `filter`/`setFilter`/`resetFilter` üçlüsüydü ama TaskBoard.tsx onu hiç
    // okumuyordu (bkz. tasarım denetimi F20) — kaldırıldı, karşılığı artık
    // useTaskBoardFilters() (URL tabanlı). Bu test "kolay olduğu için" birinin
    // bunu store'a geri eklemesini engeller.
    it('TaskBoard filtreleri store\'da TUTULMAZ (URL tek kaynak)', () => {
      const state = useUIStore.getState() as Record<string, unknown>;
      expect(state.filter).toBeUndefined();
      expect(state.setFilter).toBeUndefined();
      expect(state.resetFilter).toBeUndefined();
    });
  });

  describe('tema', () => {
    it('setTheme temayı günceller', () => {
      useUIStore.getState().setTheme('dark');
      expect(useUIStore.getState().theme).toBe('dark');
    });
  });
});
