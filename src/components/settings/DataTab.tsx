import React, { useState, useRef } from 'react';
import { Download, RotateCcw, ShieldCheck, Database, AlertCircle } from 'lucide-react';
import type { Task, User, TaskBlocker } from '../../types';
import { downloadBlob } from '../../lib/utils';
import { taskService } from '../../services/taskService';
import { auditLogService } from '../../services/auditLogService';
import { settingsService } from '../../services/settingsService';
import { logger } from '../../lib/logger';
import { SettingsCard } from '../ui/SettingsCard';
import { ActionButton } from '../ui/ActionButton';
import { ConfirmDialog } from '../ui/ConfirmDialog';

export type ImportStatus = { type: 'success' | 'error' | 'loading'; message: string };

const AUDIT_LOG_EXPORT_PAGE_SIZE = 500;

/** Geri yükleme onayında harfi harfine yazılması gereken ifade. Türkçe büyük
 *  harf duyarlıdır ('i' → 'İ'), bu yüzden karşılaştırma normalize edilmeden
 *  BİREBİR yapılır — "yaklaşık doğru" bir metin onay sayılmaz. */
const RESTORE_CONFIRM_PHRASE = 'GERİ YÜKLE';

interface DataTabProps {
  tasks: Task[];
  users: User[];
  blockers: TaskBlocker[];
  isOnline: boolean;
  currentUser?: User | null;
  /** Render koşulu (`activeSubTab === 'data' && isAdmin`, Settings.tsx'te)
   *  ile AYRI, ikinci bir savunma katmanı — orijinal handler'lar bu kontrolü
   *  render koşulundan bağımsız olarak da taşıyordu, buraya taşınırken
   *  korunur (bkz. kod denetimi: RBAC çift-kontrol deseni). */
  isAdmin: boolean;
  triggerToast?: (title: string, body: string, type?: 'info' | 'success' | 'warning' | 'danger') => void;
  setImportStatus: (status: ImportStatus | null) => void;
}

/** Veri Yönetimi sekmesi — yedekleme/geri yükleme/denetim izi arşivi/optimizasyon. */
export function DataTab({ tasks, users, blockers, isOnline, currentUser, isAdmin, triggerToast, setImportStatus }: DataTabProps) {
  const [isArchiving, setIsArchiving] = useState(false);
  // Yedekten geri yükleme, mevcut TÜM veriyi geri dönüşsüz ezen bir işlemdir —
  // dosya seçilir seçilmez doğrudan tetiklenmek yerine (uygulamanın geri
  // kalanındaki görev/personel/engel silme akışlarıyla TUTARLI olarak) önce
  // bir onay modalı gösterilir; dosya içeriği yalnızca kullanıcı onaylarsa
  // işlenir (bkz. kod denetimi).
  const [pendingRestore, setPendingRestore] = useState<{ content: string; fileName: string } | null>(null);
  const restoreFileInputRef = useRef<HTMLInputElement>(null);

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

  return (
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
              <p className="text-micro text-status-danger font-semibold uppercase tracking-label leading-relaxed">
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
              <p className="text-micro text-status-danger font-semibold uppercase tracking-label leading-relaxed">
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
              // Silinen kayıt sayıları gösterilir — eskiden işlem sessizce
              // dönüyor ve kullanıcı hiçbir şey silinmemiş olsa bile aynı
              // "başarılı" mesajını görüyordu.
              const { notifications, errorLogs } = await taskService.cleanupDatabase();
              const total = notifications + errorLogs;
              setImportStatus({
                type: 'success',
                message: total === 0
                  ? 'Temizlenecek eski kayıt bulunamadı — dizge zaten optimize.'
                  : `${total} eski kayıt temizlendi (${notifications} bildirim, ${errorLogs} hata kaydı).`,
              });
            }}
            label={<><RotateCcw className="w-3.5 h-3.5 stroke-[2]" />Optimizasyonu Çalıştır</>}
          />
        </SettingsCard>

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
}
