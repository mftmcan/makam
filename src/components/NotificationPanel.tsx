import React, { useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTaskNavigation } from '../hooks/useTaskRoute';
import { useModalBehavior } from './ui/Modal';
import type { Notification } from '../types';

interface Props {
  isNotificationsOpen: boolean;
  setIsNotificationsOpen: (show: boolean) => void;
  notifRef: React.RefObject<HTMLDivElement | null>;
  notifications: Notification[];
  /** useAppHandlers üzerinden — bu bileşen artık notificationService'i
   *  doğrudan çağırmıyor (bkz. kod denetimi: "okundu işaretleme" bir yazma
   *  işlemidir ve merkezi handler katmanını atlamamalıdır). */
  markNotificationRead: (notificationId: string) => Promise<void>;
  /** Yalnızca panelde GERÇEKTEN gösterilen bildirimlerin id'leri işaretlenir
   *  (bkz. kod denetimi: sunucudan bağımsız "tümünü getir" sorgusu, panelin
   *  limit(5) ile sınırlı görünümünün dışında kalan hiç görülmemiş bir
   *  bildirimi — ör. eski bir Kriz uyarısını — sessizce kaybedebiliyordu). */
  markAllNotificationsRead: (notificationIds: string[]) => Promise<void>;
}

export function NotificationPanel({
  isNotificationsOpen,
  setIsNotificationsOpen,
  notifRef,
  notifications,
  markNotificationRead,
  markAllNotificationsRead,
}: Props) {
  // Bildirim tıklaması artık DERİN LİNK üretir: eskiden uiStore'a
  // `setSelectedTaskId(id)` + `setActiveTab('tasks')` yazılıyordu, bu yüzden
  // bildirimden açılan bir talimat paylaşılamıyor ve sayfa yenilenince
  // kayboluyordu (bkz. kod denetimi P1-6).
  const { openTask, goToTab } = useTaskNavigation();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Escape ile kapatma, Tab focus-trap ve açılışta odaklama — eskiden bu
  // panel yalnızca dışa tıklama dinleyicisine sahipti (bkz. tasarım denetimi
  // F13: MobileDock/DatePicker aynı paylaşılan davranışı kullanırken bu panel
  // dışarıda kalmıştı — Escape ile kapanmayan bir panel klavye kullanıcısını
  // kilitliyordu).
  useModalBehavior({
    isOpen: isNotificationsOpen,
    onClose: () => setIsNotificationsOpen(false),
    containerRef: notifRef,
    initialFocusRef: closeButtonRef,
  });

  // Dışa tıklayınca kapatma — useModalBehavior bunu kapsamaz (bkz. Modal.tsx:
  // tam modallarda bu, ayrı bir backdrop elemanının onClick'iyle yapılır;
  // bu panelin backdrop'u yok, DatePicker'daki AYNI mousedown deseni kullanılır).
  useEffect(() => {
    if (!isNotificationsOpen) return;
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setIsNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isNotificationsOpen, setIsNotificationsOpen, notifRef]);

  if (!isNotificationsOpen) return null;

  return (
    <div
      ref={notifRef}
      role="dialog"
      aria-modal="true"
      aria-label="Bekleyen Kurumsal Talimatlar"
      className="fixed top-16 lg:top-20 right-3 lg:right-8 z-[200]
                 w-[calc(100vw-24px)] max-w-sm lg:max-w-md
                 bg-surface-elevated backdrop-blur-2xl
                 border border-surface-border
                 rounded-2xl
                 shadow-popover
                 overflow-hidden"
    >
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-executive-blue/[0.04] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-status-danger" />
          <span className="text-micro font-medium text-status-danger uppercase tracking-eyebrow">
            Bekleyen Kurumsal Talimatlar
          </span>
        </div>
        <button
          ref={closeButtonRef}
          onClick={async (e) => {
            e.stopPropagation();
            await markAllNotificationsRead(notifications.map(n => n.id));
            setIsNotificationsOpen(false);
          }}
          className="text-micro text-text-tertiary hover:text-executive-blue uppercase tracking-caps font-medium transition-colors px-2 py-1 rounded-lg hover:bg-surface-glass"
        >
          Tamamını Okundu Say
        </button>
      </div>

      {/* Notification list */}
      <div className="max-h-[60vh] lg:max-h-80 overflow-y-auto divide-y divide-makam-border/30">
        {notifications.map(n => {
          const isCrisis  = n.type === 'Crisis';
          const isWarning = n.type === 'Warning';
          const hasTask   = Boolean(n.taskId);
          return (
            <div key={n.id} className="flex flex-col gap-2 px-4 py-3 hover:bg-surface-glass transition-colors">
              <div className="flex items-start gap-2.5">
                <div className={cn(
                  'w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
                  isCrisis  ? 'bg-status-danger/10 text-status-danger' :
                  isWarning ? 'bg-executive-gold/10 text-[color:var(--gold-text)]' :
                  'bg-executive-blue/5 text-executive-blue'
                )}>
                  <AlertCircle className="w-3 h-3" />
                </div>
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={cn(
                      'text-micro font-bold uppercase tracking-eyebrow px-1.5 py-0.5 rounded-full',
                      isCrisis  ? 'bg-status-danger/20 text-status-danger' :
                      isWarning ? 'bg-executive-gold/10 text-[color:var(--gold-text)]' :
                      'bg-executive-blue/5 text-executive-blue'
                    )}>
                      {isCrisis ? '🚨 KRİZ' : isWarning ? '⚠ UYARI' : 'ℹ BİLGİ'}
                    </span>
                    <span className="text-caption font-medium text-executive-blue line-clamp-1 leading-tight">
                      {n.title}
                    </span>
                  </div>
                  <p className="text-micro text-text-muted leading-relaxed line-clamp-3">
                    {n.message}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between pl-8 gap-2">
                <span className="text-micro text-text-tertiary uppercase tracking-caps">
                  {isCrisis
                    ? "→ Talimatlar'da atıl talimatları denetleyin"
                    : hasTask
                    ? '→ Talimata erişmek için tıklayın'
                    : '→ Üst makam müdahalesi gerekiyor'}
                </span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {hasTask && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        openTask(n.taskId!);
                        await markNotificationRead(n.id);
                        setIsNotificationsOpen(false);
                      }}
                      className="px-2.5 py-1 text-micro font-medium text-[color:var(--executive-blue-text)] bg-executive-blue rounded-lg uppercase tracking-caps hover:opacity-85 transition-opacity"
                    >
                      Talimata Git
                    </button>
                  )}
                  {isCrisis && !hasTask && (
                    <button
                      onClick={(e) => { e.stopPropagation(); goToTab('tasks'); setIsNotificationsOpen(false); }}
                      className="px-2.5 py-1 text-micro font-medium text-[color:var(--status-danger-text)] bg-status-danger rounded-lg uppercase tracking-caps hover:opacity-85 transition-opacity"
                    >
                      Talimatlara Git
                    </button>
                  )}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      await markNotificationRead(n.id);
                    }}
                    className="px-2.5 py-1 text-micro font-medium text-text-tertiary bg-surface-glass border border-surface-border rounded-lg uppercase tracking-caps hover:text-executive-blue hover:bg-surface-elevated transition-colors"
                  >
                    Okundu
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Panel footer */}
      <div className="px-4 py-2.5 border-t border-executive-blue/[0.04] bg-surface-glass">
        <p className="text-micro text-text-tertiary uppercase tracking-caps text-center">
          Okundu sayılan talimatlar listeden kaldırılır
        </p>
      </div>
    </div>
  );
}
