import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskBoard } from './TaskBoard';
import { useUIStore } from '../store/uiStore';
import type { TaskBoardFilters } from '../hooks/useTaskBoardFilters';
import type { Task, User } from '../types';

const DEFAULT_FILTERS: TaskBoardFilters = { search: '', priority: 'All', status: 'All', assignee: 'All' };

// TaskBoard filtreleri artık kontrollüdür (bkz. tasarım denetimi F20 —
// gerçek uygulamada AuthenticatedApp'teki useTaskBoardFilters URL'den besler).
// Testte gerçek bir parent'ı taklit eden küçük bir state sarmalayıcısı
// gerekir — aksi halde select/input'lara yapılan etkileşimler onFiltersChange'i
// tetikler ama `filters` prop'u hiç değişmediğinden React kontrollü value'yu
// eski haline geri döndürür.
function TaskBoardHarness(props: Omit<React.ComponentProps<typeof TaskBoard>, 'filters' | 'onFiltersChange'>) {
  const [filters, setFilters] = useState<TaskBoardFilters>(DEFAULT_FILTERS);
  return (
    <TaskBoard
      {...props}
      filters={filters}
      onFiltersChange={(partial) => setFilters(prev => ({ ...prev, ...partial }))}
    />
  );
}

const admin: User = { uid: 'admin-1', fullName: 'Müftü Bey', email: 'admin@makam.com', role: 'Admin' };
const manager: User = { uid: 'mgr-1', fullName: 'Müdür Hanım', email: 'mgr@makam.com', role: 'Manager', departmentId: 'Operasyon' };
const staff: User = { uid: 'staff-1', fullName: 'Memur Ali', email: 'staff@makam.com', role: 'Staff', departmentId: 'Operasyon' };

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1', title: 'Talimat', description: '', creatorId: 'admin-1', assigneeId: 'staff-1',
  status: 'ASSIGNED', priority: 'Medium', deadline: Date.now() + 100_000, createdAt: 1000, updatedAt: 1000,
  totalPausedTime: 0, lockVersion: 0, tags: [],
  ...overrides,
} as Task);

const renderBoard = (overrides: Partial<Omit<React.ComponentProps<typeof TaskBoard>, 'filters' | 'onFiltersChange'>> = {}) => {
  const onAddTask = vi.fn();
  const onViewTask = vi.fn();
  const updateTaskStatus = vi.fn().mockResolvedValue(undefined);
  const updateTask = vi.fn().mockResolvedValue(undefined);
  render(
    <TaskBoardHarness
      tasks={[]}
      users={[admin, manager, staff]}
      currentUser={admin}
      onAddTask={onAddTask}
      onViewTask={onViewTask}
      updateTaskStatus={updateTaskStatus}
      updateTask={updateTask}
      {...overrides}
    />
  );
  return { onAddTask, onViewTask, updateTaskStatus, updateTask };
};

// NOT: TaskBoard aynı anda hem mobil (sm:hidden) hem masaüstü (hidden sm:block)
// boş-durum bloğunu render eder, ikisi de AYNI EmptyState düğümünü kullanır
// (bkz. TaskBoard.tsx emptyStateNode) — jsdom gerçek bir stylesheet
// uygulamadığından medya sorgusuyla gizlenen taraf da DOM'da "görünür" kalır.
// Bu yüzden CTA'lar getAllByRole ile (tekil değil) sorgulanır.
describe('TaskBoard — boş durum aktivasyon CTA\'sı (P2-17)', () => {
  it('hiç görev yoksa ve kullanıcı görev oluşturabiliyorsa (Admin) "İlk Talimatı Oluştur" CTA\'sı gösterilir ve onAddTask\'i tetikler', async () => {
    const user = userEvent.setup();
    const { onAddTask } = renderBoard({ tasks: [], currentUser: admin });

    const ctas = screen.getAllByRole('button', { name: 'İlk Talimatı Oluştur' });
    expect(ctas.length).toBeGreaterThan(0);

    await user.click(ctas[0]);
    expect(onAddTask).toHaveBeenCalledTimes(1);
  });

  it('hiç görev yoksa ve kullanıcı Manager ise "İlk Talimatı Oluştur" CTA\'sı gösterilir', () => {
    renderBoard({ tasks: [], currentUser: manager });
    expect(screen.getAllByRole('button', { name: 'İlk Talimatı Oluştur' }).length).toBeGreaterThan(0);
  });

  it('hiç görev yoksa ama kullanıcı Staff ise CTA gösterilmez (firestore.rules tasks create sadece Admin/Manager\'a izin verir)', () => {
    renderBoard({ tasks: [], currentUser: staff });
    expect(screen.queryByRole('button', { name: 'İlk Talimatı Oluştur' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Henüz talimat bulunmuyor').length).toBeGreaterThan(0);
  });

  it('bir filtre uygulanmışken sonuç boşsa "İlk Talimatı Oluştur" YERİNE "Filtreyi Temizle" gösterilir', async () => {
    const user = userEvent.setup();
    renderBoard({ tasks: [makeTask({ priority: 'Low' })], currentUser: admin });

    await user.selectOptions(screen.getByLabelText('Öncelik filtresi'), 'Urgent');

    expect(screen.queryByRole('button', { name: 'İlk Talimatı Oluştur' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Filtreyi Temizle' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Filtrelerinize uygun talimat bulunamadı').length).toBeGreaterThan(0);
  });

  it('görev listesi doluyken boş durum/CTA hiç render edilmez', () => {
    renderBoard({ tasks: [makeTask()], currentUser: admin });
    expect(screen.queryByRole('button', { name: 'İlk Talimatı Oluştur' })).not.toBeInTheDocument();
    expect(screen.queryByText('Henüz talimat bulunmuyor')).not.toBeInTheDocument();
  });
});

// P2-18: 200+ görevlik bir listede tek tek işlem yapma zorunluluğunu gideren
// çoklu seçim + toplu işlem (durum değişikliği / yeniden atama) akışı.
describe('TaskBoard — toplu seçim ve toplu işlem (P2-18)', () => {
  beforeEach(() => {
    // Toast'lar gerçek (mock'lanmamış) uiStore'da tutulur — bir önceki testten
    // kalan kayıtlar bu describe bloğundaki "kısmi başarı" doğrulamasını
    // yanlış pozitif/negatif yapmasın diye her testten önce sıfırlanır.
    useUIStore.setState({ toasts: [] });
  });

  const assignedA = makeTask({ id: 'task-1', title: 'Birinci Talimat', status: 'ASSIGNED' });
  const assignedB = makeTask({ id: 'task-2', title: 'İkinci Talimat', status: 'ASSIGNED' });
  const inProgressC = makeTask({ id: 'task-3', title: 'Üçüncü Talimat', status: 'IN_PROGRESS' });

  // TaskBoard aynı satırı AYNI ANDA hem MobileTaskRow hem DesktopTaskRow olarak
  // render eder (jsdom medya sorgusu uygulamıyor — bkz. dosya başındaki NOT).
  // İkisi de AYNI paylaşılan selectedIds/toggleSelect state'ini kullanır, bu
  // yüzden bir görev için getAllByRole çağrısı İKİ checkbox döndürür; ikisini
  // de tıklamak aynı toggle'ı iki kez çağırıp birbirini İPTAL ederdi. Yalnızca
  // İLKİNİ (index 0) tıklamak, görevi bir kez seçmek için yeterlidir.
  const selectTask = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
    const checkbox = screen.getAllByRole('checkbox', { name: `${title} seçilmedi` })[0]!;
    await user.click(checkbox);
  };

  it('bir satırın checkbox\'ına tıklamak görevi seçer ve onViewTask\'ı TETİKLEMEZ (satırın geri kalanına tıklamaktan farklı olarak)', async () => {
    const user = userEvent.setup();
    const { onViewTask } = renderBoard({ tasks: [assignedA], currentUser: admin });

    const checkbox = screen.getAllByRole('checkbox', { name: 'Birinci Talimat seçilmedi' })[0]!;
    await user.click(checkbox);

    expect(onViewTask).not.toHaveBeenCalled();
    expect(screen.getByText('1 Talimat Seçildi')).toBeInTheDocument();
  });

  it('"Tümünü Seç" yalnızca o an FİLTRELENMİŞ görünür listeyi seçer, filtre dışındaki görevleri DEĞİL', async () => {
    const user = userEvent.setup();
    renderBoard({ tasks: [assignedA, assignedB, inProgressC], currentUser: admin });

    // ASSIGNED durumuna filtrele — inProgressC (IN_PROGRESS) görünümden çıkar.
    await user.selectOptions(screen.getByLabelText('Durum filtresi'), 'ASSIGNED');
    await user.click(screen.getByRole('button', { name: 'Tümünü Seç' }));

    // Yalnızca filtrelenmiş 2 görev (assignedA, assignedB) seçili olmalı —
    // filtre dışındaki inProgressC seçilmemiş olmalı.
    expect(screen.getByText('2 Talimat Seçildi')).toBeInTheDocument();
  });

  it('seçili tüm görevler AYNI durumdaysa toplu durum değişikliği dropdown\'ı etkindir', async () => {
    const user = userEvent.setup();
    renderBoard({ tasks: [assignedA, assignedB], currentUser: admin });

    await selectTask(user, assignedA.title);
    await selectTask(user, assignedB.title);

    expect(screen.getByLabelText('Toplu durum hedefi')).toBeEnabled();
    expect(screen.queryByText(/farklı durumlarda/)).not.toBeInTheDocument();
  });

  it('seçili görevler KARIŞIK durumdaysa toplu durum değişikliği devre dışı bırakılır ve nedeni belirtilir', async () => {
    const user = userEvent.setup();
    renderBoard({ tasks: [assignedA, inProgressC], currentUser: admin });

    await selectTask(user, assignedA.title);
    await selectTask(user, inProgressC.title);

    expect(screen.queryByLabelText('Toplu durum hedefi')).not.toBeInTheDocument();
    expect(screen.getByText(/farklı durumlarda/)).toBeInTheDocument();
  });

  it('toplu durum değişikliği uygulanınca updateTaskStatus seçili HER görev için silent:true ile çağrılır', async () => {
    const user = userEvent.setup();
    const { updateTaskStatus } = renderBoard({ tasks: [assignedA, assignedB], currentUser: admin });

    await selectTask(user, assignedA.title);
    await selectTask(user, assignedB.title);
    await user.selectOptions(screen.getByLabelText('Toplu durum hedefi'), 'IN_PROGRESS');
    await user.click(screen.getByRole('button', { name: 'Uygula' }));

    await waitFor(() => expect(updateTaskStatus).toHaveBeenCalledTimes(2));
    expect(updateTaskStatus).toHaveBeenCalledWith('task-1', 'IN_PROGRESS', undefined, undefined, { silent: true });
    expect(updateTaskStatus).toHaveBeenCalledWith('task-2', 'IN_PROGRESS', undefined, undefined, { silent: true });
  });

  it('kısmi başarısızlıkta (ör. VERSION_MISMATCH) uygun özet toast\'ı gösterilir ve başarısız görev seçili kalır', async () => {
    const user = userEvent.setup();
    const updateTaskStatus = vi.fn().mockImplementation((taskId: string) =>
      taskId === 'task-2'
        ? Promise.reject(new Error('VERSION_MISMATCH: Beklenen Versiyon 0, Sunucu Versiyonu 1'))
        : Promise.resolve(undefined)
    );
    renderBoard({ tasks: [assignedA, assignedB], currentUser: admin, updateTaskStatus });

    await selectTask(user, assignedA.title);
    await selectTask(user, assignedB.title);
    await user.selectOptions(screen.getByLabelText('Toplu durum hedefi'), 'IN_PROGRESS');
    await user.click(screen.getByRole('button', { name: 'Uygula' }));

    await waitFor(() => {
      const toasts = useUIStore.getState().toasts;
      expect(toasts.some(t => t.body.includes('1/2') && t.body.includes('VERSION_MISMATCH'))).toBe(true);
    });
    // task-2 başarısız olduğu için seçili bırakılır — kullanıcı tekrar deneyebilsin.
    expect(screen.getByText('1 Talimat Seçildi')).toBeInTheDocument();
  });
});
