import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BlockersTab } from './BlockersTab';
import type { TaskBlocker } from '../../types';

const makeBlocker = (overrides: Partial<TaskBlocker> = {}): TaskBlocker => ({
  id: 'b1', taskId: 'task-1', reason: 'Belge eksik', severity: 'Medium',
  isResolved: false, createdAt: Date.now(),
  ...overrides,
});

function renderTab(overrides: Partial<React.ComponentProps<typeof BlockersTab>> = {}) {
  const props = {
    blockers: [] as TaskBlocker[],
    isAdmin: true,
    isManager: false,
    onResolveBlocker: vi.fn(),
    blockerReason: '',
    setBlockerReason: vi.fn(),
    blockerSeverity: 'Medium' as const,
    setBlockerSeverity: vi.fn(),
    isSubmittingBlocker: false,
    onAddBlocker: vi.fn(),
    ...overrides,
  };
  render(<BlockersTab {...props} />);
  return props;
}

describe('BlockersTab', () => {
  it('engel yokken boş-durum mesajı gösterir', () => {
    renderTab({ blockers: [] });
    expect(screen.getByText('Engel kaydı bulunamadı')).toBeInTheDocument();
  });

  it('aktif engel için ÇÖZÜLDÜ butonu Admin\'e gösterilir', () => {
    renderTab({ blockers: [makeBlocker({ isResolved: false })], isAdmin: true, isManager: false });
    expect(screen.getByRole('button', { name: 'ÇÖZÜLDÜ' })).toBeInTheDocument();
  });

  it('ne Admin ne Manager iken ÇÖZÜLDÜ butonu gösterilmez', () => {
    renderTab({ blockers: [makeBlocker({ isResolved: false })], isAdmin: false, isManager: false });
    expect(screen.queryByRole('button', { name: 'ÇÖZÜLDÜ' })).not.toBeInTheDocument();
  });

  it('çözülmüş engel için ÇÖZÜLDÜ butonu hiç gösterilmez', () => {
    renderTab({ blockers: [makeBlocker({ isResolved: true })], isAdmin: true });
    expect(screen.queryByRole('button', { name: 'ÇÖZÜLDÜ' })).not.toBeInTheDocument();
  });

  it('ÇÖZÜLDÜ butonuna tıklamak onResolveBlocker\'ı doğru id ile çağırır', () => {
    const props = renderTab({ blockers: [makeBlocker({ id: 'b-42', isResolved: false })], isAdmin: true });
    fireEvent.click(screen.getByRole('button', { name: 'ÇÖZÜLDÜ' }));
    expect(props.onResolveBlocker).toHaveBeenCalledWith('b-42');
  });

  it('boş açıklamayla ENGEL EKLE butonu devre dışıdır', () => {
    renderTab({ blockerReason: '' });
    expect(screen.getByRole('button', { name: 'ENGEL EKLE' })).toBeDisabled();
  });

  it('dolu açıklamayla ENGEL EKLE tıklanabilir ve onAddBlocker\'ı çağırır', () => {
    const props = renderTab({ blockerReason: 'Yetki bekleniyor' });
    fireEvent.click(screen.getByRole('button', { name: 'ENGEL EKLE' }));
    expect(props.onAddBlocker).toHaveBeenCalledOnce();
  });

  it('isSubmittingBlocker=true iken buton metni değişir ve devre dışı kalır', () => {
    renderTab({ blockerReason: 'x', isSubmittingBlocker: true });
    expect(screen.getByRole('button', { name: 'EKLENİYOR…' })).toBeDisabled();
  });
});
