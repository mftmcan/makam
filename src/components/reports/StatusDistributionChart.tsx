import { CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { ResponsiveContainer, PieChart, Pie, Cell, Legend, Tooltip } from 'recharts';
import { EmptyState } from '../ui/EmptyState';
import { PANEL_CLASSNAME } from '../ui/Panel';
import { SPRING_PANEL } from '../../lib/motion';
import { EMPTY_STATE_MESSAGES } from '../../constants';
import type { StatusDistributionRow } from './helpers';

interface StatusDistributionChartProps {
  data: StatusDistributionRow[];
}

/** ── Talimat Durum Dağılımı (Pie) ─────────────────────────────────────────
 *  Reports.tsx'ten ayrıştırıldı (bkz. kod denetimi — dosya bölme): saf sunum,
 *  kendi state'i yok. */
export const StatusDistributionChart = ({ data }: StatusDistributionChartProps) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
    transition={{ ...SPRING_PANEL, delay: 0.25 }}
    className={PANEL_CLASSNAME}
  >
    <div className="flex items-center justify-between mb-3">
      <div>
        <h3 className="text-body font-medium text-executive-blue font-display tracking-tight">Talimat Dağılımı</h3>
        <p className="text-micro text-text-tertiary uppercase tracking-eyebrow mt-0.5">Durum Matrisi</p>
      </div>
      <CheckCircle2 className="w-4 h-4 text-status-success stroke-[1.5]" />
    </div>
    <div className="h-[180px]">
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="label"
              cx="50%" cy="50%" innerRadius={50} outerRadius={75}
              paddingAngle={3} stroke="var(--color-surface-base)" strokeWidth={2}
            >
              {data.map((entry, idx) => (
                <Cell key={idx} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--color-surface-base)',
                borderColor: 'var(--color-surface-border)',
                borderRadius: '14px',
                fontSize: '11px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                backdropFilter: 'blur(20px)',
                color: 'var(--color-text-heading)'
              }}
              itemStyle={{ color: 'var(--color-text-body)' }}
              formatter={(v, name) => [v, name]}
            />
            <Legend iconSize={8} iconType="circle"
              formatter={(v) => <span style={{ fontSize: 9, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>{v}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-full flex items-center justify-center">
          <EmptyState size="sm" className="border-none bg-transparent" message={EMPTY_STATE_MESSAGES.NO_DATA_IN_RANGE} />
        </div>
      )}
    </div>
  </motion.div>
);
