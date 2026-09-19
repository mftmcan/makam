import { useMemo, useState, useCallback } from 'react';
import { AlertTriangle, Target, Zap, TrendingUp, Calendar } from 'lucide-react';
import { Task, User, TaskBlocker } from '../types';
import { logger } from '../lib/logger';
import { computeCompletionRatePercent } from './dashboard/helpers';
import {
  parseRangeStart, parseRangeEnd, computeDepartmentsList, filterTasksByDateAndDept, filterBlockersByTasks,
  computeManagers, buildTasksByAssignee, computeManagerPerformance, computeAverageCompletionTime,
  computeSlaComplianceTrend, computeStaffWorkload, computeStatusDistribution,
} from './reports/helpers';
import { format, subDays } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useUIStore } from '../store/uiStore';
import { type AppTabId } from '../constants';
import { PageHeader } from './ui/PageHeader';
import { PageShell } from './ui/PageShell';
import { Skeleton, TableRowSkeleton } from './ui/Skeleton';
import { KpiCard } from './reports/subcomponents';
import { ReportsHeaderActions } from './reports/ReportsHeaderActions';
import { SlaTrendChart } from './reports/SlaTrendChart';
import { StatusDistributionChart } from './reports/StatusDistributionChart';
import { StaffWorkloadChart } from './reports/StaffWorkloadChart';
import { ManagerPerformanceTable } from './reports/ManagerPerformanceTable';

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
        actions={
          <ReportsHeaderActions
            selectedDept={selectedDept}
            onSelectedDeptChange={setSelectedDept}
            departmentsList={departmentsList}
            dateFrom={dateFrom}
            onDateFromChange={setDateFrom}
            dateTo={dateTo}
            onDateToChange={setDateTo}
            onExportCSV={() => { void handleExportCSV(); }}
            onExportPDF={() => { void handleExportPDF(); }}
            isExporting={isExporting}
          />
        }
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
        <SlaTrendChart data={slaComplianceTrend} />
        <StatusDistributionChart data={statusDistribution} />
      </div>

      {/* Personel Yük Dağılımı */}
      {staffWorkload.length > 0 && <StaffWorkloadChart data={staffWorkload} />}

      {/* ── Manager Performance Table ─────────────────────────────── */}
      <ManagerPerformanceTable managerPerformance={managerPerformance} onNavigateTab={onNavigateTab} />

    </PageShell>
  );
};
