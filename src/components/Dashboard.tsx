import React, { useState, useMemo, useEffect } from 'react';
import { CheckCircle2, Clock, AlertCircle, Activity, ShieldCheck, ListChecks, Gauge, Users as UsersIcon } from 'lucide-react';
import { Task, User } from '../types';
import { motion } from 'motion/react';
import { EmptyState } from './ui/EmptyState';
import { PageHeader } from './ui/PageHeader';
import { PageShell } from './ui/PageShell';
import { SPRING_PANEL } from '../lib/motion';
import { PANEL_CLASSNAME } from './ui/Panel';
import { cn } from '../lib/utils';
import { type AppTabId } from '../constants';
import { DashboardSkeleton } from './ui/Skeleton';
import { useDataStore } from '../store/dataStore';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { getInterventionQueue, getUserPerformanceProfiles } from '../lib/executiveMetrics';
import {
  computeDeltas, computeStats, computeLast7DaysData, filterStatTasks,
  computeCompletionRatePercent, computeSlaCompliancePercent, computeHealthScore,
  computeExecutiveSignals, SIGNAL_MATCHERS, computeMovingAverage, computeCompletedTrend,
  type QueueSignalKey, type StatCategory
} from './dashboard/helpers';
import { StatCard, InterventionRow, PerformanceRow } from './dashboard/subcomponents';
import { HealthIndexBanner } from './dashboard/HealthIndexBanner';
import { PerformanceChart } from './dashboard/PerformanceChart';
import { StatDetailModal } from './dashboard/StatDetailModal';

interface DashboardProps {
  tasks: Task[];
  users: User[];
  user: User | null;
  onViewTask?: (task: Task) => void;
  /** Başka bir ekrana programatik geçiş. Eskiden `setActiveTab` idi ve
   *  doğrudan uiStore aksiyonunu taşıyordu; navigasyonun tek doğruluk kaynağı
   *  URL olduğundan (bkz. kod denetimi P1-6) artık AuthenticatedApp bunu
   *  `useTaskNavigation().goToTab`'a bağlar. Bu bileşen router'dan habersiz
   *  kalır — testleri Router sarmalayıcısı gerektirmez. */
  onNavigateTab?: (tab: AppTabId, params?: Record<string, string>) => void;
  /** Firestore verisi ilk yüklenene kadar skeleton gösterir */
  isLoading?: boolean;
  /** Odak filtresi aktif olduğunda globalStats bypass edilir */
  isFiltered?: boolean;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export const Dashboard = ({ tasks, users, user, onViewTask, onNavigateTab, isLoading = false, isFiltered = false }: DashboardProps) => {
  const isAdmin = useIsAdmin(user);
  const [selectedStatCategory, setSelectedStatCategory] = useState<StatCategory | null>(null);
  // Müdahale kuyruğu sinyal filtresi (chip'e tıklayınca aç/kapa)
  const [queueFilter, setQueueFilter] = useState<QueueSignalKey | null>(null);
  // Canlı SLA sayacı — her dakika güncellenir
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const globalStats = useDataStore(state => state.stats);

  // Staff için pano tamamen kişiseldir: tüm metrikler yalnızca kendi
  // görevlerinden (assigneeId eşleşmesi) türetilir.
  const isPersonalView = user?.role === 'Staff';
  const myTasks = useMemo(
    () => tasks.filter(t => t.assigneeId === user?.uid || t.assigneeId === user?.email),
    [tasks, user]
  );
  const scopeTasks = isPersonalView ? myTasks : tasks;

  const deltas = useMemo(() => computeDeltas(scopeTasks, tick), [scopeTasks, tick]);

  const stats = useMemo(
    () => computeStats(scopeTasks, tick, globalStats, isFiltered, isPersonalView),
    [scopeTasks, globalStats, isFiltered, isPersonalView, tick]
  );

  const executiveQueue = useMemo(
    () => getInterventionQueue(scopeTasks, users, tick, 8),
    [scopeTasks, users, tick]
  );

  // Kişisel görünümde tam görev listesi verilir (fonksiyon sahiplik eşlemesini
  // kendi içinde assigneeId ile yapar; ön-filtre çifte filtreleme olurdu) ve
  // yalnızca kullanıcının kendi profili gösterilir.
  const performanceProfiles = useMemo(() => {
    const profiles = getUserPerformanceProfiles(tasks, users, tick);
    if (isPersonalView) return profiles.filter(p => p.user.uid === user?.uid);
    return profiles.filter(p => p.activeCount > 0 || p.completedCount > 0).slice(0, 6);
  }, [tasks, users, tick, isPersonalView, user]);

  const executiveSignals = useMemo(() => computeExecutiveSignals(executiveQueue), [executiveQueue]);

  // Sinyal filtresi aktifken kuyruğun tamamı (en çok 8 kayıt), değilken ilk 5 kayıt
  const visibleQueue = useMemo(() => {
    if (!queueFilter) return executiveQueue.slice(0, 5);
    return executiveQueue.filter(SIGNAL_MATCHERS[queueFilter]).slice(0, 8);
  }, [executiveQueue, queueFilter]);

  // NOT: Bu seri bilinçli olarak değişmez (immutable) zaman damgalarına dayanır.
  // Önceki sürüm görevleri updatedAt penceresine ve CANLI status'e göre kovalıyordu;
  // bir görev sonradan güncellendiğinde geçmiş günün çubuğundan siliniyor, grafik
  // retroaktif olarak değişiyordu. createdAt/completedAt asla değişmediği için
  // "Yeni Talimat" ve "İcra Edilen" metrikleri geçmişe dönük tutarlıdır.
  // Gün sınırı tick'ten türetilir ki gece yarısı geçişinde pencere bayatlamasın.
  // trend: İcra Edilen'in 3 günlük hareketli ortalaması (bkz. computeMovingAverage) —
  // grafikteki çizgi katmanı için, computeLast7DaysData'nın kendisini DEĞİŞTİRMEZ
  // (o saf/test edilebilir kalır), yalnızca sonucuna bir alan ekler.
  const last7DaysData = useMemo(() => {
    const days = computeLast7DaysData(scopeTasks, tick);
    const trend = computeMovingAverage(days.map(d => d['İcra Edilen']), 3);
    return days.map((d, i) => ({ ...d, trend: trend[i] }));
  }, [scopeTasks, tick]);
  // Son 7 günde hiç yeni talimat/icra kaydı yoksa grafik sessizce boş bir
  // dikdörtgen bırakıyordu — kullanıcıya "veri yok" sinyali hiç verilmiyordu
  // (bkz. kod denetimi). Boşken grafik yerine EmptyState gösterilir.
  const hasChartActivity = useMemo(
    () => last7DaysData.some(d => d['Yeni Talimat'] > 0 || d['İcra Edilen'] > 0),
    [last7DaysData]
  );

  // Sağlık Skoru banner'ındaki "Bu Hafta" karşılaştırması — completedAt bazlı,
  // computeLast7DaysData ile AYNI immutable-timestamp ilkesi (bkz. helpers.ts).
  const completedTrend = useMemo(() => computeCompletedTrend(scopeTasks, tick), [scopeTasks, tick]);

  const chartSummary = useMemo(
    () => last7DaysData
      .map(d => `${d.name}: ${d['Yeni Talimat']} yeni talimat, ${d['İcra Edilen']} icra edildi`)
      .join('; '),
    [last7DaysData]
  );

  const filteredStatTasks = useMemo(
    () => filterStatTasks(scopeTasks, selectedStatCategory, tick),
    [scopeTasks, selectedStatCategory, tick]
  );

  const completionRatePercent = useMemo(() => computeCompletionRatePercent(scopeTasks), [scopeTasks]);

  // SLA standardize edilmiş formul: zamanında tamamlanan / toplam tamamlanan
  // (tüm ekranlarda tutarlı tek tanım)
  const slaCompliancePercent = useMemo(() => computeSlaCompliancePercent(scopeTasks), [scopeTasks]);

  const healthScore = useMemo(
    () => computeHealthScore(scopeTasks.length, completionRatePercent, slaCompliancePercent),
    [scopeTasks, completionRatePercent, slaCompliancePercent]
  );

  if (isLoading) return <DashboardSkeleton />;

  return (
    // pb-24: sağ altta beliren PWA "Çevrimdışı Hazır"/güncelleme toast'ı (ReloadPrompt,
    // fixed bottom-6 right-6) alt satırların üzerine binmesin diye ekstra boşluk.
    <PageShell withMobileDockPadding>

      {/* ── Page header ──────────────────────────────────────────────
          Diğer altı sekmenin (Talimatlar/Engeller/Kadro/Raporlar/Denetim/
          Ayarlar) hepsinde PageHeader varken Dashboard'da hiç yoktu (bkz.
          tasarım denetimi: 7 ekranda 6 farklı kopya + burada eksik) — ikon
          Sidebar/MobileDock'taki AYNI "Harekat" nav ikonuyla (ShieldCheck)
          tutarlı seçildi. */}
      <PageHeader
        icon={ShieldCheck}
        title="HAREKAT MERKEZİ"
        subtitle="Stratejik Genel Bakış"
      />

      {/* ── Stratejik Sağlık Endeksi Banner ── */}
      <HealthIndexBanner
        healthScore={healthScore}
        completionRatePercent={completionRatePercent}
        slaCompliancePercent={slaCompliancePercent}
        isPersonalView={isPersonalView}
        tick={tick}
        completedTrend={completedTrend}
      />

      {/* ── Stat Cards Grid ─────────────────────────────────────────── */}
      {/* Mobile: 2 cols | Tablet: 3 cols | Desktop: 6 cols */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Bekleyen"   value={stats.waiting}    max={stats.total} icon={Clock}        color="gray"   index={0} onClick={() => setSelectedStatCategory('waiting')} />
        <StatCard label="İşlemde"    value={stats.inProgress} max={stats.total} icon={Activity}     color="blue"   index={1} delta={deltas.inProgress} onClick={() => setSelectedStatCategory('inProgress')} />
        <StatCard label="Onayda"     value={stats.inReview}   max={stats.total} icon={CheckCircle2} color="green"  index={2} delta={deltas.inReview} onClick={() => setSelectedStatCategory('inReview')} />
        <StatCard label="Engel"      value={stats.blocked}    max={stats.total} icon={ShieldCheck}  color="orange" index={3} delta={deltas.blocked} onClick={() => setSelectedStatCategory('blocked')} />
        <StatCard label="Kriz"       value={stats.crisis}     max={stats.total} icon={AlertCircle}  color="red"    index={4} delta={deltas.crisis} onClick={() => setSelectedStatCategory('crisis')} />
        {/* Yalnızca bu kart sparkline alır — completedAt DEĞİŞMEZ olduğundan
            geçmiş 7 günün "o günkü tamamlanan sayısı" retroaktif olarak
            güvenle yeniden inşa edilebilir (bkz. StatCardProps.sparklineData
            yorumu). Diğer kartlar anlık durum sayaçlarıdır, aynı işlem onlar
            için yanıltıcı olurdu. */}
        <StatCard label="Tamamlanan" value={stats.completed}  max={stats.total} icon={ListChecks}   color="green"  index={5} onClick={() => setSelectedStatCategory('completed')} sparklineData={last7DaysData.map(d => d['İcra Edilen'])} />
      </div>

      {/* ── Chart ───────────────────────────────────────────────────── */}
      {/* Sayısal kartlardan hemen sonra, kuyruk/yük panellerinden önce — önce
          "genel eğilim", sonra "üzerinde durulması gereken ayrıntı" sırası. */}
      <PerformanceChart
        isAdmin={isAdmin}
        onNavigateTab={() => onNavigateTab?.('reports')}
        hasChartActivity={hasChartActivity}
        last7DaysData={last7DaysData}
        chartSummary={chartSummary}
      />

      {/* ── Executive Decision Surface ───────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.45fr_0.95fr] gap-3">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING_PANEL, delay: 0.38 }}
          className={PANEL_CLASSNAME}
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-body font-medium text-executive-blue tracking-tight font-display">{isPersonalView ? 'Önceliklerim' : 'Yönetici Müdahale Kuyruğu'}</h3>
              <p className="text-micro text-text-tertiary uppercase tracking-label mt-0.5">
                {queueFilter
                  ? <>Filtre: {executiveSignals.find(s => s.key === queueFilter)?.label} · <button type="button" onClick={() => setQueueFilter(null)} className="underline hover:text-executive-blue">Temizle</button></>
                  : isPersonalView ? 'Size ait risk ve mühlet önceliği' : 'Risk, mühlet, atalet ve onay önceliği'}
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 w-full md:w-auto">
              {executiveSignals.map(signal => (
                <button
                  key={signal.key}
                  type="button"
                  onClick={() => setQueueFilter(prev => prev === signal.key ? null : signal.key)}
                  aria-pressed={queueFilter === signal.key}
                  className={cn(
                    'min-w-0 rounded-xl border px-2 py-1.5 text-center transition-all duration-200',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
                    // NOT: Tailwind'in varsayılan red/amber/emerald paleti (oklch
                    // tabanlı) axe-core taramasında bu bileşende beklenmedik
                    // şekilde neredeyse görünmez metin olarak ölçüldü. Solid hex
                    // semantik status token'larına geçirildi (bkz. index.css).
                    signal.tone === 'red' ? 'bg-status-danger/10 text-status-danger border-status-danger/20' :
                    signal.tone === 'amber' ? 'bg-status-warning/10 text-status-warning border-status-warning/20' :
                    'bg-status-success/10 text-status-success border-status-success/20',
                    queueFilter === signal.key && 'ring-2 ring-offset-2 ring-offset-surface-base ring-executive-blue/40 scale-[0.97]'
                  )}
                >
                  <div className="text-[14px] font-semibold tabular-nums leading-none">{signal.value}</div>
                  <div className="text-micro uppercase tracking-label mt-1 truncate">{signal.label}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {visibleQueue.length > 0 ? (
              visibleQueue.map((item, index) => (
                <InterventionRow
                  key={item.task.id}
                  item={item}
                  users={users}
                  index={index}
                  onView={() => onViewTask?.(item.task)}
                />
              ))
            ) : (
              <EmptyState
                size="sm"
                dimIcon={false}
                icon={
                  queueFilter ? (
                    <ShieldCheck className="w-7 h-7 text-status-success stroke-[1.2]" />
                  ) : (
                    // Gerçek "tamamen temiz" anı (filtre yokken de kuyruk boş) —
                    // premium ürünlerin özenle tasarladığı bir nokta; ince bir
                    // nabız (prefers-reduced-motion'da otomatik durur, bkz.
                    // index.css) yalnızca burada, filtreli boş sonuçta DEĞİL.
                    <span className="relative flex items-center justify-center">
                      <span className="absolute inset-0 rounded-full bg-status-success/20 animate-pulse" aria-hidden="true" />
                      <ShieldCheck className="relative w-7 h-7 text-status-success stroke-[1.2]" />
                    </span>
                  )
                }
                message={queueFilter ? 'Bu filtrede müdahale yok' : 'Müdahale Gerektiren Başlık Yok'}
              />
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING_PANEL, delay: 0.44 }}
          className={PANEL_CLASSNAME}
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-body font-medium text-executive-blue tracking-tight font-display">{isPersonalView ? 'Performans Özetim' : 'Kadro Yük Matrisi'}</h3>
              <p className="text-micro text-text-tertiary uppercase tracking-label mt-0.5">{isPersonalView ? 'Kendi yükünüz ve SLA disiplininiz' : 'Aktif yük ve SLA disiplini'}</p>
            </div>
            <UsersIcon className="w-4 h-4 text-text-tertiary" />
          </div>

          <div className="flex flex-col gap-2">
            {performanceProfiles.length > 0 ? (
              performanceProfiles.slice(0, 5).map((profile, index) => (
                <PerformanceRow key={profile.user.uid} profile={profile} index={index} />
              ))
            ) : (
              <EmptyState
                size="sm"
                dimIcon={false}
                icon={<Gauge className="w-7 h-7 text-text-muted/40 stroke-[1.2]" />}
                message="Yük Verisi Yok"
              />
            )}
          </div>
        </motion.div>
      </div>

      {/* ── Stat Detail Modal ────────────────────────────────────────── */}
      <StatDetailModal
        category={selectedStatCategory}
        tasks={filteredStatTasks}
        onClose={() => setSelectedStatCategory(null)}
        onViewTask={onViewTask}
      />

    </PageShell>
  );
};
