import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Onay butonuna tıklanınca çağrılır. Modalı kapatmak (veya açık tutup
   *  `isLoading`/`warning` göstermek) çağıranın sorumluluğundadır — bu
   *  bileşen otomatik kapatmaz (bkz. DepartmentManager'daki async silme). */
  onConfirm: () => void;
  title: string;
  /** Ana açıklama paragrafı. */
  message: React.ReactNode;
  /** Uyarı/hata kutusu — ön koşul uyarısı (ör. "N aktif talimatı var") veya
   *  doğrulama hatası (ör. "Birim hâlâ kullanılıyor") için aynı görsel kalıp. */
  warning?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'danger' | 'primary';
  /**
   * Verilirse "yazarak doğrulama" modu açılır: Onay butonu, kullanıcı bu
   * metni harfi harfine yazana kadar pasif kalır (bkz. tasarım denetimi F9 —
   * eskiden Settings/DepartmentManager'da birbirinden bağımsız iki kopya
   * olarak vardı).
   */
  confirmPhrase?: string;
  /** Onay sırasında asenkron bir işlem sürüyorsa (ör. silme isteği) — onay
   *  butonunu spinner'a çevirir, iptal butonunu devre dışı bırakır. */
  isLoading?: boolean;
}

/**
 * Uygulama genelinde tekrarlanan "emin misiniz?" modal deseninin (bkz. kod
 * denetimi F9 — eskiden BlockerList/TeamList/TaskDetails'te üç ayrı kopya,
 * Settings/DepartmentManager'da yazarak-doğrulamalı iki ayrı kopya vardı)
 * tek noktadan yönetilen hali. Footer.tsx'teki "confirm-in-place" (görev
 * detayında hızlı, tek dokunuşluk eylem onayı) BİLİNÇLİ olarak buraya dahil
 * EDİLMEDİ — o, zaten açık bir panelde saniyeler içinde tekrar tıklanan bir
 * eylem için tasarlanmış farklı bir etkileşim, ikinci bir modal-üstü-modal
 * onunla aynı deneyimi bozardı.
 */
export const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  warning,
  confirmLabel = 'Onayla',
  cancelLabel = 'İptal',
  confirmVariant = 'danger',
  confirmPhrase,
  isLoading = false,
}: ConfirmDialogProps) => {
  const phraseInputId = React.useId();
  const phraseHelpId = `${phraseInputId}-help`;
  const [phraseInput, setPhraseInput] = useState('');

  // Her açılışta yazarak-doğrulama kutusu boş başlar — önceki oturumdan
  // kalan metin bir sonraki (muhtemelen farklı hedefli) onayı sessizce
  // etkinleştirmemeli.
  useEffect(() => {
    if (!isOpen) setPhraseInput('');
  }, [isOpen]);

  const isConfirmed = !confirmPhrase || phraseInput === confirmPhrase;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        <p className="text-body text-text-muted font-light leading-relaxed">{message}</p>

        {confirmPhrase && (
          <div className="flex flex-col gap-2">
            <label htmlFor={phraseInputId} className="text-body-sm text-text-heading font-normal leading-relaxed">
              Onaylamak için aşağıdaki kutuya <strong className="text-status-danger font-semibold tracking-wide">{confirmPhrase}</strong> yazın.
            </label>
            <Input
              id={phraseInputId}
              value={phraseInput}
              onChange={(e) => setPhraseInput(e.target.value)}
              placeholder={confirmPhrase}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={phraseHelpId}
              // Enter ile kazara gönderimi engelle — onay yalnızca butonla verilir.
              onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
            />
            <span id={phraseHelpId} className="text-micro text-text-tertiary px-1 leading-relaxed">
              {isConfirmed
                ? 'Doğrulama tamamlandı — işlem başlatılabilir.'
                : 'Doğrulama metni birebir eşleşmeden işlem başlatılamaz.'}
            </span>
          </div>
        )}

        {warning && (
          <div className="flex items-start gap-2 p-2.5 bg-status-danger/10 border border-status-danger/20 rounded-xl">
            <AlertTriangle className="w-3.5 h-3.5 text-status-danger flex-shrink-0 mt-0.5" />
            <p className="text-micro text-status-danger font-semibold uppercase tracking-label leading-relaxed">{warning}</p>
          </div>
        )}

        <div className="flex justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>{cancelLabel}</Button>
          <Button variant={confirmVariant} onClick={onConfirm} isLoading={isLoading} disabled={!isConfirmed}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
