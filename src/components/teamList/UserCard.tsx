import { motion } from 'motion/react';
import { Shield, Mail, Building, Activity, Edit2, Trash2 } from 'lucide-react';
import type { User } from '../../types';
import { cn } from '../../lib/utils';
import { ROLE_LABELS } from '../../constants';
import { Avatar } from '../ui/Avatar';
import { roleConfig } from './subcomponents';
import { SPRING_ROW, staggerDelay } from '../../lib/motion';

interface UserCardProps {
  user: User;
  index: number;
  currentUser: User | null;
  isAdmin: boolean;
  userTaskCount: number;
  onSelect: (user: User) => void;
  onEdit: (user: User) => void;
  onDelete: (user: User) => void;
}

/** Kadro ızgarasındaki (≤30 kişilik, sanallaştırılmamış) tek personel kartı. */
export function UserCard({ user, index, currentUser, isAdmin, userTaskCount, onSelect, onEdit, onDelete }: UserCardProps) {
  const canEdit = isAdmin || user.uid === currentUser?.uid;
  const rc = roleConfig[user.role];

  return (
    <motion.div
      key={user.uid}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING_ROW, delay: staggerDelay(index, 0.04) }}
      whileHover={{ y: -2, scale: 1.005 }}
      className={cn(
        'group flex flex-col p-4 bg-makam-glass backdrop-blur-xl border-x border-b border-surface-border rounded-2xl shadow-card hover:shadow-card-hover hover:bg-surface-elevated hover:border-surface-border transition-all duration-300 relative border-t-2',
        userTaskCount >= 5 ? 'border-t-status-danger' : 'border-t-surface-border'
      )}
    >
      {/* Action buttons (hover) */}
      {canEdit && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all duration-300 translate-x-2 group-hover:translate-x-0 group-focus-within:translate-x-0">
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

      {/* Kart içeriğinin tamamı gerçek bir <button> — Edit/Sil ile birlikte
          dış konteynere role="button" verilmesi axe-core'un "nested-interactive"
          (serious) kuralını ihlal ediyordu: bir buton-rolü elemanın içinde
          başka odaklanabilir bir eleman olamaz (bkz. tasarım denetimi F1
          düzeltmesinin canlı ortamda bulunan yan etkisi). Gerçek <button>
          kullanmak hem bu ihlali giderir hem Enter/Space'i bedavaya native
          olarak halleder — ayrı bir onKeyDown gerekmez. */}
      <button
        type="button"
        onClick={() => onSelect(user)}
        aria-label={`${user.fullName} detaylarını görüntüle`}
        className="flex flex-col gap-3 text-left w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-inset rounded-2xl -m-4 p-4"
      >
        {/* Top: avatar + name */}
        <div className="flex items-center gap-3">
          <Avatar
            name={user.fullName}
            photoURL={user.photoURL}
            size="lg"
            className="group-hover:scale-105 group-hover:rotate-3 transition-all duration-300"
          />
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <h4 className="text-body font-medium text-executive-blue truncate tracking-tight font-display group-hover:text-executive-blue transition-colors">
              {user.fullName}
            </h4>
            <div className="flex items-center gap-1.5 text-micro text-text-tertiary truncate">
              <Mail className="w-2.5 h-2.5 flex-shrink-0 opacity-60" />
              <span className="truncate">{user.email}</span>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-executive-blue/[0.04]" />

        {/* Bottom: role + dept + active tasks */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={cn(
              'inline-flex items-center gap-1 text-micro font-medium uppercase tracking-caps px-2 py-0.5 rounded-full border',
              rc.bg, rc.text, rc.border
            )}>
              <Shield className="w-2.5 h-2.5 stroke-[1.5]" />
              {ROLE_LABELS[user.role]}
            </span>
            {user.departmentId && (
              // Dolu rol rozetinden bilinçli olarak ayrışsın diye tamamen
              // ghost/outline: zemin dolgusu yok, yalnızca ince kenarlık
              // (bkz. kod denetimi — rol ile departman rozeti aynı gri
              // yoğunlukta olduğunda ilk bakışta ayırt edilemiyordu).
              <span className="inline-flex items-center gap-1 text-micro font-medium uppercase tracking-caps px-2 py-0.5 rounded-full bg-transparent text-text-tertiary border border-surface-border">
                <Building className="w-2.5 h-2.5" />
                {user.departmentId}
              </span>
            )}
          </div>
          {userTaskCount > 0 && (
            <span className={cn(
              'inline-flex items-center gap-1 text-micro font-medium uppercase tracking-caps px-2 py-0.5 rounded-full border transition-all duration-300',
              userTaskCount >= 5 ? 'bg-status-danger/[0.08] text-status-danger border-status-danger/25 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.15)]' :
              userTaskCount >= 3 ? 'bg-status-warning/[0.08] text-status-warning border-status-warning/25' :
              'bg-status-success/[0.08] text-status-success border-status-success/25'
            )}>
              <Activity className="w-2.5 h-2.5" />
              {userTaskCount} {userTaskCount >= 5 ? 'Aşırı Yük' : userTaskCount >= 3 ? 'Dengeli' : 'Müsait'}
            </span>
          )}
        </div>
      </button>
    </motion.div>
  );
}
