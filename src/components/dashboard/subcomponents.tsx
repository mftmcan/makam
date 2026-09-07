import React from 'react';
import { ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import type { User } from '../../types';
import { cn } from '../../lib/utils';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { RollingNumber } from '../ui/RollingNumber';
import type { InterventionItem, UserPerformanceProfile } from '../../lib/executiveMetrics';

// ─── Compact Stat Card ────────────────────────────────────────────────────────
export interface StatCardProps {
  label: string;
  value: number;
  max: number;
  icon: React.ElementType;
  color: 'blue' | 'green' | 'orange' | 'red' | 'gray';
  onClick?: () => void;
  index?: number;
  delta?: number;
}

export const StatCard = ({ label, value, max, icon: Icon, color, onClick, index = 0, delta = 0 }: StatCardProps) => {
  const accentColor = {
    blue:   { bg: 'bg-executive-blue/5',   text: 'text-executive-blue' },
    green:  { bg: 'bg-status-success/10',  text: 'text-status-success' },
    orange: { bg: 'bg-executive-gold/10',  text: 'text-[color:var(--gold-text)]' },
    red:    { bg: 'bg-status-danger/10',   text: 'text-status-danger' },
    gray:   { bg: 'bg-surface-glass',      text: 'text-text-muted' },
  }[color];

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28, delay: index * 0.06 }}
      whileHover={{ y: -3, scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        'group w-full text-left flex items-center gap-2.5 sm:gap-3 p-3 sm:p-3.5 min-h-[74px]',
        'bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl',
        'shadow-card hover:shadow-card-hover',
        'transition-all duration-300 hover:bg-surface-elevated hover:border-surface-border',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
        onClick && 'cursor-pointer'
      )}
    >
      {/* Icon */}
      <div className={cn(
        'w-9 h-9 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-300',
        accentColor.bg,
        'group-hover:scale-105'
      )}>
        <Icon className={cn('w-4 h-4 stroke-[1.5]', accentColor.text)} />
      </div>

      {/* Label + Value */}
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <span className="text-micro font-semibold text-text-tertiary uppercase tracking-[0.08em] leading-tight whitespace-normal">{label}</span>
        <div className="flex items-baseline gap-1 min-w-0">
          {/* value === 0 iken diğer aktif sayılarla (ör. Tamamlanan: 5) aynı
              görsel ağırlıkta duruyordu — sıfır değerler artık soluk, aktif
              sayılar tam kontrastta (bkz. kod denetimi). */}
          <RollingNumber
            value={value}
            className={cn(
              'text-[20px] sm:text-[22px] font-light tracking-tight tabular-nums leading-none shrink-0',
              value === 0 ? 'text-text-tertiary/60' : 'text-executive-blue'
            )}
          />
          {max > 0 && <span className="text-micro text-text-tertiary font-light truncate min-w-0">/ {max}</span>}
          {delta !== 0 && (
            <span className={cn(
              "text-micro font-bold px-1 py-0.5 rounded-md ml-1 flex items-center gap-0.5 shrink-0",
              delta > 0
                ? (color === 'red' || color === 'orange' ? "bg-status-danger/10 text-status-danger" : "bg-status-success/10 text-status-success")
                : (color === 'red' || color === 'orange' ? "bg-status-success/10 text-status-success" : "bg-status-danger/10 text-status-danger")
            )}>
              {delta > 0 ? `+${delta}` : delta}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
};

// low→medium→high→critical arasında gerçek bir 4 kademeli kademelenme:
// medium ve high ikisi de amber ailesindeydi ama high aslında zaten kırmızıya
// kayıyordu — critical (dolu kırmızı) ile aradaki fark yalnızca doygunluk
// farkına dayanıyordu, hızlı taramada "72" (high) ile "82" (critical) neredeyse
// aynı kırmızı gibi algılanıyordu (bkz. kod denetimi). high artık ağır bir
// amber tonunda (koyu/dolgun status-warning) — critical'in "dolu kırmızı"sı
// tek başına kalıp gerçek bir eşik geçişi hissi verir.
// Yalnızca bu dosya içinde (InterventionRow) kullanılıyor — dışa aktarılmasına
// gerek yok (bkz. kod denetimi: gereksiz genişletilmiş public API yüzeyi).
const riskTone = {
  low: 'bg-surface-glass text-text-muted border-surface-border',
  medium: 'bg-status-warning/10 text-status-warning border-status-warning/20',
  high: 'bg-status-warning/25 text-status-warning border-status-warning/50 font-semibold',
  // Kritik risk: dolgu rengi solid kalır (görsel ağırlık korunur); metin,
  // her iki temada da zeminle yüksek kontrast veren surface-base tonudur.
  critical: 'bg-status-danger text-surface-base border-status-danger',
};

const laneLabel: Record<InterventionItem['lane'], string> = {
  crisis: 'Kriz',
  blocked: 'Engel',
  approval: 'Onay',
  stalled: 'Atalet',
  deadline: 'Mühlet',
  workload: 'Yük',
};

export interface InterventionRowProps {
  item: InterventionItem;
  users: User[];
  onView?: () => void;
  index?: number;
}

export const InterventionRow = ({ item, users, onView, index = 0 }: InterventionRowProps) => {
  const assignee = users.find(u => u.uid === item.task.assigneeId || u.email === item.task.assigneeId);

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28, delay: index * 0.04 }}
      onClick={onView}
      className="group w-full text-left grid grid-cols-[auto_1fr_auto] gap-3 p-3 rounded-xl border border-surface-border bg-surface-elevated/70 hover:bg-makam-glass hover:border-executive-blue/10 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
    >
      <div className="flex flex-col items-center gap-1">
        <div className={cn('w-11 h-11 rounded-xl border flex items-center justify-center font-display text-[16px] tabular-nums', riskTone[item.level])}>
          {item.score}
        </div>
        <span className="text-micro text-text-tertiary uppercase tracking-[0.2em]">Risk</span>
      </div>

      <div className="min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={item.level === 'critical' || item.level === 'high' ? 'danger' : item.level === 'medium' ? 'warning' : 'default'}>
            {laneLabel[item.lane]}
          </Badge>
          <span className="text-body-sm font-medium text-executive-blue line-clamp-1 font-display">{item.task.title}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <Avatar name={assignee?.fullName ?? '?'} photoURL={assignee?.photoURL} size="sm" />
          <span className="text-micro text-text-muted truncate">{assignee?.fullName ?? 'Sorumlu bulunamadı'}</span>
          <span className="text-micro text-text-tertiary truncate">· {item.reasons.join(' · ')}</span>
        </div>
        <span className="text-micro font-medium text-text-heading uppercase tracking-[0.18em]">{item.action}</span>
      </div>

      <div className="flex items-center justify-center">
        <ArrowRight className="w-4 h-4 text-text-tertiary group-hover:text-executive-blue group-hover:translate-x-0.5 transition-all" />
      </div>
    </motion.button>
  );
};

export interface PerformanceRowProps {
  profile: UserPerformanceProfile;
  index?: number;
}

export const PerformanceRow = ({ profile, index = 0 }: PerformanceRowProps) => {
  // Pil rengi eskiden yalnızca iş hacmine (loadScore) bakıyordu — SLA %0 olan
  // bir kişi bile düşük aktif görev sayısı yüzünden yeşil pil taşıyabiliyordu
  // (bkz. tasarım denetimi, canlı ortamda doğrulandı). completedCount > 0
  // şartı bilinçli: hiç tamamlanmış görevi olmayan biri için
  // onTimeCompletionRate anlamsız bir varsayılan olan %100'e düşer (bkz.
  // lib/executiveMetrics.ts) — bu, sahte bir "kritik" alarmı tetiklememeli.
  const hasSlaAlarm = profile.completedCount > 0 && profile.onTimeCompletionRate < 50;
  const loadTone = hasSlaAlarm || profile.loadScore >= 75
    ? 'text-status-danger bg-status-danger/10 border-status-danger/20'
    : profile.loadScore >= 45
      ? 'text-status-warning bg-status-warning/10 border-status-warning/20'
      : 'text-status-success bg-status-success/10 border-status-success/20';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28, delay: index * 0.04 }}
      className="grid grid-cols-[auto_1fr_auto] gap-3 p-3 rounded-xl border border-surface-border bg-surface-elevated/70"
    >
      <Avatar name={profile.user.fullName} photoURL={profile.user.photoURL} size="md" />
      <div className="min-w-0 flex flex-col gap-1">
        <span className="text-body-sm font-medium text-executive-blue truncate font-display">{profile.user.fullName}</span>
        <div className="flex flex-wrap gap-2 text-micro text-text-tertiary uppercase tracking-[0.15em]">
          <span>{profile.activeCount} aktif</span>
          <span>{profile.completedCount} icra</span>
          <span>{profile.overdueCount} gecikmiş</span>
          <span>{profile.blockedCount} engelli</span>
          <span className={hasSlaAlarm ? 'text-status-danger font-bold' : undefined}>SLA %{profile.onTimeCompletionRate}</span>
        </div>
      </div>
      <div className={cn('w-12 h-10 rounded-xl border flex flex-col items-center justify-center', loadTone)}>
        <span className="text-body font-semibold tabular-nums leading-none">{profile.loadScore}</span>
        <span className="text-micro uppercase tracking-[0.16em]">Yük</span>
      </div>
    </motion.div>
  );
};

// ─── Custom Tooltip for Recharts (Frosted Glass) ──────────────────────────────
// React.memo: Recharts re-invokes this on every mousemove while hovering the chart;
// memoizing skips re-render when active/payload/label haven't actually changed.
// Not recharts'ın kendi TooltipContentProps'u kullanılmıyor: o tip payload/active
// gibi alanları ZORUNLU tanımlıyor (recharts bunları content={<CustomTooltip />}
// render edildikten SONRA React.cloneElement ile enjekte ediyor), bu yüzden JSX'te
// prop'suz kullanım tip hatası veriyordu. Burada yalnızca gerçekten okunan 3 alanın
// dar/opsiyonel bir tipi tanımlanır — `any` bulaşmadan.
interface CustomTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{ name?: string; value?: number | string; color?: string }>;
}

export const CustomTooltip = React.memo(({ active, payload, label }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-makam-glass backdrop-blur-xl border border-surface-border p-3 rounded-2xl shadow-xl flex flex-col gap-1.5 min-w-[120px] text-left">
        <span className="text-micro font-bold text-text-tertiary uppercase tracking-wider">{label}</span>
        <div className="h-px bg-executive-blue/[0.05]" />
        <div className="flex flex-col gap-1 text-caption font-medium">
          {payload.map((entry) => (
            <div key={entry.name} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-text-muted">{entry.name}:</span>
              </div>
              <span className="font-bold text-text-heading">{entry.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
});
