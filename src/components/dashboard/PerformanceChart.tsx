import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, BarChart3 } from 'lucide-react';
import { motion } from 'motion/react';
import { EmptyState } from '../ui/EmptyState';
import { PANEL_CLASSNAME } from '../ui/Panel';
import { SPRING_PANEL } from '../../lib/motion';
import { CustomTooltip } from './subcomponents';
import type { DashboardChartDay } from './helpers';

interface PerformanceChartProps {
  isAdmin: boolean;
  onNavigateTab?: () => void;
  hasChartActivity: boolean;
  last7DaysData: DashboardChartDay[];
  /** Ekran okuyucular için grafiğin metinsel özeti — recharts SVG'si
   *  erişilebilir değildir. */
  chartSummary: string;
}

/** ── Performans Analitiği Grafiği ─────────────────────────────────────────
 *  Dashboard.tsx'ten ayrıştırıldı (bkz. kod denetimi — dosya bölme): saf
 *  sunum, kendi state'i yok. */
export const PerformanceChart = ({ isAdmin, onNavigateTab, hasChartActivity, last7DaysData, chartSummary }: PerformanceChartProps) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ ...SPRING_PANEL, delay: 0.32 }}
    className={PANEL_CLASSNAME}
  >
    <div className="flex justify-between items-center mb-3">
      <div>
        <h3 className="text-body font-medium text-executive-blue tracking-tight font-display">Performans Analitiği</h3>
        <p className="text-micro text-text-tertiary uppercase tracking-eyebrow mt-0.5">Son 7 Gün</p>
      </div>
      {isAdmin && (
        <button
          onClick={onNavigateTab}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-executive-blue/[0.03] border border-executive-blue/[0.06] text-text-muted hover:bg-executive-blue hover:text-[color:var(--executive-blue-text)] transition-all duration-300 text-micro font-medium uppercase tracking-caps"
        >
          <TrendingUp className="w-3 h-3" />
          Analiz
        </button>
      )}
    </div>
    {/* Chart: reduced height on mobile */}
    <div className="h-[160px] sm:h-[200px] lg:h-[220px] w-full">
      {!hasChartActivity ? (
        <EmptyState
          className="h-full justify-center border-none"
          icon={<BarChart3 className="w-7 h-7" />}
          message="Son 7 günde yeni talimat veya icra kaydı yok"
        />
      ) : (
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
        <BarChart data={last7DaysData} barGap={4} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="chartCreated" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-created)" stopOpacity="0.8" />
              <stop offset="100%" stopColor="var(--chart-created)" stopOpacity="0.35" />
            </linearGradient>
            <linearGradient id="chartCompleted" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-completed)" stopOpacity="0.8" />
              <stop offset="100%" stopColor="var(--chart-completed)" stopOpacity="0.35" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-surface-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="name"
            stroke="transparent"
            fontSize={9}
            tickLine={false}
            axisLine={false}
            tick={{ dy: 8, fill: 'var(--text-light)', fontWeight: 400 }}
          />
          {/* Değerler eskiden yalnızca hover tooltip'iyle okunabiliyordu
              (dokunmatik cihazda pratikte hiç) — küçük, tam sayı adımlı bir
              eksen eklendi (bkz. tasarım denetimi F27). */}
          <YAxis
            allowDecimals={false}
            fontSize={8}
            tickLine={false}
            axisLine={false}
            width={28}
            tick={{ fill: 'var(--text-light)' }}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(22, 21, 19, 0.01)' }} />
          <Bar dataKey="Yeni Talimat" fill="url(#chartCreated)" radius={[4,4,0,0]} />
          <Bar dataKey="İcra Edilen" fill="url(#chartCompleted)" radius={[4,4,0,0]} />
        </BarChart>
      </ResponsiveContainer>
      )}
    </div>

    {/* Legend */}
    <div className="flex flex-wrap items-center gap-3 mt-2 pt-2 border-t border-executive-blue/[0.04]">
      {[
        { color: 'var(--chart-created)', label: 'Yeni Talimat' },
        { color: 'var(--chart-completed)', label: 'İcra Edilen' },
      ].map(({ color, label }) => (
        <div key={label} className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
          <span className="text-micro text-text-tertiary uppercase tracking-caps">{label}</span>
        </div>
      ))}
    </div>

    {/* Ekran okuyucular için grafiğin metinsel özeti — recharts SVG'si erişilebilir değildir */}
    <p className="sr-only">{chartSummary}</p>
  </motion.div>
);
