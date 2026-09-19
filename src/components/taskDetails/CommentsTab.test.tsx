import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommentsTab } from './CommentsTab';
import type { Task, User } from '../../types';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1', title: 'Talimat', description: '', creatorId: 'admin-1', assigneeId: 'staff-1',
  status: 'IN_PROGRESS', priority: 'Medium', deadline: Date.now() + 100_000, createdAt: 1000, updatedAt: 1000,
  totalPausedTime: 0, lockVersion: 0, tags: [], comments: [], checklist: [],
  ...overrides,
} as Task);

const staff: User = { uid: 'staff-1', fullName: 'Memur Ali', email: 'staff@makam.com', role: 'Staff' };

function renderTab(overrides: Partial<React.ComponentProps<typeof CommentsTab>> = {}) {
  const props = {
    task: makeTask(),
    users: [staff],
    newComment: '',
    setNewComment: vi.fn(),
    isSubmittingComment: false,
    onAddComment: vi.fn(),
    ...overrides,
  };
  render(<CommentsTab {...props} />);
  return props;
}

describe('CommentsTab', () => {
  it('yorum yokken boş-durum mesajı gösterir', () => {
    renderTab({ task: makeTask({ comments: [] }) });
    expect(screen.getByText('Henüz yorum girilmemiş')).toBeInTheDocument();
  });

  it('yorumu yazan kullanıcının tam adını (uid eşleşmesiyle) gösterir', () => {
    const task = makeTask({ comments: [{ userId: 'staff-1', text: 'Merhaba', timestamp: Date.now() }] });
    renderTab({ task, users: [staff] });
    expect(screen.getByText('Memur Ali')).toBeInTheDocument();
    expect(screen.getByText('Merhaba')).toBeInTheDocument();
  });

  it('yorumu yazan kullanıcı users listesinde yoksa userId\'yi ham gösterir', () => {
    const task = makeTask({ comments: [{ userId: 'silinmis@makam.com', text: 'Not', timestamp: Date.now() }] });
    renderTab({ task, users: [] });
    expect(screen.getByText('silinmis@makam.com')).toBeInTheDocument();
  });

  it('boş metinle gönder butonu devre dışıdır', () => {
    renderTab({ newComment: '' });
    expect(screen.getByLabelText('Yorumu gönder')).toBeDisabled();
  });

  it('dolu metinle gönder butonu onAddComment\'ı çağırır', () => {
    const props = renderTab({ newComment: 'Yeni not' });
    fireEvent.click(screen.getByLabelText('Yorumu gönder'));
    expect(props.onAddComment).toHaveBeenCalledOnce();
  });

  it('Ctrl+Enter kısayolu onAddComment\'ı tetikler', () => {
    const props = renderTab({ newComment: 'Yeni not' });
    fireEvent.keyDown(screen.getByPlaceholderText('Bir koordinasyon notu ekleyin...'), { key: 'Enter', ctrlKey: true });
    expect(props.onAddComment).toHaveBeenCalledOnce();
  });

  it('Enter tek başına (Ctrl/Cmd olmadan) onAddComment\'ı TETİKLEMEZ (textarea\'da yeni satır bırakır)', () => {
    const props = renderTab({ newComment: 'Yeni not' });
    fireEvent.keyDown(screen.getByPlaceholderText('Bir koordinasyon notu ekleyin...'), { key: 'Enter' });
    expect(props.onAddComment).not.toHaveBeenCalled();
  });

  it('isSubmittingComment=true iken textarea ve gönder butonu devre dışıdır', () => {
    renderTab({ newComment: 'x', isSubmittingComment: true });
    expect(screen.getByPlaceholderText('Bir koordinasyon notu ekleyin...')).toBeDisabled();
    expect(screen.getByLabelText('Yorumu gönder')).toBeDisabled();
  });
});
