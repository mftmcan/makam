import React from 'react';
import { Modal } from './ui/Modal';
import { ShieldCheck, Smartphone, Zap, Layout } from 'lucide-react';
import { Logo } from './Logo';
import { motion } from 'motion/react';
import { useResolvedTheme } from '../hooks/useResolvedTheme';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FEATURES = [
  { icon: Zap, title: 'Çevrimdışı Öncelikli Motor', desc: 'Zustand & IndexedDB' },
  { icon: Layout, title: 'Sessiz Lüks Arayüz', desc: 'Dinamik Gece Teması & Framer Motion' },
  { icon: ShieldCheck, title: 'Kalite Güvence', desc: 'Playwright E2E Otomasyonu' },
  { icon: Smartphone, title: 'Çoklu Platform', desc: 'PWA Destekli Adaptif Mimari' },
] as const;

const EASE = [0.16, 1, 0.3, 1] as const;

export const AboutModal = ({ isOpen, onClose }: AboutModalProps) => {
  const resolvedTheme = useResolvedTheme();
  return (
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
          <h2 className="text-2xl font-serif text-text-heading tracking-tight">MAKAM Stratejik Yönetim</h2>
          <div className="w-10 h-px bg-gradient-to-r from-transparent via-executive-gold/60 to-transparent" />
          <div className="flex items-center justify-center gap-2 mt-1">
            <span className="text-micro uppercase tracking-[0.22em] text-[color:var(--gold-text)] font-medium">Sürüm v2.3.0</span>
            <span className="text-micro text-text-muted">•</span>
            <span className="flex items-center gap-1.5 text-micro uppercase tracking-widest text-status-success font-medium">
              <span className="w-1 h-1 rounded-full bg-status-success" aria-hidden="true" />
              Lisanslı Sürüm
            </span>
          </div>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.7, delay: 0.28 }}
          className="text-body text-text-muted leading-relaxed max-w-sm"
        >
          Bu dizge, stratejik verileri minimum gecikme ve maksimum güvenlikle işlemek üzere tasarlanmış <strong className="text-text-heading font-medium">dünya standartlarında</strong> bir mimari üzerine inşa edilmiştir.
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
                  <span className="text-text-muted">{desc}</span>
                </span>
              </motion.li>
            ))}
          </ul>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.7 }}
          className="mt-1 text-micro uppercase tracking-widest font-light text-text-tertiary"
        >
          © {new Date().getFullYear()} MAKAM. Yasal Hak Sahibi: <a href="mailto:muftum@gmail.com" className="hover:text-text-muted transition-colors">muftum@gmail.com</a>
        </motion.div>
      </div>
    </Modal>
  );
};
