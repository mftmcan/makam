import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';
import { CheckCircle2, AlertCircle } from 'lucide-react';

// components/settings/SharedUI.tsx içindeydi — Settings.tsx dışında hiçbir
// modül kullanmıyordu ama içerik/görsel olarak tamamen genel amaçlı (yükleme/
// başarı/hata durumu bandı) olduğundan ui/'a taşındı (bkz. tasarım denetimi).
export const StatusBanner = ({ status }: { status: { type: 'success' | 'error' | 'loading'; message: string } | null }) => {
  if (!status) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'flex items-center gap-3 p-3 rounded-xl border text-caption font-medium',
        status.type === 'loading' ? 'bg-executive-blue/[0.03] border-executive-blue/10 text-executive-blue' :
        status.type === 'success' ? 'bg-status-success/10 border-status-success/20 text-status-success' :
        'bg-status-danger/10 border-status-danger/20 text-status-danger'
      )}
    >
      {status.type === 'loading' ? (
        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />
      ) : status.type === 'success' ? (
        <CheckCircle2 className="w-4 h-4 flex-shrink-0 stroke-[1.5]" />
      ) : (
        <AlertCircle className="w-4 h-4 flex-shrink-0 stroke-[1.5]" />
      )}
      <span className="uppercase tracking-[0.2em]">{status.message}</span>
    </motion.div>
  );
};
