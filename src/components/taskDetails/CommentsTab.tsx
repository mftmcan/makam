import React from 'react';
import { MessageSquare, Loader2, Send } from 'lucide-react';
import { Task, User as UserType } from '../../types';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { EmptyState } from '../ui/EmptyState';

interface CommentsTabProps {
  task: Task;
  users: UserType[];
  newComment: string;
  setNewComment: (value: string) => void;
  isSubmittingComment: boolean;
  onAddComment: () => void;
}

export const CommentsTab = ({ task, users, newComment, setNewComment, isSubmittingComment, onAddComment }: CommentsTabProps) => (
  <div role="tabpanel" id="task-tabpanel-comments" aria-labelledby="task-tab-comments" className="flex flex-col gap-6">
    <div className="flex flex-col gap-4">
      <h4 className="text-micro font-medium text-text-muted uppercase tracking-[0.18em]">Yorumlar & Koordinasyon Notları</h4>
      <div className="flex flex-col gap-4 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
        {(!task.comments || task.comments.length === 0) ? (
          <EmptyState icon={<MessageSquare className="w-8 h-8" />} message="Henüz yorum girilmemiş" />
        ) : (
          task.comments.map((comment, idx) => {
            const commenter = users.find(u => u.uid === comment.userId || u.email === comment.userId);
            return (
              <div key={idx} className="flex flex-col gap-2 p-3 bg-makam-glass border border-surface-border rounded-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-executive-blue/5 flex items-center justify-center text-micro text-executive-blue border border-executive-blue/10">
                      {(commenter?.fullName || comment.userId || 'Kullanıcı').charAt(0).toUpperCase()}
                    </div>
                    <span className="text-body-sm font-medium text-text-heading">{commenter?.fullName || comment.userId}</span>
                  </div>
                  <span className="text-micro text-text-muted font-light">{formatDistanceToNow(comment.timestamp, { addSuffix: true, locale: tr })}</span>
                </div>
                <p className="text-body text-text-body leading-relaxed pl-8">{comment.text}</p>
              </div>
            );
          })
        )}
      </div>
    </div>

    <div className="mt-auto pt-6 border-t border-makam-border/5">
      <div className="relative">
        <label htmlFor="comment-input" className="sr-only">Koordinasyon notu</label>
        <textarea
          id="comment-input"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onAddComment();
            }
          }}
          placeholder="Bir koordinasyon notu ekleyin..."
          disabled={isSubmittingComment}
          className="w-full bg-makam-glass border border-makam-border/10 rounded-2xl p-4 pr-16 text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue/10 min-h-[100px] resize-none disabled:opacity-60"
        />
        <button
          onClick={onAddComment}
          disabled={!newComment.trim() || isSubmittingComment}
          aria-label="Yorumu gönder"
          className="absolute bottom-4 right-4 w-10 h-10 bg-executive-gold text-[color:var(--btn-primary-text)] rounded-full flex items-center justify-center shadow-lg shadow-executive-gold/25 hover:scale-105 hover:bg-executive-gold-hover active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2"
        >
          {isSubmittingComment
            ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            : <Send className="w-4 h-4" aria-hidden="true" />}
        </button>
      </div>
      <p className="mt-2 text-micro text-text-tertiary tracking-wide">Göndermek için Ctrl+Enter (Mac: Cmd+Enter)</p>
    </div>
  </div>
);
