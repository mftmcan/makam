import { useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { motion, AnimatePresence } from 'motion/react'
import { RefreshCw, X } from 'lucide-react'
import { logger } from '../lib/logger'

// Varsayılan davranış yalnızca route/navigasyon geçişlerinde kontrol eder —
// uzun süre tek sekmede açık kalan bir kullanıcı (bu SPA'da navigasyon sayfa
// yenilemesi YAPMIYOR) bir güncelleme uyarısını hiç görmeyebilirdi (bkz. kod
// denetimi). Saatte bir `registration.update()` çağrılarak yeni bir
// service worker olup olmadığı periyodik olarak sorgulanır.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function ReloadPrompt() {
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined);

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      logger.debug('SW Registered: ' + r)
      registrationRef.current = r;
    },
    onRegisterError(error) {
      logger.error('SW registration error', error)
    },
  })

  useEffect(() => {
    const interval = setInterval(() => {
      registrationRef.current?.update().catch(err => {
        logger.debug('[ReloadPrompt] Periyodik güncelleme kontrolü başarısız (zararsız, bir sonraki koşuda tekrar denenir):', err);
      });
    }, UPDATE_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const close = () => {
    setOfflineReady(false)
    setNeedRefresh(false)
  }

  return (
    <AnimatePresence>
      {(offlineReady || needRefresh) && (
        <motion.div 
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.95 }}
          // Mobilde MobileDock `fixed bottom-4 left-4 right-4` alanını
          // kaplıyor (bkz. MobileDock.tsx) — bu toast eskiden aynı
          // bottom-6/right-6 konumunu masaüstüyle paylaşıyordu ve dock'un
          // üzerine biniyordu (bkz. mobil tasarım denetimi). Mobilde dock'un
          // üstüne, tam genişlikte oturur; lg:'de eski sağ-alt konumuna döner.
          className="fixed inset-x-4 bottom-24 lg:inset-x-auto lg:right-6 lg:bottom-6 z-[100] lg:max-w-[400px]"
        >
          <div className="bg-surface-elevated rounded-2xl p-6 shadow-sheet border border-surface-border flex flex-col gap-4">
             <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                   <div className="w-10 h-10 rounded-xl bg-status-info/10 flex items-center justify-center">
                      <RefreshCw className="w-5 h-5 text-status-info animate-spin-slow" />
                   </div>
                   <div className="flex flex-col">
                      <h4 className="text-[15px] font-semibold text-text-heading tracking-tight">
                        {offlineReady ? 'Çevrimdışı Hazır' : 'Dizge Güncellemesi'}
                      </h4>
                      <p className="text-body text-text-muted font-medium">
                        {offlineReady 
                          ? 'Uygulama artık internet olmadan çalışabilir.' 
                          : 'Dizge için yeni bir güncelleme mevcut.'}
                      </p>
                   </div>
                </div>
                <button onClick={close} aria-label="Kapat" className="p-1 hover:bg-surface-border/40 rounded-lg transition-colors">
                   <X className="w-4 h-4 text-text-muted" />
                </button>
             </div>
             
             {needRefresh && (
                 <button 
                   onClick={() => updateServiceWorker(true)}
                   className="w-full h-11 bg-executive-gold text-[color:var(--btn-primary-text)] rounded-xl text-body font-semibold uppercase tracking-widest hover:bg-executive-gold-hover transition-all shadow-lg shadow-executive-gold/20 active:scale-95"
                 >
                 Güncelle ve Yeniden Başlat
               </button>
             )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
