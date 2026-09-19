import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChecklistTab } from './ChecklistTab';
import { computeChecklistStats } from './helpers';
import type { Task } from '../../types';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1', title: 'Talimat', description: '', creatorId: 'admin-1', assigneeId: 'staff-1',
  status: 'IN_PROGRESS', priority: 'Medium', deadline: Date.now() + 100_000, createdAt: 1000, updatedAt: 1000,
  totalPausedTime: 0, lockVersion: 0, tags: [], comments: [], checklist: [],
  ...overrides,
} as Task);

function renderTab(overrides: Partial<React.ComponentProps<typeof ChecklistTab>> = {}) {
  const task = overrides.task ?? makeTask();
  const props = {
    task,
    checklistStats: overrides.checklistStats ?? computeChecklistStats(task.checklist),
    isSubmittingChecklist: false,
    newChecklistItem: '',
    setNewChecklistItem: vi.fn(),
    onAddChecklistItem: vi.fn((e: React.FormEvent) => e.preventDefault()),
    onToggleChecklistItem: vi.fn(),
    onDeleteChecklistItem: vi.fn(),
    canEditChecklist: true,
    ...overrides,
  };
  render(<ChecklistTab {...props} />);
  return props;
}

describe('ChecklistTab', () => {
  it('liste boşken boş-durum mesajı gösterir', () => {
    renderTab({ task: makeTask({ checklist: [] }) });
    expect(screen.getByText('Henüz bir alt işlem eklenmemiş')).toBeInTheDocument();
  });

  it('ilerleme yüzdesini ve tamamlanan/toplam sayısını gösterir', () => {
    const task = makeTask({
      checklist: [
        { id: 'a', text: 'Adım 1', isCompleted: true },
        { id: 'b', text: 'Adım 2', isCompleted: false },
      ],
    });
    renderTab({ task, checklistStats: computeChecklistStats(task.checklist) });
    expect(screen.getByText('50% (1 / 2)')).toBeInTheDocument();
  });

  it('bir öğeye tıklamak onToggleChecklistItem\'ı doğru id ile çağırır', () => {
    const task = makeTask({ checklist: [{ id: 'x', text: 'Adım', isCompleted: false }] });
    const props = renderTab({ task });

    fireEvent.click(screen.getByRole('checkbox'));

    expect(props.onToggleChecklistItem).toHaveBeenCalledWith('x');
  });

  it('canEditChecklist=false iken silme butonu ve ekleme formu gizlenir', () => {
    const task = makeTask({ checklist: [{ id: 'x', text: 'Adım', isCompleted: false }] });
    renderTab({ task, canEditChecklist: false });

    expect(screen.queryByLabelText('Alt işlemi sil')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Yeni bir alt işlem yazın...')).not.toBeInTheDocument();
  });

  it('canEditChecklist=true iken silme butonuna tıklamak onDeleteChecklistItem\'ı çağırır', () => {
    const task = makeTask({ checklist: [{ id: 'x', text: 'Adım', isCompleted: false }] });
    const props = renderTab({ task });

    fireEvent.click(screen.getByLabelText('Alt işlemi sil'));

    expect(props.onDeleteChecklistItem).toHaveBeenCalledWith('x');
  });

  it('boş girdiyle Ekle butonu devre dışıdır', () => {
    renderTab({ newChecklistItem: '' });
    expect(screen.getByRole('button', { name: /Ekle/ })).toBeDisabled();
  });

  it('form gönderimi onAddChecklistItem\'ı çağırır', () => {
    const props = renderTab({ newChecklistItem: 'Yeni adım' });
    fireEvent.click(screen.getByRole('button', { name: /Ekle/ }));
    expect(props.onAddChecklistItem).toHaveBeenCalledOnce();
  });

  it('isSubmittingChecklist=true iken girdi ve butonlar devre dışıdır', () => {
    const task = makeTask({ checklist: [{ id: 'x', text: 'Adım', isCompleted: false }] });
    renderTab({ task, isSubmittingChecklist: true, newChecklistItem: 'x' });

    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByPlaceholderText('Yeni bir alt işlem yazın...')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Ekle/ })).toBeDisabled();
  });
});
