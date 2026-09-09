import { useState, useEffect } from 'react';
import { Lock, AlertCircle } from 'lucide-react';
import type { User } from '../../types';
import { settingsService } from '../../services/settingsService';
import { SESSION_TIMEOUT_MIN_MS, SESSION_TIMEOUT_MAX_MS } from '../../constants';
import { SettingsCard } from '../ui/SettingsCard';
import { ActionButton } from '../ui/ActionButton';
import { Input } from '../ui/Input';

interface SecurityTabProps {
  isOnline: boolean;
  currentUser?: User | null;
  /** Render koşulu (`activeSubTab === 'security' && isAdmin`, Settings.tsx'te)
   *  ile AYRI, ikinci bir savunma katmanı — orijinal handler bu kontrolü
   *  render koşulundan bağımsız olarak da taşıyordu (bkz. kod denetimi:
   *  RBAC çift-kontrol deseni). */
  isAdmin: boolean;
  triggerToast?: (title: string, body: string, type?: 'info' | 'success' | 'warning' | 'danger') => void;
  setImportStatus: (status: { type: 'success' | 'error' | 'loading'; message: string } | null) => void;
  /** Yürürlükteki oturum zaman aşımı (system/settings). */
  sessionTimeoutMs: number;
}

/** Oturum Güvenliği sekmesi — hareketsizlik zaman aşımı süresi. */
export function SecurityTab({ isOnline, currentUser, isAdmin, triggerToast, setImportStatus, sessionTimeoutMs }: SecurityTabProps) {
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

  return (
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
            <p className="text-micro text-status-danger font-semibold uppercase tracking-label leading-relaxed">
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
  );
}
