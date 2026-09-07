import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';

// components/settings/SharedUI.tsx içindeydi — Settings.tsx'e özel sanılıyordu,
// ama GuideModal.tsx zaten kendi başına import edip kullanıyordu (bkz. tasarım
// denetimi: "domain'e özel" göründüğü halde fiilen genel amaçlı bir bileşendi).
// ui/'a taşındı ki bu ikili kullanım Button/Badge gibi diğer paylaşılan
// bileşenlerle aynı tek noktadan yönetilsin.
export interface SettingsCardProps {
  title: string;
  description?: string;
  icon: React.ElementType;
  accentColor?: 'slate' | 'red' | 'amber' | 'gold';
  children: React.ReactNode;
  index?: number;
  fullWidth?: boolean;
}

export const SettingsCard = ({ title, description, icon: Icon, accentColor = 'slate', children, index = 0, fullWidth }: SettingsCardProps) => {
  const colors = {
    slate: { icon: 'bg-executive-blue/5 text-executive-blue', border: 'border-surface-border' },
    red:   { icon: 'bg-status-danger/10 text-status-danger', border: 'border-status-danger/20 bg-status-danger/[0.03]' },
    amber: { icon: 'bg-executive-gold/10 text-[color:var(--gold-text)]', border: 'border-executive-gold/20 bg-executive-gold/[0.03]' },
    gold:  { icon: 'bg-executive-gold/10 text-[color:var(--gold-text)]', border: 'border-executive-gold/20' },
  }[accentColor];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28, delay: index * 0.06 }}
      className={cn(
        'flex flex-col gap-3 p-4 bg-makam-glass backdrop-blur-xl border rounded-2xl',
        'shadow-card hover:shadow-card-hover',
        'transition-all duration-300 hover:bg-surface-elevated',
        colors.border,
        fullWidth && 'col-span-full'
      )}
    >
      {/* Card header */}
      <div className="flex items-center gap-3">
        <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0', colors.icon)}>
          <Icon className="w-4 h-4 stroke-[1.5]" />
        </div>
        <div className="flex flex-col gap-0.5">
          <h3 className="text-body-sm font-medium text-executive-blue tracking-tight font-serif">{title}</h3>
          {description && (
            <p className="text-micro text-text-tertiary uppercase tracking-[0.25em]">{description}</p>
          )}
        </div>
      </div>

      <div className="h-px bg-executive-blue/[0.04]" />

      {/* Card content */}
      <div className="flex flex-col gap-2.5">
        {children}
      </div>
    </motion.div>
  );
};
