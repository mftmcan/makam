import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubtasksTab } from './SubtasksTab';
import type { Task } from '../../types';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1', title: 'Ana Talimat', description: '', creatorId: 'admin-1', assigneeId: 'staff-1',
  status: 'IN_PROGRESS', priority: 'Medium', deadline: Date.now() + 100_000, createdAt: 1000, updatedAt: 1000,
  totalPausedTime: 0, lockVersion: 0, tags: [], comments: [], checklist: [],
  ...overrides,
} as Task);

function renderTab(overrides: Partial<React.ComponentProps<typeof SubtasksTab>> = {}) {
  const props = {
    task: makeTask(),
    subtasks: [] as Task[],
    onAddSubTask: vi.fn(),
    onViewTask: vi.fn(),
    ...overrides,
  };
  render(<SubtasksTab {...props} />);
  return props;
}

describe('SubtasksTab', () => {
  it('alt talimat yokken boş-durum mesajı gösterir', () => {
    renderTab({ subtasks: [] });
    expect(screen.getByText('Alt talimat bulunamadı')).toBeInTheDocument();
  });

  it('alt talimatların başlığını ve Türkçe durum etiketini gösterir', () => {
    const sub = makeTask({ id: 'sub-1', title: 'Alt İş', status: 'COMPLETED' });
    renderTab({ subtasks: [sub] });
    expect(screen.getByText('Alt İş')).toBeInTheDocument();
    expect(screen.getByText('İcra Edildi')).toBeInTheDocument();
  });

  it('bir alt talimata tıklamak onViewTask\'ı o görevle çağırır', () => {
    const sub = makeTask({ id: 'sub-1', title: 'Alt İş' });
    const props = renderTab({ subtasks: [sub] });

    fireEvent.click(screen.getByRole('button', { name: 'Alt İş' }));

    expect(props.onViewTask).toHaveBeenCalledWith(sub);
  });

  it('Enter tuşu ile klavyeden de açılabilir (erişilebilirlik)', () => {
    const sub = makeTask({ id: 'sub-1', title: 'Alt İş' });
    const props = renderTab({ subtasks: [sub] });

    fireEvent.keyDown(screen.getByRole('button', { name: 'Alt İş' }), { key: 'Enter' });

    expect(props.onViewTask).toHaveBeenCalledWith(sub);
  });

  it('"Yeni Alt Talimat" butonu onAddSubTask\'ı ana görevin id\'siyle çağırır', () => {
    const task = makeTask({ id: 'parent-1' });
    const props = renderTab({ task });

    fireEvent.click(screen.getByRole('button', { name: /Yeni Alt Talimat/ }));

    expect(props.onAddSubTask).toHaveBeenCalledWith('parent-1', '');
  });
});
