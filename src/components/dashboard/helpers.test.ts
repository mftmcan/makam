import { describe, it, expect } from 'vitest';
import { computeStats, computeCompletionRatePercent, computeHealthScore, computeMovingAverage, computeCompletedTrend } from './helpers';
import type { Task } from '../../types';
import type { GlobalStats } from '../../store/dataStore';

const now = Date.parse('2026-08-26T12:00:00');

const baseTask: Task = {
  id: 't-1', title: 'Talimat', description: '', creatorId: 'admin-1', assigneeId: 'staff-1',
  status: 'ASSIGNED', priority: 'Medium', deadline: now + 100_000,
  createdAt: now, updatedAt: now, totalPausedTime: 0, lockVersion: 0,
  tags: [], checklist: [], comments: [],
} as Task;

const emptyGlobalStats: GlobalStats = {
  totalTasks: 0, status_ASSIGNED: 0, status_PENDING_DELEGATION: 0, status_IN_PROGRESS: 0,
  status_AWAITING_APPROVAL: 0, status_COMPLETED: 0, status_BLOCKED: 0, status_CANCELLED: 0, status_CRISIS: 0,
};

describe('computeStats — "Bekleyen" kartı, globalStats ve yerel hesap yolları arasında tutarlılık', () => {
  it('globalStats yolu (Admin/Müdür varsayılan pano): ASSIGNED + PENDING_DELEGATION toplamını sayar', () => {
    // Eskiden yalnızca status_ASSIGNED sayılıyordu, status_PENDING_DELEGATION
    // (izin/mazeret devri bekleyen görevler) bu kartta görünmüyordu.
    // totalTasks alt kalemlerin toplamıyla tutarlı verildi (5) — aksi halde
    // aşağıdaki drift-fallback korumasına takılıp yerel (boş) hesaba düşer.
    const stats = computeStats([], now, { ...emptyGlobalStats, status_ASSIGNED: 3, status_PENDING_DELEGATION: 2, totalTasks: 5 }, false, false);
    expect(stats.waiting).toBe(5);
  });

  it('yerel hesap yolu (Staff kişisel görünüm / odak filtresi aktif): ASSIGNED + PENDING_DELEGATION toplamını sayar', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 't1', status: 'ASSIGNED' },
      { ...baseTask, id: 't2', status: 'PENDING_DELEGATION' },
      { ...baseTask, id: 't3', status: 'IN_PROGRESS' },
    ];
    const stats = computeStats(tasks, now, null, false, true);
    expect(stats.waiting).toBe(2);
  });

  it('aynı veri için globalStats ve yerel hesap yolu AYNI "Bekleyen" sayısını üretir', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 't1', status: 'ASSIGNED' },
      { ...baseTask, id: 't2', status: 'ASSIGNED' },
      { ...baseTask, id: 't3', status: 'PENDING_DELEGATION' },
      { ...baseTask, id: 't4', status: 'IN_PROGRESS' },
      { ...baseTask, id: 't5', status: 'COMPLETED' },
    ];
    const localStats = computeStats(tasks, now, null, false, false);
    const matchingGlobalStats: GlobalStats = { ...emptyGlobalStats, status_ASSIGNED: 2, status_PENDING_DELEGATION: 1, status_IN_PROGRESS: 1, status_COMPLETED: 1, totalTasks: tasks.length };
    const globalStatsPath = computeStats(tasks, now, matchingGlobalStats, false, false);

    expect(globalStatsPath.waiting).toBe(localStats.waiting);
    expect(globalStatsPath.waiting).toBe(3);
  });

  it('isFiltered veya kişisel görünümde globalStats verilse bile yok sayılır, her zaman yerel hesap kullanılır', () => {
    const tasks: Task[] = [{ ...baseTask, id: 't1', status: 'PENDING_DELEGATION' }];
    // globalStats kasıtlı olarak yanlış/tutarsız bir değer taşıyor —
    // isFiltered=true olduğundan hiç okunmamalı.
    const stats = computeStats(tasks, now, { ...emptyGlobalStats, status_ASSIGNED: 999 }, true, false);
    expect(stats.waiting).toBe(1);
  });
});

describe('computeStats — globalStats sayaç sapması (drift) korunumu', () => {
  // Firestore'daki totalTasks/status_X sayaçları birbirinden bağımsız
  // increment() çağrılarıyla güncellenir; eşzamanlılık/yeniden deneme
  // senaryolarında birbirinden kopabilirler (bkz. taskService.ts,
  // deleteTask'taki oku-sonra-yaz aralığı). Bu durumda panoda "7 tamamlanan /
  // 6 toplam" gibi imkânsız bir görünüm oluşuyordu (bkz. kod denetimi).
  it('status_COMPLETED, totalTasks\'ı aştığında (sayaç sapması) globalStats yok sayılır, yerel görev listesinden hesaplanır', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 't1', status: 'COMPLETED' },
      { ...baseTask, id: 't2', status: 'COMPLETED' },
      { ...baseTask, id: 't3', status: 'IN_PROGRESS' },
    ];
    // Sapmış sayaç: status_COMPLETED (7) totalTasks'tan (6) büyük — gerçek
    // dünyada asla tutarlı olamaz.
    const driftedGlobalStats: GlobalStats = { ...emptyGlobalStats, totalTasks: 6, status_COMPLETED: 7 };
    const stats = computeStats(tasks, now, driftedGlobalStats, false, false);

    // Sapmış sayaç yerine yerel (canlı, doğru) görev listesinden hesaplanmalı.
    expect(stats.total).toBe(tasks.length);
    expect(stats.completed).toBe(2);
    expect(stats.completed).toBeLessThanOrEqual(stats.total);
  });

  it('alt kalemlerin toplamı totalTasks\'ı aştığında da (tek başına hiçbir kalem total\'ı geçmese bile) yerel hesaba düşer', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 't1', status: 'ASSIGNED' },
      { ...baseTask, id: 't2', status: 'IN_PROGRESS' },
    ];
    const driftedGlobalStats: GlobalStats = {
      ...emptyGlobalStats, totalTasks: 2, status_ASSIGNED: 2, status_IN_PROGRESS: 2,
    };
    const stats = computeStats(tasks, now, driftedGlobalStats, false, false);

    expect(stats.total).toBe(tasks.length);
    expect(stats.waiting).toBe(1);
    expect(stats.inProgress).toBe(1);
  });
});

describe('computeCompletionRatePercent / computeHealthScore — sınır durumları', () => {
  it('görev yokken %0 tamamlanma, ama sağlık skoru %100 döner (boş küme "kötü" değil "veri yok" anlamına gelir)', () => {
    expect(computeCompletionRatePercent([])).toBe(0);
    expect(computeHealthScore(0, 0, 100)).toBe(100);
  });

  it('CANCELLED görevler tamamlanma oranı paydasından çıkarılır', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 't1', status: 'COMPLETED' },
      { ...baseTask, id: 't2', status: 'CANCELLED' },
    ];
    expect(computeCompletionRatePercent(tasks)).toBe(100);
  });
});

describe('computeMovingAverage — PerformanceChart trend çizgisi', () => {
  it('pencere doluyken basit ortalamayı döner', () => {
    // [1, 2, 3] -> pencere 3: ilk gün yalnızca kendisi (1), ikinci gün (1+2)/2,
    // üçüncü gün (1+2+3)/3.
    expect(computeMovingAverage([1, 2, 3], 3)).toEqual([1, 1.5, 2]);
  });

  it('dizinin başında pencere henüz dolmadıysa mevcut kadarıyla daralır (null/NaN DEĞİL)', () => {
    const result = computeMovingAverage([4, 8], 3);
    expect(result[0]).toBe(4);
    expect(result[1]).toBe(6);
  });

  it('pencere boyutu 1 ise girdiyle birebir aynı diziyi döner', () => {
    expect(computeMovingAverage([5, 1, 9], 1)).toEqual([5, 1, 9]);
  });

  it('boş dizi için boş dizi döner', () => {
    expect(computeMovingAverage([], 3)).toEqual([]);
  });
});

describe('computeCompletedTrend — Sağlık Skoru "Bu Hafta" karşılaştırması', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('son 7 gün ve önceki 7 gün tamamlanan sayılarını AYRI AYRI sayar', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 't1', status: 'COMPLETED', completedAt: now - 1 * DAY },       // bu hafta
      { ...baseTask, id: 't2', status: 'COMPLETED', completedAt: now - 6 * DAY },       // bu hafta
      { ...baseTask, id: 't3', status: 'COMPLETED', completedAt: now - 8 * DAY },       // geçen hafta
      { ...baseTask, id: 't4', status: 'COMPLETED', completedAt: now - 13 * DAY },      // geçen hafta
      { ...baseTask, id: 't5', status: 'COMPLETED', completedAt: now - 20 * DAY },      // iki haftadan eski — sayılmaz
      { ...baseTask, id: 't6', status: 'IN_PROGRESS' },                                 // tamamlanmamış — sayılmaz
    ];
    expect(computeCompletedTrend(tasks, now)).toEqual({ current: 2, previous: 2 });
  });

  it('completedAt yoksa updatedAt\'e düşer (eski/backfill öncesi kayıtlar)', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 't1', status: 'COMPLETED', updatedAt: now - 2 * DAY, completedAt: undefined },
    ];
    expect(computeCompletedTrend(tasks, now)).toEqual({ current: 1, previous: 0 });
  });

  it('hiç tamamlanan görev yoksa ikisi de sıfır döner', () => {
    expect(computeCompletedTrend([{ ...baseTask, status: 'IN_PROGRESS' }], now)).toEqual({ current: 0, previous: 0 });
  });
});
