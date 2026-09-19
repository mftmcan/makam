import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuditLogList } from './AuditLogList';
import { auditLogService } from '../services/auditLogService';
import type { AuditLog, Task, User } from '../types';

// Bu ekran denetim kayıtlarını doğrudan Firestore'dan sayfalayarak çeker —
// testin ilgilendiği tek şey ÇEKİLEN kaydın nasıl gösterildiği olduğundan
// okuma katmanı komple mock'lanır.
vi.mock('../services/auditLogService', () => ({
  auditLogService: { fetchFiltered: vi.fn() },
}));

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1', title: 'Yüklü Görevin Başlığı', description: '', creatorId: 'user-1',
  assigneeId: 'user-1', status: 'IN_PROGRESS', priority: 'Medium', deadline: 2000,
  createdAt: 1000, updatedAt: 1000, totalPausedTime: 0, lockVersion: 0, tags: [],
  ...overrides,
} as Task);

const actor: User = { uid: 'user-1', fullName: 'Ali Yılmaz', email: 'ali@makam.com', role: 'Staff' };

const makeLog = (overrides: Partial<AuditLog> = {}): AuditLog => ({
  id: 'log-1', taskId: 'task-1', changedBy: 'user-1', timestamp: 1_700_000_000_000,
  oldValue: 'ASSIGNED', newValue: 'IN_PROGRESS',
  ...overrides,
});

const renderWith = async (logs: AuditLog[], tasks: Task[]) => {
  vi.mocked(auditLogService.fetchFiltered).mockResolvedValue({ logs, lastDoc: null, hasMore: false });
  render(<AuditLogList tasks={tasks} users={[actor]} />);
  await waitFor(() => expect(auditLogService.fetchFiltered).toHaveBeenCalled());
};

describe('AuditLogList — operasyon hedefi (görev başlığı) çözümü', () => {
  beforeEach(() => vi.clearAllMocks());

  // Denetim izi TANIM GEREĞİ eski olayları kapsar, ama bu ekrana geçirilen
  // `tasks` dizisi useFirestoreData'nın taskLimit penceresine tabidir — bu
  // yüzden başlık artık ÖNCE kaydın kendi donmuş `taskTitle`'ından okunur
  // (bkz. kod denetimi P1-14 + taskService.auditTaskTitle).

  it('denormalize taskTitle, yüklü görev listesinden BAĞIMSIZ olarak gösterilir', async () => {
    // Görev yüklü pencerede HİÇ yok (eski/tamamlanmış görev) — eskiden bu
    // satır "Bilinmeyen Talimat" görünüyordu.
    await renderWith([makeLog({ taskId: 'eski-gorev', taskTitle: 'Donmuş Başlık' })], []);

    expect(await screen.findByText('Donmuş Başlık')).toBeInTheDocument();
    expect(screen.queryByText('Bilinmeyen Talimat')).not.toBeInTheDocument();
  });

  it('taskTitle yoksa (bu alandan önce yazılmış eski kayıt) yüklü görev listesine düşer', async () => {
    await renderWith([makeLog()], [makeTask()]);

    expect(await screen.findByText('Yüklü Görevin Başlığı')).toBeInTheDocument();
  });

  it('ne taskTitle ne de yüklü görev varsa "Bilinmeyen Talimat" gösterilir', async () => {
    await renderWith([makeLog({ taskId: 'kayip-gorev' })], []);

    expect(await screen.findByText('Bilinmeyen Talimat')).toBeInTheDocument();
  });

  it('ikisi de varsa öncelik donmuş taskTitle\'dadır (görev sonradan yeniden adlandırılmış olabilir)', async () => {
    // Kayıt, olayın gerçekleştiği ANDAKİ başlığın kanıtıdır; görevin bugünkü
    // adı o anki gerçeği geriye dönük olarak değiştirmemelidir.
    await renderWith(
      [makeLog({ taskTitle: 'Olay Anındaki Başlık' })],
      [makeTask({ title: 'Sonradan Değiştirilen Başlık' })]
    );

    expect(await screen.findByText('Olay Anındaki Başlık')).toBeInTheDocument();
    expect(screen.queryByText('Sonradan Değiştirilen Başlık')).not.toBeInTheDocument();
  });
});

describe('AuditLogList — işlem tipi filtresi SUNUCU tarafında uygulanır (P2-22)', () => {
  beforeEach(() => vi.clearAllMocks());

  // Aktör ve tarih filtreleri zaten sunucudaydı; tip filtresi TEK BAŞINA
  // istemcide kalmıştı ve sunucudan gelen 15'lik sayfanın bir kısmını eliyordu
  // — sayfa 15'ten az satır gösteriyor, kullanıcı "Daha Fazla Yükle"ye tekrar
  // tekrar basmak zorunda kalıyordu (bkz. kod denetimi P2-22).

  const selectType = async (label: string) => {
    const user = userEvent.setup();
    // fetchFiltered çağrılmış olması, promise'in çözülüp component'in
    // loading iskeletinden çıktığı anlamına gelmez (bkz. renderWith) — bu
    // yüzden getByLabelText yerine tekrar deneyen findByLabelText kullanılır
    // (CI'da ara sıra "Unable to find a label" ile patlıyordu).
    await user.selectOptions(await screen.findByLabelText('İşlem Tipi Filtresi'), label);
  };

  it('"Tüm İşlemler" seçiliyken sorguya logType constraint\'i HİÇ geçilmez', async () => {
    await renderWith([makeLog()], []);

    expect(auditLogService.fetchFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ logType: undefined })
    );
  });

  it('tip seçilince sorgu logType ile SIFIRDAN çekilir (istemcide elenmez)', async () => {
    await renderWith([makeLog()], []);
    expect(auditLogService.fetchFiltered).toHaveBeenCalledTimes(1);

    await selectType('Durum Değişiklikleri');

    // Yeni bir sorgu: filtre bir sorgu parametresi olduğundan sayfalama
    // sıfırlanır (cursor null) — aktör/tarih filtreleriyle AYNI davranış.
    await waitFor(() => expect(auditLogService.fetchFiltered).toHaveBeenCalledTimes(2));
    expect(auditLogService.fetchFiltered).toHaveBeenLastCalledWith(
      expect.objectContaining({ logType: 'STATUS', cursor: null })
    );
  });

  it('"İçerik Güncellemeleri" FIELD constraint\'ine çevrilir', async () => {
    await renderWith([makeLog()], []);

    await selectType('İçerik Güncellemeleri');

    await waitFor(() => expect(auditLogService.fetchFiltered).toHaveBeenLastCalledWith(
      expect.objectContaining({ logType: 'FIELD' })
    ));
  });

  it('sunucunun döndürdüğü her kayıt gösterilir — `changes` taşıyan bir STATUS kaydı ELENMEZ', async () => {
    // Eski istemci-taraflı tahmin (`!log.changes && log.newValue !== undefined`)
    // tam da bu kaydı yanlış sınıflandırıyordu: transitionTaskInTransaction hem
    // newValue hem changes yazar. Artık istemcide hiç eleme yok — bu testin
    // kırılması, elemenin geri geldiği anlamına gelir.
    await renderWith(
      [makeLog({ taskTitle: 'Geçiş Kaydı', logType: 'STATUS', changes: { status: { old: 'ASSIGNED', new: 'IN_PROGRESS' } } })],
      []
    );

    await selectType('Durum Değişiklikleri');

    expect(await screen.findByText('Geçiş Kaydı')).toBeInTheDocument();
    expect(screen.queryByText('Kayıt Bulunamadı')).not.toBeInTheDocument();
  });

  it('tip filtresi seçiliyken geriye dönük uyumluluk notu gösterilir, "Tüm İşlemler"de gösterilmez', async () => {
    // logType alanı bu değişiklikten önce yazılmış kayıtlarda YOK ve Firestore
    // `where` eşitliği alanı olmayan dokümanı asla eşleştirmez — backfill
    // yapılmadığı için eski kayıtlar tip filtresinde sessizce kaybolur. Bunu
    // kullanıcıdan gizlemek, sunucu-taraflı filtrelemeyle önlemeye
    // çalıştığımız "hiç kayıt yok" yanılgısını üretirdi.
    const notMatcher = /yalnızca bu özelliğin eklenmesinden sonra yazılan kayıtları kapsar/i;
    await renderWith([makeLog()], []);
    expect(screen.queryByText(notMatcher)).not.toBeInTheDocument();

    await selectType('Durum Değişiklikleri');

    expect(await screen.findByText(notMatcher)).toBeInTheDocument();
  });
});
