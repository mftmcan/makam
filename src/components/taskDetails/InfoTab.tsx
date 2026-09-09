import React from 'react';
import {
  Calendar, AlertTriangle, FileText, Award, Info,
  Hourglass, Clock, Building2, Tag, ExternalLink, CheckCircle2,
} from 'lucide-react';
import { Task, User as UserType } from '../../types';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/Badge';
import { Avatar } from '../ui/Avatar';
import { Tooltip } from '../ui/Tooltip';
import { getSLAColor, type TimeLeftResult, type TaskDetailsTabId } from './helpers';

interface InfoTabProps {
  task: Task;
  creator: UserType | undefined;
  assignee: UserType | undefined;
  coordinator: UserType | undefined;
  coordinatorIsAdmin: boolean;
  isAdmin: boolean;
  isManager: boolean;
  canDelegate: boolean;
  timeLeft: TimeLeftResult | null;
  onClearCoordinator?: () => void;
  onOpenDelegateModal: () => void;
  onDelegateTask?: (newAssigneeId: string) => void;
  onShowCertificate?: (task: Task) => void;
  onShowWarning?: (task: Task) => void;
  setActiveTab: (tab: TaskDetailsTabId) => void;
}

export const InfoTab = ({
  task, creator, assignee, coordinator, coordinatorIsAdmin, isAdmin, isManager,
  canDelegate, timeLeft, onClearCoordinator, onOpenDelegateModal, onDelegateTask,
  onShowCertificate, onShowWarning, setActiveTab,
}: InfoTabProps) => (
  <div role="tabpanel" id="task-tabpanel-info" aria-labelledby="task-tab-info" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
    <div className="lg:col-span-2 flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h4 className="text-micro font-medium text-text-muted uppercase tracking-caps flex items-center gap-2">
          <FileText className="w-3 h-3 text-executive-blue" />
          Stratejik Açıklama
        </h4>
        <div className="p-3.5 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl">
          <p className="text-executive-blue leading-relaxed font-light text-body font-display">
            {task.description || 'Bu talimat için detaylı bir açıklama girilmemiştir.'}
          </p>
        </div>
        {/* #3 - Etiketler */}
        {task.tags && task.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-1">
            <Tag className="w-3 h-3 text-text-muted shrink-0" aria-hidden="true" />
            {task.tags.map(tag => (
              <span
                key={tag}
                className="px-2 py-0.5 rounded-full bg-executive-blue/[0.05] border border-executive-blue/10 text-executive-blue text-micro font-medium tracking-wide"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="flex flex-col gap-4">
          <h4 className="text-micro font-medium text-text-muted uppercase tracking-caps">Sorumlu Kadro</h4>
          <div className="flex flex-col gap-3">
            {[
              { u: creator,     l: 'Oluşturan',   ring: 'ring-executive-gold/30' },
              { u: assignee,    l: 'Sorumlu',     ring: 'ring-executive-blue/20' },
              { u: coordinator, l: 'İrtibatlı',   ring: coordinatorIsAdmin ? 'ring-status-danger/40' : 'ring-status-success/40' }
            ].filter(x => x.u).map((item, idx) => (
              <div key={idx} className="flex items-center gap-2.5 p-2.5 bg-makam-glass backdrop-blur-xl rounded-xl border border-surface-border shadow-sm">
                {/* #10 - Avatar bileşeni */}
                <Avatar
                  name={item.u?.fullName ?? ''}
                  photoURL={item.u?.photoURL}
                  size="sm"
                  ring
                  className={cn('flex-shrink-0', item.ring)}
                />
                <div className="flex flex-col gap-0.5 flex-1">
                  <span className="text-body-sm font-medium text-executive-blue tracking-tight">{item.u?.fullName}</span>
                  <span className="text-micro text-text-tertiary font-medium uppercase tracking-caps">{item.l}</span>
                </div>
                {/* Koordinatör Admin ise uyarı + temizle */}
                {item.l === 'İrtibatlı' && coordinatorIsAdmin && (isAdmin || isManager) && (
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="danger" className="text-micro px-1.5 py-0.5 font-bold">
                      Hatalı Atama
                    </Badge>
                    <button
                      onClick={onClearCoordinator}
                      className="text-caption px-2 py-1 -mr-2 rounded-md text-status-danger hover:text-status-danger uppercase tracking-widest font-medium underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger"
                    >
                      Temizle
                    </button>
                  </div>
                )}
                {/* İzin/mazeret devri: sorumlu Müdür başka bir Müdür'e devredebilir */}
                {item.l === 'Sorumlu' && canDelegate && onDelegateTask && (
                  <button
                    onClick={onOpenDelegateModal}
                    className="text-caption px-2 py-1 -mr-2 rounded-md text-executive-blue hover:text-[color:var(--gold-text)] uppercase tracking-widest font-medium underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
                  >
                    Devret
                  </button>
                )}
              </div>
            ))}
            {/* #3 - Sorumlu birim (departman) */}
            {task.departmentId && (
              <div className="flex items-center gap-2.5 p-2.5 bg-makam-glass backdrop-blur-xl rounded-xl border border-surface-border shadow-sm">
                <div className="w-8 h-8 rounded-full bg-executive-blue/[0.05] border border-executive-blue/10 flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-4 h-4 text-executive-blue/70" aria-hidden="true" />
                </div>
                <div className="flex flex-col gap-0.5 flex-1">
                  <span className="text-body-sm font-medium text-executive-blue tracking-tight">{task.departmentId}</span>
                  <span className="text-micro text-text-tertiary font-medium uppercase tracking-caps">Sorumlu Birim</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-1.5">
            <h4 className="text-micro font-medium text-text-muted uppercase tracking-caps">Zaman Yönetimi</h4>
            <Tooltip content="Mühlet yalnızca mesai saatleri (09:00–18:00) içinde işler; hafta sonu/resmî tatiller ve Engellendi/Onay Sürecinde geçen süre sayılmaz.">
              <Info className="w-3 h-3 text-text-tertiary cursor-help" aria-label="Mühlet hesaplama kuralı" />
            </Tooltip>
          </div>
          <div className="p-3 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-xl flex items-center gap-3">
            <Calendar className="w-4 h-4 text-[color:var(--gold-text)] stroke-[1.3] flex-shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="text-micro font-medium text-text-tertiary uppercase tracking-caps">Bitiş Tarihi</span>
              <p className="text-body font-medium text-executive-blue">
                {format(task.deadline, 'd MMMM yyyy', { locale: tr })}
              </p>
              {/* #4 - Canlı SLA geri sayım */}
              {timeLeft && (
                <span className={cn(
                  'text-micro font-medium tabular-nums mt-0.5',
                  getSLAColor(timeLeft.status)
                )}>
                  {timeLeft.label}
                </span>
              )}
            </div>
          </div>
          {/* #3 - Tahmini efor */}
          {typeof task.estimatedHours === 'number' && task.estimatedHours > 0 && (
            <div className="p-3 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-xl flex items-center gap-3">
              <Clock className="w-4 h-4 text-[color:var(--gold-text)] stroke-[1.3] flex-shrink-0" aria-hidden="true" />
              <div className="flex flex-col gap-0.5">
                <span className="text-micro font-medium text-text-tertiary uppercase tracking-caps">Tahmini Efor</span>
                <p className="text-body font-medium text-executive-blue tabular-nums">
                  {task.estimatedHours} saat
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    <div className="flex flex-col gap-6">
      {/* Durum-özel bilgi kutuları — birincil aksiyon butonu modal alt çubuğundadır */}
      {(task.status === 'PENDING_DELEGATION' ||
        task.status === 'BLOCKED' ||
        task.status === 'COMPLETED' ||
        task.status === 'CANCELLED' ||
        (task.status === 'AWAITING_APPROVAL' && !isAdmin)) && (
        <div className="flex flex-col gap-4">
          <h4 className="text-micro font-medium text-text-muted uppercase tracking-caps">Durum Bilgisi</h4>
          <div className="flex flex-col gap-2.5">
            {task.status === 'PENDING_DELEGATION' && (
              <div className="flex flex-col items-center gap-3 py-4 px-3 bg-executive-gold/[0.06] border border-dashed border-executive-gold/25 rounded-2xl">
                <Hourglass className="w-5 h-5 text-[color:var(--gold-text)]" aria-hidden="true" />
                <span className="text-micro text-[color:var(--gold-text)] font-medium uppercase tracking-widest text-center">Yetki Devri Bekleniyor</span>
                <p className="text-caption text-text-muted font-light text-center leading-relaxed">
                  Talimat devralınmayı bekliyor; süreç ancak devir kabul edildiğinde başlar.
                </p>
              </div>
            )}

            {task.status === 'AWAITING_APPROVAL' && !isAdmin && (
              <div className="flex flex-col items-center gap-3 py-4 px-3 bg-executive-gold/[0.06] border border-dashed border-executive-gold/25 rounded-2xl">
                <Hourglass className="w-5 h-5 text-[color:var(--gold-text)]" aria-hidden="true" />
                <span className="text-micro text-[color:var(--gold-text)] font-medium uppercase tracking-widest text-center">Makam Onayı Bekleniyor</span>
                <p className="text-caption text-text-muted font-light text-center leading-relaxed">
                  Talimat onaya sunuldu; nihai kapanış yönetici onayıyla gerçekleşir.
                </p>
              </div>
            )}

            {task.status === 'BLOCKED' && (
              <div className="flex flex-col items-center gap-3 py-4 px-2 bg-status-danger/5 border border-dashed border-status-danger/20 rounded-2xl">
                <AlertTriangle className="w-5 h-5 text-status-danger animate-pulse" />
                <span className="text-micro text-status-danger font-medium uppercase tracking-widest text-center">İşlem Engellendi</span>
                <button
                  onClick={() => setActiveTab('blockers')}
                  className="text-micro px-2 py-1 rounded-md text-executive-blue font-bold uppercase tracking-widest hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
                >
                  ENGELİ ÇÖZ
                </button>
              </div>
            )}

            {(task.status === 'COMPLETED' || task.status === 'CANCELLED') && (
              <div className="flex flex-col items-center gap-3 py-4 px-2 bg-surface-border/30 border border-dashed border-surface-border/50 rounded-2xl">
                <CheckCircle2 className="w-5 h-5 text-status-success" />
                <span className="text-micro text-text-muted font-medium uppercase tracking-widest">Operasyon Sonlandı</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* #7 - Sonuç Belgeleri: Liyakat/İkaz belgeleri ve icra kanıtı */}
      {((task.status === 'COMPLETED' && task.completedAt) || task.evidence) && (
        <div className="flex flex-col gap-4">
          <h4 className="text-micro font-medium text-text-muted uppercase tracking-caps">Sonuç Belgeleri</h4>
          <div className="p-3 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl flex flex-col gap-2">
            {task.status === 'COMPLETED' && task.completedAt && task.completedAt <= task.deadline && (
              <Tooltip content="Mühleti içinde tamamlanan talimatlar için otomatik olarak hazırlanır." side="bottom" className="w-full">
                <button
                  onClick={() => onShowCertificate?.(task)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-caption font-medium text-[color:var(--gold-text)] uppercase tracking-widest hover:bg-executive-gold/10 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
                >
                  <Award className="w-4 h-4 shrink-0" aria-hidden="true" />
                  Liyakat Belgesi
                </button>
              </Tooltip>
            )}
            {task.status === 'COMPLETED' && task.completedAt && task.completedAt > task.deadline && (
              <Tooltip content="Mühleti aşıldıktan sonra tamamlanan talimatlar için otomatik olarak hazırlanır." side="bottom" className="w-full">
                <button
                  onClick={() => onShowWarning?.(task)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-caption font-medium text-status-danger uppercase tracking-widest hover:bg-status-danger/10 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  İkaz Belgesi
                </button>
              </Tooltip>
            )}
            {task.evidence && (
              /^https?:\/\//i.test(task.evidence) ? (
                <a
                  href={task.evidence}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-caption font-medium text-executive-blue uppercase tracking-widest hover:bg-executive-blue/[0.06] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
                >
                  <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
                  İcra Kanıtı{task.evidenceType ? ` (${task.evidenceType === 'Image' ? 'Görsel' : task.evidenceType === 'Link' ? 'Bağlantı' : 'PDF'})` : ''}
                </a>
              ) : (
                <div className="flex items-start gap-2.5 px-3 py-2.5">
                  <FileText className="w-4 h-4 shrink-0 text-executive-blue mt-0.5" aria-hidden="true" />
                  <span className="text-caption text-text-body break-all">{task.evidence}</span>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  </div>
);
