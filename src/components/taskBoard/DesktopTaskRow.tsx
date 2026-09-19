import { useState } from 'react';
import type { ReactElement } from 'react';
import type { RowComponentProps } from 'react-window';
import { ArrowRight, CheckCircle2, AlertTriangle, ShieldCheck, Zap, Info, Clock, AlertCircle, Play, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '../../lib/utils';
import { STATUS_LABELS, PRIORITY_LABELS, PRIORITY_BADGE_VARIANT, STATUS_BADGE_VARIANT } from '../../constants';
import { isTaskInCrisis } from '../../lib/executiveMetrics';
import { getPrimaryAction } from '../taskDetails/helpers';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { TASK_BOARD_COLUMNS } from './columns';
import { SyncPendingBadge, type TaskRowData } from './MobileTaskRow';

/** `TASK_BOARD_COLUMNS`'un `width`'lerinden türetilir — başlık ve satırlar
 *  AYNI kaynağı paylaşır (bkz. columns.tsx). */
export const DESKTOP_GRID_TEMPLATE = TASK_BOARD_COLUMNS.map((c) => c.width ?? 'minmax(0,1fr)').join(' ');

export function DesktopTaskRow({ index, style, tasks, usersById, onViewTask, selectedIds, onToggleSelect, pendingTaskIds, currentUser, updateTaskStatus }: RowComponentProps<TaskRowData>): ReactElement | null {
  const task = tasks[index];
  const [isQuickActionSubmitting, setIsQuickActionSubmitting] = useState(false);
  if (!task) return null;
  const assignee = usersById.get(task.assigneeId);
  const isCrisis = isTaskInCrisis(task, Date.now());
  const isSelected = selectedIds.has(task.id);
  // Satır içi hızlı durum değişikliği (bkz. tasarım planı Öncelik 3) —
  // Footer.tsx'in KULLANDIĞI AYNI getPrimaryAction, ama yalnızca kanıt
  // TOPLAMAYAN ve onay GEREKTİRMEYEN aksiyonlarda (SÜRECİ BAŞLAT / DEVRİ
  // KABUL ET VE BAŞLAT) satırdan tek tıkla tetiklenebilir hale getirilir —
  // aksi halde Footer'ın kanıt formunu/"EMİN MİSİNİZ?" onayını atlamış
  // olurduk. Diğer tüm aksiyonlarda satır eskisi gibi yalnızca dekoratif
  // oku gösterir, kullanıcı Talimat Detayı'na girer.
  const primaryAction = getPrimaryAction(task, currentUser);
  const quickAction = primaryAction && !primaryAction.collectsEvidence && !primaryAction.needsConfirm ? primaryAction : null;

  const handleQuickAction = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!quickAction || isQuickActionSubmitting) return;
    setIsQuickActionSubmitting(true);
    try {
      // updateTaskStatus (useAppHandlers.ts) kendi try/catch'i içinde hem
      // hata hem başarı toast'ını zaten veriyor — burada AYRICA bir toast
      // tetiklenmez (bkz. BulkActionBar'daki AYNI ilke).
      await updateTaskStatus(task.id, quickAction.next);
    } finally {
      setIsQuickActionSubmitting(false);
    }
  };
  // react-window'un ariaAttributes'ı (role="listitem" + aria-posinset/
  // aria-setsize) BİLİNÇLİ OLARAK hiç spread edilmez: role aşağıda "row"a
  // çevrilir ve posinset/setsize yalnızca listitem/treegrid satırları için
  // geçerlidir — role="row" ile birlikte kullanıldığında "aria-allowed-attr"
  // (serious) ihlaline dönüşüyordu (bkz. tasarım denetimi F3, canlı taramada
  // bulundu).
  return (
    <div
      role="row"
      tabIndex={0}
      onClick={() => onViewTask(task)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onViewTask(task);
        }
      }}
      style={{ ...style, gridTemplateColumns: DESKTOP_GRID_TEMPLATE }}
      className={cn(
        'grid items-center border-b border-l-2 border-transparent border-b-makam-border/30 cursor-pointer transition-colors duration-200 hover:bg-makam-glass group',
        // Toplu seçim (P2-18) — eskiden yalnızca sol uçtaki küçük checkbox
        // dolu görünürdü, satırın geri kalanı DEĞİŞMİYORDU; 10+ satır
        // seçildiğinde hangilerinin seçili olduğunu görmek için her satırın
        // checkbox'ına tek tek bakmak gerekiyordu (bkz. tasarım planı Öncelik
        // 1 — Gmail/Linear/Notion'da seçim her zaman TÜM satırın zeminini
        // değiştirir). Ring (box-shadow tabanlı) `bg-*`/`border-*` ile
        // ÇAKIŞMAZ — kriz satırında da (aşağıda) ek bir onay katmanı olarak
        // kalır; zemin tonu ise yalnızca kriz DEĞİLKEN eklenir (kriz kırmızısı
        // önceliklidir, iki zemin tonu üst üste binmez).
        isSelected && 'ring-1 ring-inset ring-executive-blue/20',
        isSelected && !isCrisis && 'bg-executive-blue/[0.04]',
        // SLA ihlalli satırlar eskiden yalnızca %3 opaklıkta bir zemin tonuyla
        // ayrışıyordu — sayfa taranırken fark edilmesi zordu. Sol kenarlıktaki
        // kırmızı şerit, Harekat Merkezi'ndeki kriz kartlarıyla aynı deseni
        // kullanarak ihlali satırı taramadan görünür kılar (bkz. kod denetimi).
        // %3→%6 zemin ve 2px→3px kenarlık: canlı ortamda karanlık modda
        // karşılaştırıldığında %3 neredeyse görünmüyordu (bkz. tasarım denetimi).
        isCrisis && 'bg-status-danger/[0.06] border-l-[3px] border-l-status-danger'
      )}
    >
      {/* Toplu seçim checkbox'ı (P2-18) — MobileTaskRow'daki AYNI stopPropagation
          gerekçesi: satırın kendi onClick/onKeyDown'ı (onViewTask) tetiklenmesin. */}
      <div role="cell" className="px-2 py-3 flex items-center justify-center">
        <input
          type="checkbox"
          checked={isSelected}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={() => onToggleSelect(task.id)}
          aria-label={isSelected ? `${task.title} seçildi` : `${task.title} seçilmedi`}
          className="w-3.5 h-3.5 rounded border-surface-border accent-executive-blue cursor-pointer"
        />
      </div>

      {/* Status */}
      <div role="cell" className="px-4 py-3">
        <Badge
          variant={STATUS_BADGE_VARIANT[task.status] ?? 'default'}
          withPulse={task.status === 'BLOCKED'}
          icon={
            task.status === 'COMPLETED' ? <CheckCircle2 className="w-3.5 h-3.5 stroke-[1.3]" /> :
            task.status === 'BLOCKED' ? <AlertTriangle className="w-3.5 h-3.5 stroke-[1.3]" /> :
            task.status === 'AWAITING_APPROVAL' ? <ShieldCheck className="w-3.5 h-3.5 stroke-[1.3]" /> :
            task.status === 'IN_PROGRESS' ? <Zap className="w-3.5 h-3.5 stroke-[1.3]" /> :
            <Info className="w-3.5 h-3.5 stroke-[1.3]" />
          }
        >
          {STATUS_LABELS[task.status]}
        </Badge>
      </div>

      {/* Title + description */}
      <div role="cell" className="px-4 py-3 min-w-0">
        <div className="flex flex-col gap-0.5 max-w-[320px]">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-body font-medium text-executive-blue group-hover:text-executive-blue tracking-tight font-display line-clamp-1 min-w-0">
              {task.title}
            </span>
            {pendingTaskIds.has(task.id) && <SyncPendingBadge />}
          </div>
          <span className="text-micro text-text-tertiary font-light line-clamp-1">{task.description}</span>
        </div>
      </div>

      {/* Assignee */}
      <div role="cell" className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Avatar
            name={assignee?.fullName ?? '?'}
            photoURL={assignee?.photoURL}
            size="xs"
          />
          <span className="text-caption font-normal text-executive-blue tracking-tight whitespace-nowrap">
            {assignee?.fullName || 'Atanmamış'}
          </span>
        </div>
      </div>

      {/* Priority */}
      <div role="cell" className="px-4 py-3">
        <Badge
          variant={PRIORITY_BADGE_VARIANT[task.priority]}
          icon={
            task.priority === 'Urgent' ? <AlertCircle className="w-2.5 h-2.5 stroke-[1.5]" /> :
            task.priority === 'High' ? <AlertTriangle className="w-2.5 h-2.5 stroke-[1.5]" /> :
            <Zap className="w-2.5 h-2.5 stroke-[1.5]" />
          }
        >
          {PRIORITY_LABELS[task.priority]}
        </Badge>
      </div>

      {/* Deadline */}
      <div role="cell" className="px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <Clock className={cn('w-3 h-3 stroke-[1.2]', isCrisis ? 'text-status-danger animate-pulse' : 'text-text-tertiary')} />
            <span className={cn('text-caption font-light tabular-nums tracking-tight', isCrisis ? 'text-status-danger' : 'text-executive-blue')}>
              {format(task.deadline, 'd MMM yyyy', { locale: tr })}
            </span>
          </div>
          {isCrisis && <span className="text-micro font-medium text-status-danger uppercase tracking-caps">SLA İhlali</span>}
        </div>
      </div>

      {/* Ok/Hızlı Aksiyon — quickAction YOKSA (çoğu satır) tamamen dekoratif
          kalır: satırın kendisi zaten role="row" + onClick ile tıklanabilir/
          klavye-erişilebilir, bu ok ayrı bir eylem taşımaz. <button> olması
          axe-core'da "button-name" (critical) ihlaliydi — erişilebilir adı
          yoktu (bkz. tasarım denetimi, F1'in canlı ortamda bulunan yan
          etkisi) — bu yüzden quickAction VARKEN de aria-label EKSİKSİZ verilir. */}
      <div role="cell" className="px-4 py-3 text-right">
        {quickAction ? (
          <button
            type="button"
            onClick={(e) => { void handleQuickAction(e); }}
            disabled={isQuickActionSubmitting}
            aria-label={`${task.title}: ${quickAction.label}`}
            title={quickAction.label}
            className="w-7 h-7 rounded-full bg-makam-glass border border-executive-blue/[0.05] flex items-center justify-center text-text-tertiary hover:bg-executive-gold hover:text-[color:var(--btn-primary-text)] hover:border-transparent transition-all duration-300 shadow-sm ml-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue disabled:opacity-60 disabled:pointer-events-none"
          >
            {isQuickActionSubmitting
              ? <Loader2 className="w-3 h-3 stroke-[2] animate-spin" aria-hidden="true" />
              : <Play className="w-3 h-3 stroke-[2]" aria-hidden="true" />}
          </button>
        ) : (
          <div aria-hidden="true" className="w-7 h-7 rounded-full bg-makam-glass border border-executive-blue/[0.05] flex items-center justify-center text-text-tertiary group-hover:bg-executive-gold group-hover:text-[color:var(--btn-primary-text)] group-hover:border-transparent transition-all duration-300 shadow-sm ml-auto">
            <ArrowRight className="w-3 h-3 stroke-[2]" />
          </div>
        )}
      </div>
    </div>
  );
}
