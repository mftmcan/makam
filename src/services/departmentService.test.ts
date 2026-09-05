import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  departmentService,
  isUsableAsDepartmentId,
  normalizeDepartmentName,
} from './departmentService';
import * as firebase from '../firebase';
import type { Department } from '../types';

type DocRefStub = { __col: string; __id?: string };
type SnapshotDocStub = { id: string; data: () => Record<string, unknown> };

const mockedDoc = vi.mocked(firebase.doc) as unknown as {
  mockImplementation: (fn: (db: unknown, col: string, id?: string) => DocRefStub) => void;
};
const mockedCollection = vi.mocked(firebase.collection) as unknown as {
  mockImplementation: (fn: (db: unknown, name: string) => { __name: string }) => void;
};
const mockedSetDoc = vi.mocked(firebase.setDoc) as unknown as {
  mockResolvedValue: (v: undefined) => void;
  mock: { calls: unknown[][] };
};
const mockedGetDocs = vi.mocked(firebase.getDocs) as unknown as {
  mockResolvedValue: (v: { docs: SnapshotDocStub[] }) => void;
};
const mockedOnSnapshot = vi.mocked(firebase.onSnapshot) as unknown as {
  mockImplementation: (
    fn: (
      q: unknown,
      onNext: (snap: { docs: SnapshotDocStub[] }) => void,
      onError: (e: unknown) => void
    ) => () => void
  ) => void;
};

const snapshotDoc = (id: string, data: Record<string, unknown>): SnapshotDocStub => ({
  id,
  data: () => data,
});

describe('departmentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDoc.mockImplementation((_db, col, id) => ({ __col: col, __id: id }));
    mockedCollection.mockImplementation((_db, name) => ({ __name: name }));
    mockedSetDoc.mockResolvedValue(undefined);
  });

  describe('isUsableAsDepartmentId', () => {
    it('Türkçe karakter ve boşluk içeren adları kabul eder', () => {
      // Doküman ID'si departmanın KENDİ değeridir; ASCII'ye daraltmak mevcut
      // üretim departmanlarının çoğunu taşınamaz kılardı.
      expect(isUsableAsDepartmentId('İnsan Kaynakları')).toBe(true);
      expect(isUsableAsDepartmentId('Operasyon')).toBe(true);
    });

    it('Firestore doküman ID kısıtlarını ihlal eden adları reddeder', () => {
      expect(isUsableAsDepartmentId('Operasyon/Lojistik')).toBe(false);
      expect(isUsableAsDepartmentId('.')).toBe(false);
      expect(isUsableAsDepartmentId('..')).toBe(false);
      expect(isUsableAsDepartmentId('__proto__')).toBe(false);
      expect(isUsableAsDepartmentId('')).toBe(false);
      expect(isUsableAsDepartmentId('x'.repeat(101))).toBe(false);
    });
  });

  describe('normalizeDepartmentName', () => {
    it('yalnızca baştaki/sondaki boşluğu kırpar', () => {
      expect(normalizeDepartmentName('  Operasyon  ')).toBe('Operasyon');
    });

    it('büyük/küçük harfi DEĞİŞTİRMEZ (değer aynı zamanda doküman ID\'sidir)', () => {
      // Normalize edilmiş bir ad, mevcut tasks/users kayıtlarındaki ham
      // string değerle eşleşmez ve sessizce yeni bir departman üretirdi.
      expect(normalizeDepartmentName('OPERASYON')).toBe('OPERASYON');
    });
  });

  describe('createDepartment', () => {
    it('doküman ID olarak adın kendisini kullanır ve şemaya uygun alanları yazar', async () => {
      await departmentService.createDepartment('  Operasyon  ', 'admin-1');

      expect(firebase.doc).toHaveBeenCalledWith(firebase.db, 'departments', 'Operasyon');
      const [, data] = mockedSetDoc.mock.calls[0] as [unknown, Record<string, unknown>];
      expect(data).toMatchObject({ name: 'Operasyon', createdBy: 'admin-1' });
      expect(data.createdAt).toBeTypeOf('number');
    });

    it('name alanı doküman ID ile birebir aynı yazılır (hayalet departman koruması)', async () => {
      await departmentService.createDepartment('İnsan Kaynakları', 'admin-1');
      const [ref, data] = mockedSetDoc.mock.calls[0] as [DocRefStub, Record<string, unknown>];
      expect(ref.__id).toBe('İnsan Kaynakları');
      expect(data.name).toBe('İnsan Kaynakları');
    });

    it('geçersiz ad (eğik çizgi) için yazma denemeden hata fırlatır', async () => {
      await expect(departmentService.createDepartment('Operasyon/Lojistik', 'admin-1')).rejects.toThrow(/geçersiz/i);
      expect(firebase.setDoc).not.toHaveBeenCalled();
    });

    it('zaten var olan bir birim için YENİDEN YAZMAZ (createdAt kuralı korunur)', async () => {
      const existing: Department[] = [{ id: 'Operasyon', name: 'Operasyon', createdAt: 1, createdBy: 'admin-1' }];
      const result = await departmentService.createDepartment('Operasyon', 'admin-2', existing);

      expect(result).toBe('Operasyon');
      expect(firebase.setDoc).not.toHaveBeenCalled();
    });
  });

  describe('okuma', () => {
    it('listAll doküman ID\'sini id VE name olarak doldurur, Türkçe sıralar', async () => {
      mockedGetDocs.mockResolvedValue({
        docs: [
          snapshotDoc('Zabıta', { name: 'Zabıta', createdAt: 2, createdBy: 'admin-1' }),
          snapshotDoc('Çevre', { name: 'Çevre', createdAt: 1, createdBy: 'admin-1' }),
        ],
      });

      const list = await departmentService.listAll();

      expect(list.map(d => d.id)).toEqual(['Çevre', 'Zabıta']);
      expect(list[0]).toMatchObject({ id: 'Çevre', name: 'Çevre' });
    });

    it('name alanı eksik bir eski kayıtta doküman ID\'si ada düşer', async () => {
      mockedGetDocs.mockResolvedValue({
        docs: [snapshotDoc('Operasyon', { createdAt: 1, createdBy: 'admin-1' })],
      });

      const list = await departmentService.listAll();
      expect(list[0]?.name).toBe('Operasyon');
    });

    it('subscribe, snapshot verisini sıralanmış olarak iletir ve aboneliği döndürür', () => {
      const unsubscribe = vi.fn();
      mockedOnSnapshot.mockImplementation((_q, onNext) => {
        onNext({
          docs: [
            snapshotDoc('Operasyon', { name: 'Operasyon', createdAt: 2, createdBy: 'admin-1' }),
            snapshotDoc('Basın', { name: 'Basın', createdAt: 1, createdBy: 'admin-1' }),
          ],
        });
        return unsubscribe;
      });

      const onNext = vi.fn();
      const stop = departmentService.subscribe(onNext, vi.fn());

      expect(onNext).toHaveBeenCalledOnce();
      const emitted = onNext.mock.calls[0]?.[0] as Department[];
      expect(emitted.map(d => d.id)).toEqual(['Basın', 'Operasyon']);

      stop();
      expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('subscribe hata geri çağrısını dışarı iletir', () => {
      mockedOnSnapshot.mockImplementation((_q, _onNext, onError) => {
        onError(new Error('izin yok'));
        return vi.fn();
      });

      const onError = vi.fn();
      departmentService.subscribe(vi.fn(), onError);

      expect(onError).toHaveBeenCalledOnce();
    });
  });

  /**
   * Yeniden adlandırma ve silme — referans taşımanın kendisi.
   *
   * Bu blok, `name == doküman ID` invaryantının doğurduğu tasarımı doğrular:
   * yeniden adlandırma yerinde bir güncelleme DEĞİL, üç adımlı bir taşımadır
   * (yeni doküman → referanslar → eski dokümanın silinmesi) ve bu adımların
   * SIRASI güvenlik kurallarının bir gereğidir (bkz. departmentService
   * renameDepartment yorumu: kurallar aynı batch içindeki yazımları görmez).
   */
  describe('renameDepartment / deleteDepartment', () => {
    type FakeBatch = {
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      commit: ReturnType<typeof vi.fn>;
    };

    /** departments/{id} için sahte sunucu durumu. */
    let departmentDocs: Record<string, Record<string, unknown> | undefined>;
    /** `departmentId == 'Operasyon'` olan tasks/users doküman ID'leri. */
    let references: { tasks: string[]; users: string[] };
    let batches: FakeBatch[];

    beforeEach(() => {
      departmentDocs = { Operasyon: { name: 'Operasyon', createdAt: 111, createdBy: 'kurucu-admin' } };
      references = { tasks: [], users: [] };
      batches = [];

      // Sorgu YAPISINI taşıyan sahteler: getDocs'un hangi koleksiyona ve hangi
      // imleçten sonra sorulduğunu çağrı SIRASINDAN değil sorgunun kendisinden
      // okuyabilmek için (tasks/users taramaları Promise.all ile paralel
      // koştuğundan sıraya dayalı bir sahte kırılgan olurdu).
      vi.mocked(firebase.where).mockImplementation(
        ((field: string, op: string, value: unknown) => ({ __t: 'where', field, op, value })) as any
      );
      vi.mocked(firebase.orderBy).mockImplementation((() => ({ __t: 'orderBy' })) as any);
      vi.mocked(firebase.documentId).mockImplementation((() => '__name__') as any);
      vi.mocked(firebase.limit).mockImplementation(((n: number) => ({ __t: 'limit', n })) as any);
      vi.mocked(firebase.startAfter).mockImplementation(((cursor: any) => ({ __t: 'startAfter', cursor })) as any);
      vi.mocked(firebase.query).mockImplementation(
        ((base: any, ...constraints: any[]) => ({ col: base.__name, constraints })) as any
      );

      vi.mocked(firebase.getDoc).mockImplementation((async (ref: any) => {
        const data = departmentDocs[ref.__id as string];
        return { exists: () => data !== undefined, data: () => data };
      }) as any);

      vi.mocked(firebase.getDocs).mockImplementation((async (q: any) => {
        const ids = references[q.col as 'tasks' | 'users'] ?? [];
        const after = q.constraints.find((c: any) => c.__t === 'startAfter')?.cursor;
        const pageSize = q.constraints.find((c: any) => c.__t === 'limit')?.n ?? ids.length;
        const start = after ? ids.indexOf(after.id) + 1 : 0;
        return { docs: ids.slice(start, start + pageSize).map((id: string) => ({ id })) };
      }) as any);

      vi.mocked(firebase.getCountFromServer).mockImplementation((async (q: any) => ({
        data: () => ({ count: (references[q.col as 'tasks' | 'users'] ?? []).length }),
      })) as any);

      vi.mocked(firebase.writeBatch).mockImplementation((() => {
        const batch: FakeBatch = {
          update: vi.fn(), delete: vi.fn(), commit: vi.fn().mockResolvedValue(undefined),
        };
        batches.push(batch);
        return batch;
      }) as any);

      vi.mocked(firebase.deleteDoc).mockResolvedValue(undefined as any);
    });

    describe('renameDepartment', () => {
      it('yeni dokümanı ÖNCE ayrı bir yazımla oluşturur, referansları sonra taşır, eski dokümanı EN SON siler', async () => {
        references.tasks = ['t1', 't2'];
        references.users = ['u1'];

        const result = await departmentService.renameDepartment('Operasyon', 'Zabıta', 'admin-9');

        expect(result).toEqual({ tasksUpdated: 2, usersUpdated: 1 });

        // (1) Yeni doküman batch'in DIŞINDA ve referans yazımlarından ÖNCE:
        // kurallar (isValidTaskBusinessRules/userDepartmentIsValid) hedef
        // departmanı exists() ile arar ve aynı batch içindeki yazımı GÖRMEZ.
        expect(firebase.setDoc).toHaveBeenCalledOnce();
        const [newRef] = mockedSetDoc.mock.calls[0] as [DocRefStub, Record<string, unknown>];
        expect(newRef).toMatchObject({ __col: 'departments', __id: 'Zabıta' });
        expect(batches).toHaveLength(1);
        const batch = batches[0]!;
        expect(mockedSetDoc.mock.calls.length).toBe(1);
        expect((firebase.setDoc as any).mock.invocationCallOrder[0])
          .toBeLessThan(batch.update.mock.invocationCallOrder[0]);

        // (2) Referanslar: yalnızca departmentId yazılır — updatedAt/lockVersion
        // bilinçli olarak ELLENMEZ (yönetim taşıması, kullanıcı eylemi değil).
        expect(batch.update).toHaveBeenCalledTimes(3);
        expect(batch.update.mock.calls.map(c => c[0])).toEqual([
          { __col: 'tasks', __id: 't1' },
          { __col: 'tasks', __id: 't2' },
          { __col: 'users', __id: 'u1' },
        ]);
        expect(batch.update.mock.calls.map(c => c[1])).toEqual([
          { departmentId: 'Zabıta' }, { departmentId: 'Zabıta' }, { departmentId: 'Zabıta' },
        ]);

        // (3) Eski doküman en son ve AYNI commit'in sonunda silinir.
        expect(batch.delete).toHaveBeenCalledWith({ __col: 'departments', __id: 'Operasyon' });
        expect(batch.delete.mock.invocationCallOrder[0])
          .toBeGreaterThan(batch.update.mock.invocationCallOrder[2]);
        expect(batch.commit).toHaveBeenCalledOnce();
      });

      it('createdAt/createdBy eski kayıttan DEVRALINIR (yeniden adlandırma yeni bir kuruluş değildir)', async () => {
        await departmentService.renameDepartment('Operasyon', 'Zabıta', 'admin-9');

        const [, data] = mockedSetDoc.mock.calls[0] as [DocRefStub, Record<string, unknown>];
        expect(data).toEqual({ name: 'Zabıta', createdAt: 111, createdBy: 'kurucu-admin' });
      });

      it('eski kayıtta createdAt/createdBy bozuksa güvenli varsayılana düşer (kural reddini önler)', async () => {
        departmentDocs.Operasyon = { name: 'Operasyon' };

        await departmentService.renameDepartment('Operasyon', 'Zabıta', 'admin-9');

        const [, data] = mockedSetDoc.mock.calls[0] as [DocRefStub, Record<string, unknown>];
        expect(data.createdBy).toBe('admin-9');
        expect(data.createdAt).toBeTypeOf('number');
        expect(data.createdAt as number).toBeGreaterThan(0);
      });

      it('yeni ad normalize edilir (yalnızca boşluk kırpma)', async () => {
        await departmentService.renameDepartment('Operasyon', '  Zabıta  ', 'admin-9');

        const [ref, data] = mockedSetDoc.mock.calls[0] as [DocRefStub, Record<string, unknown>];
        expect(ref.__id).toBe('Zabıta');
        expect(data.name).toBe('Zabıta');
      });

      it('hedef ad zaten kayıtlıysa reddeder ve HİÇBİR yazım yapmaz (birleştirme kapsam dışı)', async () => {
        departmentDocs['Zabıta'] = { name: 'Zabıta', createdAt: 5, createdBy: 'admin-1' };
        references.tasks = ['t1'];

        await expect(departmentService.renameDepartment('Operasyon', 'Zabıta', 'admin-9'))
          .rejects.toThrow(/zaten var/i);

        expect(firebase.setDoc).not.toHaveBeenCalled();
        expect(batches).toHaveLength(0);
      });

      it('kaynak birim yoksa reddeder', async () => {
        await expect(departmentService.renameDepartment('Yok Böyle Birim', 'Zabıta', 'admin-9'))
          .rejects.toThrow(/bulunamadı/i);
        expect(firebase.setDoc).not.toHaveBeenCalled();
      });

      it('geçersiz yeni ad (eğik çizgi) için okuma bile yapmadan hata fırlatır', async () => {
        await expect(departmentService.renameDepartment('Operasyon', 'Zabıta/Trafik', 'admin-9'))
          .rejects.toThrow(/geçersiz/i);
        expect(firebase.getDoc).not.toHaveBeenCalled();
        expect(firebase.setDoc).not.toHaveBeenCalled();
      });

      it('yeni ad mevcut adla aynıysa reddeder (anlamsız taşıma)', async () => {
        await expect(departmentService.renameDepartment('Operasyon', '  Operasyon  ', 'admin-9'))
          .rejects.toThrow(/aynı/i);
        expect(firebase.setDoc).not.toHaveBeenCalled();
      });

      it('500 batch sınırını aşan referans sayısında parçalara böler ve hiçbir referansı atlamaz', async () => {
        // 460 görev → sayfalama (300'lük sayfa) İKİ okuma turu gerektirir;
        // yazma tarafında 460 update + 1 delete = 461 işlem, 450'lik parçalarla
        // İKİ commit eder. Tek batch'e sığdırmaya çalışmak Firestore'un 500
        // işlem sınırına takılırdı (ve sessizce kesmek yetim referans bırakırdı).
        references.tasks = Array.from({ length: 460 }, (_, i) => `t${i}`);

        const result = await departmentService.renameDepartment('Operasyon', 'Zabıta', 'admin-9');

        expect(result.tasksUpdated).toBe(460);
        expect(batches).toHaveLength(2);
        expect(batches[0]!.update).toHaveBeenCalledTimes(450);
        expect(batches[1]!.update).toHaveBeenCalledTimes(10);

        const updatedIds = [...batches[0]!.update.mock.calls, ...batches[1]!.update.mock.calls]
          .map(c => (c[0] as DocRefStub).__id);
        expect(new Set(updatedIds).size).toBe(460);

        // Silme YALNIZCA son parçada: referansların tamamı taşınmadan eski
        // doküman kaybolursa aradaki kayıtlar "var olmayan departman" durumuna
        // düşer ve kendi kurallarınca güncellenemez hâle gelir.
        expect(batches[0]!.delete).not.toHaveBeenCalled();
        expect(batches[1]!.delete).toHaveBeenCalledOnce();
      });
    });

    describe('deleteDepartment', () => {
      it('hâlâ referans veren görev/kullanıcı varsa siler DEĞİL, sayıları içeren bir hata fırlatır', async () => {
        references.tasks = ['t1', 't2'];
        references.users = ['u1'];

        await expect(departmentService.deleteDepartment('Operasyon'))
          .rejects.toThrow(/2 görev ve 1 kullanıcı/);

        expect(firebase.deleteDoc).not.toHaveBeenCalled();
      });

      it('yalnızca kullanıcı referansı olsa bile reddeder', async () => {
        references.users = ['u1'];

        await expect(departmentService.deleteDepartment('Operasyon')).rejects.toThrow(/kullanılıyor/i);
        expect(firebase.deleteDoc).not.toHaveBeenCalled();
      });

      it('hiç referans yoksa dokümanı siler', async () => {
        await departmentService.deleteDepartment('Operasyon');

        expect(firebase.deleteDoc).toHaveBeenCalledWith({ __col: 'departments', __id: 'Operasyon' });
      });

      it('referans kontrolü SUNUCUYA giden count() ile yapılır (offline önbellek yanlış yeşil ışık vermesin)', async () => {
        await departmentService.deleteDepartment('Operasyon');

        // tasks + users için birer agregasyon; doküman ÇEKİLMEZ.
        expect(firebase.getCountFromServer).toHaveBeenCalledTimes(2);
        expect(firebase.getDocs).not.toHaveBeenCalled();
      });
    });
  });
});
