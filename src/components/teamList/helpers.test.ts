import { describe, it, expect } from 'vitest';
import {
  buildActiveTaskCountByUser, makeGetActiveTaskCount, buildStaffByDepartment,
  getIndependentStaff, computeCapacitySummary, computeDepartmentCapacity,
} from './helpers';
import type { Task, User } from '../../types';

const user = (over: Partial<User>): User => ({
  uid: 'u1', email: 'u1@makam.com', fullName: 'Test User', role: 'Staff', ...over,
});

const task = (over: Partial<Task>): Task => ({
  id: 't1', title: 'T', description: '', status: 'IN_PROGRESS', priority: 'Medium',
  assigneeId: 'u1', departmentId: 'Operasyon', createdAt: 0, updatedAt: 0, deadline: 0,
  lockVersion: 1, ...over,
} as Task);

describe('buildActiveTaskCountByUser', () => {
  it('sayar ve COMPLETED/CANCELLED durumlarını hariç tutar', () => {
    const tasks = [
      task({ id: 't1', assigneeId: 'u1', status: 'IN_PROGRESS' }),
      task({ id: 't2', assigneeId: 'u1', status: 'BLOCKED' }),
      task({ id: 't3', assigneeId: 'u1', status: 'COMPLETED' }),
      task({ id: 't4', assigneeId: 'u2', status: 'CANCELLED' }),
    ];
    const map = buildActiveTaskCountByUser(tasks);
    expect(map.get('u1')).toBe(2);
    expect(map.has('u2')).toBe(false);
  });
});

describe('makeGetActiveTaskCount', () => {
  it('uid ve email farklıysa ikisini de toplar', () => {
    const map = new Map([['u1', 2], ['u1@makam.com', 1]]);
    const getCount = makeGetActiveTaskCount(map);
    expect(getCount({ uid: 'u1', email: 'u1@makam.com' })).toBe(3);
  });

  it('uid == email ise çift saymaz', () => {
    const map = new Map([['same@makam.com', 2]]);
    const getCount = makeGetActiveTaskCount(map);
    expect(getCount({ uid: 'same@makam.com', email: 'same@makam.com' })).toBe(2);
  });
});

describe('buildStaffByDepartment / getIndependentStaff', () => {
  const users = [
    user({ uid: 's1', role: 'Staff', departmentId: 'Operasyon' }),
    user({ uid: 's2', role: 'Staff', departmentId: 'Operasyon' }),
    user({ uid: 's3', role: 'Staff', departmentId: 'Yalniz' }),
    user({ uid: 'm1', role: 'Manager', departmentId: 'Operasyon' }),
  ];

  it('personeli departmana göre gruplar', () => {
    const map = buildStaffByDepartment(users);
    expect(map.get('Operasyon')?.length).toBe(2);
    expect(map.get('Yalniz')?.length).toBe(1);
  });

  it('yöneticisi olmayan departmandaki personeli bağımsız sayar', () => {
    const independent = getIndependentStaff(users);
    expect(independent.map(u => u.uid)).toEqual(['s3']);
  });
});

describe('computeCapacitySummary', () => {
  it('veri yoksa hasCapacityData false döner', () => {
    const summary = computeCapacitySummary([], () => 0);
    expect(summary.hasCapacityData).toBe(false);
    expect(summary.capacityPercent).toBe(0);
  });

  it('müsait (<=2) ve aşırı yüklü (>=5) personeli ayrıştırır', () => {
    const staff = [user({ uid: 'a' }), user({ uid: 'b' })];
    const counts: Record<string, number> = { a: 1, b: 6 };
    const summary = computeCapacitySummary(staff, (u) => counts[u.uid] ?? 0);
    expect(summary.availableStaffCount).toBe(1);
    expect(summary.overloadedStaffCount).toBe(1);
    expect(summary.hasCapacityData).toBe(true);
  });
});

describe('computeDepartmentCapacity', () => {
  it('departmansız personeli ayrı bir grup olarak gösterir, yoksaymaz', () => {
    const staffByDepartment = new Map<string, User[]>([
      ['', [user({ uid: 'x', departmentId: undefined })]],
    ]);
    const rows = computeDepartmentCapacity(staffByDepartment, () => 4);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.department).toBe('Departmansız');
  });

  it('yüzdeye göre azalan sırada döner', () => {
    const staffByDepartment = new Map<string, User[]>([
      ['Az', [user({ uid: 'a' })]],
      ['Cok', [user({ uid: 'b' })]],
    ]);
    const counts: Record<string, number> = { a: 1, b: 4 };
    const rows = computeDepartmentCapacity(staffByDepartment, (u) => counts[u.uid] ?? 0);
    expect(rows[0]!.department).toBe('Cok');
    expect(rows[1]!.department).toBe('Az');
  });
});
