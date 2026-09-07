import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskFormModal } from './TaskFormModal';
import type { Department, Task, User } from '../types';

// Admin BİLİNÇLİ olarak departmansız: organizasyon geneli çalışır ve P0-1'in
// kaynağı tam da buydu (görev departmanı oluşturandan türetildiğinde Admin'in
// oluşturduğu her görev departmansız kalıyordu).
const admin: User = { uid: 'admin-1', fullName: 'Müftü Bey', email: 'admin@makam.com', role: 'Admin' };
const manager: User = { uid: 'mgr-1', fullName: 'Müdür Hanım', email: 'mgr@makam.com', role: 'Manager', departmentId: 'Operasyon' };
const staff1: User = { uid: 'staff-1', fullName: 'Memur Ali', email: 'staff1@makam.com', role: 'Staff', departmentId: 'Operasyon' };
const staff2: User = { uid: 'staff-2', fullName: 'Memur Veli', email: 'staff2@makam.com', role: 'Staff', departmentId: 'Basın' };
const allUsers = [admin, manager, staff1, staff2];

const departments: Department[] = [
  { id: 'Basın', name: 'Basın', createdAt: 1, createdBy: 'admin-1' },
  { id: 'Operasyon', name: 'Operasyon', createdAt: 1, createdBy: 'admin-1' },
];

const renderForm = (overrides: Partial<React.ComponentProps<typeof TaskFormModal>> = {}) => {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <TaskFormModal
      users={allUsers}
      currentUser={admin}
      departments={departments}
      onSubmit={onSubmit}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onSubmit, onClose };
};

const getAssigneeSelect = () => screen.getAllByRole('combobox')[0] as HTMLSelectElement;
const getCoordinatorSelect = () => screen.getAllByRole('combobox')[1] as HTMLSelectElement;
const getPrioritySelect = () => screen.getAllByRole('combobox')[2] as HTMLSelectElement;
const getSubmitButton = () => screen.getByRole('button', { name: /ATAMAYI TAMAMLA|GÜNCELLE/ });

// Native <input type="date"> yerine premium takvim (DatePicker) kullanıldığından
// (bkz. TaskFormModal), "bugün" hücresi aria-current="date" ile işaretlenmiş
// tek gündür — gerçek sistem tarihinden ve ay gezinmesinden bağımsız, tekil bir seçim sağlar.
const pickTodayAsDeadline = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'SLA mühleti' }));
  const dialog = screen.getByRole('dialog', { name: 'SLA mühleti' });
  await user.click(within(dialog).getByRole('gridcell', { current: 'date' }));
};

const fillValidForm = async (user: ReturnType<typeof userEvent.setup>, assigneeId = 'staff-1') => {
  await user.type(screen.getByPlaceholderText('Talimat Başlığı'), 'Test Talimatı');
  await user.type(screen.getByPlaceholderText('İşin detaylarını ve başarı kriterlerini tanımlayın...'), 'Detaylı açıklama');
  await user.selectOptions(getAssigneeSelect(), assigneeId);
  await pickTodayAsDeadline(user);
};

describe('TaskFormModal', () => {
  describe('zod doğrulaması', () => {
    it('zorunlu alanlar boş bırakılıp gönderilirse hata mesajları gösterilir, onSubmit çağrılmaz', async () => {
      const { onSubmit } = renderForm();

      await userEvent.click(getSubmitButton());

      expect(await screen.findByText('Başlık zorunludur.')).toBeInTheDocument();
      expect(screen.getByText('Açıklama zorunludur.')).toBeInTheDocument();
      expect(screen.getByText('Sorumlu seçimi zorunludur.')).toBeInTheDocument();
      expect(screen.getByText('Mühlet seçilmelidir.')).toBeInTheDocument();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('tüm alanlar geçerliyse onSubmit doğru veri şekliyle çağrılır', async () => {
      const user = userEvent.setup();
      const { onSubmit } = renderForm();

      await fillValidForm(user, 'staff-1');
      await userEvent.click(getSubmitButton());

      await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
      const data = onSubmit.mock.calls[0]![0];
      expect(data).toMatchObject({
        title: 'Test Talimatı', description: 'Detaylı açıklama', assigneeId: 'staff-1',
        priority: 'Medium', status: 'ASSIGNED', creatorId: 'admin-1',
        // Departman OLUŞTURANDAN (departmansız Admin) değil, SORUMLUDAN gelir.
        departmentId: 'Operasyon',
      });
      expect(data.deadline).toBeTypeOf('number');
      expect(data.coordinatorId).toBeUndefined();
    });
  });

  describe('departman türetimi (P0-1)', () => {
    const getDepartmentSelect = () => screen.getByLabelText('Sorumlu Birim') as HTMLSelectElement;

    it('görevin departmanı OLUŞTURANDAN değil ATANAN KİŞİDEN türetilir', async () => {
      const user = userEvent.setup();
      // Oluşturan: departmansız Admin. Sorumlu: Basın biriminden Memur Veli.
      // Eski davranışta (currentUser?.departmentId) görev departmansız kalır
      // ve tüm organizasyona okunur hale gelirdi.
      const { onSubmit } = renderForm({ currentUser: admin });

      await fillValidForm(user, 'staff-2');
      await userEvent.click(getSubmitButton());

      await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
      expect(onSubmit.mock.calls[0]![0]).toMatchObject({ assigneeId: 'staff-2', departmentId: 'Basın' });
    });

    it('sorumlunun departmanı yoksa (Admin\'e atanan görev) birim alanı görünür ve zorunlu olur', async () => {
      const user = userEvent.setup();
      const { onSubmit } = renderForm({ currentUser: admin });

      await fillValidForm(user, 'admin-1');
      await userEvent.click(getSubmitButton());

      expect(await screen.findByText(/talimatın birimini seçmelisiniz/i)).toBeInTheDocument();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(getDepartmentSelect()).toBeInTheDocument();
    });

    it('birim açıkça seçilirse görev o birimle oluşturulur', async () => {
      const user = userEvent.setup();
      const { onSubmit } = renderForm({ currentUser: admin });

      await fillValidForm(user, 'admin-1');
      await user.selectOptions(getDepartmentSelect(), 'Basın');
      await userEvent.click(getSubmitButton());

      await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
      expect(onSubmit.mock.calls[0]![0]).toMatchObject({ assigneeId: 'admin-1', departmentId: 'Basın' });
    });

    it('sorumlunun departmanı varsa birim alanı hiç gösterilmez (gereksiz soru sorulmaz)', async () => {
      const user = userEvent.setup();
      renderForm({ currentUser: admin });

      await user.selectOptions(getAssigneeSelect(), 'staff-1');

      expect(screen.queryByLabelText('Sorumlu Birim')).not.toBeInTheDocument();
    });

    it('Müdür, kendi birimi dışındaki bir personele talimat atayamaz (anlaşılır hata)', async () => {
      const user = userEvent.setup();
      // Müdür Operasyon'da; staff-2 Basın'da. Sunucu tarafı bunu zaten
      // reddederdi (tasks create kuralı) — burada ham izin hatası yerine
      // anlaşılır bir mesaj gösterilir.
      const { onSubmit } = renderForm({ currentUser: manager });

      await fillValidForm(user, 'staff-2');
      await userEvent.click(getSubmitButton());

      expect(await screen.findByText(/yalnızca kendi biriminize talimat atayabilirsiniz/i)).toBeInTheDocument();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('Müdür için birim seçenekleri kendi birimiyle sınırlıdır', async () => {
      const user = userEvent.setup();
      // Birim alanını görünür kılmak için departmansız bir sorumlu gerekir
      // (Müdür'ün kendisi departmanlı) — departmansız ikinci bir Müdür.
      const deptlessManager: User = { uid: 'mgr-2', fullName: 'Müdür İkinci', email: 'mgr2@makam.com', role: 'Manager' };
      renderForm({ currentUser: manager, users: [...allUsers, deptlessManager] });

      await user.selectOptions(getAssigneeSelect(), 'mgr-2');

      const options = Array.from(getDepartmentSelect().options).map(o => o.value).filter(Boolean);
      expect(options).toEqual(['Operasyon']);
    });
  });

  describe('rol bazlı sorumlu filtreleme', () => {
    it('Admin: sorumlu listesinde Admin/Manager/Staff hepsi görünür', () => {
      renderForm({ currentUser: admin });
      const options = Array.from(getAssigneeSelect().options).map(o => o.value).filter(Boolean);
      expect(options).toEqual(['admin-1', 'mgr-1', 'staff-1', 'staff-2']);
    });

    it('Manager: sorumlu listesinde yalnızca Manager ve Staff görünür (Admin yok)', () => {
      renderForm({ currentUser: manager });
      const options = Array.from(getAssigneeSelect().options).map(o => o.value).filter(Boolean);
      expect(options).toEqual(['mgr-1', 'staff-1', 'staff-2']);
    });

    it('Staff: sorumlu listesinde yalnızca Staff görünür', () => {
      renderForm({ currentUser: staff1 });
      const options = Array.from(getAssigneeSelect().options).map(o => o.value).filter(Boolean);
      expect(options).toEqual(['staff-1', 'staff-2']);
    });

    it('alt talimat (parentId dolu): rol ne olursa olsun sorumlu listesi sadece Staff\'a indirilir ve uyarı gösterilir', () => {
      renderForm({ currentUser: admin, parentId: 'parent-task-1' });
      const options = Array.from(getAssigneeSelect().options).map(o => o.value).filter(Boolean);
      expect(options).toEqual(['staff-1', 'staff-2']);
      expect(screen.getByText('Alt talimatlar yalnızca memurlara atanabilir.')).toBeInTheDocument();
    });
  });

  describe('irtibatlı (coordinator) listesi', () => {
    it('Admin rolündeki kullanıcılar irtibatlı listesinde hiç görünmez', () => {
      renderForm();
      const options = Array.from(getCoordinatorSelect().options).map(o => o.value).filter(Boolean);
      expect(options).not.toContain('admin-1');
    });

    it('seçili sorumlu, irtibatlı listesinden otomatik olarak elenir', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.selectOptions(getAssigneeSelect(), 'staff-1');

      const options = Array.from(getCoordinatorSelect().options).map(o => o.value).filter(Boolean);
      expect(options).not.toContain('staff-1');
      expect(options).toContain('staff-2');
      expect(options).toContain('mgr-1');
    });

    it('alt talimatta irtibatlı listesi de sadece Staff ile sınırlanır', () => {
      renderForm({ parentId: 'parent-task-1' });
      const options = Array.from(getCoordinatorSelect().options).map(o => o.value).filter(Boolean);
      expect(options).toEqual(['staff-1', 'staff-2']);
    });
  });

  describe('düzenleme modu (task prop verildiğinde)', () => {
    const existingTask: Task = {
      id: 'task-1', title: 'Mevcut Talimat', description: 'Mevcut açıklama', creatorId: 'admin-1',
      assigneeId: 'staff-1', coordinatorId: 'mgr-1', status: 'IN_PROGRESS', priority: 'High',
      deadline: new Date('2026-03-10').getTime(), createdAt: 1000, updatedAt: 1000,
      totalPausedTime: 0, lockVersion: 2, tags: [],
    } as Task;

    it('alanlar mevcut görev verisiyle önceden doldurulur', () => {
      renderForm({ task: existingTask });
      expect(screen.getByPlaceholderText('Talimat Başlığı')).toHaveValue('Mevcut Talimat');
      expect(screen.getByPlaceholderText('İşin detaylarını ve başarı kriterlerini tanımlayın...')).toHaveValue('Mevcut açıklama');
      expect(getAssigneeSelect()).toHaveValue('staff-1');
      expect(getPrioritySelect()).toHaveValue('High');
    });

    it('gönderimde status/creatorId/createdAt alanları eklenmez (mevcut görev güncellenir, yeniden oluşturulmaz)', async () => {
      const { onSubmit } = renderForm({ task: existingTask });

      await userEvent.click(getSubmitButton());

      await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
      const data = onSubmit.mock.calls[0]![0];
      expect(data).not.toHaveProperty('status');
      expect(data).not.toHaveProperty('creatorId');
      expect(data).not.toHaveProperty('createdAt');
    });

    it('buton etiketi "GÜNCELLE" olur (yeni kayıtta "ATAMAYI TAMAMLA")', () => {
      renderForm({ task: existingTask });
      expect(screen.getByRole('button', { name: 'GÜNCELLE' })).toBeInTheDocument();
    });

    it('mevcut sorumlunun rolü düzenleyenin izinli listesinde değilse (ör. Manager, Admin\'e atanmış görevi düzenlerken) yine de seçenekte görünür ve uyarı gösterilir', () => {
      // Manager'ın izinli rolleri ['Manager','Staff'] — 'Admin' yok. Eskiden bu
      // durumda mevcut sorumlu <select> seçeneklerinden tamamen düşüyordu (bkz.
      // kod denetimi).
      const taskAssignedToAdmin: Task = { ...existingTask, assigneeId: 'admin-1' };
      renderForm({ task: taskAssignedToAdmin, currentUser: manager });

      expect(getAssigneeSelect()).toHaveValue('admin-1');
      expect(within(getAssigneeSelect()).getByRole('option', { name: 'Müftü Bey' })).toBeInTheDocument();
      expect(screen.getByText(/Mevcut sorumlu \(Müftü Bey\) sizin atayabileceğiniz rol dışında/)).toBeInTheDocument();
    });

    it('mevcut sorumlunun rolü düzenleyenin izinli listesindeyse uyarı gösterilmez', () => {
      renderForm({ task: existingTask, currentUser: manager });
      expect(screen.queryByText(/sizin atayabileceğiniz rol dışında/)).not.toBeInTheDocument();
    });
  });

  it('İPTAL butonuna tıklanınca onClose çağrılır', async () => {
    const { onClose } = renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'İPTAL' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
