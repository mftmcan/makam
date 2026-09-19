/**
 * TaskDetailsFooter testleri.
 *
 * Özellikle EVIDENCE_FILE_UPLOAD_ENABLED=false kararının (bkz. constants.ts —
 * Storage bucket Spark planında kalıcı olarak kullanılamıyor) UI'a doğru
 * yansıdığını kilitler: Görsel/PDF seçenekleri hiç render edilmemeli, yalnızca
 * Bağlantı (Link) kanıtı sunulmalı.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskDetailsFooter } from './Footer';
import { EVIDENCE_FILE_UPLOAD_ENABLED } from './constants';
import type { Task, User } from '../../types';

const staff: User = { uid: 'staff-1', fullName: 'Memur Ali', email: 'staff@makam.com', role: 'Staff' };
const admin: User = { uid: 'admin-1', fullName: 'Müftü Bey', email: 'admin@makam.com', role: 'Admin' };

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1', title: 'Talimat', description: '', creatorId: 'admin-1', assigneeId: 'staff-1',
  status: 'IN_PROGRESS', priority: 'Medium', deadline: Date.now() + 100_000, createdAt: 1000, updatedAt: 1000,
  totalPausedTime: 0, lockVersion: 0, tags: [], comments: [], checklist: [],
  ...overrides,
} as Task);

describe('TaskDetailsFooter', () => {
  it('EVIDENCE_FILE_UPLOAD_ENABLED kalıcı olarak false\'tur (Spark planı kararı)', () => {
    // Bu, kodun kendisinin ötesinde bir ÜRÜN KARARINI kilitler — biri bu
    // bayrağı sessizce true'ya çevirirse (Storage hâlâ Spark'ta çalışmadan)
    // kanıt yükleme yine sessizce başarısız olur. bkz. constants.ts.
    expect(EVIDENCE_FILE_UPLOAD_ENABLED).toBe(false);
  });

  it('aksiyon yoksa (canActOnTask reddi) hiçbir şey render edilmez', () => {
    const otherStaff: User = { ...staff, uid: 'someone-else' };
    const { container } = render(
      <TaskDetailsFooter task={makeTask()} currentUser={otherStaff} onStatusChange={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('yalnızca Bağlantı (Link) seçeneği sunulur — Görsel/PDF hiç render edilmez', () => {
    render(<TaskDetailsFooter task={makeTask()} currentUser={staff} onStatusChange={vi.fn()} />);

    // Tek seçenek kaldığından tür-geçiş grubu (role="group") hiç render edilmez.
    expect(screen.queryByRole('group', { name: 'Kanıt türü' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Görsel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'PDF' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Kanıt bağlantısı')).toBeInTheDocument();
  });

  it('IN_PROGRESS + Staff: "TAMAMLA VE ONAYA SUN" butonu tek tıkla (needsConfirm=false) çalışır', () => {
    const onStatusChange = vi.fn();
    render(<TaskDetailsFooter task={makeTask()} currentUser={staff} onStatusChange={onStatusChange} />);

    fireEvent.change(screen.getByLabelText('Kanıt bağlantısı'), { target: { value: 'ornek.com/kanit' } });
    fireEvent.click(screen.getByRole('button', { name: 'TAMAMLA VE ONAYA SUN' }));

    // Şema dışı (http olmayan) bir bağlantı otomatik https:// ile tamamlanır.
    expect(onStatusChange).toHaveBeenCalledWith('AWAITING_APPROVAL', 'https://ornek.com/kanit', 'Link');
  });

  it('IN_PROGRESS + Admin: "KESİN TAMAMLA" needsConfirm=true olduğundan İKİ tıklama gerektirir', () => {
    const onStatusChange = vi.fn();
    render(<TaskDetailsFooter task={makeTask()} currentUser={admin} onStatusChange={onStatusChange} />);

    const button = screen.getByRole('button', { name: 'KESİN TAMAMLA' });
    fireEvent.click(button);
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'EMİN MİSİNİZ? ONAYLA' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'EMİN MİSİNİZ? ONAYLA' }));
    expect(onStatusChange).toHaveBeenCalledWith('COMPLETED', undefined, undefined);
  });

  it('boş bağlantı ile gönderilirse evidence/undefined olarak geçilir (kanıt opsiyoneldir)', () => {
    const onStatusChange = vi.fn();
    render(<TaskDetailsFooter task={makeTask()} currentUser={staff} onStatusChange={onStatusChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'TAMAMLA VE ONAYA SUN' }));

    expect(onStatusChange).toHaveBeenCalledWith('AWAITING_APPROVAL', undefined, undefined);
  });

  it('ASSIGNED durumunda collectsEvidence=false olduğundan kanıt formu hiç gösterilmez', () => {
    render(<TaskDetailsFooter task={makeTask({ status: 'ASSIGNED' })} currentUser={staff} onStatusChange={vi.fn()} />);

    expect(screen.queryByLabelText('Kanıt bağlantısı')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SÜRECİ BAŞLAT' })).toBeInTheDocument();
  });
});
