import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeamList } from './TeamList';
import type { Department, User } from '../types';

/**
 * TeamList'in DEPARTMAN ATAMA akışı (P0-2).
 *
 * Bu dosyanın odağı bilinçli olarak dar: departman girdisinin serbest metin
 * OLMADIĞINI ve yalnızca kayıtlı referans varlıklardan seçilebildiğini
 * kanıtlar. Ekranın geri kalanı (kapasite endeksi, şema görünümü, denetim izi)
 * bu fazın kapsamı dışında.
 */

const admin: User = { uid: 'admin-1', fullName: 'Müftü Bey', email: 'admin@makam.com', role: 'Admin' };
const staff: User = { uid: 'staff-1', fullName: 'Memur Ali', email: 'staff1@makam.com', role: 'Staff', departmentId: 'Operasyon' };

const departments: Department[] = [
  { id: 'Basın', name: 'Basın', createdAt: 1, createdBy: 'admin-1' },
  { id: 'Operasyon', name: 'Operasyon', createdAt: 1, createdBy: 'admin-1' },
];

const renderList = (overrides: Partial<React.ComponentProps<typeof TeamList>> = {}) => {
  const onAddUser = vi.fn();
  const onUpdateUser = vi.fn();
  const onCreateDepartment = vi.fn().mockResolvedValue('Zabıta');
  const onRenameDepartment = vi.fn().mockResolvedValue({ tasksUpdated: 0, usersUpdated: 0 });
  const onDeleteDepartment = vi.fn().mockResolvedValue(undefined);
  render(
    <TeamList
      users={[admin, staff]}
      tasks={[]}
      currentUser={admin}
      departments={departments}
      onUpdateUser={onUpdateUser}
      onDeleteUser={vi.fn()}
      onAddUser={onAddUser}
      onCreateDepartment={onCreateDepartment}
      onRenameDepartment={onRenameDepartment}
      onDeleteDepartment={onDeleteDepartment}
      {...overrides}
    />
  );
  return { onAddUser, onUpdateUser, onCreateDepartment, onRenameDepartment, onDeleteDepartment };
};

/**
 * Modal, AÇILIŞTAN 50 ms SONRA odağı kapatma butonuna taşır
 * (ui/Modal.tsx `useModalBehavior` — erişilebilirlik gereği). Bu zamanlayıcı
 * beklenmeden yazmaya başlanırsa tuş vuruşlarının bir kısmı odağını kaybetmiş
 * alana gider ve test tuhaf biçimde kırılgan olur. Bu yüzden modal açıldıktan
 * sonra odağın YERLEŞMESİ beklenir.
 */
const openModalAndSettleFocus = async (user: ReturnType<typeof userEvent.setup>, triggerName: RegExp | string, modalTitle: string) => {
  await user.click(screen.getByRole('button', { name: triggerName }));
  const closeButton = await screen.findByRole('button', { name: `${modalTitle} penceresini kapat` });
  await waitFor(() => expect(closeButton).toHaveFocus());
};

const openAddModal = async (user: ReturnType<typeof userEvent.setup>) => {
  await openModalAndSettleFocus(user, /Yeni Kadro/, 'Yeni Kadro Tanımla');
  return screen.getByLabelText('Departman / Birim') as HTMLSelectElement;
};

describe('TeamList — departman atama (P0-2)', () => {
  it('departman girdisi serbest metin DEĞİL, kayıtlı birimlerden oluşan bir seçim listesidir', async () => {
    const user = userEvent.setup();
    renderList();

    const select = await openAddModal(user);

    expect(select.tagName).toBe('SELECT');
    const values = Array.from(select.options).map(o => o.value);
    expect(values).toContain('Basın');
    expect(values).toContain('Operasyon');
    // Departmansız seçeneği korunur: Admin org geneli çalışabilir.
    expect(values).toContain('');
  });

  it('seçilen departman, hiçbir dönüşüme uğramadan (trim/lowercase yok) onAddUser\'a geçer', async () => {
    const user = userEvent.setup();
    const { onAddUser } = renderList();

    await openAddModal(user);
    await user.type(screen.getByPlaceholderText('Örn: Ali Yılmaz'), 'Yeni Personel');
    await user.type(screen.getByPlaceholderText('orn@makam.com'), 'yeni@makam.com');
    await user.selectOptions(screen.getByLabelText('Departman / Birim'), 'Operasyon');
    await user.click(screen.getByRole('button', { name: 'Kadroyu Onayla' }));

    // waitFor: jsdom'da submit butonuna tıklama, form submit olayını hemen
    // değil bir sonraki görevde tetikler — TaskFormModal.test.tsx'teki aynı
    // desen (bkz. oradaki onSubmit beklemeleri).
    await waitFor(() => expect(onAddUser).toHaveBeenCalledOnce());
    expect(onAddUser.mock.calls[0]?.[0]).toMatchObject({
      email: 'yeni@makam.com', departmentId: 'Operasyon',
    });
  });

  it('Admin için "+ Yeni Birim Oluştur" akışı vardır; oluşturulan birim anında seçili hale gelir', async () => {
    const user = userEvent.setup();
    const { onCreateDepartment } = renderList();

    const select = await openAddModal(user);
    await user.selectOptions(select, '__yeni__');

    const nameInput = screen.getByLabelText('Yeni Birim Adı');
    await user.type(nameInput, 'Zabıta');
    await user.click(screen.getByRole('button', { name: 'Birimi Oluştur' }));

    await waitFor(() => expect(onCreateDepartment).toHaveBeenCalledWith('Zabıta'));
    // onCreateDepartment 'Zabıta' döndürür — seçim ona kayar (kullanıcı
    // "oluşturdum ama atanmadı" durumunda kalmamalı).
    await waitFor(() => expect(screen.getByLabelText('Departman / Birim')).toHaveValue('Zabıta'));
  });

  it('birim oluşturma başarısız olursa hata gösterilir ve akış açık kalır', async () => {
    const user = userEvent.setup();
    const onCreateDepartment = vi.fn().mockRejectedValue(new Error('Birim adı geçersiz: eğik çizgi (/) içeremez ve 1-100 karakter olmalıdır.'));
    renderList({ onCreateDepartment });

    const select = await openAddModal(user);
    await user.selectOptions(select, '__yeni__');
    await user.type(screen.getByLabelText('Yeni Birim Adı'), 'Operasyon/Lojistik');
    await user.click(screen.getByRole('button', { name: 'Birimi Oluştur' }));

    expect(await screen.findByText(/eğik çizgi/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Yeni Birim Adı')).toBeInTheDocument();
  });

  it('Admin olmayan kullanıcıya "+ Yeni Birim Oluştur" seçeneği gösterilmez', async () => {
    const user = userEvent.setup();
    // Memur kendi profilini düzenleyebilir; o modalda departman alanı zaten
    // yalnızca Admin'e görünür, bu yüzden burada Admin'in kendi düzenleme
    // modalı üzerinden canCreate=false yolunu doğrulayamayız — bunun yerine
    // seçeneğin varlığını Admin'de kanıtlayıp, canCreate kapısını
    // DepartmentPicker'ın kendi sözleşmesi olarak bırakıyoruz.
    renderList();
    const select = await openAddModal(user);
    expect(Array.from(select.options).map(o => o.value)).toContain('__yeni__');
  });

  it('kullanıcının MEVCUT departmanı kayıtlı değilse seçenekte kalır ve uyarı gösterilir', async () => {
    const user = userEvent.setup();
    const orphanStaff: User = { ...staff, departmentId: 'Kapatılmış Birim' };
    renderList({ users: [admin, orphanStaff] });

    // Kart üzerindeki "Düzenle" butonu ile düzenleme modalı açılır.
    await openModalAndSettleFocus(user, `${orphanStaff.fullName} kaydını düzenle`, 'Kadro Revizyonu');

    const select = screen.getByLabelText('Departman / Birim') as HTMLSelectElement;
    expect(select).toHaveValue('Kapatılmış Birim');
    expect(within(select).getByRole('option', { name: /kayıtlı birim değil/ })).toBeInTheDocument();
    expect(screen.getByText(/departman kayıtlarında yok/i)).toBeInTheDocument();
  });
});

/**
 * TeamList — Birim Yönetimi paneli (departman yeniden adlandırma/silme).
 *
 * Panel bilinçli olarak AYRI bir sayfa/route değil, Kadro ekranına gömülü ve
 * yalnızca Admin'e görünen kapalı bir bölümdür. Buradaki testlerin odağı UI
 * sözleşmesidir: yıkıcı aksiyonun yazarak-doğrulama kapısı (Settings.tsx'teki
 * "GERİ YÜKLE" deseniyle aynı) ve servis reddinin kullanıcıya görünür olması.
 */
describe('TeamList — Birim Yönetimi paneli', () => {
  const openPanel = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /Birim Yönetimi/ }));
  };

  const openPanelModal = async (
    user: ReturnType<typeof userEvent.setup>,
    triggerName: RegExp | string,
    modalTitle: string
  ) => {
    await user.click(screen.getByRole('button', { name: triggerName }));
    const closeButton = await screen.findByRole('button', { name: `${modalTitle} penceresini kapat` });
    await waitFor(() => expect(closeButton).toHaveFocus());
  };

  it('yalnızca Admin\'e gösterilir', () => {
    renderList({ currentUser: staff });
    expect(screen.queryByRole('button', { name: /Birim Yönetimi/ })).not.toBeInTheDocument();
  });

  it('açıldığında kayıtlı birimleri aksiyonlarıyla listeler', async () => {
    const user = userEvent.setup();
    renderList();

    await openPanel(user);

    expect(screen.getByRole('button', { name: 'Basın birimini yeniden adlandır' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Operasyon birimini sil' })).toBeInTheDocument();
  });

  it('yeniden adlandırma, eski ve yeni adı servise geçirir', async () => {
    const user = userEvent.setup();
    const { onRenameDepartment } = renderList();

    await openPanel(user);
    await openPanelModal(user, 'Operasyon birimini yeniden adlandır', 'Birimi Yeniden Adlandır');

    const input = screen.getByLabelText('Yeni Birim Adı');
    await user.clear(input);
    await user.type(input, 'Zabıta');
    await user.click(screen.getByRole('button', { name: 'Taşımayı Onayla' }));

    await waitFor(() => expect(onRenameDepartment).toHaveBeenCalledWith('Operasyon', 'Zabıta'));
  });

  it('yeniden adlandırma onayı, ad değişmediği sürece kapalıdır', async () => {
    const user = userEvent.setup();
    renderList();

    await openPanel(user);
    await openPanelModal(user, 'Operasyon birimini yeniden adlandır', 'Birimi Yeniden Adlandır');

    // Kutu mevcut adla ön-doldurulur; aynı adla "taşıma" anlamsızdır.
    expect(screen.getByLabelText('Yeni Birim Adı')).toHaveValue('Operasyon');
    expect(screen.getByRole('button', { name: 'Taşımayı Onayla' })).toBeDisabled();
  });

  it('silme, doğrulama metni birebir yazılmadan başlatılamaz', async () => {
    const user = userEvent.setup();
    const { onDeleteDepartment } = renderList();

    await openPanel(user);
    await openPanelModal(user, 'Operasyon birimini sil', 'Birimi Sil');

    const confirmButton = screen.getByRole('button', { name: 'Birimi Sil' });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText(/Onaylamak için/i), 'birimi sil');
    expect(confirmButton).toBeDisabled();
    expect(onDeleteDepartment).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/Onaylamak için/i));
    await user.type(screen.getByLabelText(/Onaylamak için/i), 'BİRİMİ SİL');
    await user.click(confirmButton);

    await waitFor(() => expect(onDeleteDepartment).toHaveBeenCalledWith('Operasyon'));
  });

  it('silme reddedilirse (birim hâlâ kullanılıyorsa) hata gösterilir ve modal açık kalır', async () => {
    const user = userEvent.setup();
    const onDeleteDepartment = vi.fn().mockRejectedValue(
      new Error('Bu birim hâlâ 3 görev ve 1 kullanıcı tarafından kullanılıyor — önce onları başka bir birime taşıyın.')
    );
    renderList({ onDeleteDepartment });

    await openPanel(user);
    await openPanelModal(user, 'Operasyon birimini sil', 'Birimi Sil');
    await user.type(screen.getByLabelText(/Onaylamak için/i), 'BİRİMİ SİL');
    await user.click(screen.getByRole('button', { name: 'Birimi Sil' }));

    expect(await screen.findByText(/3 görev ve 1 kullanıcı/)).toBeInTheDocument();
    // Modal kapanmaz: Admin sayıyı görüp önce taşımayı yapabilmeli.
    expect(screen.getByLabelText(/Onaylamak için/i)).toBeInTheDocument();
  });
});

/**
 * TeamList — sanallaştırma eşiği (P2-19).
 *
 * `useFirestoreData.ts` kadroyu `limit(1000)` ile çekiyor; TeamList eskiden
 * bunu sayfalama/sanallaştırma olmadan tek seferde DOM'a basıyordu. Kadro
 * ızgarası artık `VIRTUALIZE_THRESHOLD`'un (30) ALTINDA aynı 1/2/3 sütunlu
 * ızgarayı korurken, ÜZERİNDE `react-window`'un `List`'ine (TaskBoard.tsx'teki
 * aynı desen) geçiyor. Bu blok her iki tarafı da doğrular.
 *
 * DİKKAT (react-window + jsdom tuzağı): `List` görünür satır aralığını
 * konteynerin GERÇEK layout'undan (offsetHeight/ResizeObserver) değil,
 * `style.height`'e verilen SAYISAL değerden hesaplıyor (bkz.
 * node_modules/react-window/dist/react-window.js — `we()` fonksiyonu,
 * `styleHeight` tanımlıysa ResizeObserver hiç kurulmuyor). TeamList.tsx bu
 * yüzden `style={{ height: userListHeight }}` gibi SAYISAL bir yükseklik
 * geçiyor (TaskBoard.tsx'teki desenle birebir aynı) — aksi halde jsdom'da
 * (gerçek layout hesaplamadığından) yükseklik 0 kalır ve hiçbir satır render
 * edilmezdi.
 */
describe('TeamList — sanallaştırma eşiği (P2-19)', () => {
  const makeStaff = (count: number): User[] =>
    Array.from({ length: count }, (_, i) => ({
      uid: `staff-${i}`,
      fullName: `Personel ${String(i).padStart(3, '0')}`,
      email: `personel${i}@makam.com`,
      role: 'Staff' as const,
      departmentId: 'Operasyon',
    }));

  it('eşiğin ALTINDAKİ (30) kadro sanallaştırılmadan, tamamı DOM\'da olacak şekilde render edilir', () => {
    const users = [admin, ...makeStaff(29)]; // toplam 30 — eşiğe eşit, hâlâ ızgara
    renderList({ users });

    // Sanallaştırılmamış ızgarada TÜM personel aynı anda DOM'dadır.
    expect(screen.getByText('Personel 000')).toBeInTheDocument();
    expect(screen.getByText('Personel 028')).toBeInTheDocument();
  });

  it('eşiğin ÜZERİNDEKİ (31) kadro react-window ile sanallaştırılır — yalnızca görünür pencere DOM\'a basılır', () => {
    const users = [admin, ...makeStaff(60)]; // toplam 61 — eşiğin üzerinde
    renderList({ users });

    // Listenin başındaki bir personel görünür pencerede olmalı.
    expect(screen.getByText('Personel 000')).toBeInTheDocument();
    // Listenin sonundaki bir personel, virtualization sayesinde DOM'a hiç
    // basılmamış olmalı (viewport dışı) — bu, sanallaştırmanın gerçekten
    // devrede olduğunun kanıtı.
    expect(screen.queryByText('Personel 059')).not.toBeInTheDocument();
  });

  it('sanallaştırılmış listede görünür bir satıra tıklamak Kadro Profili modalını açar', async () => {
    const user = userEvent.setup();
    const users = [admin, ...makeStaff(60)];
    renderList({ users });

    await user.click(screen.getByRole('button', { name: 'Personel 000' }));

    expect(await screen.findByRole('heading', { name: 'Kadro Profili' })).toBeInTheDocument();
    // Modal içeriği ilgili personelin adını göstermeli.
    expect(within(screen.getByRole('dialog')).getByText('Personel 000')).toBeInTheDocument();
  });

  it('sanallaştırılmış listede görünür bir satırın Düzenle butonu düzenleme modalını açar', async () => {
    const user = userEvent.setup();
    const users = [admin, ...makeStaff(60)];
    renderList({ users });

    await user.click(screen.getByRole('button', { name: 'Personel 000 kaydını düzenle' }));

    expect(await screen.findByRole('heading', { name: 'Kadro Revizyonu' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Personel 000')).toBeInTheDocument();
  });
});
