import React from 'react';
import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck, CheckSquare, AlertTriangle,
  Users, BarChart3, MoreHorizontal, Settings, Database,
  LogOut
} from 'lucide-react';
import { cn } from '../lib/utils';
import { User } from '../types';
import { triggerHaptic } from '../lib/haptics';
import { TAB_ROLES, tabPath, type AppTabId } from '../constants';
import { useModalBehavior } from './ui/Modal';

interface DockItem {
  id: AppTabId;
  label: string;
  icon: React.ElementType;
  roles: string[];
}

// Sıra = örtük öncelik: MAX_VISIBLE'ı aşan roller (bugün yalnızca Admin, 7
// modül) burada önce gelen öğeleri birincil barda tutar, geri kalanı "Daha
// Fazla"ya düşer. Yeni bir modül eklerken veya bir role yeni bir sekme
// verirken bu sırayı gözden geçirin — örn. TAB_ROLES.manager'a 5. bir sekme
// eklenirse (bugün Manager tam MAX_VISIBLE=4'te, overflow'suz), en sık
// kullanılan sekmenin burada hâlâ ilk 4 içinde kaldığından emin olun (bkz.
// mobil tasarım denetimi).
const ALL_ITEMS: DockItem[] = [
  { id: 'dashboard', label: 'Harekat',   icon: ShieldCheck,   roles: TAB_ROLES.dashboard },
  { id: 'tasks',     label: 'Talimatlar', icon: CheckSquare,  roles: TAB_ROLES.tasks },
  { id: 'blockers',  label: 'Engeller',  icon: AlertTriangle, roles: TAB_ROLES.blockers },
  { id: 'team',      label: 'Kadro',     icon: Users,         roles: TAB_ROLES.team },
  { id: 'reports',   label: 'Raporlar',  icon: BarChart3,     roles: TAB_ROLES.reports },
  { id: 'audit',     label: 'Denetim',   icon: Database,      roles: TAB_ROLES.audit },
  { id: 'settings',  label: 'Ayarlar',   icon: Settings,      roles: TAB_ROLES.settings },
];

const MAX_VISIBLE = 4;

interface MobileDockProps {
  user: User | null;
  onLogout: () => void;
  /** Bekleyen bildirim sayısı — bugün tamamı görev kaynaklı olduğundan
   *  (bkz. NotificationPanel'in /tasks/:taskId yönlendirmesi) rozet yalnızca
   *  'tasks' öğesinde gösterilir. */
  notificationCount?: number;
}

export const MobileDock = ({ user, onLogout, notificationCount = 0 }: MobileDockProps) => {
  const [showMore, setShowMore] = React.useState(false);
  const overflowPanelRef = React.useRef<HTMLDivElement>(null);
  // NavLink bir <a> render eder — overflow panelinin açılış odağı için ref tipi
  // de HTMLAnchorElement olmalı (eskiden <button> idi).
  const firstOverflowItemRef = React.useRef<HTMLAnchorElement>(null);

  const filtered = ALL_ITEMS.filter(item => user && item.roles.includes(user.role));
  const primary  = filtered.slice(0, MAX_VISIBLE);
  const overflow = filtered.slice(MAX_VISIBLE);
  const hasMore  = overflow.length > 0;
  const badges: Partial<Record<string, number>> = notificationCount > 0 ? { tasks: notificationCount } : {};
  // Staff gibi düşük modül sayılı roller (bugün 2 sekme: Harekat, Talimatlar)
  // barı eskiden uçtan uca (left-4 right-4) flex-1 ile eşit paylaştırıyordu —
  // 2 öğe her biri barın yaklaşık yarısını kaplayıp aralarında büyük, dengesiz
  // bir boşluk bırakıyordu (bkz. mobil tasarım denetimi). Az öğe sayısında
  // (≤3) bar artık içeriğe göre daralıp ortalanıyor — segmented-control
  // görünümüne yakın, premium mobil nav'larda alışılan davranış.
  const itemCount = primary.length + (hasMore ? 1 : 0);
  const isCompact = itemCount <= 3;

  // Overflow paneli görsel olarak bir backdrop + kart taşıyan tam teşekküllü
  // bir modal — ui/Modal'ın "ortak modal davranışı"nı (Escape ile kapatma,
  // Tab focus-trap, açılışta odaklama) paylaşır; eskiden bu panelde hiçbiri
  // yoktu (bkz. mobil tasarım denetimi, Tutarlılık bulgusu).
  useModalBehavior({
    isOpen: showMore,
    onClose: () => setShowMore(false),
    containerRef: overflowPanelRef,
    initialFocusRef: firstOverflowItemRef,
  });

  // Gezinmenin kendisini artık NavLink yapıyor (bkz. Sidebar'daki aynı gerekçe)
  // — burada yalnızca dokunsal geri bildirim ve overflow panelinin kapanışı kalır.
  const handleSelect = () => {
    triggerHaptic('light');
    setShowMore(false);
  };

  return (
    <>
      {/* Overflow "Daha Fazla" Panel */}
      <AnimatePresence>
        {showMore && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMore(false)}
              aria-hidden="true"
              className="fixed inset-0 bg-executive-blue/20 backdrop-blur-sm z-[70] lg:hidden"
            />

            {/* Overflow panel — sağ alt köşeden yukarı fırlar */}
            <motion.div
              ref={overflowPanelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Ek Modüller"
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.96 }}
              transition={{ type: 'spring', damping: 24, stiffness: 320 }}
              className="fixed bottom-24 right-4 left-auto z-[80] lg:hidden
                         bg-makam-glass backdrop-blur-3xl backdrop-saturate-[180%]
                         border border-surface-border
                         rounded-[22px] shadow-sheet
                         overflow-hidden min-w-[190px] max-w-[calc(100vw-2rem)]"
            >
              {/* Panel başlık */}
              <div className="px-4 py-2.5 border-b border-executive-blue/[0.04]">
                <span className="text-micro text-text-muted/70 uppercase tracking-label font-medium truncate block">
                  Ek Modüller
                </span>
              </div>

              {overflow.map((item, index) => {
                const Icon = item.icon;
                const badgeCount = badges[item.id];
                return (
                  <NavLink
                    key={item.id}
                    to={tabPath(item.id)}
                    ref={index === 0 ? firstOverflowItemRef : undefined}
                    onClick={handleSelect}
                    aria-label={badgeCount ? `${item.label}, ${badgeCount} bekleyen bildirim` : item.label}
                    className={({ isActive }) => cn(
                      'flex items-center gap-3 w-full px-4 py-3.5 touch-manipulation transition-all duration-200 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-inset',
                      isActive
                        ? 'bg-executive-blue/5 text-executive-blue'
                        : 'text-text-muted hover:bg-executive-blue/[0.03] hover:text-text-heading'
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        <Icon
                          className={cn(
                            'w-4 h-4 flex-shrink-0',
                            isActive ? 'text-executive-blue' : 'text-text-muted/75'
                          )}
                          strokeWidth={isActive ? 2 : 1.5}
                          aria-hidden={true}
                        />
                        <span className="text-body-sm font-medium tracking-wide flex-1 min-w-0 truncate">
                          {item.label}
                        </span>
                        {Boolean(badgeCount) && (
                          <span
                            aria-hidden="true"
                            className="flex-shrink-0 min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full bg-status-danger text-[color:var(--status-danger-text)] text-micro font-bold leading-none"
                          >
                            {badgeCount! > 9 ? '9+' : badgeCount}
                          </span>
                        )}
                        {isActive && (
                          <span className="w-1.5 h-1.5 rounded-full bg-executive-gold flex-shrink-0" aria-hidden="true" />
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}

              {/* Ayraç + Çıkış */}
              <div className="border-t border-executive-blue/[0.04]">
                <button
                  onClick={onLogout}
                  className="flex items-center gap-3 w-full px-4 py-3.5 touch-manipulation transition-all duration-200
                             text-status-danger/70 hover:text-status-danger hover:bg-status-danger/10"
                >
                  <LogOut className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />
                  <span className="text-body-sm font-medium tracking-wide min-w-0 truncate">Oturumu Kapat</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ─── DOCK BAR ───────────────────────────────────────────────── */}
      <nav
        className="fixed bottom-4 left-4 right-4 z-[60] lg:hidden touch-manipulation"
        aria-label="Mobil navigasyon"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom) - 12px, 0px)' }}
      >
        <div
          className={cn(
            // gap-1(4px)->1.5(6px): dar telefonlarda bitişik öğeye yanlış
            // dokunma riskini azaltmak için (bkz. mobil dokunma hassasiyeti
            // denetimi) — Apple HIG/Material'ın önerdiği ≥8px'e yaklaştırır.
            'flex items-stretch gap-1.5 px-2.5 sm:px-3 py-1.5',
            'bg-makam-glass backdrop-blur-[30px] backdrop-saturate-[180%]',
            'border border-surface-border',
            'rounded-[28px]',
            'shadow-[0_12px_40px_-10px_rgba(22,21,19,0.08),0_0_0_0.5px_rgba(22,21,19,0.04)]',
            isCompact && 'mx-auto w-fit'
          )}
        >
          {primary.map((item) => {
            const Icon = item.icon;
            const badgeCount = badges[item.id];
            return (
              <NavLink
                key={item.id}
                to={tabPath(item.id)}
                onClick={handleSelect}
                aria-label={badgeCount ? `${item.label}, ${badgeCount} bekleyen bildirim` : item.label}
                // Aktif görünüm bu sınıflarda değil, içerideki motion.div
                // zemininde/ikon renklerinde ifade ediliyor — className
                // callback'i isActive'e ihtiyaç duymaz.
                className={cn(
                  'flex flex-col items-center justify-center',
                  // min-h-12(48px): Material'ın dokunma hedefi eşiğini açıkça
                  // garanti eder (mevcut py-2.5+ikon+etiket yüksekliğiyle
                  // görsel fark yaratmaz). active:duration-75: büzülme geri
                  // bildirimi renk/zemin geçişinin 300ms'inden bağımsız
                  // hızlansın diye — aksi halde dokunuş "gecikmeli" hissediyor.
                  'gap-1 py-2.5 min-h-12 rounded-xl transition-all duration-300 active:duration-75',
                  'relative min-w-0 group touch-manipulation active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-1',
                  isCompact ? 'w-20 sm:w-24 shrink-0' : 'flex-1 px-0.5 sm:px-1'
                )}
              >
                {({ isActive }) => (
                  <>
                    {/* Aktif zemin */}
                    {isActive && (
                      <motion.div
                        layoutId="dock-active-bg"
                        className="absolute inset-0 bg-executive-blue/[0.07] rounded-xl"
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                        aria-hidden="true"
                      />
                    )}

                    {/* İkon */}
                    <div className="relative flex items-center justify-center w-6 h-6" aria-hidden="true">
                      <motion.div
                        animate={{ scale: isActive ? 1.12 : 1 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                      >
                        <Icon
                          className={cn(
                            'w-5 h-5 transition-colors duration-300',
                            isActive ? 'text-executive-blue' : 'text-text-muted/70 group-hover:text-text-muted'
                          )}
                          strokeWidth={isActive ? 2 : 1.5}
                        />
                      </motion.div>

                      {/* Gold aktif nokta */}
                      <AnimatePresence>
                        {isActive && (
                          <motion.span
                            key="dot"
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0, opacity: 0 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                            className="absolute -top-0.5 -right-0.5
                                       w-1.5 h-1.5 rounded-full bg-executive-gold
                                       shadow-[0_0_6px_rgba(197,160,89,0.5)]"
                          />
                        )}
                      </AnimatePresence>

                      {/* Bekleyen bildirim rozeti — aktif noktayla çakışmaması için
                          karşı köşede (bkz. mobil tasarım denetimi). */}
                      {Boolean(badgeCount) && (
                        <span
                          aria-hidden="true"
                          className="absolute -top-1 -left-1.5 min-w-[15px] h-[15px] px-[3px]
                                     flex items-center justify-center rounded-full
                                     bg-status-danger text-[color:var(--status-danger-text)] text-micro font-bold leading-none"
                        >
                          {badgeCount! > 9 ? '9+' : badgeCount}
                        </span>
                      )}
                    </div>

                    {/* Etiket */}
                    <span
                      className={cn(
                        'text-micro sm:text-caption font-medium tracking-normal sm:tracking-wide truncate leading-none transition-colors duration-300 max-w-full',
                        isActive ? 'text-executive-blue' : 'text-text-muted/70 group-hover:text-text-muted'
                      )}
                      aria-hidden="true"
                    >
                      {item.label}
                    </span>
                  </>
                )}
              </NavLink>
            );
          })}

          {/* "Daha Fazla" butonu — sadece overflow varsa */}
          {hasMore && (
            <button
              onClick={() => {
                triggerHaptic('light');
                setShowMore(prev => !prev);
              }}
              aria-label={showMore ? 'Ek modülleri gizle' : 'Ek modülleri göster'}
              aria-expanded={showMore}
              aria-haspopup="true"
              className={cn(
                'flex flex-col items-center justify-center',
                'gap-1 py-2.5 min-h-12 rounded-xl transition-all duration-300 active:duration-75',
                'relative min-w-0 group touch-manipulation active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-1',
                isCompact ? 'w-20 sm:w-24 shrink-0' : 'flex-1 px-0.5 sm:px-1'
              )}
            >
              {showMore && (
                <motion.div
                  layoutId="dock-active-bg"
                  className="absolute inset-0 bg-executive-blue/[0.07] rounded-xl"
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  aria-hidden="true"
                />
              )}

              <motion.div animate={{ rotate: showMore ? 90 : 0 }} transition={{ duration: 0.2 }} aria-hidden="true">
                <MoreHorizontal
                  className={cn(
                    'w-5 h-5 transition-colors duration-300',
                    showMore ? 'text-executive-blue' : 'text-text-muted/70 group-hover:text-text-muted'
                  )}
                  strokeWidth={1.5}
                />
              </motion.div>

              <span
                aria-hidden="true"
                className={cn(
                  'text-micro sm:text-caption font-medium tracking-normal sm:tracking-wide leading-none transition-colors duration-300',
                  showMore ? 'text-executive-blue' : 'text-text-muted/70 group-hover:text-text-muted'
                )}
              >
                Diğer
              </span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
};
