import React, { useState, useEffect } from 'react';
import { Download, AlertCircle, CheckCircle2, Database, RotateCcw, ShieldCheck, Smartphone, Bell, Settings as SettingsIcon, Clock, Lock } from 'lucide-react';
import { Task, User, TaskBlocker } from '../types';
import { cn, downloadBlob } from '../lib/utils';
import { createAudioContext } from '../lib/audio';
import { taskService } from '../services/taskService';
import { auditLogService } from '../services/auditLogService';
import { settingsService } from '../services/settingsService';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { getSLAConfigForPriority } from '../lib/sla';
import { SLA_CONFIG_SYNCED_EVENT } from '../hooks/useSLASync';
import { SlaPriorityInput } from './settings/SharedUI';
import { SettingsCard } from './ui/SettingsCard';
import { ActionButton } from './ui/ActionButton';
import { StatusBanner } from './ui/StatusBanner';
import { Skeleton } from './ui/Skeleton';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { SegmentedTabs } from './ui/SegmentedTabs';
import { Input } from './ui/Input';
import { logger } from '../lib/logger';
import { useUIStore } from '../store/uiStore';
import { DEFAULT_SESSION_TIMEOUT_MS, SESSION_TIMEOUT_MIN_MS, SESSION_TIMEOUT_MAX_MS } from '../constants';

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

const AUDIT_LOG_EXPORT_PAGE_SIZE = 500;

/** Geri yükleme onayında harfi harfine yazılması gereken ifade. Türkçe büyük
 *  harf duyarlıdır ('i' → 'İ'), bu yüzden karşılaştırma normalize edilmeden
 *  BİREBİR yapılır — "yaklaşık doğru" bir metin onay sayılmaz. */
const RESTORE_CONFIRM_PHRASE = 'GERİ YÜKLE';

const SettingsSkeleton = () => (
  <div className="flex flex-col gap-5 py-4 max-w-[1440px] mx-auto" aria-label="Ayarlar yükleniyor..." role="status">
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
  </div>
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
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error' | 'loading'; message: string } | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  // Yedekten geri yükleme, mevcut TÜM veriyi geri dönüşsüz ezen bir işlemdir —
  // dosya seçilir seçilmez doğrudan tetiklenmek yerine (uygulamanın geri
  // kalanındaki görev/personel/engel silme akışlarıyla TUTARLI olarak) önce
  // bir onay modalı gösterilir; dosya içeriği yalnızca kullanıcı onaylarsa
  // işlenir (bkz. kod denetimi).
  const [pendingRestore, setPendingRestore] = useState<{ content: string; fileName: string } | null>(null);
  const restoreFileInputRef = React.useRef<HTMLInputElement>(null);
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const soundEnabled = useUIStore((state) => state.soundEnabled);
  const setSoundEnabled = useUIStore((state) => state.setSoundEnabled);

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

  // ── Oturum Güvenliği State ────────────────────────────────────────────────
  // Form dakika cinsinden çalışır (Admin'in düşündüğü birim); kaydederken ms'e
  // çevrilir ve settingsService içinde ayrıca güvenli aralığa oturtulur.
  const [sessionTimeoutMin, setSessionTimeoutMin] = useState(() => Math.round(sessionTimeoutMs / 60000));
  const [isSavingSession, setIsSavingSession] = useState(false);

  // Başka bir Admin ayarı değiştirdiğinde (veya ilk snapshot geldiğinde) form
  // canlı güncellenir — kendi kaydımız sürerken ELİMİZDEKİ değeri ezmesin diye
  // isSavingSession true iken atlanır (SLA formundaki aynı gerekçe).
  useEffect(() => {
    if (isSavingSession) return;
    setSessionTimeoutMin(Math.round(sessionTimeoutMs / 60000));
  }, [sessionTimeoutMs, isSavingSession]);

  const sessionTimeoutMinBound = { min: Math.round(SESSION_TIMEOUT_MIN_MS / 60000), max: Math.round(SESSION_TIMEOUT_MAX_MS / 60000) };
  const isSessionTimeoutValid =
    Number.isFinite(sessionTimeoutMin) &&
    sessionTimeoutMin >= sessionTimeoutMinBound.min &&
    sessionTimeoutMin <= sessionTimeoutMinBound.max;

  const handleSaveSessionTimeout = async () => {
    if (!currentUser || !isAdmin || !isSessionTimeoutValid) return;
    setIsSavingSession(true);
    setImportStatus({ type: 'loading', message: 'Oturum Güvenliği Kaydediliyor...' });
    try {
      await settingsService.saveSessionTimeout(sessionTimeoutMin * 60000, currentUser.uid);
      setImportStatus({ type: 'success', message: `Oturum zaman aşımı ${sessionTimeoutMin} dakika olarak güncellendi.` });
      if (triggerToast) {
        triggerToast('🔐 OTURUM GÜVENLİĞİ', `Hareketsizlik süresi ${sessionTimeoutMin} dakika olarak ayarlandı.`, 'success');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportStatus({ type: 'error', message: `Oturum Ayarı Hatası: ${msg}` });
    } finally {
      setIsSavingSession(false);
    }
  };

  // SLA Settings State
  const [slaLowVal, setSlaLowVal] = useState(15);
  const [slaLowUnit, setSlaLowUnit] = useState<'days' | 'hours'>('days');

  const [slaMediumVal, setSlaMediumVal] = useState(5);
  const [slaMediumUnit, setSlaMediumUnit] = useState<'days' | 'hours'>('days');

  const [slaHighVal, setSlaHighVal] = useState(2);
  const [slaHighUnit, setSlaHighUnit] = useState<'days' | 'hours'>('days');

  const [slaUrgentVal, setSlaUrgentVal] = useState(4);
  const [slaUrgentUnit, setSlaUrgentUnit] = useState<'days' | 'hours'>('hours');
  
  const [isSavingSla, setIsSavingSla] = useState(false);

  const loadSlaFromLocalStorage = () => {
    const low = getSLAConfigForPriority('Low');
    setSlaLowVal(low.value);
    setSlaLowUnit(low.unit);

    const medium = getSLAConfigForPriority('Medium');
    setSlaMediumVal(medium.value);
    setSlaMediumUnit(medium.unit);

    const high = getSLAConfigForPriority('High');
    setSlaHighVal(high.value);
    setSlaHighUnit(high.unit);

    const urgent = getSLAConfigForPriority('Urgent');
    setSlaUrgentVal(urgent.value);
    setSlaUrgentUnit(urgent.unit);
  };

  useEffect(() => {
    loadSlaFromLocalStorage();
  }, []);

  // useSLASync (App.tsx kök seviyesinde) Firestore'dan gelen bir değişikliği
  // localStorage'a yazdığında bu event'i fırlatır — panel açıkken BAŞKA bir
  // admin SLA yapılandırmasını değiştirirse form artık canlı güncellenir
  // (bkz. kod denetimi: eskiden yalnızca ilk mount'ta okunuyordu). Kendi
  // kaydetme işlemimiz devam ederken gelen bir güncelleme formu ELİMİZDEKİ
  // düzenlemenin üzerine yazmasın diye isSavingSla true iken yoksayılır.
  useEffect(() => {
    if (isSavingSla) return;
    const handleSync = () => loadSlaFromLocalStorage();
    window.addEventListener(SLA_CONFIG_SYNCED_EVENT, handleSync);
    return () => window.removeEventListener(SLA_CONFIG_SYNCED_EVENT, handleSync);
  }, [isSavingSla]);

  const handleSaveSla = async () => {
    if (!currentUser || !isAdmin) return;
    setIsSavingSla(true);
    setImportStatus({ type: 'loading', message: 'SLA Yapılandırması Kaydediliyor...' });
    try {
      const summaryLabel = 'Rutin: ' + slaLowVal + ' ' + slaLowUnit + ', Normal: ' + slaMediumVal + ' ' + slaMediumUnit + ', Öncelikli: ' + slaHighVal + ' ' + slaHighUnit + ', İvedi: ' + slaUrgentVal + ' ' + slaUrgentUnit;
      await settingsService.saveSlaConfig({
        Low: { value: Number(slaLowVal), unit: slaLowUnit },
        Medium: { value: Number(slaMediumVal), unit: slaMediumUnit },
        High: { value: Number(slaHighVal), unit: slaHighUnit },
        Urgent: { value: Number(slaUrgentVal), unit: slaUrgentUnit },
      }, currentUser.uid, summaryLabel);

      setImportStatus({ type: 'success', message: 'SLA Teslim Mühletleri başarıyla güncellendi.' });
      if (triggerToast) {
        triggerToast('📋 SLA GÜNCELLENDİ', 'Kurumsal SLA teslim süreleri başarıyla revize edildi.', 'success');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportStatus({ type: 'error', message: `SLA Kayıt Hatası: ${msg}` });
    } finally {
      setIsSavingSla(false);
    }
  };

  const handleTestNotifications = async () => {
    // 1. Play the synthesis sound instantly
    try {
      const audioCtx = createAudioContext();
      if (!audioCtx) throw new Error('AudioContext desteklenmiyor');

      // Auto-resume context on click if suspended by browser autoplay policy
      if (audioCtx.state === 'suspended') {
        const resumeAudio = () => {
          audioCtx.resume();
          document.removeEventListener('click', resumeAudio);
        };
        document.addEventListener('click', resumeAudio);
      }

      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      const gain2 = audioCtx.createGain();
      
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(554.37, audioCtx.currentTime); // C#5 (Root tone)
      gain1.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);
      
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 (Harmonic overtone)
      gain2.gain.setValueAtTime(0.03, audioCtx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
      
      osc1.connect(gain1);
      osc2.connect(gain2);
      gain1.connect(audioCtx.destination);
      gain2.connect(audioCtx.destination);
      
      osc1.start();
      osc2.start();
      osc1.stop(audioCtx.currentTime + 0.8);
      osc2.stop(audioCtx.currentTime + 0.6);
    } catch {
      logger.warn('Audio feedback blocked by browser autoplay policy');
    }

    // 2. Trigger the In-App Toast visual notification
    if (triggerToast) {
      triggerToast(
        'BİLDİRİM TESTİ',
        'Makam ses ve yazılı bildirim sentezleyici motoru başarıyla test edildi.',
        'success'
      );
    }

    // 3. Try to trigger native browser notification if allowed
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Makam Kurumsal Bildirim', {
          body: 'Dizge arka plan ve yerel bildirim altyapısı aktiftir.',
          icon: '/favicon.ico'
        });
      } catch (err) {
        logger.warn('Native notification failed:', err);
      }
    } else {
      setImportStatus({
        type: 'success',
        message: 'Uygulama içi görsel ve sesli bildirim test edildi! Tarayıcı push izni etkin değil.'
      });
      setTimeout(() => setImportStatus(null), 5000);
    }
  };

  const handleInstallClick = async () => {
    const success = await install();
    if (success) {
      setImportStatus({ type: 'success', message: 'Uygulama başarıyla kuruluyor...' });
    } else {
      setImportStatus({ type: 'error', message: 'Yükleme başlatılamadı veya iptal edildi.' });
    }
  };

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (!isAdmin) {
      if (triggerToast) {
        triggerToast('YETKİSİZ İŞLEM', 'Dizge yedeği indirme yetkisi yalnızca Admin makamına aittir.', 'danger');
      }
      return;
    }
    setImportStatus({ type: 'loading', message: 'Dizge Verileri Yedekleniyor...' });
    try {
      const logs = await auditLogService.fetchAllPaged(AUDIT_LOG_EXPORT_PAGE_SIZE);

      const backup = {
        tasks, users, blockers, auditLogs: logs,
        exportDate: new Date().toISOString(),
        version: '2.3.0',
        system: 'MAKAM Stratejik Yönetim',
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `MAKAM-Backup-${new Date().toISOString().split('T')[0]}.json`);
      setImportStatus({ type: 'success', message: 'Dizge yedeği başarıyla indirildi.' });
    } catch (err) {
      logger.error('Export failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setImportStatus({ type: 'error', message: `Yedekleme Hatası: ${msg}` });
    }
  };

  // ── Import ────────────────────────────────────────────────────────────────
  // Dosya seçilir seçilmez restore ETMEZ — içeriği okuyup onay modalını açar.
  // Gerçek geri yükleme yalnızca kullanıcı modalda onayladığında (aşağıdaki
  // confirmRestore) çalışır (bkz. kod denetimi).
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentUser || !isAdmin) {
      if (triggerToast) {
        triggerToast('YETKİSİZ İŞLEM', 'Dizge geri yükleme yetkisi yalnızca Admin makamına aittir.', 'danger');
      }
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;
    setImportStatus({ type: 'loading', message: 'Veri Bütünlüğü Doğrulanıyor...' });

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      if (!content) {
        setImportStatus({ type: 'error', message: 'Hata: Dosya içeriği okunamadı.' });
        return;
      }
      setImportStatus(null);
      setPendingRestore({ content, fileName: file.name });
    };
    reader.readAsText(file);
  };

  const cancelRestore = () => {
    setPendingRestore(null);
    if (restoreFileInputRef.current) restoreFileInputRef.current.value = '';
  };

  const confirmRestore = async () => {
    // ConfirmDialog'un yazarak-doğrulama modu zaten Onayla butonunu gerçek
    // (native) disabled yapıyor — bu bir görsel stil değil, disabled bir
    // <button> klavye/senkron .click() ile de tetiklenemez. Yine de
    // pendingRestore null ise (ör. çağrı sırası bozulursa) sessizce çık.
    if (!currentUser || !pendingRestore) return;
    const { content, fileName } = pendingRestore;
    setPendingRestore(null);
    setImportStatus({ type: 'loading', message: 'Dizge Geri Yükleniyor...' });
    try {
      await settingsService.restoreBackup(content, currentUser.uid, fileName, (percent) => {
        setImportStatus({ type: 'loading', message: `Veri Yazılıyor... %${percent}` });
      });
      setImportStatus({ type: 'success', message: 'Dizge başarıyla önceki sürüme döndürüldü.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportStatus({ type: 'error', message: `Hata: ${msg}` });
    } finally {
      if (restoreFileInputRef.current) restoreFileInputRef.current.value = '';
    }
  };

  // ── Archive (export-only) ───────────────────────────────────────────────────
  // NOT: Denetim izleri artık firestore.rules'ta değiştirilemez/silinemez
  // (kanıt bütünlüğü). Bu işlem yalnızca dışa aktarır — veritabanından hiçbir
  // kayıt silinmez.
  const handleArchive = async () => {
    if (!currentUser || !isAdmin) {
      if (triggerToast) {
        triggerToast('YETKİSİZ İŞLEM', 'Log dışa aktarma yetkisi yalnızca Admin makamına aittir.', 'danger');
      }
      return;
    }
    setIsArchiving(true);
    setImportStatus({ type: 'loading', message: 'Denetim İzleri İndiriliyor...' });
    try {
      const logs = await auditLogService.fetchAllPaged(AUDIT_LOG_EXPORT_PAGE_SIZE);

      if (logs.length === 0) {
        setImportStatus({ type: 'success', message: 'Dışa aktarılacak denetim izi bulunamadı.' });
        return;
      }

      // Arşiv Dosyasını İndir (JSON)
      const backup = {
        auditLogs: logs,
        archiveDate: new Date().toISOString(),
        version: '2.3.0',
        system: 'MAKAM Stratejik Yönetim Denetim Arşivi',
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `MAKAM-Logs-Backup-${new Date().toISOString().split('T')[0]}.json`);

      // Dışa aktarma işleminin kendisi denetim izine kaydedilir (kayıtlar silinmez)
      await settingsService.archiveAuditLogs(logs.length, currentUser.uid);

      setImportStatus({ type: 'success', message: `${logs.length} denetim izi kaydı başarıyla yerel diske aktarıldı.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportStatus({ type: 'error', message: `Arşivleme Hatası: ${msg}` });
    } finally {
      setIsArchiving(false);
    }
  };

  if (isLoading) return <SettingsSkeleton />;

  return (
    <div className="flex flex-col gap-5 py-4 max-w-[1440px] mx-auto font-sans">

      {/* ── Page Header ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 pb-4 border-b border-executive-blue/[0.04]">
        <div className="w-8 h-8 rounded-xl bg-executive-blue flex items-center justify-center shadow-lg">
          <SettingsIcon className="w-4 h-4 text-[color:var(--executive-blue-text)] stroke-[1.5]" />
        </div>
        <div>
          <span className="text-micro font-medium text-executive-blue uppercase tracking-[0.4em] block leading-none">
            DİZGE YAPILANDIRMASI
          </span>
          <span className="text-micro text-text-tertiary uppercase tracking-[0.3em]">Konfigürasyon & Veri Yönetimi</span>
        </div>
      </div>

      {/* ── Offline Banner ─────────────────────────────────────────── */}
      {!isOnline && (
        <div className="flex items-center gap-2.5 p-3 bg-status-danger/10 border border-status-danger/20 text-status-danger rounded-2xl text-micro font-semibold uppercase tracking-[0.15em] animate-pulse">
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
          
          {/* TAB 1: GENERAL & VIEW */}
          {activeSubTab === 'general' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Notification and Audio System Test */}
              <SettingsCard title="Bildirim & Ses Testi" description="Akustik & görsel doğrulaması" icon={Bell} accentColor="amber" index={0}>
                <p className="text-caption text-text-muted font-light leading-relaxed">
                  Dizge ses sentezleyici çanını ve yerel bildirim motorunun (In-App Toast ve PWA Push) çalışma durumunu anında test edin.
                </p>
                <div className="flex items-center justify-between gap-3 p-2.5 bg-surface-glass border border-surface-border rounded-xl">
                  <span className="text-micro font-medium text-text-heading uppercase tracking-[0.15em]">
                    Bildirim Sesi
                  </span>
                  <button
                    onClick={() => setSoundEnabled(!soundEnabled)}
                    role="switch"
                    aria-checked={soundEnabled}
                    aria-label="Bildirim sesini aç/kapat"
                    className={cn(
                      'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2',
                      soundEnabled ? 'bg-executive-blue' : 'bg-surface-border'
                    )}
                  >
                    <span className={cn(
                      'pointer-events-none inline-block h-4 w-4 rounded-full bg-surface-elevated shadow-sm ring-0 transition duration-300',
                      soundEnabled ? 'translate-x-4' : 'translate-x-0'
                    )} />
                  </button>
                </div>
                <ActionButton
                  variant="warning"
                  onClick={handleTestNotifications}
                  label={<><Bell className="w-3.5 h-3.5 stroke-[2]" />Bildirimleri Test Et</>}
                />
              </SettingsCard>

              {/* PWA Installation */}
              <SettingsCard title="Cihaza Yükle (PWA)" description="Masaüstü & Mobil Uygulama" icon={Smartphone} accentColor="gold" index={1}>
                <div className="flex flex-col gap-2.5">
                  <p className="text-caption text-text-muted font-light leading-relaxed">
                    MAKAM dizgesini bilgisayarınıza veya telefonunuza bağımsız bir uygulama olarak yükleyebilirsiniz. Bu sayede daha hızlı erişim sağlar ve tam ekran deneyimi yaşarsınız.
                  </p>

                  {isInstalled ? (
                    <div className="flex items-center gap-2 p-2.5 bg-status-success/10 border border-status-success/20 rounded-xl">
                      <CheckCircle2 className="w-3.5 h-3.5 text-status-success flex-shrink-0" />
                      <span className="text-micro text-status-success font-medium uppercase tracking-[0.2em]">
                        Uygulama zaten yüklü ve aktif!
                      </span>
                    </div>
                  ) : isInstallable ? (
                    <ActionButton
                      variant="primary"
                      onClick={handleInstallClick}
                      label={<><Smartphone className="w-3.5 h-3.5 stroke-[2]" />Uygulamayı Şimdi Yükle</>}
                    />
                  ) : (
                    <div className="flex flex-col gap-2 p-3 bg-surface-glass border border-surface-border rounded-xl text-micro text-text-muted font-normal leading-relaxed">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-3.5 h-3.5 text-[color:var(--gold-text)] flex-shrink-0 mt-0.5 animate-pulse" />
                        <div>
                          <span className="font-semibold text-text-heading block mb-0.5">Yükleme Kılavuzu</span>
                          <span>Tarayıcınız otomatik yükleme butonunu şu an desteklemiyor olabilir. Alternatif yükleme adımları:</span>
                        </div>
                      </div>
                      <div className="h-px bg-executive-blue/[0.04] my-1" />
                      <ul className="list-disc pl-4 flex flex-col gap-1 text-micro text-text-tertiary">
                        <li><strong>iOS (iPhone/iPad):</strong> Safari tarayıcısında alt menüdeki <span className="text-text-muted font-semibold">Paylaş</span> butonuna tıklayıp, gelen menüden <span className="text-text-muted font-semibold">"Ana Ekrana Ekle"</span> seçeneğini seçin.</li>
                        <li><strong>Android (Chrome):</strong> Sağ üstteki üç noktaya tıklayıp <span className="text-text-muted font-semibold">"Uygulamayı yükle"</span> veya <span className="text-text-muted font-semibold">"Ana ekrana ekle"</span> seçeneğini seçin.</li>
                        <li><strong>Masaüstü (Chrome/Edge):</strong> Adres çubuğunun sağ tarafındaki <span className="text-text-muted font-semibold">"Yükle" (küçük monitör/ok)</span> simgesine tıklayın.</li>
                      </ul>
                    </div>
                  )}
                </div>
              </SettingsCard>

            </div>
          )}

          {/* TAB 2: SLA RULES */}
          {activeSubTab === 'sla' && isAdmin && (
            <div className="max-w-2xl">
              {/* SLA Configuration */}
              <SettingsCard 
                title="SLA Teslim Mühletleri" 
                description="Talimat öncelik süreleri" 
                icon={Clock} 
                accentColor="gold" 
                index={0}
              >
                <p className="text-caption text-text-muted font-light leading-relaxed mb-1">
                  Görevin tanımlandığı andan itibaren tamamlanması gereken iş günü veya mesai saati mühlet limitleri (Mesai: 09:00 - 18:00).
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
                  <SlaPriorityInput
                    label="Rutin"
                    value={slaLowVal} unit={slaLowUnit}
                    onValueChange={setSlaLowVal} onUnitChange={setSlaLowUnit}
                    disabled={!isOnline || isSavingSla}
                  />
                  <SlaPriorityInput
                    label="Normal"
                    value={slaMediumVal} unit={slaMediumUnit}
                    onValueChange={setSlaMediumVal} onUnitChange={setSlaMediumUnit}
                    disabled={!isOnline || isSavingSla}
                  />
                  <SlaPriorityInput
                    label="Öncelikli"
                    value={slaHighVal} unit={slaHighUnit}
                    onValueChange={setSlaHighVal} onUnitChange={setSlaHighUnit}
                    disabled={!isOnline || isSavingSla}
                  />
                  <SlaPriorityInput
                    label="İvedi"
                    value={slaUrgentVal} unit={slaUrgentUnit}
                    onValueChange={setSlaUrgentVal} onUnitChange={setSlaUrgentUnit}
                    disabled={!isOnline || isSavingSla}
                  />
                </div>

                {!isOnline ? (
                  <div className="flex items-start gap-2 p-2.5 bg-status-danger/10 border border-status-danger/20 rounded-xl">
                    <AlertCircle className="w-3.5 h-3.5 text-status-danger flex-shrink-0 mt-0.5" />
                    <p className="text-micro text-status-danger font-semibold uppercase tracking-[0.15em] leading-relaxed">
                      SLA sürelerini güncellemek için internet bağlantısı gereklidir.
                    </p>
                  </div>
                ) : (
                  <ActionButton
                    variant="primary"
                    disabled={isSavingSla}
                    onClick={handleSaveSla}
                    label={isSavingSla ? 'Kaydediliyor...' : 'Süreleri Güncelle'}
                  />
                )}
              </SettingsCard>
            </div>
          )}

          {/* TAB 3: SESSION SECURITY */}
          {activeSubTab === 'security' && isAdmin && (
            <div className="max-w-2xl">
              <SettingsCard
                title="Oturum Zaman Aşımı"
                description="Hareketsizlik güvenlik limiti"
                icon={Lock}
                accentColor="slate"
                index={0}
              >
                <p className="text-caption text-text-muted font-light leading-relaxed mb-1">
                  Kullanıcı belirtilen süre boyunca hiçbir işlem yapmazsa oturumu güvenlik gereği
                  otomatik olarak kapatılır. Kapanmadan bir dakika önce ekranda "Devam Et" seçeneği
                  sunulur. Bu ayar tüm personel için geçerlidir.
                </p>

                <div className="flex flex-col gap-2 mb-2">
                  <Input
                    id="session-timeout-input"
                    label={`Süre (dakika) — ${sessionTimeoutMinBound.min} ile ${sessionTimeoutMinBound.max} arası`}
                    type="number"
                    inputMode="numeric"
                    min={sessionTimeoutMinBound.min}
                    max={sessionTimeoutMinBound.max}
                    value={Number.isFinite(sessionTimeoutMin) ? sessionTimeoutMin : ''}
                    onChange={(e) => setSessionTimeoutMin(Number(e.target.value))}
                    disabled={!isOnline || isSavingSession}
                    error={!isSessionTimeoutValid
                      ? `Süre ${sessionTimeoutMinBound.min}-${sessionTimeoutMinBound.max} dakika aralığında olmalıdır.`
                      : undefined}
                  />
                  <span className="text-micro text-text-tertiary px-1 leading-relaxed">
                    Yürürlükteki değer: {Math.round(sessionTimeoutMs / 60000)} dakika.
                  </span>
                </div>

                {!isOnline ? (
                  <div className="flex items-start gap-2 p-2.5 bg-status-danger/10 border border-status-danger/20 rounded-xl">
                    <AlertCircle className="w-3.5 h-3.5 text-status-danger flex-shrink-0 mt-0.5" />
                    <p className="text-micro text-status-danger font-semibold uppercase tracking-[0.15em] leading-relaxed">
                      Oturum güvenliği ayarını değiştirmek için internet bağlantısı gereklidir.
                    </p>
                  </div>
                ) : (
                  <ActionButton
                    variant="primary"
                    disabled={isSavingSession || !isSessionTimeoutValid}
                    onClick={handleSaveSessionTimeout}
                    label={isSavingSession ? 'Kaydediliyor...' : 'Süreyi Güncelle'}
                  />
                )}
              </SettingsCard>
            </div>
          )}

          {/* TAB 4: DATA MANAGEMENT */}
          {activeSubTab === 'data' && isAdmin && (
            <div className="flex flex-col gap-4">

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Export */}
                <SettingsCard title="Arşivleme" description="Dizge yedeği oluştur" icon={Download} accentColor="slate" index={0}>
                  <p className="text-caption text-text-muted font-light leading-relaxed">
                    Tüm talimat, personel ve denetim verilerini tek bir JSON dosyasına aktarır.
                  </p>
                  <ActionButton
                    variant="primary"
                    disabled={!isOnline}
                    onClick={handleExport}
                    label={<><Download className="w-3.5 h-3.5 stroke-[2]" />Yedeği İndir (.json)</>}
                  />
                </SettingsCard>

                {/* Import / Restore */}
                <SettingsCard title="Geri Yükleme" description="Yedekten dizgeyi döndür" icon={RotateCcw} accentColor="amber" index={1}>
                  <p className="text-caption text-text-muted font-light leading-relaxed">
                    Daha önce alınan bir yedek dosyasından dizgeyi geri yükler (Çalışma zamanı Zod doğrulaması içerir).
                  </p>

                  <input ref={restoreFileInputRef} type="file" accept=".json" onChange={handleImport} className="hidden" id="restore-upload" disabled={!isOnline} />
                  
                  {!isOnline ? (
                    <div className="flex items-start gap-2 p-2.5 bg-status-danger/10 border border-status-danger/20 rounded-xl">
                      <AlertCircle className="w-3.5 h-3.5 text-status-danger flex-shrink-0 mt-0.5" />
                      <p className="text-micro text-status-danger font-semibold uppercase tracking-[0.15em] leading-relaxed">
                        Dizgeyi geri yüklemek için internet bağlantısı gereklidir.
                      </p>
                    </div>
                  ) : (
                    <>
                      <ActionButton
                        variant="danger"
                        htmlFor="restore-upload"
                        label={<><RotateCcw className="w-3.5 h-3.5 stroke-[2]" />Yedekten Dön</>}
                      />

                      <div className="flex items-start gap-2.5 p-3.5 border-l-[3px] border-status-danger bg-status-danger/[0.06] rounded-r-xl">
                        <AlertCircle className="w-4 h-4 text-status-danger flex-shrink-0 mt-0.5 stroke-[1.5]" />
                        <p className="text-body-sm text-text-heading font-normal leading-relaxed">
                          Bu işlem mevcut verilerin üzerine yazacaktır. Kayıtlar toplu halde (chunk) yazılır — işlem yarıda kesilirse veritabanı kısmen güncellenmiş durumda kalabilir. Geri yüklemeden önce güncel bir yedek almanız önerilir.
                        </p>
                      </div>
                    </>
                  )}
                </SettingsCard>

                {/* Export Audit Logs */}
                <SettingsCard title="Denetim İzlerini Arşivle" description="Dizge log dışa aktarımı" icon={ShieldCheck} accentColor="slate" index={2}>
                  <p className="text-caption text-text-muted font-light leading-relaxed">
                    Tüm dizge erişim ve değişim loglarını yerel bir JSON dosyasına aktarır. Denetim izleri kanıt bütünlüğü gereği değiştirilemez/silinemez olduğundan bu işlem veritabanından hiçbir kaydı kaldırmaz.
                  </p>

                  {!isOnline ? (
                    <div className="flex items-start gap-2 p-2.5 bg-status-danger/10 border border-status-danger/20 rounded-xl">
                      <AlertCircle className="w-3.5 h-3.5 text-status-danger flex-shrink-0 mt-0.5" />
                      <p className="text-micro text-status-danger font-semibold uppercase tracking-[0.15em] leading-relaxed">
                        Denetim izlerini dışa aktarmak için internet bağlantısı gereklidir.
                      </p>
                    </div>
                  ) : (
                    <ActionButton
                      variant="primary"
                      disabled={isArchiving}
                      onClick={handleArchive}
                      label={isArchiving ? 'Arşivleniyor...' : <><Download className="w-3.5 h-3.5 stroke-[2]" />Arşivi İndir (.json)</>}
                    />
                  )}
                </SettingsCard>

                {/* System Optimization */}
                <SettingsCard title="Dizge Optimizasyonu" description="Önbellek & bildirim temizliği" icon={Database} accentColor="slate" index={3}>
                  <p className="text-caption text-text-muted font-light leading-relaxed">
                    Okunmuş bildirimleri ve geçici önbelleği temizleyerek dizge performansını artırır.
                  </p>
                  <ActionButton
                    variant="secondary"
                    disabled={!isOnline}
                    onClick={async () => {
                      setImportStatus({ type: 'loading', message: 'Dizge Optimize Ediliyor...' });
                      await taskService.cleanupDatabase();
                      setImportStatus({ type: 'success', message: 'Dizge başarıyla optimize edildi.' });
                    }}
                    label={<><RotateCcw className="w-3.5 h-3.5 stroke-[2]" />Optimizasyonu Çalıştır</>}
                  />
                </SettingsCard>

              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Yedekten Geri Yükleme Onayı ──────────────────────────────── */}
      {/* Yazarak doğrulama kullanılır: uygulamanın en yıkıcı ve GERİ DÖNÜŞÜ
          OLMAYAN işlemi (tüm personel/talimat/engel verisinin üzerine yazma)
          için tek butonluk bir onay yetersiz sürtünme sağlıyordu — refleksle
          tıklanan bir onay tüm dizgeyi eski bir yedeğe döndürebilirdi (bkz.
          kod denetimi). */}
      <ConfirmDialog
        isOpen={!!pendingRestore}
        onClose={cancelRestore}
        onConfirm={() => { void confirmRestore(); }}
        title="Yedekten Geri Yükle"
        message={<><strong className="text-status-danger font-medium">{pendingRestore?.fileName}</strong> dosyasından dizgeyi geri yüklemek üzeresiniz. Bu işlem mevcut TÜM personel, talimat ve engel verilerinin üzerine yazacaktır ve <strong className="text-status-danger font-medium">geri alınamaz</strong>.</>}
        confirmLabel="Geri Yüklemeyi Onayla"
        confirmPhrase={RESTORE_CONFIRM_PHRASE}
      />
    </div>
  );
};
