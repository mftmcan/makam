import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

/* ── Modal Stack ─────────────────────────────────────────────────────────
   Birden fazla modal iç içe açıldığında (ör. detay modalı içindeki silme
   onayı):
   - Escape ve focus-trap yalnızca en üstteki (son açılan) modal tarafından
     yönetilir,
   - body scroll kilidi yalnızca stack tamamen boşalınca kaldırılır
     (ref-count mantığı). */
let modalStack: symbol[] = [];

/** Takvim gibi `useModalBehavior` kullanmayan hafif açılır panellerin de aynı
 *  "yalnızca en üstteki Escape'i işler" kuralına katılabilmesi için dışa
 *  açılan yardımcılar (bkz. DatePicker.tsx). */
export const pushModalStack = (id: symbol) => { modalStack.push(id); };
export const popModalStack = (id: symbol) => { modalStack = modalStack.filter(entry => entry !== id); };
export const isTopOfModalStack = (id: symbol) => modalStack[modalStack.length - 1] === id;

interface ModalBehaviorOptions {
  isOpen: boolean;
  onClose: () => void;
  /** Focus-trap'in içinde dolaşacağı modal paneli */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Modal açıldığında odaklanılacak eleman (genellikle kapat butonu) */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * `#root`'u (arka plandaki uygulama) inert yapar. YALNIZCA `document.body`'ye
   * portal edilen (bkz. `createPortal`) tam modallar için `true` verin — bu
   * hook'u paylaşan MobileDock/FormalDocumentModal gibi `#root` İÇİNDE render
   * olan hafif paneller için `true` verilirse panelin kendi içeriği de inert
   * olup tamamen etkileşimsiz kalır (bkz. tasarım denetimi F33). Varsayılan
   * `false`.
   */
  applyInert?: boolean;
}

/**
 * Ortak modal davranışı: Escape ile kapatma, focus-trap, body scroll kilidi
 * ve açılışta odaklama. `ui/Modal` shell'ini kullanmayan tam-özel modallar
 * (CertificateModal, WarningModal) da bu hook'u paylaşır.
 */
export const useModalBehavior = ({ isOpen, onClose, containerRef, initialFocusRef, applyInert = false }: ModalBehaviorOptions) => {
  const idRef = useRef<symbol | null>(null);
  if (idRef.current === null) idRef.current = Symbol('modal');

  // onClose her render'da değişebilir; listener'ı yeniden bağlamamak için ref'te tut
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return;
    const id = idRef.current!;
    modalStack.push(id);
    document.body.style.overflow = 'hidden';
    // Arka plandaki uygulama içeriği (#root) ekran okuyucular için erişilebilir
    // kalıyordu — aria-modal="true" bunu VoiceOver gibi bazı tarayıcı/AT
    // kombinasyonlarında engellemiyor (bkz. tasarım denetimi F33). Scroll
    // kilidiyle aynı ref-count mantığı: yalnızca İLK modal açıldığında inert
    // eklenir, yalnızca SON modal kapandığında kaldırılır. applyInert=false
    // olan çağıranlar (#root İÇİNDE render olanlar) bu adımı atlar.
    const rootEl = applyInert ? document.getElementById('root') : null;
    if (rootEl && modalStack.length === 1) rootEl.setAttribute('inert', '');

    const handleKeyDown = (e: KeyboardEvent) => {
      // Yalnızca en üstteki modal klavye olaylarını yönetir
      if (modalStack[modalStack.length - 1] !== id) return;

      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }

      // Focus Trap: Tab tuşu modal içinde dolaşır, dışına çıkmaz
      if (e.key === 'Tab' && containerRef.current) {
        const candidates = containerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        );
        // Sekmeli modallarda (ör. TaskDetails) pasif sekmenin içeriği DOM'da
        // kalıp yalnızca CSS ile gizlenebiliyor — offsetParent null kontrolü
        // olmadan seçici bu görünmez elemanları da yakalayıp Tab döngüsünü
        // ekranda hiç görünmeyen bir alana kilitleyebiliyordu (bkz. kod
        // denetimi). aria-hidden olan (dekoratif ikon vb.) elemanlar zaten
        // doğal olarak tabindex taşımadığından burada ayrıca elenmesi gerekmez.
        const focusable = Array.from(candidates).filter(el => el.offsetParent !== null);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    const focusTimer = window.setTimeout(() => initialFocusRef?.current?.focus(), 50);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      modalStack = modalStack.filter(entry => entry !== id);
      // Scroll kilidi ve inert yalnızca son modal kapanınca kalkar
      if (modalStack.length === 0) {
        document.body.style.overflow = '';
        rootEl?.removeAttribute('inert');
      }
    };
    // containerRef ve initialFocusRef sabit ref nesneleridir
  }, [isOpen]);
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** title boş bırakıldığında dialog'un erişilebilir adı (aria-label) olarak kullanılır. */
  ariaLabel?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  layoutId?: string;
}

let modalIdCounter = 0;

export const Modal = ({ isOpen, onClose, title, ariaLabel, children, footer, size = 'md', layoutId }: ModalProps) => {
  const [mounted, setMounted] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  // Her modal için benzersiz ID (aria-labelledby için)
  const [modalId] = useState(() => `modal-title-${++modalIdCounter}`);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Escape, focus-trap, scroll-lock ve açılış odağı (paylaşılan davranış).
  // applyInert: true — bu bileşen document.body'ye portal edildiği için #root
  // (arka plandaki uygulama) güvenle inert yapılabilir (bkz. F33).
  useModalBehavior({ isOpen, onClose, containerRef: modalRef, initialFocusRef: closeButtonRef, applyInert: true });

  const sizes: Record<string, string> = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-3xl',
    xl: 'max-w-5xl',
    full: 'max-w-[92vw]'
  };

  const content = (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[100] overflow-y-auto"
          role="dialog"
          aria-modal="true"
          {...(title ? { 'aria-labelledby': modalId } : { 'aria-label': ariaLabel })}
        >
          <div className="flex min-h-full items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={onClose}
              aria-hidden="true"
              className="fixed inset-0 bg-executive-blue/20 backdrop-blur-md -z-10"
            />

            {/* Modal panel */}
            <motion.div
              layoutId={layoutId}
              ref={modalRef}
              initial={{ opacity: 0, scale: 0.98, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 15 }}
              transition={{ type: 'spring', damping: 30, stiffness: 400 }}
              className={cn(
                'relative z-10 w-full !p-0 overflow-hidden flex flex-col max-h-[90vh]',
                'shadow-[0_40px_100px_-20px_rgba(0,0,0,0.1)]',
                'bg-surface-elevated backdrop-blur-[40px] border border-surface-border rounded-[40px]',
                sizes[size]
              )}
            >
              {/* Header — title boşsa (ör. About modal) tam genişlikte boş bir
                  şerit yerine, kapat butonu doğrudan panelin köşesinde yüzer. */}
              {title ? (
                <div className="flex items-center justify-between px-6 py-4 border-b border-makam-border/5 shrink-0">
                  <h3
                    id={modalId}
                    className="text-[20px] font-light text-text-heading tracking-tight font-serif uppercase"
                  >
                    {title}
                  </h3>
                  <button
                    ref={closeButtonRef}
                    onClick={onClose}
                    aria-label={`${title} penceresini kapat`}
                    className="w-10 h-10 flex items-center justify-center text-text-muted hover:text-executive-blue hover:bg-surface-glass transition-all rounded-full border border-transparent hover:border-makam-border/10 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2"
                  >
                    <X className="w-5 h-5 stroke-[1.2]" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <button
                  ref={closeButtonRef}
                  onClick={onClose}
                  aria-label={ariaLabel ? `${ariaLabel} penceresini kapat` : 'Kapat'}
                  className="absolute top-3 right-3 z-10 w-10 h-10 flex items-center justify-center text-text-muted hover:text-executive-blue hover:bg-surface-glass transition-all rounded-full border border-transparent hover:border-makam-border/10 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2"
                >
                  <X className="w-5 h-5 stroke-[1.2]" aria-hidden="true" />
                </button>
              )}

              {/* İçerik */}
              <div className="flex-1 overflow-y-auto p-5 scroll-smooth custom-scrollbar">
                {children}
              </div>

              {footer && (
                <div className="px-8 py-6 border-t border-makam-border/5 bg-surface-border/30 shrink-0">
                  {footer}
                </div>
              )}
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );

  if (!mounted) return null;

  return createPortal(content, document.body);
};
