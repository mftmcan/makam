import { Users } from 'lucide-react';
import { motion } from 'motion/react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { PANEL_CLASSNAME } from '../ui/Panel';
import { SPRING_PANEL } from '../../lib/motion';
import type { StaffWorkloadRow } from './helpers';
import { CHART_TOOLTIP_CONTENT_STYLE, CHART_TOOLTIP_ITEM_STYLE, CHART_AXIS_TICK_STYLE, CHART_LEGEND_FORMATTER_STYLE } from './chartTheme';

interface StaffWorkloadChartProps {
  data: StaffWorkloadRow[];
}

/** ── Personel Yük Dağılımı ─────────────────────────────────────────────────
 *  Reports.tsx'ten ayrıştırıldı (bkz. kod denetimi — dosya bölme): saf sunum,
 *  kendi state'i yok. Çağıran (`Reports.tsx`) `data.length > 0` koşuluyla
 *  sarmalıyor — boş veri hâli burada AYRICA ele alınmaz. */
export const StaffWorkloadChart = ({ data }: StaffWorkloadChartProps) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
    transition={{ ...SPRING_PANEL, delay: 0.3 }}
    className={PANEL_CLASSNAME}
  >
    <div className="flex items-center justify-between mb-3">
      <div>
        <h3 className="text-body font-medium text-executive-blue font-display tracking-tight">Personel İş Yükü</h3>
        <p className="text-micro text-text-tertiary uppercase tracking-eyebrow mt-0.5">Aktif vs Tamamlanan</p>
      </div>
      <Users className="w-4 h-4 text-text-tertiary stroke-[1]" />
    </div>
    <div className="h-[180px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="barActive" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-created)" stopOpacity="0.8" />
              <stop offset="100%" stopColor="var(--chart-created)" stopOpacity="0.35" />
            </linearGradient>
            <linearGradient id="barCompleted" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-completed)" stopOpacity="0.8" />
              <stop offset="100%" stopColor="var(--chart-completed)" stopOpacity="0.35" />
            </linearGradient>
          </defs>
          <XAxis dataKey="name" fontSize={9} tickLine={false} axisLine={false} tick={CHART_AXIS_TICK_STYLE} />
          <YAxis fontSize={8} tickLine={false} axisLine={false} tick={CHART_AXIS_TICK_STYLE} />
          <Tooltip
            contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
            cursor={{ fill: 'var(--shadow-card)' }}
          />
          <Bar dataKey="assigned" name="Aktif" fill="url(#barActive)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="completed" name="Tamamlanan" fill="url(#barCompleted)" radius={[4, 4, 0, 0]} />
          <Legend iconSize={8} iconType="circle"
            formatter={(v) => <span style={CHART_LEGEND_FORMATTER_STYLE}>{v}</span>}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </motion.div>
);
