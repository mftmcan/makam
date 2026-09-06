import React, { useRef } from 'react';
import { Award, X, ShieldCheck, AlertTriangle, ShieldAlert, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useModalBehavior } from './Modal';
import { Button } from './Button';
import { formatLongDate } from '../../lib/utils';

// CertificateModal ve WarningModal, yalnızca renk/ikon/metin farklı olan
// neredeyse birebir aynı çerçeve (overlay/panel/mühür/kapat) yapısını
// bağımsız kopyalar olarak taşıyordu (bkz. kod denetimi). Çerçeve burada
// tek bir yerde tutulur; yalnızca gerçekten FARKLI olan içerik (gövde metni)
// `children` ile enjekte edilir.
export type FormalDocumentVariant = 'certificate' | 'warning';

interface VariantConfig {
  overlayTint: string;
  panelBorder: string;
  panelShadow: string;
  blobPrimary: string;
  iconBg: string;
  iconColor: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  dividerColor: string;
  bodyBorder: string;
  sectionLabelColor: string;
  dateLabel: string;
  sealIcon: LucideIcon;
  sealIconColor: string;
  sealRing: string;
  sealDashedRing: string;
  sealLabelColor: string;
  buttonVariant: 'primary' | 'danger';
  closeAriaLabel: string;
  closeHoverColor: string;
  closeRingColor: string;
  titleId: string;
}

const VARIANTS: Record<FormalDocumentVariant, VariantConfig> = {
  certificate: {
    overlayTint: 'bg-executive-blue/40',
    panelBorder: 'border-executive-gold/10',
    panelShadow: 'shadow-[0_40px_90px_-24px_rgba(0,0,0,0.18)]',
    blobPrimary: 'bg-executive-gold/5',
    iconBg: 'bg-executive-gold/10',
    iconColor: 'text-[color:var(--gold-text)]',
    icon: Award,
    title: 'Liyakat Belgesi',
    subtitle: 'Makam Başarı Takdiri',
    dividerColor: 'bg-executive-gold/30',
    bodyBorder: 'border-makam-border/5',
    sectionLabelColor: 'text-[color:var(--gold-text)]',
    dateLabel: 'TARİH',
    sealIcon: ShieldCheck,
    sealIconColor: 'text-executive-gold/30',
    sealRing: 'border-executive-gold/20',
    sealDashedRing: 'border-executive-gold/20',
    sealLabelColor: 'text-[color:var(--gold-text)]',
    buttonVariant: 'primary',
    closeAriaLabel: 'Liyakat belgesini kapat',
    closeHoverColor: 'hover:text-executive-blue',
    closeRingColor: 'focus-visible:ring-executive-blue',
    titleId: 'certificate-modal-title',
  },
  warning: {
    overlayTint: 'bg-executive-blue/60',
    panelBorder: 'border-status-danger/10',
    panelShadow: 'shadow-[0_40px_90px_-24px_rgba(239,68,68,0.14)]',
    blobPrimary: 'bg-status-danger/5',
    iconBg: 'bg-status-danger/10',
    iconColor: 'text-status-danger',
    icon: AlertTriangle,
    title: 'İkaz ve Uyarı Belgesi',
    subtitle: 'Makam Disiplin Bildirimi',
    dividerColor: 'bg-status-danger/30',
    bodyBorder: 'border-status-danger/10',
    sectionLabelColor: 'text-status-danger',
    dateLabel: 'TEBLİĞ TARİHİ',
    sealIcon: ShieldAlert,
    sealIconColor: 'text-status-danger/30',
    sealRing: 'border-status-danger/20',
    sealDashedRing: 'border-status-danger/20',
    sealLabelColor: 'text-status-danger',
    buttonVariant: 'danger',
    closeAriaLabel: 'İkaz belgesini kapat',
    closeHoverColor: 'hover:text-status-danger',
    closeRingColor: 'focus-visible:ring-status-danger',
    titleId: 'warning-modal-title',
  },
};

interface FormalDocumentModalProps {
  variant: FormalDocumentVariant;
  onClose: () => void;
  // Selamlama + isim + gövde metni birlikte geçilir — CertificateModal ve
  // WarningModal'da bu üç parçanın SIRASI aynıdır ama içerikleri (selamlama
  // metni, gövde paragraf sayısı) farklıdır, bu yüzden burada sabit bir
  // "isim" slotu ayırmak yerine tamamı çağıran tarafa bırakılır.
  children: React.ReactNode;
}

export const FormalDocumentModal = ({ variant, onClose, children }: FormalDocumentModalProps) => {
  const c = VARIANTS[variant];
  const Icon = c.icon;
  const SealIcon = c.sealIcon;
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Ortak modal davranışı: Escape ile kapatma, focus-trap, body scroll kilidi,
  // açılışta kapat butonuna odaklanma (ui/Modal ile paylaşılan stack mantığı)
  useModalBehavior({ isOpen: true, onClose, containerRef: panelRef, initialFocusRef: closeButtonRef });

  return (
    <div
      className={`fixed inset-0 ${c.overlayTint} backdrop-blur-md flex items-center justify-center p-8 z-[200]`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={c.titleId}
    >
      <motion.div
        ref={panelRef}
        initial={{ opacity: 0, scale: 0.9, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className={`w-full max-w-2xl bg-surface-elevated p-6 md:p-10 rounded-2xl relative border-[8px] md:border-[10px] ${c.panelBorder} ${c.panelShadow} overflow-y-auto overflow-x-hidden max-h-[90vh] custom-scrollbar`}
      >
        {/* Decorative Background Patterns */}
        <div className={`absolute top-0 right-0 w-64 h-64 ${c.blobPrimary} rounded-full blur-[80px] -mr-32 -mt-32`} />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-executive-blue/5 rounded-full blur-[80px] -ml-32 -mb-32" />

        <button
          ref={closeButtonRef}
          onClick={onClose}
          aria-label={c.closeAriaLabel}
          className={`absolute top-8 right-8 text-text-muted/40 ${c.closeHoverColor} transition-colors rounded-full focus-visible:outline-none focus-visible:ring-2 ${c.closeRingColor} focus-visible:ring-offset-2`}
        >
          <X className="w-8 h-8 stroke-[1.2]" aria-hidden="true" />
        </button>

        <div className="flex flex-col items-center text-center gap-4 md:gap-6 relative z-10">
          <div className={`w-16 h-16 md:w-20 md:h-20 ${c.iconBg} rounded-2xl flex items-center justify-center ${c.iconColor} shadow-inner shrink-0`}>
            <Icon className="w-8 h-8 md:w-10 md:h-10 stroke-[1.2]" aria-hidden="true" />
          </div>

          <div className="flex flex-col gap-2 md:gap-3">
            <h2 id={c.titleId} className="text-2xl md:text-3xl font-light text-text-heading tracking-[0.3em] font-serif uppercase">{c.title}</h2>
            <div className="flex items-center justify-center gap-3 md:gap-4">
              <div className={`h-[1px] w-12 ${c.dividerColor}`} />
              <span className={`text-micro ${c.sectionLabelColor} font-medium tracking-[0.3em] uppercase`}>{c.subtitle}</span>
              <div className={`h-[1px] w-12 ${c.dividerColor}`} />
            </div>
          </div>

          <div className={`w-full border-y ${c.bodyBorder} py-6 md:py-8 flex flex-col gap-3 md:gap-4`}>
            {children}
          </div>

          <div className="flex flex-col md:flex-row items-center justify-between w-full px-4 md:px-12 pt-4 gap-8 md:gap-0">
             <div className="flex flex-col items-center md:items-start gap-2">
                <span className="text-micro text-text-muted font-medium uppercase tracking-[0.3em]">{c.dateLabel}</span>
                <span className="text-[14px] text-text-heading font-light font-serif">{formatLongDate()}</span>
             </div>
             <div className="flex flex-col items-center gap-3 shrink-0">
                <div className={`w-16 h-16 md:w-20 md:h-20 rounded-full border ${c.sealRing} flex items-center justify-center relative`}>
                   {/* sealIconColor AYRI bir literal alan — Tailwind'in JIT
                       tarayıcısı yalnızca kaynak dosyada TAM/bitişik geçen
                       sınıf isimlerini yakalar; `${c.iconColor}/30` gibi
                       çalışma zamanında birleştirilen bir sınıf ismi
                       derlenmiş CSS'te asla üretilmez (bkz. kod denetimi). */}
                   <SealIcon className={`w-8 h-8 md:w-10 md:h-10 ${c.sealIconColor} stroke-[1]`} aria-hidden="true" />
                   <div className="absolute inset-0 flex items-center justify-center">
                      <div className={`w-12 h-12 md:w-16 md:h-16 border border-dashed ${c.sealDashedRing} rounded-full animate-[spin_20s_linear_infinite]`} />
                   </div>
                </div>
                <span className={`text-micro ${c.sealLabelColor} font-medium uppercase tracking-[0.3em]`}>RESMİ MÜHÜR</span>
             </div>
             <div className="flex flex-col items-center md:items-end gap-2">
                <span className="text-micro text-text-muted font-medium uppercase tracking-[0.3em]">ONAY MAKAMI</span>
                <span className="text-[14px] text-text-heading font-light font-serif">Stratejik Denetim Kurulu</span>
             </div>
          </div>

          <Button
            variant={c.buttonVariant}
            size="lg"
            onClick={onClose}
            className="mt-4 md:mt-6 tracking-[0.3em] text-micro md:text-caption w-full md:w-auto"
          >
            DİZGEYE DÖN
          </Button>
        </div>
      </motion.div>
    </div>
  );
};
