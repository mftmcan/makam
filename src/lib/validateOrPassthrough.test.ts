import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateOrPassthrough } from './validateOrPassthrough';
import { logError } from '../services/errorLoggingService';

vi.mock('../services/errorLoggingService', () => ({ logError: vi.fn().mockResolvedValue('log-ref') }));

const okSchema = {
  safeParse: (data: unknown) => ({ success: true as const, data: { ...(data as object), normalized: true } }),
};

const failSchema = {
  safeParse: () => ({ success: false as const, error: new Error('şema uyumsuz') }),
};

describe('validateOrPassthrough', () => {
  let now = 1_700_000_000_000;

  beforeEach(() => {
    now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.mocked(logError).mockClear();
  });

  afterEach(async () => {
    await vi.dynamicImportSettled();
    vi.restoreAllMocks();
  });

  it('doğrulama başarılıysa şemanın döndürdüğü (normalize edilmiş) veriyi verir', () => {
    const result = validateOrPassthrough(okSchema, { id: '1' }, 'doc-1', 'tasks');
    expect(result).toEqual({ id: '1', normalized: true });
    expect(logError).not.toHaveBeenCalled();
  });

  it('doğrulama başarısızsa ham veriyi olduğu gibi döndürür (listeyi karartmaz)', () => {
    const raw = { id: 'broken' };
    const result = validateOrPassthrough(failSchema, raw, 'doc-2', 'schema-fallback-test');
    expect(result).toBe(raw);
  });

  it("şema hatasını errorLoggingService üzerinden Firestore'a (error_logs) bildirir (P1-10)", async () => {
    validateOrPassthrough(failSchema, { id: 'broken' }, 'doc-3', 'users');
    await vi.dynamicImportSettled();

    expect(logError).toHaveBeenCalledTimes(1);
    const [, , payload] = vi.mocked(logError).mock.calls[0]!;
    expect(payload).toMatchObject({
      operationType: 'schema-validation',
      path: 'users/doc-3',
      context: { collectionName: 'users', docId: 'doc-3' },
    });
  });

  it('aynı koleksiyon için art arda gelen hataları soğuma süresi dolmadan tekrar bildirmez', async () => {
    validateOrPassthrough(failSchema, { id: 'a' }, 'doc-a', 'blockers');
    await vi.dynamicImportSettled();
    expect(logError).toHaveBeenCalledTimes(1);

    now += 60 * 1000; // 1 dakika sonra — 5 dakikalık soğuma dolmadı
    validateOrPassthrough(failSchema, { id: 'b' }, 'doc-b', 'blockers');
    validateOrPassthrough(failSchema, { id: 'c' }, 'doc-c', 'blockers');
    await vi.dynamicImportSettled();

    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('soğuma süresi dolduktan sonra aynı koleksiyon için tekrar bildirir', async () => {
    validateOrPassthrough(failSchema, { id: 'a' }, 'doc-a', 'notifications');
    await vi.dynamicImportSettled();
    expect(logError).toHaveBeenCalledTimes(1);

    now += 5 * 60 * 1000 + 1;
    validateOrPassthrough(failSchema, { id: 'b' }, 'doc-b', 'notifications');
    await vi.dynamicImportSettled();

    expect(logError).toHaveBeenCalledTimes(2);
  });

  it('farklı koleksiyonlar birbirinin soğuma süresini etkilemez', async () => {
    validateOrPassthrough(failSchema, { id: 'a' }, 'doc-a', 'audit_logs');
    validateOrPassthrough(failSchema, { id: 'b' }, 'doc-b', 'system-stats-test');
    await vi.dynamicImportSettled();

    expect(logError).toHaveBeenCalledTimes(2);
  });
});
