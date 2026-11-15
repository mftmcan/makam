import { describe, it, expect } from 'vitest';
import { mergeDataState } from './dataStore';
import type { Task } from '../types';

const baseState = {
  tasks: [] as Task[],
  users: [],
  blockers: [],
  resolvedBlockers: [],
  stats: null,
  isHydrated: false,
  hasLiveTasks: false,
  hasLiveUsers: false,
  hasLiveBlockers: false,
  hasLiveResolvedBlockers: false,
  hasLiveStats: false,
  taskLimit: 200,
  setTasks: () => {},
  setUsers: () => {},
  setBlockers: () => {},
  setResolvedBlockers: () => {},
  setStats: () => {},
  setHydrated: () => {},
  loadMoreTasks: () => {},
  reset: () => {},
};

describe('mergeDataState — IDB rehydration yarışı koruması', () => {
  it('oturum kapandıktan sonra tamamlanan IDB okuması eski verileri geri getirmez', () => {
    const currentState = { ...baseState, cacheInvalidated: true };
    const result = mergeDataState({ tasks: [{ id: 'previous-user-task' }] }, currentState);
    expect(result.tasks).toEqual([]);
    expect(result).toBe(currentState);
  });
  it('canlı veri henüz gelmediyse (normal akış) IDB\'den gelen önbellek uygulanır', () => {
    const persisted = { tasks: [{ id: 'cached-task' }] as Task[] };
    const result = mergeDataState(persisted, { ...baseState, hasLiveTasks: false });
    expect(result.tasks).toEqual(persisted.tasks);
  });

  it('rehydration tamamlanmadan ÖNCE canlı Firestore verisi geldiyse, IDB önbelleği taze veriyi EZMEZ', () => {
    const liveTasks: Task[] = [{ id: 'live-task' } as Task];
    const currentState = { ...baseState, tasks: liveTasks, hasLiveTasks: true };
    const stalePersisted = { tasks: [{ id: 'stale-cached-task' }] as Task[] };

    const result = mergeDataState(stalePersisted, currentState);

    // Bayat IDB verisi değil, o oturumda zaten gelmiş canlı veri korunur
    expect(result.tasks).toEqual(liveTasks);
    expect(result.tasks).not.toEqual(stalePersisted.tasks);
  });

  it('resolvedBlockers, blockers ile AYNI ama BAĞIMSIZ hasLive* bayrağını kullanır (bkz. kod denetimi: eskiden bu alan hiç yoktu)', () => {
    const liveResolved = [{ id: 'live-resolved' }] as Task[];
    const currentState = { ...baseState, resolvedBlockers: liveResolved, hasLiveResolvedBlockers: true };
    const stalePersisted = { resolvedBlockers: [{ id: 'stale-resolved' }] as Task[] };

    const result = mergeDataState(stalePersisted, currentState);

    expect(result.resolvedBlockers).toEqual(liveResolved);
  });

  it('bir alanın (stats) canlı verisi erken gelse bile, henüz canlı verisi gelmemiş DİĞER bir alan (tasks) IDB önbelleğinden geri yüklenmeye devam eder', () => {
    // Bu, düzeltilen yarış durumunu doğrudan test eder: eskiden tek paylaşılan
    // hasLiveData bayrağı, hızlı dönen stats dinleyicisi yüzünden erken true
    // olup tasks'ın IDB'den geri yüklenmesini de engelliyordu.
    const currentState = { ...baseState, stats: { totalTasks: 5 } as any, hasLiveStats: true, hasLiveTasks: false };
    const persisted = { tasks: [{ id: 'cached-task' }] as Task[], stats: { totalTasks: 999 } as any };

    const result = mergeDataState(persisted, currentState);

    expect(result.tasks).toEqual(persisted.tasks);
    expect(result.stats).toEqual({ totalTasks: 5 }); // canlı stats korunur, IDB'deki bayat değer değil
  });
});

// NOT: `reset` action'ının kendisi burada DOĞRUDAN test edilmiyor — gerçek
// useDataStore örneğini çağırmak persist middleware'i (idb-keyval →
// IndexedDB) tetikliyor ve jsdom'da IndexedDB olmadığından yakalanmamış
// promise reddi üretiyor (bu dosyanın geri kalanının neden yalnızca saf
// `mergeDataState` fonksiyonunu test ettiğinin nedeni de bu). `reset`'in
// doğru zamanda (logout) çağrıldığı, store'un mock'landığı
// hooks/useFirestoreData.test.ts içinde ayrıca test ediliyor.
