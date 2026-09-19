import { ArrowRight, BarChart3 } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';
import { SPRING_PANEL, SPRING_ROW, staggerDelay } from '../../lib/motion';
import { EMPTY_STATE_MESSAGES, type AppTabId } from '../../constants';
import { EmptyState } from '../ui/EmptyState';
import { PANEL_FRAME_CLASSNAME } from '../ui/Panel';
import { Avatar } from '../ui/Avatar';
import { SimpleDataTable, type DataTableColumn } from '../ui/dataTable';
import type { ManagerPerformanceRow } from './helpers';

// Yönetici performans tablosunun sütun tanımı — hücre içerikleri yalnızca
// satırın kendisine (`m`) bağlı, `onNavigateTab` gibi dış bağımlılık taşımaz
// (satır tıklaması `renderRow`'da, DataTable'ın dışında ele alınır) — bu
// yüzden component gövdesi yerine modül seviyesinde sabit tanımlanabilir.
const MANAGER_PERFORMANCE_COLUMNS: DataTableColumn<ManagerPerformanceRow>[] = [
  {
    id: 'name',
    header: 'Yetkili Makam',
    align: 'left',
    cell: (m) => (
      <div className="flex items-center gap-3">
        <Avatar name={m.fullName} photoURL={m.photoURL} size="sm" className="group-hover:scale-105 transition-transform" />
        <div className="flex flex-col gap-0.5">
          <span className="text-body font-medium text-executive-blue font-display tracking-tight group-hover:text-executive-blue transition-colors">
            {m.fullName}
          </span>
          <span className="text-micro text-text-tertiary uppercase tracking-caps">
            {m.departmentId || 'Stratejik Planlama'}
          </span>
        </div>
      </div>
    ),
  },
  {
    id: 'total',
    header: 'İş Yükü',
    align: 'center',
    cell: (m) => <span className="text-[16px] font-light text-executive-blue tabular-nums">{m.total}</span>,
  },
  {
    id: 'completed',
    header: 'Çıktı',
    align: 'center',
    cell: (m) => (
      <span className="text-body-sm font-medium text-status-success bg-status-success/10 px-3 py-1 rounded-lg border border-status-success/20 tabular-nums">
        {m.completed}
      </span>
    ),
  },
  {
    id: 'blocked',
    header: 'Darboğaz',
    align: 'center',
    cell: (m) => (
      <span className={cn(
        'text-body-sm font-medium px-3 py-1 rounded-lg border tabular-nums',
        m.blocked > 0
          ? 'text-status-danger bg-status-danger/10 border-status-danger/20'
          : 'text-text-tertiary bg-surface-glass border-surface-border'
      )}>
        {m.blocked}
      </span>
    ),
  },
  {
    id: 'sla',
    header: 'SLA Uyum',
    align: 'center',
    cell: (m) => m.hasData ? (
      <span className={cn(
        'text-body-sm font-medium px-3 py-1 rounded-lg border tabular-nums',
        m.slaRate > 80 ? 'text-status-success bg-status-success/10 border-status-success/20' :
        m.slaRate > 50 ? 'text-[color:var(--gold-text)] bg-executive-gold/10 border-executive-gold/20' :
        'text-status-danger bg-status-danger/10 border-status-danger/20'
      )}>
        %{m.slaRate}
      </span>
    ) : (
      <span className="text-micro font-medium px-3 py-1 rounded-lg border text-text-tertiary bg-surface-glass border-surface-border uppercase tracking-wider">
        {EMPTY_STATE_MESSAGES.NO_DATA_SHORT}
      </span>
    ),
  },
  {
    id: 'score',
    header: 'Performans',
    align: 'right',
    cell: (m, i) => (
      <div className="flex items-center justify-end gap-3">
        {m.hasData ? (
          <div className="flex flex-col items-end gap-1.5">
            <span className={cn(
              'text-[18px] font-light tabular-nums tracking-tight font-display',
              m.completionRate > 70 ? 'text-status-success' :
              m.completionRate > 40 ? 'text-[color:var(--gold-text)]' : 'text-status-danger'
            )}>
              %{m.completionRate}
            </span>
            <div className="w-24 h-1 bg-surface-border/80 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${m.completionRate}%` }}
                transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: staggerDelay(i, 0.06) }}
                className={cn(
                  'h-full rounded-full',
                  m.completionRate > 70 ? 'bg-status-success' :
                  m.completionRate > 40 ? 'bg-executive-gold' : 'bg-status-danger'
                )}
              />
            </div>
          </div>
        ) : (
          <span className="text-micro font-medium px-3 py-1 rounded-lg border text-text-tertiary bg-surface-glass border-surface-border uppercase tracking-wider">
            {EMPTY_STATE_MESSAGES.NO_DATA_SHORT}
          </span>
        )}
        <div className="w-6 h-6 rounded-full bg-executive-blue/5 border border-executive-blue/10 flex items-center justify-center group-hover:bg-executive-blue group-hover:border-transparent transition-all flex-shrink-0">
          <ArrowRight className="w-3 h-3 text-text-tertiary group-hover:text-[color:var(--executive-blue-text)] stroke-[2] transition-colors" />
        </div>
      </div>
    ),
  },
];

interface ManagerPerformanceTableProps {
  managerPerformance: ManagerPerformanceRow[];
  onNavigateTab?: (tab: AppTabId, params?: Record<string, string>) => void;
}

/** ── Yönetici Performans Endeksi Tablosu ──────────────────────────────────
 *  Reports.tsx'ten ayrıştırıldı (bkz. kod denetimi — dosya bölme): mobil
 *  kart listesi + masaüstü veri tablosu birlikte, kendi state'i yok. */
export const ManagerPerformanceTable = ({ managerPerformance, onNavigateTab }: ManagerPerformanceTableProps) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ ...SPRING_PANEL, delay: 0.4 }}
    className={PANEL_FRAME_CLASSNAME}
  >
    {/* Table header */}
    <div className="flex items-center justify-between px-4 py-3 border-b border-executive-blue/[0.04]">
      <div>
        <h3 className="text-body font-medium text-executive-blue font-display tracking-tight">Yönetici Performans Endeksi</h3>
        <p className="text-micro text-text-tertiary uppercase tracking-eyebrow mt-0.5">{managerPerformance.length} Yetkili</p>
      </div>
      <BarChart3 className="w-5 h-5 text-surface-border/50 stroke-[1]" />
    </div>

    {/* Mobile cards */}
    <div className="sm:hidden divide-y divide-makam-border/30">
      {managerPerformance.length === 0 ? (
        <EmptyState size="sm" className="border-none bg-transparent rounded-none" message={EMPTY_STATE_MESSAGES.NO_MANAGER_RECORDS} />
      ) : (
        managerPerformance.map((m, i) => (
          <motion.div
            key={m.uid}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...SPRING_ROW, delay: staggerDelay(i, 0.04) }}
            className="flex items-center gap-3 p-3.5"
          >
            <Avatar name={m.fullName} photoURL={m.photoURL} size="md" className="flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-body-sm font-medium text-executive-blue font-display line-clamp-1">{m.fullName}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-micro text-text-tertiary tabular-nums">{m.total} talimat</span>
                <span className="text-micro text-status-success tabular-nums">{m.completed} tamamlandı</span>
                {m.blocked > 0 && <span className="text-micro text-status-danger tabular-nums">{m.blocked} engel</span>}
                {m.hasData ? (
                  <span className={cn(
                    'text-micro font-bold px-1.5 py-0.5 rounded border',
                    m.slaRate > 80 ? 'text-status-success border-status-success/20 bg-status-success/10' :
                    m.slaRate > 50 ? 'text-[color:var(--gold-text)] border-executive-gold/20 bg-executive-gold/10' :
                    'text-status-danger border-status-danger/20 bg-status-danger/10'
                  )}>SLA %{m.slaRate}</span>
                ) : (
                  <span className="text-micro font-bold px-1.5 py-0.5 rounded border text-text-tertiary border-surface-border bg-surface-glass">Veri yok</span>
                )}
              </div>
              {m.hasData ? (
              <div className="flex items-center gap-2 mt-1.5">
                <div className="flex-1 h-1 bg-surface-border rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${m.completionRate}%` }}
                    transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: staggerDelay(i, 0.05) }}
                    className={cn(
                      'h-full rounded-full',
                      m.completionRate > 70 ? 'bg-status-success' :
                      m.completionRate > 40 ? 'bg-executive-gold' : 'bg-status-danger'
                    )}
                  />
                </div>
                <span className={cn(
                  'text-micro font-medium tabular-nums w-8 text-right',
                  m.completionRate > 70 ? 'text-status-success' :
                  m.completionRate > 40 ? 'text-[color:var(--gold-text)]' : 'text-status-danger'
                )}>%{m.completionRate}</span>
              </div>
              ) : (
                <p className="text-micro text-text-tertiary mt-1.5">{EMPTY_STATE_MESSAGES.NO_DATA_IN_RANGE}</p>
              )}
            </div>
          </motion.div>
        ))
      )}
    </div>

    {/* Desktop table */}
    <div className="hidden sm:block overflow-x-auto custom-scrollbar">
      <SimpleDataTable
        columns={MANAGER_PERFORMANCE_COLUMNS}
        rows={managerPerformance}
        rowKey={(m) => m.uid}
        emptyState={<EmptyState size="sm" className="border-none bg-transparent rounded-none" message={EMPTY_STATE_MESSAGES.NO_MANAGER_RECORDS} />}
        renderRow={(m, i, cells) => (
          <motion.tr
            key={m.uid}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: staggerDelay(i, 0.04) }}
            onClick={() => onNavigateTab?.('tasks', { assignee: m.uid })}
            role="button"
            tabIndex={0}
            aria-label={`${m.fullName} talimatlarını görüntüle`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigateTab?.('tasks', { assignee: m.uid });
              }
            }}
            title="Bu yöneticinin talimatlarını görmek için tıklayın — Talimatlar'da sorumluya göre filtrelenir"
            className="hover:bg-makam-glass transition-all duration-300 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-executive-blue"
          >
            {cells}
          </motion.tr>
        )}
      />
    </div>
  </motion.div>
);
