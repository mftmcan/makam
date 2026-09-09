import React, { useMemo, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Target, Zap, TrendingUp, BarChart3, Users, CheckCircle2, Loader2, Download, FileText, Calendar, ArrowRight } from 'lucide-react';
import { Task, User, TaskBlocker } from '../types';
import { cn } from '../lib/utils';
import { logger } from '../lib/logger';
import { computeCompletionRatePercent } from './dashboard/helpers';
import {
  parseRangeStart, parseRangeEnd, computeDepartmentsList, filterTasksByDateAndDept, filterBlockersByTasks,
  computeManagers, buildTasksByAssignee, computeManagerPerformance, computeAverageCompletionTime,
  computeSlaComplianceTrend, computeStaffWorkload, computeStatusDistribution,
  type ManagerPerformanceRow,
} from './reports/helpers';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, CartesianGrid
} from 'recharts';
import { format, subDays } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useUIStore } from '../store/uiStore';
import { EMPTY_STATE_MESSAGES, type AppTabId } from '../constants';
import { EmptyState } from './ui/EmptyState';
import { PageHeader } from './ui/PageHeader';
import { PageShell } from './ui/PageShell';
import { PANEL_CLASSNAME, PANEL_FRAME_CLASSNAME } from './ui/Panel';
import { DatePicker } from './ui/DatePicker';
import { Avatar } from './ui/Avatar';
import { Skeleton, TableRowSkeleton } from './ui/Skeleton';
import { SimpleDataTable, type DataTableColumn } from './ui/dataTable';
import { SPRING_PANEL, SPRING_ROW, staggerDelay } from '../lib/motion';

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

interface ReportsProps {
  tasks: Task[];
  users: User[];
  blockers: TaskBlocker[];
  /** Bkz. Dashboard'daki aynı prop — router bağımlılığı bilinçli olarak
   *  AuthenticatedApp'te kalır, bu bileşen router'dan habersizdir. */
  onNavigateTab?: (tab: AppTabId, params?: Record<string, string>) => void;
  isLoading?: boolean;
}

// Firestore verisi gelmeden bu sayfa tüm metrikleri "0" olarak render edip
// kısa süre tamamen boş kalıyordu (bkz. tasarım denetimi — grafik alanının
// da kendisi boş olduğundan bu "yazılım bozuk" gibi okunuyordu).
const ReportsSkeleton = () => (
  <PageShell aria-label="Yükleniyor..." role="status">
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="makam-card p-5 flex flex-col gap-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
        </div>
      ))}
    </div>
    <div className="makam-card p-6 flex flex-col gap-4">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-48 w-full" rounded="lg" />
    </div>
    <div className="makam-card p-4 flex flex-col gap-3">
      {[...Array(4)].map((_, i) => <TableRowSkeleton key={i} cols={4} />)}
    </div>
  </PageShell>
);

// ─── Compact KPI Card ─────────────────────────────────────────────────────────
interface KpiCardProps {
  label: string;
  value: string;
  icon: React.ElementType;
  color: 'blue' | 'red' | 'green';
  index?: number;
}

const KpiCard = ({ label, value, icon: Icon, color, index = 0 }: KpiCardProps) => {
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
      className="flex items-center gap-3 p-3.5 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl shadow-card hover:shadow-card-hover hover:bg-surface-elevated transition-all duration-300 group"
    >
      <div className={cn('w-9 h-9 flex-shrink-0 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform', palette.bg)}>
        <Icon className={cn('w-4 h-4 stroke-[1.5]', palette.icon)} />
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[22px] font-light text-executive-blue tracking-tight tabular-nums leading-none font-display">
          {value}
        </span>
        <span className="text-micro text-text-tertiary font-medium uppercase tracking-eyebrow">{label}</span>
      </div>
    </motion.div>
  );
};

// ─── Reports ──────────────────────────────────────────────────────────────────
export const Reports = ({ tasks: propsTasks, users, blockers: propsBlockers, onNavigateTab, isLoading = false }: ReportsProps) => {
  const addToast = useUIStore(state => state.addToast);
  const tasks = propsTasks;
  const blockers = propsBlockers;

  // ─── Tarih Aralığı Filtresi ───────────────────────────────────────────────
  const today = new Date();
  const [dateFrom, setDateFrom] = useState(format(subDays(today, 30), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(today, 'yyyy-MM-dd'));
  const [selectedDept, setSelectedDept] = useState<string>('ALL');
  const [isExporting, setIsExporting] = useState(false);

  const departmentsList = useMemo(() => computeDepartmentsList(users, tasks), [users, tasks]);

  const rangeStart = useMemo(() => parseRangeStart(dateFrom), [dateFrom]);
  const rangeEnd = useMemo(() => parseRangeEnd(dateTo), [dateTo]);

  const filteredTasks = useMemo(
    () => filterTasksByDateAndDept(tasks, rangeStart, rangeEnd, selectedDept),
    [tasks, rangeStart, rangeEnd, selectedDept]
  );

  const filteredBlockers = useMemo(() => filterBlockersByTasks(blockers, filteredTasks), [blockers, filteredTasks]);

  // jsPDF (+html2canvas, ~140KB gzip) yalnızca Export butonuna basıldığında
  // yükleniyor — statik import Reports sekmesine her girişte bu paketi
  // gereksiz yere indiriyordu.
  const handleExportPDF = useCallback(async () => {
    setIsExporting(true);
    try {
      const { exportTasksToPDF } = await import('../services/exportService');
      await exportTasksToPDF(filteredTasks, users, {
        from: rangeStart,
        to: rangeEnd,
      });
    } catch (err) {
      logger.error('PDF export hatası:', err);
      addToast({ title: '⚠️ Dışa Aktarma Başarısız', body: 'PDF raporu oluşturulurken bir hata oluştu. Lütfen tekrar deneyin.', type: 'danger' });
    } finally {
      setIsExporting(false);
    }
  }, [filteredTasks, users, rangeStart, rangeEnd]);

  const handleExportCSV = useCallback(async () => {
    const { exportTasksToCSV } = await import('../services/exportService');
    exportTasksToCSV(filteredTasks, users, {
      from: rangeStart,
      to: rangeEnd,
    });
  }, [filteredTasks, users, rangeStart, rangeEnd]);

  const managers = useMemo(() => computeManagers(users, selectedDept), [users, selectedDept]);

  // filteredTasks üzerinde her yönetici/personel için ayrı ayrı tam tarama
  // yapmak yerine (O(kişi × görev) — tarih/departman filtresi her
  // değiştiğinde tekrarlanıyordu) tek geçişte assigneeId'ye göre gruplanır
  // (O(görev) + kişi başına O(1) lookup).
  const tasksByAssignee = useMemo(() => buildTasksByAssignee(filteredTasks), [filteredTasks]);

  const managerPerformance = useMemo(
    () => computeManagerPerformance(managers, tasksByAssignee),
    [managers, tasksByAssignee]
  );

  const averageCompletionTime = useMemo(() => computeAverageCompletionTime(filteredTasks), [filteredTasks]);

  const avgDays = Math.round(averageCompletionTime / (1000 * 60 * 60 * 24));
  // dashboard/helpers.ts'teki MERKEZİ tanım (bkz. yukarıdaki managerPerformance
  // yorumu) — eskiden burada da bağımsız bir formül vardı.
  const completionRate = computeCompletionRatePercent(filteredTasks);

  // #6 — Son 14 gün SLA uyum oranı (trend)
  const slaComplianceTrend = useMemo(() => computeSlaComplianceTrend(filteredTasks, new Date()), [filteredTasks]);
  // Seçili aralıkta hiç tamamlanan görev yoksa `oran` tüm noktalarda null olur
  // ve çizgi hiçbir şey çizmeden yalnızca eksenler kalırdı — boş durum ayrıca
  // belirtilir (bkz. tasarım denetimi: "grafik alanı tamamen boş").
  const hasSlaTrendData = slaComplianceTrend.some(d => d.oran !== null);

  // #6 — Personel yük dağılımı (Staff bazlı)
  const staffWorkload = useMemo(
    () => computeStaffWorkload(users, tasksByAssignee, selectedDept),
    [users, tasksByAssignee, selectedDept]
  );

  // #6 — Durum dağılımı (Pie chart verisi)
  const statusDistribution = useMemo(() => computeStatusDistribution(filteredTasks), [filteredTasks]);

  if (isLoading) return <ReportsSkeleton />;

  return (
    <PageShell>

      {/* ── Page header ─────────────────────────────────────────────── */}
      <PageHeader
        icon={TrendingUp}
        title="OPERASYONEL ANALİTİK"
        subtitle="İçgörü Matrisi"
        actions={<>
          {/* Birim Filtresi */}
          <div className="flex items-center gap-2 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl px-3 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-executive-blue has-[:focus-visible]:ring-offset-1">
            <Users className="w-3.5 h-3.5 text-executive-blue stroke-[1.5] flex-shrink-0" aria-hidden="true" />
            <select
              value={selectedDept}
              onChange={e => setSelectedDept(e.target.value)}
              className="text-caption text-text-heading bg-transparent outline-none border-none cursor-pointer pr-4 font-medium"
              aria-label="Birim Filtresi"
            >
              <option value="ALL" className="bg-surface-base text-text-heading">Tüm Birimler</option>
              {departmentsList.map(dept => (
                <option key={dept} value={dept} className="bg-surface-base text-text-heading">
                  {dept}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl px-3 py-2">
            <Calendar className="w-3.5 h-3.5 text-executive-blue stroke-[1.5] flex-shrink-0" aria-hidden="true" />
            <DatePicker
              id="report-date-from"
              value={dateFrom}
              onChange={setDateFrom}
              ariaLabel="Rapor başlangıç tarihi"
            />
            <span className="text-micro text-text-tertiary mx-1">—</span>
            <DatePicker
              id="report-date-to"
              value={dateTo}
              onChange={setDateTo}
              ariaLabel="Rapor bitiş tarihi"
            />
          </div>

          <button
            onClick={handleExportCSV}
            aria-label="Raporu CSV olarak dışa aktar"
            className="flex items-center gap-1.5 px-3 py-2 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl text-micro uppercase tracking-widest text-text-muted hover:text-executive-blue hover:bg-surface-elevated transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
          >
            <FileText className="w-3.5 h-3.5" aria-hidden="true" />
            CSV
          </button>

          <button
            onClick={handleExportPDF}
            disabled={isExporting}
            aria-label="Raporu PDF olarak dışa aktar"
            className="flex items-center gap-1.5 px-3 py-2 bg-executive-blue text-[color:var(--executive-blue-text)] rounded-2xl text-micro uppercase tracking-widest hover:bg-executive-blue/90 transition-all shadow-lg shadow-executive-blue/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2"
          >
            {isExporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            {isExporting ? 'Hazırlanıyor...' : 'PDF'}
          </button>
        </>}
      />

      {/* Filtre özeti — önceden çok soluk (text-tertiary) olduğundan, dar bir
          tarih aralığında %0 gibi görünen metrikler "herkesin performansı
          kötü" gibi yanlış okunabiliyordu; aktif kapsam artık daha belirgin
          (bkz. kod denetimi). */}
      <div className="flex items-center gap-1.5 text-micro text-text-muted uppercase tracking-widest font-medium">
        <Calendar className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
        <span className="tabular-nums">{filteredTasks.length} talimat</span>
        <span>·</span>
        <span className="tabular-nums">{format(rangeStart, 'd MMM yyyy', { locale: tr })} — {format(rangeEnd, 'd MMM yyyy', { locale: tr })}</span>
      </div>

      {/* ── KPI Cards — 1 col mobile, 3 cols sm+ ─────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard label="Ort. Tamamlanma" value={`${avgDays} Gün`}  icon={Zap}           color="blue"  index={0} />
        <KpiCard label="Aktif Darboğaz"  value={`${filteredBlockers.filter(b => !b.isResolved).length}`} icon={AlertTriangle} color="red" index={1} />
        <KpiCard label="Hedef Gerçekleşme" value={`%${completionRate}`} icon={Target}    color="green" index={2} />
      </div>

      {/* ── Görsel Analiz — özet sayılardan sonra, detay tablosundan önce ── */}
      {/* #6 — SLA Trend + Durum Dağılımı */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* SLA Uyum Trend Çizgi Grafiği */}
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
              <LineChart data={slaComplianceTrend} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
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
            {!hasSlaTrendData && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-micro text-text-tertiary uppercase tracking-wider bg-surface-elevated/90 px-3 py-1.5 rounded-lg border border-surface-border">
                  Seçili aralıkta tamamlanan talimat yok
                </span>
              </div>
            )}
          </div>
        </motion.div>

        {/* Durum Dağılımı (Pie) */}
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
            {statusDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusDistribution} dataKey="count" nameKey="label"
                    cx="50%" cy="50%" innerRadius={50} outerRadius={75}
                    paddingAngle={3} stroke="var(--color-surface-base)" strokeWidth={2}
                  >
                    {statusDistribution.map((entry, idx) => (
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
      </div>

      {/* Personel Yük Dağılımı */}
      {staffWorkload.length > 0 && (
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
              <BarChart data={staffWorkload} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
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
                <XAxis dataKey="name" fontSize={9} tickLine={false} axisLine={false} tick={{ fill: 'var(--text-light)' }} />
                <YAxis fontSize={8} tickLine={false} axisLine={false} tick={{ fill: 'var(--text-light)' }} />
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
                  cursor={{ fill: 'rgba(22, 21, 19, 0.02)' }}
                />
                <Bar dataKey="assigned" name="Aktif" fill="url(#barActive)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="completed" name="Tamamlanan" fill="url(#barCompleted)" radius={[4, 4, 0, 0]} />
                <Legend iconSize={8} iconType="circle"
                  formatter={(v) => <span style={{ fontSize: 9, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>{v}</span>}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      )}

      {/* ── Manager Performance Table ─────────────────────────────── */}
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

    </PageShell>
  );
};
