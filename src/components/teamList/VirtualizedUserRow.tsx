import type { ReactElement } from 'react';
import type { RowComponentProps } from 'react-window';
import { Shield, Mail, Building, Activity, Edit2, Trash2 } from 'lucide-react';
import type { User } from '../../types';
import { cn } from '../../lib/utils';
import { ROLE_LABELS } from '../../constants';
import { Avatar } from '../ui/Avatar';
import { roleConfig } from './subcomponents';

export interface UserRowData {
  users: User[];
  currentUser: User | null;
  isAdmin: boolean;
  getActiveTaskCount: (u: { uid: string; email: string }) => number;
  onSelect: (user: User) => void;
  onEdit: (user: User) => void;
  onDelete: (user: User) => void;
}

/**
 * Sanallaştırılmış (react-window) tek sütunlu personel satırı — P2-19:
 * `useFirestoreData.ts` kullanıcıları `limit(1000)` ile çekiyor ve bu ekran
 * öncesinde TÜM kadroyu tek seferde DOM'a basıyordu (bkz. kod denetimi).
 * NOT: Bu bir GRID TABLOSU DEĞİL — `role="row"/"cell"` yapısı taşımaz, tek
 * tıklanabilir `role="button"` bloğudur (bkz. TeamList.tsx'teki grid kart
 * görünümünün AYNI satırı) — bu yüzden `ui/dataTable/GridDataTable` (rol
 * zinciri gerçek bir `role="table"` gerektirir) burada KULLANILMAZ, yalnızca
 * react-window'un `List`i doğrudan kullanılır.
 */
export function VirtualizedUserRow({
  index, style, ariaAttributes, users, currentUser, isAdmin, getActiveTaskCount, onSelect, onEdit, onDelete,
}: RowComponentProps<UserRowData>): ReactElement | null {
  const user = users[index];
  if (!user) return null;
  const canEdit = isAdmin || user.uid === currentUser?.uid;
  const userTaskCount = getActiveTaskCount(user);
  const rc = roleConfig[user.role];

  return (
    <div style={style} {...ariaAttributes}>
      <div
        role="button"
        tabIndex={0}
        aria-label={user.fullName}
        onClick={() => onSelect(user)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(user);
          }
        }}
        className={cn(
          'group flex items-center gap-3 h-full px-3.5 box-border cursor-pointer border-b border-l-2 border-l-transparent border-b-surface-border/60 hover:bg-makam-glass transition-colors',
          userTaskCount >= 5 && 'border-l-status-danger'
        )}
      >
        <Avatar name={user.fullName} photoURL={user.photoURL} size="md" className="flex-shrink-0" />

        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="text-body-sm font-medium text-executive-blue truncate tracking-tight font-display">
            {user.fullName}
          </span>
          <div className="flex items-center gap-1.5 text-micro text-text-tertiary min-w-0">
            <Mail className="w-2.5 h-2.5 flex-shrink-0 opacity-60" />
            <span className="truncate">{user.email}</span>
          </div>
        </div>

        <span className={cn(
          'hidden sm:inline-flex items-center gap-1 text-micro font-medium uppercase tracking-caps px-2 py-0.5 rounded-full border flex-shrink-0',
          rc.bg, rc.text, rc.border
        )}>
          <Shield className="w-2.5 h-2.5 stroke-[1.5]" />
          {ROLE_LABELS[user.role]}
        </span>

        {user.departmentId && (
          <span className="hidden md:inline-flex items-center gap-1 text-micro font-medium uppercase tracking-caps px-2 py-0.5 rounded-full bg-transparent text-text-tertiary border border-surface-border flex-shrink-0 max-w-[130px]">
            <Building className="w-2.5 h-2.5 flex-shrink-0" />
            <span className="truncate">{user.departmentId}</span>
          </span>
        )}

        {userTaskCount > 0 && (
          <span className={cn(
            'hidden lg:inline-flex items-center gap-1 text-micro font-medium uppercase tracking-caps px-2 py-0.5 rounded-full border flex-shrink-0',
            userTaskCount >= 5 ? 'bg-status-danger/[0.08] text-status-danger border-status-danger/25' :
            userTaskCount >= 3 ? 'bg-status-warning/[0.08] text-status-warning border-status-warning/25' :
            'bg-status-success/[0.08] text-status-success border-status-success/25'
          )}>
            <Activity className="w-2.5 h-2.5" />
            {userTaskCount}
          </span>
        )}

        {canEdit && (
          <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
            <button
              className="w-7 h-7 flex items-center justify-center bg-makam-glass border border-executive-blue/[0.06] rounded-lg text-text-tertiary hover:text-executive-blue hover:bg-surface-elevated transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
              onClick={(e) => { e.stopPropagation(); onEdit(user); }}
              title="Düzenle"
              aria-label={`${user.fullName} kaydını düzenle`}
            >
              <Edit2 className="w-3 h-3 stroke-[1.5]" />
            </button>
            {isAdmin && user.uid !== currentUser?.uid && (
              <button
                className="w-7 h-7 flex items-center justify-center bg-makam-glass border border-executive-blue/[0.06] rounded-lg text-text-tertiary hover:text-status-danger hover:bg-status-danger/10 transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger"
                onClick={(e) => { e.stopPropagation(); onDelete(user); }}
                title="Sil"
                aria-label={`${user.fullName} kaydını sil`}
              >
                <Trash2 className="w-3 h-3 stroke-[1.5]" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
