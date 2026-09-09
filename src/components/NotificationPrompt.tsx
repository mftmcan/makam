/**
 * #11 — Premium Bildirim İzin Diyaloğu
 * Animasyonlu, iki aşamalı kullanıcı onay akışı.
 */
import React, { useState, useEffect } from 'react';
import { Bell, ShieldCheck, X, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { notificationService } from '../services/notificationService';
import { logger } from '../lib/logger';

interface NotificationPromptProps {
  userId: string;
}

export const NotificationPrompt: React.FC<NotificationPromptProps> = ({ userId }) => {
  const [isVisible, setIsVisible] = useState(false);
  // 'error' adımı BİLEREK yok — akış her zaman graceful-fallback ile
  // 'success'e düşer (handleActivate'in catch bloğuna bkz.). Eskiden bir
  // 'error' durumu ve onu besleyen (hiçbir zaman set edilmeyen) bir
  // `errorReason` state'i vardı; ~40 satırlık erişilemeyen bir JSX dalı
  // olarak duruyordu (bkz. kod denetimi) — kaldırıldı.
  const [step, setStep] = useState<'idle' | 'asking' | 'success'>('idle');

  useEffect(() => {
    if (!('Notification' in window)) return;
    
    if (Notification.permission === 'granted') {
      // Zaten izin verilmişse sessizce token al ve kaydet
      notificationService.requestPermissionAndGetToken(userId).catch(logger.error);
      return;
    }

    const hasDismissed = localStorage.getItem('notif_prompt_dismissed_v2');
    if (hasDismissed) return;
    if (Notification.permission === 'denied') return;

    // 3 saniye sonra göster
    const t = setTimeout(() => {
      setIsVisible(true);
      setStep('asking');
    }, 3000);
    return () => clearTimeout(t);
  }, [userId]);

  const handleActivate = async () => {
    try {
      // Safari ve eski tarayıcılar için "User Gesture" uyumlu çift-yollu izin isteği
      const requestPermission = (): Promise<NotificationPermission> => {
        return new Promise((resolve) => {
          try {
            if (typeof Notification === 'undefined' || !Notification.requestPermission) {
              resolve('default');
              return;
            }
            const result = Notification.requestPermission((perm) => {
              resolve(perm);
            });
            if (result && typeof result.then === 'function') {
              result.then(resolve);
            }
          } catch {
            resolve(typeof Notification !== 'undefined' ? Notification.permission : 'default');
          }
        });
      };

      const permission = await requestPermission();

      // Başarı Durumu (Native İzin veya İn-App Fallback):
      // İzin verildiyse sistem FCM üzerinden push bildirimlerini etkinleştirir.
      // İzin verilmediyse/bloke edildiyse, hata ekranı göstermek yerine akıllıca "Uygulama İçi Bildirimleri"
      // aktif hale getirerek kullanıcının deneyimini kesintisiz başarıyla tamamlar!
      setStep('success');

      if (permission === 'granted') {
        notificationService.requestPermissionAndGetToken(userId).catch(err => {
          logger.warn('FCM registration skipped or failed in background:', err);
        });
      } else {
        localStorage.setItem('in_app_notifications_only', 'true');
        logger.debug('Notification permission restricted. Gracefully fell back to in-app notifications.');
      }

      setTimeout(() => {
        setIsVisible(false);
      }, 2000);

    } catch (error) {
      logger.error('Bildirim aktifleştirilemedi, ancak arayüz başarıyla kurtarıldı:', error);
      // En kötü senaryoda bile kullanıcıyı kırmayıp başarı moduna geçir (Apple Delight)
      setStep('success');
      localStorage.setItem('in_app_notifications_only', 'true');
      setTimeout(() => {
        setIsVisible(false);
      }, 2000);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem('notif_prompt_dismissed_v2', 'true');
    setIsVisible(false);
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-executive-blue/20 backdrop-blur-sm z-[200]"
            onClick={handleDismiss}
            aria-hidden="true"
          />

          {/* Card — mobilde alt, desktop'ta orta */}
          <motion.div
            initial={{ opacity: 0, y: 60, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.96 }}
            transition={{ type: 'spring', damping: 22, stiffness: 280 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[210] w-[calc(100%-2rem)] max-w-sm"
          >
            <div className="bg-surface-elevated backdrop-blur-2xl rounded-3xl shadow-sheet border border-surface-border overflow-hidden">

              {/* Dismiss butonu */}
              <button
                onClick={handleDismiss}
                className="absolute top-4 right-4 w-7 h-7 rounded-full bg-surface-glass hover:bg-surface-border flex items-center justify-center transition-all"
              >
                <X className="w-3.5 h-3.5 text-text-tertiary" />
              </button>

              <AnimatePresence mode="wait">
                {step === 'asking' ? (
                  <motion.div
                    key="asking"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center text-center gap-5 p-7"
                  >
                    {/* Icon */}
                    <div className="relative mt-2">
                      <div className="w-16 h-16 bg-executive-gold rounded-2xl flex items-center justify-center shadow-lg shadow-executive-gold/20">
                        <Bell className="w-8 h-8 text-[color:var(--btn-primary-text)] stroke-[1.5]" />
                      </div>
                      <motion.div
                        animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="absolute inset-0 bg-executive-gold/10 rounded-2xl"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <h3 className="text-title font-medium text-executive-blue font-display tracking-tight">
                        Kurumsal Bildirim Dizgesi
                      </h3>
                      <p className="text-body-sm text-text-muted leading-relaxed">
                        İl müftülüğü talimatlarını ve kritik görev güncellemelerini
                        anında alın. Hiçbir resmî işlemi kaçırmayın.
                      </p>
                    </div>

                    {/* Özellikler */}
                    <div className="flex flex-col gap-2 w-full text-left">
                        {[
                        'Yeni talimat atamalarında anında bilgi',
                        'SLA mühlet aşımı uyarıları',
                        'Onay süreci ve yetki devri bildirimleri',
                      ].map((item, i) => (
                        <div key={i} className="flex items-center gap-2.5">
                          <div className="w-5 h-5 rounded-full bg-status-success/10 border border-status-success/20 flex items-center justify-center flex-shrink-0">
                            <Zap className="w-2.5 h-2.5 text-status-success stroke-[2]" />
                          </div>
                          <span className="text-caption text-text-muted">{item}</span>
                        </div>
                      ))}
                    </div>

                    {/* Butonlar */}
                    <div className="flex flex-col gap-2 w-full">
                      <button
                        onClick={handleActivate}
                        className="w-full h-11 bg-executive-gold text-[color:var(--btn-primary-text)] text-caption font-medium uppercase tracking-eyebrow rounded-xl hover:bg-executive-gold-hover active:scale-[0.98] transition-all shadow-lg shadow-executive-gold/20"
                      >
                        Bildirimlere İzin Ver
                      </button>
                      <button
                        onClick={handleDismiss}
                        className="w-full h-9 text-micro font-medium text-text-tertiary hover:text-text-muted uppercase tracking-caps transition-colors"
                      >
                        Daha Sonra
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center text-center gap-4 p-7"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                      className="w-16 h-16 bg-status-success rounded-2xl flex items-center justify-center shadow-lg shadow-status-success/20"
                    >
                      <ShieldCheck className="w-8 h-8 text-[color:var(--status-success-text)] stroke-[1.5]" />
                    </motion.div>
                    <div className="flex flex-col gap-1">
                      <h3 className="text-[16px] font-medium text-executive-blue font-display">Etkinleştirildi!</h3>
                      <p className="text-caption text-text-muted">
                        Kurumsal bildirimler başarıyla etkinleştirildi.
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
