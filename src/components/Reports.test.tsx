import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Reports } from './Reports';
import type { Task, User, TaskBlocker } from '../types';

const admin: User = { uid: 'admin-1', fullName: 'Müftü Bey', email: 'admin@makam.com', role: 'Admin' };
const task: Task = {
  id: 'task-1', title: 'Test Talimatı', description: '', creatorId: 'admin-1', assigneeId: 'admin-1',
  status: 'IN_PROGRESS', priority: 'Medium', deadline: Date.now() + 100000,
  createdAt: Date.now(), updatedAt: Date.now(), totalPausedTime: 0, lockVersion: 0,
  tags: [], checklist: [], comments: [],
};
const users: User[] = [admin];
const blockers: TaskBlocker[] = [];

const getDateFromButton = () => screen.getByRole('button', { name: 'Rapor başlangıç tarihi' }) as HTMLButtonElement;

describe('Reports — tarih aralığı filtresi (özel takvim)', () => {
  it('takvim yalnızca takvim ikonuna/butona tıklanınca açılır, kapalıyken günler görünmez', () => {
    render(<Reports tasks={[task]} users={users} blockers={blockers} />);
    expect(screen.queryByRole('dialog', { name: 'Rapor başlangıç tarihi' })).not.toBeInTheDocument();

    fireEvent.click(getDateFromButton());

    expect(screen.getByRole('dialog', { name: 'Rapor başlangıç tarihi' })).toBeInTheDocument();
  });

  it('takvimden bir gün seçilince buton etiketi güncellenir ve takvim kapanır', () => {
    render(<Reports tasks={[task]} users={users} blockers={blockers} />);
    fireEvent.click(getDateFromButton());
    const dialog = screen.getByRole('dialog', { name: 'Rapor başlangıç tarihi' });

    // Ayın 1'i her zaman ızgarada bulunur (önceki/aynı ay içinde) — tıklanabilir gün hücrelerinden ilkini seç.
    const dayCells = within(dialog).getAllByRole('gridcell').filter(b => /^\d+$/.test(b.textContent ?? ''));
    fireEvent.click(dayCells[0]!);

    // Kapanış AnimatePresence exit animasyonu ile gecikmeli olabilir — tetikleyici
    // butonun aria-expanded durumu, animasyon zamanlamasından bağımsız otorite kaynağıdır.
    expect(getDateFromButton()).toHaveAttribute('aria-expanded', 'false');
    expect(getDateFromButton().textContent).not.toBe('—');
  });

  it('ay gezinme okları takvimi kapatmaz, ay başlığını değiştirir', () => {
    render(<Reports tasks={[task]} users={users} blockers={blockers} />);
    fireEvent.click(getDateFromButton());
    const dialog = screen.getByRole('dialog', { name: 'Rapor başlangıç tarihi' });
    const monthLabel = within(dialog).getByText(/\d{4}/).textContent;

    fireEvent.click(within(dialog).getByLabelText('Sonraki ay'));

    expect(within(dialog).getByText(/\d{4}/).textContent).not.toBe(monthLabel);
    expect(screen.getByRole('dialog', { name: 'Rapor başlangıç tarihi' })).toBeInTheDocument();
  });

  it('Escape tuşu açık takvimi kapatır', () => {
    render(<Reports tasks={[task]} users={users} blockers={blockers} />);
    fireEvent.click(getDateFromButton());
    expect(screen.getByRole('dialog', { name: 'Rapor başlangıç tarihi' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(getDateFromButton()).toHaveAttribute('aria-expanded', 'false');
  });
});
