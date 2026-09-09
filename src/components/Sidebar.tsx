import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { motion } from 'motion/react';
import { CheckSquare, AlertTriangle, LogOut, Users, BarChart3, ShieldCheck, Settings as SettingsIcon, Database } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { triggerHaptic } from '../lib/haptics';
import { cn } from '../lib/utils';
import { User } from '../types';
import { ROLE_LABELS, TAB_ROLES, tabPath, type AppTabId } from '../constants';
import { Logo } from './Logo';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { PremiumIcon } from './ui/PremiumIcon';
import { Avatar } from './ui/Avatar';
import { AboutModal } from './AboutModal';

interface SidebarProps {
  user: User | null;
  onLogout: () => void;
}

interface MenuItem {
  id: AppTabId;
  label: string;
  icon: LucideIcon;
  roles: string[];
}

export const Sidebar = ({ user, onLogout }: SidebarProps) => {
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const resolvedTheme = useResolvedTheme();

  const primaryItems: MenuItem[] = [
    { id: 'dashboard', label: 'Harekat Merkezi', icon: ShieldCheck, roles: TAB_ROLES.dashboard },
    { id: 'tasks', label: 'Talimatlar', icon: CheckSquare, roles: TAB_ROLES.tasks },
    { id: 'blockers', label: 'Engeller', icon: AlertTriangle, roles: TAB_ROLES.blockers },
    { id: 'team', label: 'Kadro', icon: Users, roles: TAB_ROLES.team },
    { id: 'reports', label: 'Raporlar', icon: BarChart3, roles: TAB_ROLES.reports },
  ];

  const systemItems: MenuItem[] = [
    { id: 'audit', label: 'Denetim İzleri', icon: Database, roles: TAB_ROLES.audit },
    { id: 'settings', label: 'Dizge Ayarları', icon: SettingsIcon, roles: TAB_ROLES.settings },
  ];

  const filteredPrimaryItems = primaryItems.filter(item => user && item.roles.includes(user.role));
  const filteredSystemItems = systemItems.filter(item => user && item.roles.includes(user.role));

  // Menü öğeleri <button> + setActiveTab yerine gerçek <NavLink> (yani <a href>):
  // orta tıkla yeni sekmede açma, bağlantıyı kopyalama ve tarayıcı geri tuşu
  // ücretsiz gelir (bkz. kod denetimi P1-6). Aktiflik uiStore'dan değil URL'den
  // türetilir; NavLink `aria-current="page"`'i de kendisi yönetir.
  // `end` verilmez — /tasks/:taskId açıkken "Talimatlar" aktif kalmalı.
  const renderMenuItem = (item: MenuItem) => (
    <NavLink
      key={item.id}
      to={tabPath(item.id)}
      onClick={() => triggerHaptic('light')}
      aria-label={item.label}
      className={({ isActive }) => cn(
        'flex items-center gap-4 px-3.5 py-2.5 rounded-xl transition-all duration-500 group relative border border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
        isActive
          ? 'bg-executive-gold/[0.08] border-executive-gold/15 shadow-[0_8px_32px_rgba(197,160,89,0.05)] translate-x-1'
          : 'hover:bg-surface-glass hover:translate-x-0.5'
      )}
    >
      {({ isActive }) => (
        <>
          <PremiumIcon
            icon={item.icon}
            active={isActive}
            size="sm"
            variant={isActive ? 'gold' : 'glass'}
            aria-hidden
          />
          <span className={cn(
            'font-normal text-body tracking-wide transition-colors duration-300',
            // text-executive-gold (#C5A059) düz metin olarak açık zeminlerde
            // ~2.2:1 kontrast veriyor (axe-core authenticated e2e testi bulgusu)
            // — tema-duyarlı --gold-text token'ı kullanılıyor (bkz. index.css).
            isActive ? 'text-[color:var(--gold-text)] font-medium' : 'text-text-muted group-hover:text-text-body'
          )}>
            {item.label}
          </span>
          {isActive && (
            <motion.div
              layoutId="active-pill"
              className="absolute -left-8 w-1.5 h-6 bg-executive-gold rounded-r-full"
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              aria-hidden="true"
            />
          )}
        </>
      )}
    </NavLink>
  );

  const SidebarContent = (
    <div className="w-64 h-full bg-makam-glass backdrop-blur-[35px] flex flex-col p-6 gap-8 relative overflow-y-auto custom-scrollbar border-r border-surface-border shadow-2xl">
      <div className="relative w-full py-4 px-3 flex justify-center items-center rounded-2xl bg-surface-glass border border-surface-border shadow-[0_8px_32px_rgba(0,0,0,0.15)] overflow-hidden group">
        <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-executive-gold/30 to-transparent opacity-70 pointer-events-none" />

        <button
          onClick={() => {
            triggerHaptic('medium');
            setIsAboutModalOpen(true);
          }}
          className="relative z-10 w-full flex items-center justify-center rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2 transition-transform hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
          aria-label="Dizge Hakkında"
        >
          {/* variant sabit 'dark' idi — light temada bg-surface-glass açık bir
              zemine döndüğünde logo metni (beyaz) neredeyse görünmez oluyordu
              (~1.14:1 kontrast, axe-core authenticated e2e testi bulgusu).
              Login/AboutModal/App.tsx'teki gibi çözümlenmiş temayı izliyor. */}
          <Logo variant={resolvedTheme} size="md" className="drop-shadow-[0_4px_12px_rgba(197,160,89,0.12)]" />
          <div className="absolute -right-2 -top-2 bg-executive-gold text-brand-obsidian text-micro font-bold px-1.5 py-0.5 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300">v2.3.0</div>
        </button>
      </div>

      <nav className="flex flex-col gap-7 flex-1" aria-label="Ana menü">
        <div className="flex flex-col gap-1.5">
          <div className="text-micro text-text-muted font-medium uppercase tracking-caps mb-2 px-2" aria-hidden="true">
            OPERASYON
          </div>
          {filteredPrimaryItems.map(renderMenuItem)}
        </div>

        {filteredSystemItems.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-2 border-t border-surface-border">
            <div className="text-micro text-text-muted font-medium uppercase tracking-caps mb-2 px-2" aria-hidden="true">
              DİZGE
            </div>
            {filteredSystemItems.map(renderMenuItem)}
          </div>
        )}
      </nav>

      <div className="flex flex-col gap-4 pt-6">
        <div className="makam-divider mb-2 opacity-10" />
        <div className="px-4 py-3 flex items-center gap-3 group bg-surface-glass border border-surface-border rounded-2xl shadow-sm transition-all duration-300 hover:bg-makam-glass">
          <Avatar
            name={user?.fullName ?? '?'}
            photoURL={user?.photoURL}
            size="md"
            ring
            className="border-surface-border flex-shrink-0 group-hover:scale-105 transition-all"
          />
          <div className="flex flex-col overflow-hidden gap-1">
            <span className="text-[14px] font-normal text-text-heading truncate tracking-tight leading-none font-display">{user?.fullName}</span>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="w-1 h-1 rounded-full bg-status-success" />
              <span className="text-micro text-[color:var(--gold-text)] font-medium uppercase tracking-caps">{user ? ROLE_LABELS[user.role] : ''}</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            triggerHaptic('medium');
            onLogout();
          }}
          aria-label="Oturumu kapat"
          className="flex items-center justify-center gap-2 px-5 py-3 text-text-tertiary hover:text-status-danger hover:bg-status-danger/10 rounded-full transition-all group font-medium text-caption uppercase tracking-label border border-surface-border hover:border-status-danger/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
        >
          <LogOut className="w-4 h-4 transition-transform group-hover:-translate-x-1" aria-hidden="true" />
          <span>Oturumu Kapat</span>
        </button>

        <button
          onClick={() => setIsAboutModalOpen(true)}
          className="mt-2 text-micro text-text-tertiary/60 hover:text-[color:var(--gold-text)] transition-colors font-medium tracking-widest uppercase text-center"
        >
          MAKAM v2.3.0
        </button>
      </div>

      <AboutModal isOpen={isAboutModalOpen} onClose={() => setIsAboutModalOpen(false)} />
    </div>
  );

  return (
    <aside className="hidden lg:flex w-64 h-screen fixed left-0 top-0 z-40">
      {SidebarContent}
    </aside>
  );
};
