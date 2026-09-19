import { TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { PANEL_CLASSNAME } from '../ui/Panel';
import { SPRING_PANEL } from '../../lib/motion';
import type { SlaTrendPoint } from './helpers';

interface SlaTrendChartProps {
  data: SlaTrendPoint[];
}

/** ── SLA Uyum Trend Çizgi Grafiği ──────────────────────────────────────────
 *  Reports.tsx'ten ayrıştırıldı (bkz. kod denetimi — dosya bölme): saf sunum,
 *  kendi state'i yok. */
export const SlaTrendChart = ({ data }: SlaTrendChartProps) => {
  // Seçili aralıkta hiç tamamlanan görev yoksa `oran` tüm noktalarda null olur
  // ve çizgi hiçbir şey çizmeden yalnızca eksenler kalırdı — boş durum ayrıca
  // belirtilir (bkz. tasarım denetimi: "grafik alanı tamamen boş").
  const hasData = data.some(d => d.oran !== null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING_PANEL, delay: 0.2 }}
      className={PANEL_CLASSNAME}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-body font-medium text-executive-blue font-display tracking-tight">SLA Uyum Trendi</h3>
          <p className="text-micro text-text-tertiary uppercase tracking-eyebrow mt-0.5">Son 14 Gün</p>
        </div>
        <TrendingUp className="w-4 h-4 text-[color:var(--gold-text)] stroke-[1.5]" />
      </div>
      <div className="h-[180px] relative">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
            <CartesianGrid stroke="var(--color-surface-border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" fontSize={8} tickLine={false} axisLine={false} tick={{ fill: 'var(--text-light)' }} />
            <YAxis domain={[0, 100]} fontSize={8} tickLine={false} axisLine={false} tick={{ fill: 'var(--text-light)' }}
              tickFormatter={(v) => `%${v}`} />
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
              formatter={(v) => v !== null ? [`%${v}`, 'SLA Uyum'] : ['Veri yok', '']}
            />
            <Line dataKey="oran" stroke="var(--chart-created)" strokeWidth={2} dot={{ r: 3, fill: 'var(--chart-created)' }}
              activeDot={{ r: 5 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
        {!hasData && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-micro text-text-tertiary uppercase tracking-wider bg-surface-elevated/90 px-3 py-1.5 rounded-lg border border-surface-border">
              Seçili aralıkta tamamlanan talimat yok
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
};
