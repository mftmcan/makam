/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AuthenticatedApp — giriş sonrası TÜM veri katmanı (Firestore listener'ları,
 * offline-queue merge, CRUD handler'lar) ve tüm authenticated UI ağacı.
 *
 * App.tsx (shell) bu bileşeni yalnızca `user` doluyken lazy() ile yükler.
 * Amaç: Login ekranının (ve App.tsx'teki auth bootstrap'ının) bundle'ı,
 * yalnızca giriş SONRASI gereken iş mantığını (taskService/blockerService/
 * userService/notificationService — hepsi useAppHandlers üzerinden; ayrıca
 * offlineQueue'nun taskService bağımlılığı) ve authenticated bileşen ağacını
 * (Sidebar/AppHeader/NotificationPanel/MobileDock/TaskFormModal/Modal/
 * CertificateModal/WarningModal + tab route'larının lazy() facade'leri)
 * taşımasın (bkz. kod denetimi — bundle bölünmesi analizi). Firebase/Firestore
 * SDK'sının kendisi (vendor-firebase) bu sınırın DIŞINDA kalır çünkü App.tsx'teki
 * auth listener zaten kullanıcının profil dokümanını Firestore'dan okumak
 * zorunda — bu bileşen yalnızca üst-seviye İŞ MANTIĞI + authenticated UI
 * ağırlığını erteler.
 */
import { useState, useEffect, useCallback, useRef, lazy, Suspense, useMemo } from 'react';
import type { ReactNode, RefObject } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User, Task } from '../types';
import { useUIStore } from '../store/uiStore';
import { useShallow } from 'zustand/react/shallow';
import { AppRoutes } from './AppRoutes';
import { useActiveTab } from '../hooks/useActiveTab';
import { useSelectedTaskId, useTaskNavigation } from '../hooks/useTaskRoute';

import { Sidebar } from './Sidebar';
import { AppHeader } from './AppHeader';
import { NotificationPanel } from './NotificationPanel';
import { NotificationPrompt } from './NotificationPrompt';
import { WelcomeModal } from './WelcomeModal';
import { MobileDock } from './MobileDock';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { TaskFormModal } from './TaskFormModal';
import { CertificateModal } from './CertificateModal';
import { WarningModal } from './WarningModal';
import { ErrorBoundary } from './ErrorBoundary';
import { getPrimaryAction } from './taskDetails/helpers';

// Lazy loaded routes (tabs)
const Dashboard = lazy(() => import('./Dashboard').then(m => ({ default: m.Dashboard })));
const TaskBoard = lazy(() => import('./TaskBoard').then(m => ({ default: m.TaskBoard })));
const BlockerList = lazy(() => import('./BlockerList').then(m => ({ default: m.BlockerList })));
const TeamList = lazy(() => import('./TeamList').then(m => ({ default: m.TeamList })));
const AuditLogList = lazy(() => import('./AuditLogList').then(m => ({ default: m.AuditLogList })));
const Reports = lazy(() => import('./Reports').then(m => ({ default: m.Reports })));
const Settings = lazy(() => import('./Settings').then(m => ({ default: m.Settings })));
// TaskDetails, uygulamanın en büyük bileşenidir (~1000 satır) ve yalnızca bir
// görev detayına tıklandığında Modal içinde render edilir.
const TaskDetails = lazy(() => import('./TaskDetails').then(m => ({ default: m.TaskDetails })));
const TaskDetailsFooter = lazy(() => import('./taskDetails/Footer').then(m => ({ default: m.TaskDetailsFooter })));

import { useAppHandlers } from '../services/useAppHandlers';
import { useFirestoreData, fetchTaskById } from '../hooks/useFirestoreData';
import { useDepartments } from '../hooks/useDepartments';
import { departmentService } from '../services/departmentService';
import { useNotifications } from '../hooks/useNotifications';
import { applyOfflineMutations, type OfflineMutation } from '../lib/offlineQueue';
import { useSLASync } from '../hooks/useSLASync';
import { useIdleTimer } from '../hooks/useIdleTimer';
import { useSessionTimeout } from '../hooks/useSessionTimeout';
import { useSelfHealing } from '../hooks/useSelfHealing';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { type AppTabId } from '../constants';

interface AuthenticatedAppProps {
  user: User;
  onLogout: () => Promise<void>;
  onError: (error: unknown, operationType: string, path: string | null) => void;
  isOffline: boolean;
  offlineQueueLength: number;
  offlineMutations: OfflineMutation[];
  tasksRef: RefObject<Task[]>;
}

export function AuthenticatedApp({ user, onLogout, onError, isOffline, offlineQueueLength, offlineMutations, tasksRef }: AuthenticatedAppProps) {
  const isAdmin = useIsAdmin(user);
  const [fetchedTask, setFetchedTask] = useState<Task | null>(null);
  const [activeCertificateTask, setActiveCertificateTask] = useState<Task | null>(null);
  const [activeWarningTask, setActiveWarningTask] = useState<Task | null>(null);

  const notifRef = useRef<HTMLDivElement>(null);

  const {
    addToast,
    isCreateModalOpen, setIsCreateModalOpen,
    isEditModalOpen, setIsEditModalOpen,
    parentTaskId, setParentTaskId,
    initialTitle, setInitialTitle,
    isNotificationsOpen, setIsNotificationsOpen,
  } = useUIStore(useShallow(s => ({
    addToast: s.addToast,
    isCreateModalOpen: s.isCreateModalOpen, setIsCreateModalOpen: s.setIsCreateModalOpen,
    isEditModalOpen: s.isEditModalOpen, setIsEditModalOpen: s.setIsEditModalOpen,
    parentTaskId: s.parentTaskId, setParentTaskId: s.setParentTaskId,
    initialTitle: s.initialTitle, setInitialTitle: s.setInitialTitle,
    isNotificationsOpen: s.isNotificationsOpen, setIsNotificationsOpen: s.setIsNotificationsOpen,
  })));

  // ─── Navigasyon: URL tek doğruluk kaynağı ─────────────────────────────────
  // `activeTab` ve `selectedTaskId` eskiden yukarıdaki uiStore seçiminin
  // parçasıydı (bkz. kod denetimi P1-6). Artık ikisi de route'tan türetilir;
  // sayfa yenileme, tarayıcı geri tuşu ve paylaşılan derin linkler bu sayede
  // çalışır.
  const activeTab = useActiveTab();
  const selectedTaskId = useSelectedTaskId();
  const { openTask, closeTask, goToTab } = useTaskNavigation();

  // Close notification panel when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setIsNotificationsOpen(false);
      }
    };
    if (isNotificationsOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isNotificationsOpen, setIsNotificationsOpen]);

  // Tab yetki kontrolü (Güvenlik Duvarı) artık burada bir useEffect değil,
  // her route element'ini saran <RequireTabAccess> guard'ıdır (bkz. o dosya).

  // SLA konfigürasyon senkronizasyonu (Firestore → localStorage)
  useSLASync(user, onError);

  const { tasks: firestoreTasks, users, blockers: firestoreBlockers, resolvedBlockers, isLoading: isDataLoading } = useFirestoreData(user, onError);

  // Derived tasks/blockers state — offline kuyruktaki bekleyen mutasyonlar
  // Firestore verisinin üzerine bindirilir (bkz. lib/offlineQueue.ts
  // applyOfflineMutations).
  const tasks = useMemo(() => {
    const result = applyOfflineMutations(firestoreTasks, offlineMutations, 'tasks');
    result.sort((a, b) => b.updatedAt - a.updatedAt);
    return result;
  }, [firestoreTasks, offlineMutations]);

  tasksRef.current = tasks;

  const blockers = useMemo(
    () => applyOfflineMutations(firestoreBlockers, offlineMutations, 'blockers').filter(b => !b.isResolved),
    [firestoreBlockers, offlineMutations]
  );

  // ─── Global Focus Filter (Birim Odak Filtresi) ───────────────────────────
  const [globalFocusDept, setGlobalFocusDept] = useState<string>('ALL');

  // Rol bazlı ilk odak: Yönetici için varsayılan kendi birimidir. Login başına
  // yalnızca bir kez çalışır (ref, uid'i saklar) — Firestore snapshot'ı user
  // referansını yenilediğinde ya da kullanıcı manuel "Tüm Odaklar" seçtiğinde
  // asla geri ezilmez.
  const focusInitializedUidRef = useRef<string | null>(null);
  useEffect(() => {
    if (focusInitializedUidRef.current === user.uid) return;
    focusInitializedUidRef.current = user.uid;
    if (user.role === 'Manager' && user.departmentId) {
      setGlobalFocusDept(user.departmentId);
    }
  }, [user]);

  // departments koleksiyonundaki KAYITLI birimler — departman ATAMA akışlarını
  // (TeamList, TaskFormModal) besler. Aşağıdaki türetilmiş `departments`
  // useMemo'su ile BİLİNÇLİ olarak ayrıdır ve onun yerini ALMAZ: o, mevcut
  // kayıtlardaki (geçmişte yazılmış, artık kayıtlı olmayabilecek) departmanları
  // da kapsayan salt-okunur bir odak filtresidir; atama ise yalnızca gerçek
  // referans varlıklara yapılabilir (bkz. kod denetimi P0-2).
  const registeredDepartments = useDepartments(user, onError);

  const handleCreateDepartment = useCallback(
    (name: string) => departmentService.createDepartment(name, user.uid, registeredDepartments),
    [user.uid, registeredDepartments]
  );

  // Yeniden adlandırma/silme yalnızca Admin'e açıktır (firestore.rules); burada
  // ek bir rol kapısı YOKTUR çünkü paneli render eden TeamList zaten isAdmin
  // ile koruyor ve gerçek sınır kurallardadır. Handler'lar servisin ham
  // hatalarını YUTMAZ — panel, "hâlâ kullanılıyor" gibi reddi kullanıcıya
  // olduğu gibi gösterebilmek için Promise'in reject'ine ihtiyaç duyar.
  const handleRenameDepartment = useCallback(
    (oldId: string, newId: string) => departmentService.renameDepartment(oldId, newId, user.uid),
    [user.uid]
  );

  const handleDeleteDepartment = useCallback(
    (id: string) => departmentService.deleteDepartment(id),
    []
  );

  const departments = useMemo(() => {
    const depts = new Set<string>();
    users.forEach(u => {
      if (u.departmentId) depts.add(u.departmentId);
    });
    firestoreTasks.forEach(t => {
      if (t.departmentId) depts.add(t.departmentId);
    });
    return Array.from(depts).sort();
  }, [users, firestoreTasks]);

  const filteredTasksByFocus = useMemo(() => {
    if (globalFocusDept === 'ALL') return tasks;
    return tasks.filter(t => t.departmentId === globalFocusDept);
  }, [tasks, globalFocusDept]);

  const filteredUsersByFocus = useMemo(() => {
    if (globalFocusDept === 'ALL') return users;
    return users.filter(u => u.departmentId === globalFocusDept || u.role === 'Admin');
  }, [users, globalFocusDept]);

  const filteredBlockersByFocus = useMemo(() => {
    if (globalFocusDept === 'ALL') return blockers;
    const focusTaskIds = new Set(filteredTasksByFocus.map(t => t.id));
    return blockers.filter(b => focusTaskIds.has(b.taskId));
  }, [blockers, globalFocusDept, filteredTasksByFocus]);

  // resolvedBlockers offline kuyruktan BİLİNÇLİ olarak geçmiyor (bkz. App.tsx'in
  // eski yorumu / kod denetimi) — Odak filtresi diğer listelerle AYNI mantıkla
  // (görevin departmanına göre) uygulanır.
  const filteredResolvedBlockersByFocus = useMemo(() => {
    if (globalFocusDept === 'ALL') return resolvedBlockers;
    const focusTaskIds = new Set(filteredTasksByFocus.map(t => t.id));
    return resolvedBlockers.filter(b => focusTaskIds.has(b.taskId));
  }, [resolvedBlockers, globalFocusDept, filteredTasksByFocus]);

  // On-demand task fetch (CQRS — lokal listede yoksa). fetchTaskById,
  // useFirestoreData'daki diğer tüm task okumalarıyla AYNI zod doğrulamasından
  // geçer — burada doğrudan getDoc çağırmak bu tek yolu şemasız bırakırdı.
  useEffect(() => {
    if (!selectedTaskId) { setFetchedTask(null); return; }
    if (tasks.find(t => t.id === selectedTaskId)) { setFetchedTask(null); return; }
    fetchTaskById(selectedTaskId)
      .then((result) => {
        setFetchedTask(result);
        if (result === null) {
          closeTask();
          addToast({ title: '⚠️ Talimat Bulunamadı', body: 'Bu talimat silinmiş veya artık erişiminiz olmayabilir.', type: 'warning' });
        }
      })
      .catch(() => {
        setFetchedTask(null);
        closeTask();
        addToast({ title: '⚠️ Talimat Yüklenemedi', body: 'Talimat getirilirken bir hata oluştu. Lütfen tekrar deneyin.', type: 'danger' });
      });
  }, [selectedTaskId, tasks, addToast, closeTask]);

  const selectedTask = tasks.find(t => t.id === selectedTaskId) || fetchedTask;

  // ─── Bildirimler ──────────────────────────────────────────────────────────
  const { notifications } = useNotifications(user.uid, onError);

  // ─── Toast yardımcıları ──────────────────────────────────────────────────
  const triggerToast = useCallback((title: string, body: string, type: 'info' | 'success' | 'warning' | 'danger' = 'success', taskId?: string) => {
    addToast({ title, body, type, taskId });
  }, [addToast]);

  // ─── Self-Healing + Idle Timer ────────────────────────────────────────────
  useSelfHealing({ user, tasks, blockers });
  // Oturum süresi Admin tarafından yapılandırılabilir (system/settings) —
  // hook, ayar okunamazsa/geçersizse güvenli varsayılana (30 dk) düşer.
  const sessionTimeoutMs = useSessionTimeout(user, onError);
  const { isWarning: isSessionExpiring, remainingMs: sessionRemainingMs, continueSession } =
    useIdleTimer({ onIdle: onLogout, enabled: true, timeoutMs: sessionTimeoutMs });

  // ─── Tüm CRUD handler'lar ─────────────────────────────────────────────────
  const {
    updateTaskStatus, createTask, updateTask, deleteTask,
    addBlocker, resolveBlocker, addComment, delegateTask,
    addUser, updateUserRole, deleteUser,
    updateBlocker, deleteBlocker,
    markNotificationRead, markAllNotificationsRead,
  } = useAppHandlers({ user, tasks, blockers, onError });

  // ─── Route ekranları ──────────────────────────────────────────────────────
  // `Record<AppTabId, ReactNode>`: TypeScript her sekme için bir ekran
  // zorunlu kılar, yani yeni bir AppTabId eklendiğinde route'u UNUTULAMAZ
  // (derleme hatası). Elemanlar burada oluşturuluyor olsa da bileşenler hâlâ
  // lazy() facade'leridir — yalnızca eşleşen route render edildiğinde chunk
  // indirilir; React element'i oluşturmak modülü YÜKLEMEZ (bkz. vite.config.ts
  // chunkFileNames notu — Dashboard/Reports'un lazy sınırı korunmalı).
  const screens: Record<AppTabId, ReactNode> = {
    dashboard: (
      <Dashboard
        tasks={filteredTasksByFocus} users={filteredUsersByFocus} user={user}
        onViewTask={(t) => openTask(t.id)}
        onNavigateTab={goToTab}
        isLoading={isDataLoading}
        isFiltered={globalFocusDept !== 'ALL'}
      />
    ),
    tasks: (
      <TaskBoard
        tasks={filteredTasksByFocus} users={filteredUsersByFocus} currentUser={user}
        onAddTask={() => { setParentTaskId(undefined); setIsCreateModalOpen(true); }}
        onViewTask={(t) => openTask(t.id)}
        isLoading={isDataLoading}
        updateTaskStatus={updateTaskStatus}
        updateTask={updateTask}
      />
    ),
    blockers: (
      <BlockerList
        tasks={filteredTasksByFocus} blockers={filteredBlockersByFocus} resolvedBlockers={filteredResolvedBlockersByFocus} users={filteredUsersByFocus}
        isAdmin={isAdmin || user.role === 'Manager'}
        isSystemAdmin={isAdmin}
        onResolve={resolveBlocker}
        onEditBlocker={updateBlocker}
        onDeleteBlocker={deleteBlocker}
        onViewTask={(t) => openTask(t.id)}
        isLoading={isDataLoading}
      />
    ),
    team: (
      <TeamList
        users={filteredUsersByFocus} tasks={filteredTasksByFocus} currentUser={user}
        departments={registeredDepartments}
        onUpdateUser={updateUserRole}
        onDeleteUser={deleteUser}
        onAddUser={addUser}
        onCreateDepartment={handleCreateDepartment}
        onRenameDepartment={handleRenameDepartment}
        onDeleteDepartment={handleDeleteDepartment}
        isLoading={isDataLoading}
      />
    ),
    reports: (
      <Reports
        tasks={filteredTasksByFocus} users={filteredUsersByFocus} blockers={filteredBlockersByFocus}
        onNavigateTab={goToTab}
        isLoading={isDataLoading}
      />
    ),
    audit: (
      // Denetim izi BİLEREK birim odak filtresini (globalFocusDept) yoksayar —
      // bu sekme yalnızca Admin'e açık (TAB_ROLES.audit) ve denetim kaydı
      // tanım gereği organizasyon geneli olmalı; filtrelenmiş tasks/users
      // geçirmek, odağın dışındaki bir birimin geçmişini "Bilinmeyen Talimat"
      // olarak göstererek kanıt izini eksik/yanıltıcı kılıyordu (bkz. kod
      // denetimi P1-14).
      <AuditLogList
        tasks={tasks} users={users}
      />
    ),
    settings: (
      <Settings tasks={tasks} users={users} blockers={blockers} triggerToast={triggerToast} currentUser={user} isLoading={isDataLoading} sessionTimeoutMs={sessionTimeoutMs} />
    ),
  };

  return (
    <>
      <WelcomeModal user={user} />
      <NotificationPrompt userId={user.uid} />

      <Sidebar user={user} onLogout={onLogout} />
      <AppHeader
        user={user}
        notifications={notifications}
        isNotificationsOpen={isNotificationsOpen}
        setIsNotificationsOpen={setIsNotificationsOpen}
        globalFocusDept={globalFocusDept}
        onGlobalFocusDeptChange={setGlobalFocusDept}
        departments={departments}
        isOffline={isOffline}
        queueLength={offlineQueueLength}
      />
      <NotificationPanel isNotificationsOpen={isNotificationsOpen} setIsNotificationsOpen={setIsNotificationsOpen} notifRef={notifRef} notifications={notifications} markNotificationRead={markNotificationRead} markAllNotificationsRead={markAllNotificationsRead} />

      <main id="main-content" className="lg:ml-64 min-h-screen relative z-10 scroll-smooth pb-24 lg:pb-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="p-4 lg:p-6"
          >
            <ErrorBoundary variant="inline" key={activeTab}>
            <Suspense fallback={
              <div className="flex items-center justify-center p-20 min-h-[400px]">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-8 h-8 border-2 border-executive-gold/20 border-t-executive-gold rounded-full animate-spin" />
                  <span className="text-[10px] text-text-muted font-medium uppercase tracking-[0.3em] opacity-50">MODÜL YÜKLENİYOR...</span>
                </div>
              </div>
            }>
              <AppRoutes role={user.role} screens={screens} />
            </Suspense>
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Oturum Zaman Aşımı Uyarısı — kapanmadan ~60sn önce.
          onClose olarak continueSession verilir: Escape/arka plan tıklaması da
          AÇIK bir kullanıcı eylemidir, oturumu uzatmalıdır. Aksi halde modal
          kapanır ama sayaç işlemeye devam eder ve kullanıcı hiçbir uyarı
          görmeden saniyeler içinde dışarı atılırdı. */}
      <Modal
        isOpen={isSessionExpiring}
        onClose={continueSession}
        title="Oturum Sonlanmak Üzere"
        size="sm"
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-text-muted font-light leading-relaxed">
            Uzun süredir işlem yapılmadığı için oturumunuz{' '}
            <strong className="text-status-danger font-medium" aria-live="polite">
              {Math.ceil(sessionRemainingMs / 1000)} saniye
            </strong>{' '}
            içinde güvenlik gereği kapatılacaktır. Çalışmaya devam etmek için aşağıdaki
            butonu kullanın.
          </p>
          <div className="flex justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
            <Button variant="secondary" onClick={() => { void onLogout(); }}>Şimdi Çıkış Yap</Button>
            <Button variant="primary" onClick={continueSession}>Devam Et</Button>
          </div>
        </div>
      </Modal>

      {/* Görev Form Modalı (Yeni / Düzenle) */}
      <Modal
        isOpen={isCreateModalOpen || isEditModalOpen}
        onClose={() => { setIsCreateModalOpen(false); setIsEditModalOpen(false); }}
        title={isEditModalOpen ? "Talimat Güncellemesi" : "Yeni Talimat Tanımla"}
        size="lg"
      >
        <TaskFormModal
          users={users}
          currentUser={user}
          departments={registeredDepartments}
          task={isEditModalOpen && selectedTask ? selectedTask : undefined}
          parentId={parentTaskId}
          initialTitle={initialTitle}
          onSubmit={(data) => {
            // createTask/updateTask'in promise'i geri döndürülür ki
            // TaskFormModal bunu await edip isSubmitting'i gerçek
            // network round-trip süresince true tutabilsin (bkz. kod
            // denetimi — aksi halde çifte gönderim/çift görev riski).
            if (isEditModalOpen && selectedTask) return updateTask(selectedTask.id, data);
            return createTask(data);
          }}
          onClose={() => { setIsCreateModalOpen(false); setIsEditModalOpen(false); setParentTaskId(undefined); }}
        />
      </Modal>

      {/* Görev Detay Modalı — TaskDetails/TaskDetailsFooter lazy() olduğundan
          bu Suspense sınırı, footer prop'u dahil ikisini de kapsar (Suspense
          lexical iç içelikten değil, render ağacındaki soydan bağımsızdır). */}
      <Suspense fallback={
        <div className="flex items-center justify-center p-16 min-h-[300px]">
          <div className="w-6 h-6 border-2 border-executive-gold/20 border-t-executive-gold rounded-full animate-spin" />
        </div>
      }>
        <Modal
          isOpen={!!selectedTaskId && !isEditModalOpen && !isCreateModalOpen}
          onClose={closeTask}
          title="Talimat Detayı & İcra"
          size="xl"
          layoutId={selectedTask ? `task-card-${selectedTask.id}` : undefined}
          footer={selectedTask && getPrimaryAction(selectedTask, user) ? (
            <TaskDetailsFooter
              task={selectedTask}
              currentUser={user}
              onStatusChange={(status, evidence, type) => updateTaskStatus(selectedTask.id, status, evidence, type)}
            />
          ) : undefined}
        >
          {Boolean(selectedTask) && (
            <TaskDetails
              task={selectedTask!}
              tasks={tasks}
              users={users}
              currentUser={user}
              blockers={[...blockers, ...resolvedBlockers].filter(b => b.taskId === selectedTask!.id)}
              onAddBlocker={(reason, severity) => selectedTask && addBlocker(selectedTask.id, reason, severity)}
              onResolveBlocker={resolveBlocker}
              onAddSubTask={(parentId, title) => { setParentTaskId(parentId); setInitialTitle(title); setIsCreateModalOpen(true); }}
              onAddComment={(text) => selectedTask && addComment(selectedTask.id, text)}
              onViewTask={(t) => openTask(t.id)}
              onEdit={() => setIsEditModalOpen(true)}
              onDelete={() => selectedTask && deleteTask(selectedTask.id)}
              onClearCoordinator={() => selectedTask && updateTask(selectedTask.id, { coordinatorId: undefined })}
              onShowCertificate={setActiveCertificateTask}
              onShowWarning={setActiveWarningTask}
              onUpdateTask={(data) => selectedTask && updateTask(selectedTask.id, data)}
              onDelegateTask={(newAssigneeId) => selectedTask && delegateTask(selectedTask.id, newAssigneeId)}
            />
          )}
        </Modal>
      </Suspense>

      {/* Belgeler - Detay Modalının Dışında */}
      {activeCertificateTask && (
        <CertificateModal
          task={activeCertificateTask}
          assignee={users.find(u => u.uid === activeCertificateTask.assigneeId || u.email === activeCertificateTask.assigneeId)}
          onClose={() => setActiveCertificateTask(null)}
        />
      )}

      {activeWarningTask && (
        <WarningModal
          task={activeWarningTask}
          assignee={users.find(u => u.uid === activeWarningTask.assigneeId || u.email === activeWarningTask.assigneeId)}
          onClose={() => setActiveWarningTask(null)}
        />
      )}

      <MobileDock user={user} onLogout={onLogout} notificationCount={notifications.length} />
    </>
  );
}
