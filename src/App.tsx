/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import {
  auth, db, googleProvider, signInWithPopup, signInWithCustomToken, signOut, onAuthStateChanged,
  doc, getDoc, updateDoc, onSnapshot, writeBatch, isUsingFirebaseEmulator
} from './firebase';
import { User, Task, UserSchema } from './types';
import { validateOrPassthrough } from './lib/validateOrPassthrough';
import { humanizeError } from './lib/errorMessages';
import { motion, MotionConfig } from 'motion/react';

// UI Components
import { Login } from './components/Login';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ExecutiveToast } from './components/ExecutiveToast';
import { ReloadPrompt } from './components/ReloadPrompt';
import { Logo } from './components/Logo';
import { useResolvedTheme } from './hooks/useResolvedTheme';
import { OfflineBanner } from './components/OfflineBanner';

// AuthenticatedApp, giriş SONRASI tüm veri katmanını (Firestore listener'ları,
// useAppHandlers'ın taskService/blockerService/userService bağımlılıkları) ve
// tüm authenticated UI ağacını taşıyor — yalnızca `user` doluyken lazy()
// yüklenir, böylece Login ekranının ilk yüklemesi bu ağırlığı taşımaz (bkz.
// AuthenticatedApp.tsx başındaki yorum — bundle bölünmesi analizi).
const AuthenticatedApp = lazy(() => import('./components/AuthenticatedApp').then(m => ({ default: m.AuthenticatedApp })));

// Services & Hooks
import { conflictDetectionService, type ConflictContext, type ConflictInfo } from './services/conflictDetectionService';
import { ConflictModal } from './components/ConflictModal';
import { logError } from './services/errorLoggingService';
import { useOfflineQueue } from './hooks/useOfflineQueue';
import { useUIStore } from './store/uiStore';
import { useTaskNavigation } from './hooks/useTaskRoute';
import { useShallow } from 'zustand/react/shallow';

export default function App() {
  const resolvedTheme = useResolvedTheme();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const isLoggingOutRef = useRef(false);
  const tasksRef = useRef<Task[]>([]);

  // ─── uiStore ─────────────────────────────────────────────────────────────
  // `useShallow` ile yalnızca burada kullanılan alanlar seçilir — aksi halde
  // whole-store `useUIStore()` store'daki İLGİSİZ her alan değişiminde
  // App'in ve altındaki tüm ağacın gereksiz yere yeniden render olmasına yol
  // açardı. Yalnızca giriş-öncesi de görünmesi gereken alanlar (toast'lar,
  // tema) burada tutulur — tab/modal state'i AuthenticatedApp'in kendi
  // seçimidir.
  const {
    toasts, addToast, removeToast,
    theme,
  } = useUIStore(useShallow(s => ({
    toasts: s.toasts, addToast: s.addToast, removeToast: s.removeToast,
    theme: s.theme,
  })));

  // Toast'a tıklayınca ilgili talimata git. Eskiden uiStore'daki
  // setSelectedTaskId'yi çağırıyordu; artık URL tek doğruluk kaynağı olduğundan
  // (bkz. hooks/useTaskRoute.ts) doğrudan navigate edilir. Bu, App'in Router'ın
  // ALTINDA kalmasını gerektirir — bkz. main.tsx'teki BrowserRouter notu.
  const { openTask } = useTaskNavigation();

  // ─── Tema Uygulama ────────────────────────────────────────────────────────
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);

      const listener = (e: MediaQueryListEvent) => {
        root.classList.remove('light', 'dark');
        root.classList.add(e.matches ? 'dark' : 'light');
      };

      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    } else {
      root.classList.add(theme);
      return undefined;
    }
  }, [theme]);

  // ─── Firestore hata yöneticisi ────────────────────────────────────────────
  const handleFirestoreError = useCallback(async (
    error: unknown, operationType: string, path: string | null, conflictContext?: ConflictContext
  ) => {
    const errorMsg = error instanceof Error ? error.message : String(error);

    const isPermissionError = errorMsg.toLowerCase().includes('permission') || errorMsg.toLowerCase().includes('yetki');
    if (isPermissionError && (isLoggingOutRef.current || !auth.currentUser)) {
      console.warn('[Auth] Logout sonrası izin hatası yoksayıldı:', errorMsg);
      return;
    }

    // İyimser Kilitleme Çakışma Tespiti (VERSION_MISMATCH)
    if (errorMsg.includes('VERSION_MISMATCH') && path && path.startsWith('tasks/')) {
      const taskId = path.split('/')[1] || '';
      const task = tasksRef.current.find(t => t.id === taskId);
      const taskTitle = task?.title || 'Seçili Talimat';

      const match = errorMsg.match(/Beklenen Versiyon (\d+), Sunucu Versiyonu (\d+)/);
      const expectedVersion = match ? parseInt(match[1]!) : 0;
      const serverVersion = match ? parseInt(match[2]!) : undefined;

      conflictDetectionService.detectConflict(error, taskId, taskTitle, expectedVersion, serverVersion, conflictContext);
      return; // UI'da çakışma uyarısı tetiklendi, ek sistem hatası toast'ına gerek yok
    }

    console.error(`[Firestore] ${operationType} on "${path}" failed:`, errorMsg);
    // logError'ın döndürdüğü doküman ID'si "Destek Referansı" olarak toast'a
    // yansıtılır — Admin bu referansla error_logs'taki kaydı anında bulabilir
    // (bkz. kod denetimi: bu ID üretiliyordu ama kullanıcıya hiç gösterilmiyordu).
    const supportReference = await logError(error, 'firestore', { operationType, path: path ?? undefined });

    addToast(humanizeError(error, supportReference));
  }, [addToast]);

  // ─── Offline kuyruk ───────────────────────────────────────────────────────
  // Login ekranında da görünmesi gereken (OfflineBanner) tek veri-katmanı
  // hook'u olduğundan giriş-öncesi shell'de kalır.
  const {
    isOffline,
    queueLength: offlineQueueLength,
    pendingMutations: offlineMutations,
    syncNow,
  } = useOfflineQueue();

  // ─── Çakışma Tespiti ─────────────────────────────────────────────────────
  // Eskiden yalnızca "sayfayı yenileyin" diyen bir toast gösteriliyordu —
  // kullanıcının denediği değişiklik sessizce kayboluyordu ve uygulama zaten
  // canlı onSnapshot kullandığından tavsiye teknik olarak da yanlıştı (bkz.
  // tasarım denetimi F7). Artık sunucu/yerel karşılaştırması ve "Benimkini
  // Uygula" (taze lockVersion ile yeniden dener) / "Sunucudakini Al" (sessizce
  // kapat, onSnapshot zaten güncel veriyi getirmiş durumda) sunan bir modal var.
  const [activeConflict, setActiveConflict] = useState<ConflictInfo | null>(null);
  useEffect(() => {
    const unsubscribe = conflictDetectionService.subscribe((info) => {
      setActiveConflict(info);
    });
    return unsubscribe;
  }, []);

  // E2E test girişi — yalnızca Firebase Emulator Suite'e bağlıyken ve URL'de
  // ?e2e_token= parametresi varsa çalışır. Gerçek Google OAuth popup'ını
  // otomatikleştirmek pratik olmadığından, Playwright bu token'ı bir seed
  // script'inin (scripts/seedE2E.ts) ürettiği custom token ile sağlar.
  useEffect(() => {
    if (!isUsingFirebaseEmulator) return;
    const token = new URLSearchParams(window.location.search).get('e2e_token');
    if (!token) return;
    signInWithCustomToken(auth, token).catch((err) => {
      console.error('[E2E] signInWithCustomToken failed:', err);
    });
  }, []);

  // Auth Listener
  useEffect(() => {
    let unsubscribeUserDoc: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (unsubscribeUserDoc) { unsubscribeUserDoc(); unsubscribeUserDoc = null; }

      if (firebaseUser) {
        const userEmail = firebaseUser.email?.toLowerCase().trim();

        unsubscribeUserDoc = onSnapshot(doc(db, 'users', firebaseUser.uid), async (userDoc) => {
          if (userDoc.exists()) {
            // useFirestoreData.ts'teki diğer TÜM users okumalarıyla AYNI zod
            // doğrulaması — bu doküman RBAC'in (TAB_ROLES) doğrudan dayandığı
            // `role` alanını taşıyor; eskiden burada ham `as User` cast'i
            // yapılıyordu, bozuk/eksik bir role alanı hiçbir uyarı vermeden
            // sessizce davranışı bozabiliyordu (bkz. kod denetimi).
            const raw = { ...userDoc.data(), uid: userDoc.data().uid || userDoc.id } as User;
            const userData = validateOrPassthrough(UserSchema, raw, userDoc.id, 'users');
            if (firebaseUser.photoURL && firebaseUser.photoURL !== userData.photoURL) {
              try {
                await updateDoc(doc(db, 'users', firebaseUser.uid), { photoURL: firebaseUser.photoURL });
              } catch { /* sessizce geç */ }
            }
            setUser({ ...userData, photoURL: firebaseUser.photoURL ?? userData.photoURL });
            setLoading(false);
          } else {
            if (userEmail) {
              try {
                const tempDocRef = doc(db, 'users', userEmail);
                const tempDocSnap = await getDoc(tempDocRef);
                if (tempDocSnap.exists()) {
                  const tempData = tempDocSnap.data();
                  const batch = writeBatch(db);
                  batch.set(doc(db, 'users', firebaseUser.uid), {
                    ...tempData,
                    uid: firebaseUser.uid,
                    photoURL: firebaseUser.photoURL || tempData.photoURL || null,
                  });
                  batch.delete(tempDocRef);
                  await batch.commit();
                  return;
                }
              } catch (migrationErr) {
                console.error('[Migration] Kullanıcı dökümanı taşıma hatası:', migrationErr);
              }
            }
            setLoading(false);
            // Kullanıcı Firestore'da bulunamadı — Login ekranı göster
            setUser(null);
          }
        }, (err) => {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const isPermissionError = errorMsg.toLowerCase().includes('permission') || errorMsg.toLowerCase().includes('yetki');
          if (!(isPermissionError && (isLoggingOutRef.current || !auth.currentUser))) {
            handleFirestoreError(err, 'auth', 'users');
          }
          setLoading(false);
        });
      } else {
        isLoggingOutRef.current = false;
        setUser(null);
        setLoading(false);
      }
    });

    return () => { unsubscribe(); if (unsubscribeUserDoc) unsubscribeUserDoc(); };
  }, [handleFirestoreError]);

  // NOT: Atıl görev denetimi artık yalnızca sunucu tarafında çalışıyor
  // (functions/src/scheduledAudit.ts — günde bir, Cloud Function). Burada
  // eskiden istemci tarafında da (saatte bir) çalışan eşdeğer bir denetim
  // vardı; iki sistemin aynı işi yapması gereksiz/çakışan yazmalara yol
  // açabileceğinden kaldırıldı.

  // ─── Auth Handlers ────────────────────────────────────────────────────────
  const handleLogout = useCallback(async () => {
    isLoggingOutRef.current = true;
    try { await signOut(auth); }
    catch (err) { isLoggingOutRef.current = false; handleFirestoreError(err, 'auth', 'users'); }
  }, [handleFirestoreError]);

  const handleLogin = useCallback(async () => {
    setIsLoggingIn(true);
    try { await signInWithPopup(auth, googleProvider); }
    catch (err) { handleFirestoreError(err, 'auth', 'users'); }
    finally { setIsLoggingIn(false); }
  }, [handleFirestoreError]);

  if (loading) {
    return (
      <div
        className="min-h-screen bg-surface-base flex items-center justify-center font-sans"
        role="status"
        aria-label="Uygulama yükleniyor"
      >
        <div className="flex flex-col items-center gap-12">
          <Logo size="xl" withText={false} variant={resolvedTheme} />
          <div className="flex flex-col items-center gap-4">
            <span className="text-text-muted font-normal uppercase tracking-[0.6em] text-caption animate-pulse">STRATEJİK VERİ BAĞLANTISI</span>
            <div className="w-48 h-[1px] bg-text-muted/15 overflow-hidden relative">
              <motion.div
                className="absolute inset-y-0 w-24 bg-executive-blue"
                animate={{ x: [-100, 200] }}
                transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    // reducedMotion="user" — OS/tarayıcı seviyesinde "Reduce Motion" açık
    // kullanıcılar için motion/react'in tüm spring/layout animasyonlarını
    // (dock aktif göstergesi, modal geçişleri, sayfa geçişi) otomatik olarak
    // sadeleştirir; CSS tabanlı animate-pulse/ping/flash için ayrıca
    // index.css'teki prefers-reduced-motion bloğuna bakın (bkz. mobil tasarım
    // denetimi — bu ayar öncesinde reduced-motion tercihi hiç ele alınmıyordu).
    <MotionConfig reducedMotion="user">
    <ErrorBoundary>
      <a href="#main-content" className="skip-to-content">Ana içeriğe geç</a>

      <div className="min-h-screen bg-surface-base text-text-body selection:bg-executive-blue/10 font-sans">
        <OfflineBanner
          isOffline={isOffline}
          queueLength={offlineQueueLength}
          pendingMutations={offlineMutations}
          onSyncNow={() => { void syncNow(); }}
        />

        <ConflictModal
          info={activeConflict}
          onClose={() => setActiveConflict(null)}
          currentTask={activeConflict ? tasksRef.current.find(t => t.id === activeConflict.taskId) : undefined}
        />

        {/* Toast Bölgesi */}
        <div
          role="region"
          aria-label="Bildirimler"
          className="fixed top-12 left-1/2 -translate-x-1/2 z-[150] flex flex-col gap-4 pointer-events-none w-full max-w-md px-6"
        >
          {toasts.map(toast => (
            <ExecutiveToast
              key={toast.id}
              toast={toast}
              onClose={removeToast}
              onClick={(taskId) => { if (taskId) openTask(taskId); }}
            />
          ))}
        </div>

        {!user ? (
          <main id="main-content">
            <Login onLogin={handleLogin} isLoading={isLoggingIn} />
          </main>
        ) : (
          <Suspense fallback={
            <div className="flex items-center justify-center p-20 min-h-[400px]">
              <div className="w-8 h-8 border-2 border-executive-gold/20 border-t-executive-gold rounded-full animate-spin" />
            </div>
          }>
            <AuthenticatedApp
              user={user}
              onLogout={handleLogout}
              onError={handleFirestoreError}
              isOffline={isOffline}
              offlineQueueLength={offlineQueueLength}
              offlineMutations={offlineMutations}
              tasksRef={tasksRef}
            />
          </Suspense>
        )}
      </div>
      <ReloadPrompt />
    </ErrorBoundary>
    </MotionConfig>
  );
}
