import { useState, useEffect } from 'react';
import { AlertCircle, Settings as SettingsIcon } from 'lucide-react';
import { Task, User, TaskBlocker } from '../types';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { PageHeader } from './ui/PageHeader';
import { PageShell } from './ui/PageShell';
import { StatusBanner } from './ui/StatusBanner';
import { Skeleton } from './ui/Skeleton';
import { SegmentedTabs } from './ui/SegmentedTabs';
import { GeneralTab } from './settings/GeneralTab';
import { SlaTab } from './settings/SlaTab';
import { SecurityTab } from './settings/SecurityTab';
import { DataTab, type ImportStatus } from './settings/DataTab';
import { DEFAULT_SESSION_TIMEOUT_MS } from '../constants';

interface SettingsProps {
  tasks: Task[];
  users: User[];
  blockers: TaskBlocker[];
  triggerToast?: (title: string, body: string, type?: 'info' | 'success' | 'warning' | 'danger') => void;
  currentUser?: User | null;
  isLoading?: boolean;
  /** Yürürlükteki oturum zaman aşımı (system/settings). Verilmezse varsayılan. */
  sessionTimeoutMs?: number;
  /**
   * Verilirse aktif alt sekme dışarıdan kontrol edilir (bkz. tasarım denetimi
   * F32 — AuthenticatedApp bunu `useTabSearchParam` ile `?tab=`e bağlar, bir
   * ayar sekmesi derin link/yenileme sonrası kalıcı olsun diye). Verilmezse
   * bileşen kendi iç state'ini kullanır — Settings.test.tsx gibi router
   * bağlamı olmayan çağıranlar etkilenmez.
   */
  activeSubTab?: 'general' | 'sla' | 'security' | 'data';
  onActiveSubTabChange?: (tab: 'general' | 'sla' | 'security' | 'data') => void;
}

const SettingsSkeleton = () => (
  <PageShell aria-label="Ayarlar yükleniyor..." role="status">
    <div className="flex items-center gap-2.5 pb-4 border-b border-executive-blue/[0.04]">
      <Skeleton className="h-8 w-8" rounded="lg" />
      <Skeleton className="h-6 w-52" />
    </div>
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
      <div className="flex flex-col gap-2">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="makam-card p-6 flex flex-col gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-9 w-full mt-2" rounded="full" />
          </div>
        ))}
      </div>
    </div>
  </PageShell>
);

// ── Main Component ────────────────────────────────────────────────────────────
export const Settings = ({
  tasks, users, blockers, triggerToast, currentUser, isLoading = false, sessionTimeoutMs = DEFAULT_SESSION_TIMEOUT_MS,
  activeSubTab: controlledActiveSubTab, onActiveSubTabChange,
}: SettingsProps) => {
  const [internalActiveSubTab, setInternalActiveSubTab] = useState<'general' | 'sla' | 'security' | 'data'>('general');
  const activeSubTab = controlledActiveSubTab ?? internalActiveSubTab;
  const setActiveSubTab = onActiveSubTabChange ?? setInternalActiveSubTab;
  const [isOnline, setIsOnline] = useState(typeof window !== 'undefined' ? window.navigator.onLine : true);
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);

  const isAdmin = useIsAdmin(currentUser);

  // Network status listener
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // RBAC Tab Access control — bu, aşağıdaki render koşullarındaki `&& isAdmin`
  // kontrolüyle KASITLI olarak aynı kuralı iki kez uyguluyor (bkz. kod
  // denetimi). Görünüşte gereksiz ama değil: bu efekt render'dan SONRA
  // çalışır — isAdmin, Settings açıkken bir rol değişikliği snapshot'ıyla
  // (ör. başka bir Admin bu kullanıcının rolünü düşürürse) false olursa,
  // activeSubTab hâlâ 'sla'/'data' iken en az BİR render gerçekleşir; render
  // koşulundaki `&& isAdmin` olmasa, o tek render'da admin-özel içerik kısa
  // süreliğine görünür kalırdı. Efekt yalnızca sekmeyi bir sonraki render için
  // düzeltir, render koşulu ise İLK render'ı da korur.
  useEffect(() => {
    if (!isAdmin && (activeSubTab === 'sla' || activeSubTab === 'security' || activeSubTab === 'data')) {
      setActiveSubTab('general');
    }
  }, [activeSubTab, isAdmin]);

  if (isLoading) return <SettingsSkeleton />;

  return (
    <PageShell>

      {/* ── Page Header ──────────────────────────────────────────────── */}
      <PageHeader
        icon={SettingsIcon}
        title="DİZGE YAPILANDIRMASI"
        subtitle="Konfigürasyon & Veri Yönetimi"
      />

      {/* ── Offline Banner ─────────────────────────────────────────── */}
      {!isOnline && (
        <div className="flex items-center gap-2.5 p-3 bg-status-danger/10 border border-status-danger/20 text-status-danger rounded-2xl text-micro font-semibold uppercase tracking-label animate-pulse">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Çevrimdışı moddasınız. Veritabanı ve SLA işlemleri geçici olarak kısıtlanmıştır.</span>
        </div>
      )}

      {/* ── Status Banner ──────────────────────────────────────────── */}
      <StatusBanner status={importStatus} />

      {/* ── Tabbed Layout ─────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row gap-6 mt-2">

        {/* Left Sidebar Tabs Selector — mobilde bu yatay kaydırılan bir
            şerit, masaüstünde dikey bir sütun. Sekme butonları eskiden
            koşulsuz `w-full` idi: masaüstündeki dikey sütunda (w-56) bu
            doğruydu ama mobil yatay şeritte her buton konteynerin TAM
            genişliğini kaplayıp tek seferde yalnızca bir sekme gösteriyor,
            kullanıcıyı sonrakini görmek için tam bir kaydırma yapmaya
            zorluyordu (bkz. mobil tasarım denetimi) — mobilde artık içeriğe
            göre daralıyor, md:'de yine tam genişlik (bkz. ui/SegmentedTabs
            variant="sidebar"). */}
        <SegmentedTabs
          variant="sidebar"
          ariaLabel="Ayarlar bölümleri"
          activeId={activeSubTab}
          onChange={(id) => setActiveSubTab(id as typeof activeSubTab)}
          className="pb-3 md:pb-0 shrink-0 md:w-56 border-b md:border-b-0 md:border-r border-surface-border"
          tabs={[
            { id: 'general', label: 'Genel & Görünüm' },
            ...(isAdmin ? [
              { id: 'sla', label: 'SLA Kuralları' },
              { id: 'security', label: 'Oturum Güvenliği' },
              { id: 'data', label: 'Veri Yönetimi' },
            ] : []),
          ]}
        />

        {/* Right Tab Content Panel */}
        <div className="flex-1 min-w-0">
          {activeSubTab === 'general' && (
            <GeneralTab triggerToast={triggerToast} setImportStatus={setImportStatus} />
          )}

          {activeSubTab === 'sla' && isAdmin && (
            <SlaTab isOnline={isOnline} currentUser={currentUser} isAdmin={isAdmin} triggerToast={triggerToast} setImportStatus={setImportStatus} />
          )}

          {activeSubTab === 'security' && isAdmin && (
            <SecurityTab isOnline={isOnline} currentUser={currentUser} isAdmin={isAdmin} triggerToast={triggerToast} setImportStatus={setImportStatus} sessionTimeoutMs={sessionTimeoutMs} />
          )}

          {activeSubTab === 'data' && isAdmin && (
            <DataTab tasks={tasks} users={users} blockers={blockers} isOnline={isOnline} currentUser={currentUser} isAdmin={isAdmin} triggerToast={triggerToast} setImportStatus={setImportStatus} />
          )}
        </div>
      </div>
    </PageShell>
  );
};
