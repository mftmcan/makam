import { useState, useEffect } from 'react';
import { Clock, AlertCircle } from 'lucide-react';
import type { User } from '../../types';
import { getSLAConfigForPriority } from '../../lib/sla';
import { SLA_CONFIG_SYNCED_EVENT } from '../../hooks/useSLASync';
import { settingsService } from '../../services/settingsService';
import { SettingsCard } from '../ui/SettingsCard';
import { ActionButton } from '../ui/ActionButton';
import { SlaPriorityInput } from './SharedUI';
import type { ImportStatus } from './DataTab';

interface SlaTabProps {
  isOnline: boolean;
  currentUser?: User | null;
  /** Render koşulu (`activeSubTab === 'sla' && isAdmin`, Settings.tsx'te)
   *  ile AYRI, ikinci bir savunma katmanı — orijinal handler bu kontrolü
   *  render koşulundan bağımsız olarak da taşıyordu (bkz. kod denetimi:
   *  RBAC çift-kontrol deseni). */
  isAdmin: boolean;
  triggerToast?: (title: string, body: string, type?: 'info' | 'success' | 'warning' | 'danger') => void;
  setImportStatus: (status: ImportStatus | null) => void;
}

/** SLA Kuralları sekmesi — öncelik bazlı teslim mühletleri. */
export function SlaTab({ isOnline, currentUser, isAdmin, triggerToast, setImportStatus }: SlaTabProps) {
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

  return (
    <div className="max-w-2xl">
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
            <p className="text-micro text-status-danger font-semibold uppercase tracking-label leading-relaxed">
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
  );
}
