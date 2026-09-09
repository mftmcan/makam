import type { Task, User } from '../../types';

/**
 * Kullanıcı başına aktif görev sayısını tek geçişte hesaplar — aksi halde
 * her personel için tasks dizisi ayrı ayrı filtrelenir (O(kullanıcı × görev)
 * yerine burada tek O(görev) geçiş + O(1) lookup). `getActiveTaskCount` hem
 * uid hem email anahtarını dener çünkü `assigneeId` bazen uid bazen email
 * olabiliyor.
 */
export function buildActiveTaskCountByUser(tasks: Task[]): Map<string, number> {
  const map = new Map<string, number>();
  const bump = (key: string | undefined) => {
    if (!key) return;
    map.set(key, (map.get(key) ?? 0) + 1);
  };
  for (const t of tasks) {
    if (t.status === 'COMPLETED' || t.status === 'CANCELLED') continue;
    bump(t.assigneeId);
  }
  return map;
}

export function makeGetActiveTaskCount(activeTaskCountByUser: Map<string, number>) {
  return (u: { uid: string; email: string }) =>
    (activeTaskCountByUser.get(u.uid) ?? 0) + (u.email !== u.uid ? (activeTaskCountByUser.get(u.email) ?? 0) : 0);
}

/** Şema (tree) görünümünde her yönetici için ayrı ayrı users.filter() çağırmak
 *  yerine (O(yönetici × personel)) departman başına tek geçişte gruplanır. */
export function buildStaffByDepartment(users: User[]): Map<string, User[]> {
  const map = new Map<string, User[]>();
  for (const u of users) {
    if (u.role !== 'Staff') continue;
    const key = u.departmentId ?? '';
    const list = map.get(key);
    if (list) list.push(u); else map.set(key, [u]);
  }
  return map;
}

export function getIndependentStaff(users: User[]): User[] {
  return users.filter(u =>
    u.role === 'Staff' && (!u.departmentId || !users.some(m => m.role === 'Manager' && m.departmentId === u.departmentId))
  );
}

export interface CapacitySummary {
  capacityPercent: number;
  availableStaffCount: number;
  overloadedStaffCount: number;
  hasCapacityData: boolean;
}

export function computeCapacitySummary(
  staffUsers: User[],
  getActiveTaskCount: (u: { uid: string; email: string }) => number
): CapacitySummary {
  let total = 0, available = 0, overloaded = 0;
  for (const u of staffUsers) {
    const count = getActiveTaskCount(u);
    total += count;
    if (count <= 2) available++;
    if (count >= 5) overloaded++;
  }
  const max = Math.max(1, staffUsers.length * 4);
  return {
    capacityPercent: Math.min(100, Math.round((total / max) * 100)),
    availableStaffCount: available,
    overloadedStaffCount: overloaded,
    hasCapacityData: total > 0,
  };
}

export interface DepartmentCapacityRow {
  department: string;
  percent: number;
  staffCount: number;
}

/**
 * Tek bir organizasyon-geneli yüzde, "hangi BİRİM gerçekten aşırı yüklü"
 * sorusuna cevap vermiyordu — iki dengeli departman ortalamada dengeli
 * görünüp aslında biri boşta biri tıka basa dolu olabilirdi (bkz. tasarım
 * denetimi). `computeCapacitySummary` ile AYNI formül (aktif görev / (kişi ×
 * 4)) yalnızca departman bazında tekrarlanır. Departmansız ('') personel ayrı
 * bir grup olarak gösterilir, yoksayılmaz.
 */
export function computeDepartmentCapacity(
  staffByDepartment: Map<string, User[]>,
  getActiveTaskCount: (u: { uid: string; email: string }) => number
): DepartmentCapacityRow[] {
  const rows: DepartmentCapacityRow[] = [];
  for (const [dept, staffList] of staffByDepartment.entries()) {
    if (staffList.length === 0) continue;
    let total = 0;
    for (const u of staffList) total += getActiveTaskCount(u);
    const max = Math.max(1, staffList.length * 4);
    rows.push({
      department: dept || 'Departmansız',
      percent: Math.min(100, Math.round((total / max) * 100)),
      staffCount: staffList.length,
    });
  }
  return rows.sort((a, b) => b.percent - a.percent);
}
