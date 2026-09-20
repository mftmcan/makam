import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';
import { SPRING_ROW, staggerDelay } from '../../lib/motion';
import { RollingNumber } from '../ui/RollingNumber';

// ─── Compact KPI Card ─────────────────────────────────────────────────────────
export interface KpiCardProps {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  icon: React.ElementType;
  color: 'blue' | 'red' | 'green';
  index?: number;
}

export const KpiCard = ({ label, value, prefix, suffix, icon: Icon, color, index = 0 }: KpiCardProps) => {
  const palette = {
    blue:  { bg: 'bg-executive-blue/5',   icon: 'text-executive-blue',  bar: 'bg-executive-blue' },
    red:   { bg: 'bg-status-danger/10',   icon: 'text-status-danger',   bar: 'bg-status-danger' },
    green: { bg: 'bg-status-success/10',  icon: 'text-status-success',  bar: 'bg-status-success' },
  }[color];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING_ROW, delay: staggerDelay(index, 0.06) }}
      className="group relative flex items-center gap-3 p-3.5 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl shadow-card hover:shadow-card-hover hover:bg-surface-elevated transition-all duration-300"
    >
      {/* Aksan şeridi — Dashboard'un StatCard'ıyla AYNI desen (bkz. tasarım
          denetimi: kartın kategorik kimliği ikondan önce fark edilsin). */}
      <div className={cn('absolute inset-x-0 top-0 h-[2px] rounded-t-2xl', palette.bar)} aria-hidden="true" />

      <div className={cn('w-9 h-9 flex-shrink-0 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform', palette.bg)}>
        <Icon className={cn('w-4 h-4 stroke-[1.5]', palette.icon)} />
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[22px] font-light text-executive-blue tracking-tight tabular-nums leading-none font-display">
          {prefix}<RollingNumber value={value} />{suffix}
        </span>
        <span className="text-micro text-text-tertiary font-medium uppercase tracking-eyebrow">{label}</span>
      </div>
    </motion.div>
  );
};
