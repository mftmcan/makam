/**
 * Settings — yedekten geri yükleme onay akışı (P0-4).
 *
 * Kapsam bilinçli olarak dar: Settings.tsx'in tamamı (PWA kurulumu, SLA formu,
 * bildirim testi, dışa aktarım) e2e/manuel testin alanında. Buradaki tek konu,
 * dizgedeki en yıkıcı ve GERİ DÖNÜŞÜ OLMAYAN işlemin ("Yedekten Dön") yazarak
 * doğrulama olmadan HİÇBİR koşulda tetiklenememesi.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from './Settings';
import { settingsService } from '../services/settingsService';
import type { User } from '../types';

vi.mock('../services/settingsService', () => ({
  settingsService: {
    restoreBackup: vi.fn().mockResolvedValue({ userCount: 1, taskCount: 2, blockerCount: 0 }),
    saveSlaConfig: vi.fn().mockResolvedValue(undefined),
    archiveAuditLogs: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../services/auditLogService', () => ({
  auditLogService: { fetchAllPaged: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../services/taskService', () => ({
  taskService: { cleanupDatabase: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../hooks/usePWAInstall', () => ({
  usePWAInstall: () => ({ isInstallable: false, isInstalled: false, install: vi.fn() }),
}));

const adminUser: User = {
  uid: 'admin-1', fullName: 'Müftü', email: 'admin@makam.test', role: 'Admin',
};

const BACKUP_JSON = JSON.stringify({ system: 'MAKAM Stratejik Yönetim', users: [], tasks: [], blockers: [] });

const renderSettings = () =>
  render(<Settings tasks={[]} users={[adminUser]} blockers={[]} currentUser={adminUser} />);

/** Gizli dosya girdisine bir yedek dosyası bırakıp onay modalını açar. */
async function openRestoreModal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: /Veri Yönetimi/i }));
  const fileInput = document.getElementById('restore-upload') as HTMLInputElement;
  const file = new File([BACKUP_JSON], 'MAKAM-Backup.json', { type: 'application/json' });
  await user.upload(fileInput, file);
  await screen.findByRole('dialog');

  // ui/Modal, açılıştan ~50ms SONRA odağı kapat butonuna taşır
  // (useModalBehavior'daki setTimeout). Bu zamanlayıcı beklenmezse yazma
  // işleminin ortasında odak kutudan çalınır ve testler "GE" gibi yarım
  // metinlerle sessizce yanlış sonuç verir — önce odağın yerleşmesi beklenir.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /penceresini kapat/i })).toHaveFocus()
  );
}

const confirmButton = () => screen.getByRole('button', { name: 'Geri Yüklemeyi Onayla' });

describe('Settings — geri yükleme yazarak doğrulama', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('onay modalı açıldığında onay butonu PASİFTİR', async () => {
    const user = userEvent.setup();
    renderSettings();
    await openRestoreModal(user);

    expect(confirmButton()).toBeDisabled();
    expect(settingsService.restoreBackup).not.toHaveBeenCalled();
  });

  it('pasif butona tıklamak geri yüklemeyi başlatmaz', async () => {
    const user = userEvent.setup();
    renderSettings();
    await openRestoreModal(user);

    await user.click(confirmButton());
    expect(settingsService.restoreBackup).not.toHaveBeenCalled();
  });

  it('yanlış/eksik metin yazmak butonu aktifleştirmez', async () => {
    const user = userEvent.setup();
    renderSettings();
    await openRestoreModal(user);

    const input = screen.getByLabelText(/Onaylamak için/i);
    await user.type(input, 'GERI YUKLE'); // Türkçe karakterler eksik
    expect(confirmButton()).toBeDisabled();

    await user.clear(input);
    await user.type(input, 'geri yükle'); // küçük harf
    expect(confirmButton()).toBeDisabled();

    await user.clear(input);
    await user.type(input, 'GERİ'); // eksik
    expect(confirmButton()).toBeDisabled();
  });

  it('ifade BİREBİR yazıldığında buton aktifleşir ve geri yükleme dosya içeriğiyle başlar', async () => {
    const user = userEvent.setup();
    renderSettings();
    await openRestoreModal(user);

    await user.type(screen.getByLabelText(/Onaylamak için/i), 'GERİ YÜKLE');
    expect(confirmButton()).toBeEnabled();

    await user.click(confirmButton());

    await waitFor(() => expect(settingsService.restoreBackup).toHaveBeenCalledOnce());
    const [content, userId, fileName] = vi.mocked(settingsService.restoreBackup).mock.calls[0]!;
    expect(content).toBe(BACKUP_JSON);
    expect(userId).toBe('admin-1');
    expect(fileName).toBe('MAKAM-Backup.json');
  });

  it('iptal edildikten sonra doğrulama metni sıfırlanır (bir sonraki denemede taşınmaz)', async () => {
    const user = userEvent.setup();
    renderSettings();
    await openRestoreModal(user);

    await user.type(screen.getByLabelText(/Onaylamak için/i), 'GERİ YÜKLE');
    expect(confirmButton()).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await openRestoreModal(user);
    expect(screen.getByLabelText(/Onaylamak için/i)).toHaveValue('');
    expect(confirmButton()).toBeDisabled();
    expect(settingsService.restoreBackup).not.toHaveBeenCalled();
  });

  it('doğrulama kutusunda Enter tuşu geri yüklemeyi tetiklemez', async () => {
    const user = userEvent.setup();
    renderSettings();
    await openRestoreModal(user);

    await user.type(screen.getByLabelText(/Onaylamak için/i), 'GERİ YÜKLE{Enter}');
    expect(settingsService.restoreBackup).not.toHaveBeenCalled();
  });
});
