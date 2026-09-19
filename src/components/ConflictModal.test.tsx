import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConflictModal } from './ConflictModal';
import type { ConflictInfo } from '../services/conflictDetectionService';
import type { Task } from '../types';

function makeInfo(overrides: Partial<ConflictInfo> = {}): ConflictInfo {
  return {
    taskId: 'task-1',
    taskTitle: 'Denetim Hedefi',
    expectedVersion: 3,
    serverVersion: 4,
    attemptedChangeSummary: 'Durumu "İşlemde" yapmak',
    retry: vi.fn(),
    ...overrides,
  };
}

describe('ConflictModal', () => {
  it('info null iken kapalıdır (dialog render edilmez)', () => {
    render(<ConflictModal info={null} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog', { name: 'Düzenleme Çakışması' })).not.toBeInTheDocument();
  });

  it('info doluyken görev başlığını ve deneme özetini gösterir', () => {
    render(<ConflictModal info={makeInfo()} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Düzenleme Çakışması' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Denetim Hedefi')).toBeInTheDocument();
    expect(screen.getByText('Durumu "İşlemde" yapmak')).toBeInTheDocument();
  });

  it('currentTask verilmezse sunucu durumu "Bilinmiyor" gösterir', () => {
    render(<ConflictModal info={makeInfo()} onClose={vi.fn()} />);
    expect(screen.getByText('Bilinmiyor')).toBeInTheDocument();
  });

  it('currentTask verilirse STATUS_LABELS üzerinden Türkçe etiketi gösterir', () => {
    const currentTask = { status: 'BLOCKED' } as Task;
    render(<ConflictModal info={makeInfo()} onClose={vi.fn()} currentTask={currentTask} />);
    expect(screen.getByText('Engellenmiş')).toBeInTheDocument();
  });

  it('"Sunucudakini Al" yalnızca onClose çağırır, retry ÇAĞIRMAZ', () => {
    const onClose = vi.fn();
    const info = makeInfo();
    render(<ConflictModal info={info} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sunucudakini Al' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(info.retry).not.toHaveBeenCalled();
  });

  it('"Benimkini Uygula" önce retry\'ı sonra onClose\'u çağırır', () => {
    const onClose = vi.fn();
    const info = makeInfo();
    render(<ConflictModal info={info} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Benimkini Uygula' }));

    expect(info.retry).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
