import React, { useState, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { CheckCircle2, Clock, AlertTriangle, AlertCircle, TrendingUp, Activity, Target, ArrowRight, ShieldCheck, ListChecks, Gauge, Users as UsersIcon, Info, BarChart3 } from 'lucide-react';
import { Task, User } from '../types';
import { motion } from 'motion/react';
import { Modal } from './ui/Modal';
import { Badge } from './ui/Badge';
import { EmptyState } from './ui/EmptyState';
import { Tooltip as InfoTooltip } from './ui/Tooltip';
import { PANEL_CLASSNAME } from './ui/Panel';
import { cn, formatTimeAgo, formatTime } from '../lib/utils';
import { STATUS_LABELS, STATUS_BADGE_VARIANT, type AppTabId } from '../constants';
import { DashboardSkeleton } from './ui/Skeleton';
import { useDataStore } from '../store/dataStore';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { getInterventionQueue, getUserPerformanceProfiles } from '../lib/executiveMetrics';
import {
  computeDeltas, computeStats, computeLast7DaysData, filterStatTasks,
  computeCompletionRatePercent, computeSlaCompliancePercent, computeHealthScore,
  computeExecutiveSignals, SIGNAL_MATCHERS,
  type QueueSignalKey, type StatCategory
} from './dashboard/helpers';
import { StatCard, InterventionRow, PerformanceRow, CustomTooltip } from './dashboard/subcomponents';

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
  const last7DaysData = useMemo(() => computeLast7DaysData(scopeTasks, tick), [scopeTasks, tick]);
  // Son 7 günde hiç yeni talimat/icra kaydı yoksa grafik sessizce boş bir
  // dikdörtgen bırakıyordu — kullanıcıya "veri yok" sinyali hiç verilmiyordu
  // (bkz. kod denetimi). Boşken grafik yerine EmptyState gösterilir.
  const hasChartActivity = useMemo(
    () => last7DaysData.some(d => d['Yeni Talimat'] > 0 || d['İcra Edilen'] > 0),
    [last7DaysData]
  );

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

  const statModalTitle: Record<string, string> = {
    total: 'Toplam Talimatlar', waiting: 'Bekleyen Talimatlar', inProgress: 'İcra Aşamasındakiler',
    blocked: 'Engellenen Talimatlar', inReview: 'Onay Sürecindekiler',
    crisis: 'SLA İhlali (Kriz)', completed: 'İcra Edilenler',
  };

  if (isLoading) return <DashboardSkeleton />;

  return (
    // pb-24: sağ altta beliren PWA "Çevrimdışı Hazır"/güncelleme toast'ı (ReloadPrompt,
    // fixed bottom-6 right-6) alt satırların üzerine binmesin diye ekstra boşluk.
    <div className="flex flex-col gap-5 pt-4 pb-24 max-w-[1440px] mx-auto font-sans">

      {/* ── Stratejik Sağlık Endeksi Banner ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 28 }}
        className="relative overflow-hidden p-5 rounded-3xl bg-makam-glass backdrop-blur-xl border border-surface-border shadow-md flex flex-col md:flex-row items-center justify-between gap-6"
      >
        {/* Ambient backglow matching health score state */}
        <div className={cn(
          "absolute -inset-10 opacity-30 blur-3xl pointer-events-none transition-all duration-1000",
          healthScore >= 80 ? "bg-status-success/[0.035]" :
          healthScore >= 50 ? "bg-status-warning/[0.04]" :
          "bg-status-danger/[0.04]"
        )} />

        <div className="relative z-10 flex items-center gap-4">
          <div className={cn(
            "w-12 h-12 rounded-2xl flex items-center justify-center border shadow-inner flex-shrink-0",
            healthScore >= 80 ? "bg-status-success/10 text-status-success border-status-success/20" :
            healthScore >= 50 ? "bg-status-warning/10 text-status-warning border-status-warning/20" :
            "bg-status-danger/10 text-status-danger border-status-danger/20"
          )}>
            <Target className="w-6 h-6 stroke-[1.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-body font-medium text-executive-blue tracking-tight font-display">Stratejik Sağlık Endeksi</h3>
              {/* Veri tazeliği göstergesi — tick state'inden türetilir, ek okuma yok */}
              <InfoTooltip content="Veriler canlı olarak izlenir; sayaçlar her dakika tazelenir." side="bottom">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-status-success/25 bg-status-success/10 text-status-success text-micro font-semibold uppercase tracking-[0.14em] tabular-nums">
                  <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" aria-hidden="true" />
                  Canlı · {formatTime(tick)}
                </span>
              </InfoTooltip>
            </div>
            <p className="text-micro text-text-tertiary uppercase tracking-[0.3em] mt-0.5">
              {isPersonalView ? 'Kişisel Performans & İcra Düzeyi' : 'Organizasyonel Performans & İcra Düzeyi'}
            </p>
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-8 justify-between w-full md:w-auto">
          <div className="flex flex-col items-start md:items-end gap-1">
            <span className="text-micro text-text-tertiary uppercase tracking-[0.2em] font-medium">Dizge Durumu</span>
            <div className="flex items-center gap-2">
              <span className={cn(
                "w-2 h-2 rounded-full",
                healthScore >= 80 ? "bg-status-success shadow-[0_0_8px_var(--color-status-success)]" :
                healthScore >= 50 ? "bg-status-warning shadow-[0_0_8px_var(--color-status-warning)]" :
                "bg-status-danger shadow-[0_0_8px_var(--color-status-danger)]"
              )} />
              <span className={cn(
                "text-micro font-bold uppercase tracking-widest",
                // NOT: Semantik status token'ları kullanılır — light modda AA-uyumlu
                // koyu tonlar (#047857/#B45309/#DC2626), dark modda pastel tonlar.
                // (Eski emerald/amber-700 + dark: çifti aynı değerlere denk geliyordu.)
                healthScore >= 80 ? "text-status-success" :
                healthScore >= 50 ? "text-status-warning" :
                "text-status-danger"
              )}>
                {healthScore >= 80 ? "STABİL / GÜVENLİ" :
                 healthScore >= 50 ? "GÖZETİM ALTINDA" :
                 "ACİL PROTOKOL"}
               </span>
            </div>
            {/* Sub-metrics transparency indicators */}
            <div className="flex gap-2.5 text-micro text-text-tertiary font-bold uppercase mt-1">
              <span>İcra: %{completionRatePercent}</span>
              <span>SLA: %{slaCompliancePercent}</span>
            </div>
          </div>

          <div className="h-10 w-[1px] bg-executive-blue/10 hidden md:block" />

          <div className="flex items-center gap-3">
            <div className="flex flex-col items-center">
              {/* 24px'ten 32px'e büyütüldü — StatCard rakamlarıyla (20-22px)
                  arasında sayfadaki EN önemli tekil metrik olduğunu belirgin
                  kılan bir punto farkı yoktu (bkz. kod denetimi). */}
              <span className="text-[32px] font-display font-medium text-executive-blue tracking-tight tabular-nums leading-none">
                {healthScore}%
              </span>
              <InfoTooltip content="Hesap yöntemi: İcra Oranı (%60 ağırlık) + SLA Uyumu (%40 ağırlık). Lağvedilen görevler hesaba katılmaz." side="bottom">
                <span className="flex items-center gap-1 text-micro text-text-tertiary uppercase tracking-[0.25em] mt-1 cursor-help">
                  SAĞLIK SKORU
                  <Info className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                </span>
              </InfoTooltip>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Stat Cards Grid ─────────────────────────────────────────── */}
      {/* Mobile: 2 cols | Tablet: 3 cols | Desktop: 6 cols */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Bekleyen"   value={stats.waiting}    max={stats.total} icon={Clock}        color="gray"   index={0} onClick={() => setSelectedStatCategory('waiting')} />
        <StatCard label="İşlemde"    value={stats.inProgress} max={stats.total} icon={Activity}     color="blue"   index={1} delta={deltas.inProgress} onClick={() => setSelectedStatCategory('inProgress')} />
        <StatCard label="Onayda"     value={stats.inReview}   max={stats.total} icon={CheckCircle2} color="green"  index={2} delta={deltas.inReview} onClick={() => setSelectedStatCategory('inReview')} />
        <StatCard label="Engel"      value={stats.blocked}    max={stats.total} icon={ShieldCheck}  color="orange" index={3} delta={deltas.blocked} onClick={() => setSelectedStatCategory('blocked')} />
        <StatCard label="Kriz"       value={stats.crisis}     max={stats.total} icon={AlertCircle}  color="red"    index={4} delta={deltas.crisis} onClick={() => setSelectedStatCategory('crisis')} />
        <StatCard label="Tamamlanan" value={stats.completed}  max={stats.total} icon={ListChecks}   color="green"  index={5} onClick={() => setSelectedStatCategory('completed')} />
      </div>

      {/* ── Chart ───────────────────────────────────────────────────── */}
      {/* Sayısal kartlardan hemen sonra, kuyruk/yük panellerinden önce — önce
          "genel eğilim", sonra "üzerinde durulması gereken ayrıntı" sırası. */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 28, delay: 0.32 }}
        className={PANEL_CLASSNAME}
      >
        <div className="flex justify-between items-center mb-3">
          <div>
            <h3 className="text-body font-medium text-executive-blue tracking-tight font-display">Performans Analitiği</h3>
            <p className="text-micro text-text-tertiary uppercase tracking-[0.3em] mt-0.5">Son 7 Gün</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => onNavigateTab?.('reports')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-executive-blue/[0.03] border border-executive-blue/[0.06] text-text-muted hover:bg-executive-blue hover:text-[color:var(--executive-blue-text)] transition-all duration-300 text-micro font-medium uppercase tracking-[0.2em]"
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
              <span className="text-micro text-text-tertiary uppercase tracking-[0.2em]">{label}</span>
            </div>
          ))}
        </div>

        {/* Ekran okuyucular için grafiğin metinsel özeti — recharts SVG'si erişilebilir değildir */}
        <p className="sr-only">{chartSummary}</p>
      </motion.div>

      {/* ── Executive Decision Surface ───────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.45fr_0.95fr] gap-3">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 28, delay: 0.38 }}
          className={PANEL_CLASSNAME}
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-body font-medium text-executive-blue tracking-tight font-display">{isPersonalView ? 'Önceliklerim' : 'Yönetici Müdahale Kuyruğu'}</h3>
              <p className="text-micro text-text-tertiary uppercase tracking-[0.16em] mt-0.5">
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
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
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
                  <div className="text-micro uppercase tracking-[0.12em] mt-1 truncate">{signal.label}</div>
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
                icon={<ShieldCheck className="w-7 h-7 text-status-success stroke-[1.2]" />}
                message={queueFilter ? 'Bu filtrede müdahale yok' : 'Müdahale Gerektiren Başlık Yok'}
              />
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 28, delay: 0.44 }}
          className={PANEL_CLASSNAME}
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-body font-medium text-executive-blue tracking-tight font-display">{isPersonalView ? 'Performans Özetim' : 'Kadro Yük Matrisi'}</h3>
              <p className="text-micro text-text-tertiary uppercase tracking-[0.16em] mt-0.5">{isPersonalView ? 'Kendi yükünüz ve SLA disiplininiz' : 'Aktif yük ve SLA disiplini'}</p>
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
      <Modal
        isOpen={!!selectedStatCategory}
        onClose={() => setSelectedStatCategory(null)}
        title={selectedStatCategory ? statModalTitle[selectedStatCategory] ?? '' : ''}
        size="lg"
      >
        <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
          {filteredStatTasks.length > 0 ? (
            filteredStatTasks.map(task => (
              <div
                key={task.id}
                role="button"
                tabIndex={0}
                aria-label={task.title}
                className="flex items-center gap-3 p-3 bg-surface-elevated border border-surface-border rounded-xl group cursor-pointer hover:bg-makam-glass hover:border-executive-blue/10 transition-all duration-300 shadow-sm"
                onClick={() => { setSelectedStatCategory(null); onViewTask?.(task); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedStatCategory(null);
                    onViewTask?.(task);
                  }
                }}
              >
                <div className={cn(
                  'w-8 h-8 rounded-xl flex items-center justify-center border flex-shrink-0',
                  task.status === 'COMPLETED' ? 'bg-status-success/10 text-status-success border-status-success/20' :
                  task.status === 'BLOCKED'   ? 'bg-status-danger/10 text-status-danger border-status-danger/20' :
                  task.status === 'IN_PROGRESS'? 'bg-executive-blue/5 text-executive-blue border-executive-blue/10' :
                  'bg-surface-border/20 text-text-muted border-surface-border'
                )}>
                  {task.status === 'COMPLETED' ? <CheckCircle2 className="w-4 h-4 stroke-[1.3]" /> :
                   task.status === 'BLOCKED'   ? <AlertTriangle className="w-4 h-4 stroke-[1.3]" /> :
                   <Activity className="w-4 h-4 stroke-[1.3]" />}
                </div>
                <div className="flex flex-col flex-1 gap-1.5 min-w-0 items-start">
                  <span className="text-body font-medium text-executive-blue tracking-tight line-clamp-1 font-display">{task.title}</span>
                  <Badge variant={STATUS_BADGE_VARIANT[task.status] ?? 'default'}>
                    {STATUS_LABELS[task.status] || task.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-micro text-text-tertiary uppercase tracking-[0.2em] hidden sm:block">
                    {formatTimeAgo(task.updatedAt, task.status)}
                  </span>
                  <div className="w-7 h-7 rounded-full bg-surface-border/20 flex items-center justify-center group-hover:bg-executive-blue group-hover:text-[color:var(--executive-blue-text)] transition-all duration-300 opacity-0 group-hover:opacity-100">
                    <ArrowRight className="w-3 h-3" />
                  </div>
                </div>
              </div>
            ))
          ) : (
            <EmptyState
              dimIcon={false}
              className="border-none opacity-40"
              icon={<CheckCircle2 className="w-10 h-10 text-text-muted/50 stroke-[1]" />}
              message="Veri Bulunamadı"
            />
          )}
        </div>
      </Modal>

    </div>
  );
};
