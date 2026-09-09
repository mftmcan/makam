import React, { useState } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { GuideModal } from './GuideModal';
import { Clock, CloudOff, ShieldCheck, KeyRound, BookOpen } from 'lucide-react';
import { Logo } from './Logo';
import { motion } from 'motion/react';
import { useResolvedTheme } from '../hooks/useResolvedTheme';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Her madde codebase'te GERÇEKTEN uygulanmış bir davranışa karşılık gelir
 *  (bkz. parantez içi referanslar) — pazarlama dili veya teknoloji adı
 *  (Zustand/IndexedDB gibi) DEĞİL, kullanıcının fiilen deneyimlediği
 *  yetenek anlatılır (bkz. tasarım denetimi: eski liste "Çevrimdışı Öncelikli
 *  Motor — Zustand & IndexedDB" gibi geliştirici-taraflı ifadeler taşıyordu). */
const FEATURES = [
  { icon: Clock, title: 'Talimat & Mühlet Takibi', desc: 'Önceliğe göre mesai-saatli mühlet otomatik hesaplanır, gecikme ve krizler anında görünür olur.' },
  { icon: CloudOff, title: 'Çevrimdışı Çalışma', desc: 'Bağlantı kesilse de çalışmaya devam edersiniz; değişiklikler bağlantı gelince otomatik senkronize olur.' },
  { icon: ShieldCheck, title: 'Değişmez Denetim İzi', desc: 'Durum değişikliği, atama ve düzenleme gibi her işlem kalıcı kaydedilir, geriye dönük sorgulanabilir.' },
  { icon: KeyRound, title: 'Rol Bazlı Yetkilendirme', desc: 'Müftü, Müdür ve Memur rollerine göre görünürlük ve yetkiler ayrı ayrı uygulanır.' },
] as const;

const EASE = [0.16, 1, 0.3, 1] as const;

export const AboutModal = ({ isOpen, onClose }: AboutModalProps) => {
  const resolvedTheme = useResolvedTheme();
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="" ariaLabel="Hakkında" size="md">
        <div className="flex flex-col items-center justify-center text-center p-2 gap-7 relative">
          {/* Amblem arkasında yumuşak altın hâle — sessiz lüks vurgusu */}
          <div
            aria-hidden="true"
            className="absolute top-2 left-1/2 -translate-x-1/2 w-40 h-40 bg-executive-gold/[0.09] rounded-full blur-[48px] pointer-events-none -z-10"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: EASE }}
          >
            <Logo size="xl" withText={false} variant={resolvedTheme} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
            className="flex flex-col items-center gap-2"
          >
            <h2 className="text-2xl font-display text-text-heading tracking-tight">MAKAM Stratejik Yönetim</h2>
            <div className="w-10 h-px bg-gradient-to-r from-transparent via-executive-gold/60 to-transparent" />
            <span className="text-micro uppercase tracking-caps text-[color:var(--gold-text)] font-medium mt-1">Sürüm v2.3.0</span>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.28 }}
            className="text-body text-text-muted leading-relaxed max-w-sm"
          >
            MAKAM; müftülük bünyesindeki talimatların verilmesinden icrasına, mühlet
            takibinden denetim iziyle arşivlenmesine kadar tüm süreci{' '}
            <strong className="text-text-heading font-medium">tek bir dizgede</strong> birleştirir.
          </motion.p>

          <div className="w-full bg-surface-glass rounded-2xl border border-surface-border p-5 mt-1 backdrop-blur-2xl shadow-inner">
            <ul className="flex flex-col gap-0.5">
              {FEATURES.map(({ icon: Icon, title, desc }, i) => (
                <motion.li
                  key={title}
                  initial={{ opacity: 0, x: -14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, delay: 0.35 + i * 0.08, ease: EASE }}
                  whileHover={{ x: 4 }}
                  className="group flex items-center gap-3.5 text-left py-2"
                >
                  <div className="w-9 h-9 shrink-0 rounded-full bg-surface-base/60 border border-makam-border/10 flex items-center justify-center text-[color:var(--gold-text)] shadow-inner transition-all duration-500 group-hover:bg-executive-gold group-hover:text-[color:var(--btn-primary-text)]">
                    <Icon className="w-4 h-4 stroke-[1.4]" aria-hidden="true" />
                  </div>
                  <span className="text-body-sm leading-tight text-text-heading">
                    <strong className="block font-medium">{title}</strong>
                    <span className="text-text-muted font-light">{desc}</span>
                  </span>
                </motion.li>
              ))}
            </ul>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.65 }}
          >
            <Button variant="secondary" size="sm" onClick={() => { onClose(); setIsGuideOpen(true); }}>
              <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
              Kılavuzu Aç
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.75 }}
            className="text-micro uppercase tracking-widest font-light text-text-tertiary"
          >
            © {new Date().getFullYear()} MAKAM. Destek: <a href="mailto:muftum@gmail.com" className="hover:text-text-muted transition-colors">muftum@gmail.com</a>
          </motion.div>
        </div>
      </Modal>

      <GuideModal isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />
    </>
  );
};
