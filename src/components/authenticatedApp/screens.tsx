/**
 * buildAppScreens — AuthenticatedApp.tsx'ten ayrıştırıldı (bkz. kod denetimi
 * — dosya bölme). Her sekmenin route ekranını, o ekranın ihtiyaç duyduğu
 * (zaten AuthenticatedApp'te hesaplanmış) veri ve handler'larla besler.
 *
 * `Record<AppTabId, ReactNode>` dönüş tipi KORUNUR: TypeScript her sekme için
 * bir ekran zorunlu kılar, yani yeni bir AppTabId eklendiğinde bir ekran
 * unutulursa derleme hatası verir (bkz. AuthenticatedApp.tsx'teki orijinal
 * yorum). Elemanlar burada oluşturuluyor olsa da bileşenler hâlâ lazy()
 * facade'leridir — yalnızca eşleşen route render edildiğinde chunk indirilir.
 */
import { lazy, type ReactNode } from 'react';
import type { AppTabId } from '../../constants';
import type { Department, Task, TaskBlocker, TaskStatus, User, UserRole } from '../../types';
import type { TaskBoardFilters } from '../../hooks/useTaskBoardFilters';

const Dashboard = lazy(() => import('../Dashboard').then(m => ({ default: m.Dashboard })));
const TaskBoard = lazy(() => import('../TaskBoard').then(m => ({ default: m.TaskBoard })));
const BlockerList = lazy(() => import('../BlockerList').then(m => ({ default: m.BlockerList })));
const TeamList = lazy(() => import('../TeamList').then(m => ({ default: m.TeamList })));
const AuditLogList = lazy(() => import('../AuditLogList').then(m => ({ default: m.AuditLogList })));
const Reports = lazy(() => import('../Reports').then(m => ({ default: m.Reports })));
const Settings = lazy(() => import('../Settings').then(m => ({ default: m.Settings })));

export interface BuildAppScreensParams {
  user: User;
  isAdmin: boolean;
  isDataLoading: boolean;

  // Birim odak filtresine göre önceden filtrelenmiş listeler (bkz.
  // AuthenticatedApp.tsx — filteredTasksByFocus vb.)
  filteredTasksByFocus: Task[];
  filteredUsersByFocus: User[];
  filteredBlockersByFocus: TaskBlocker[];
  filteredResolvedBlockersByFocus: TaskBlocker[];
  globalFocusDept: string;

  // Odak filtresinden BAĞIMSIZ ham listeler — yalnızca Denetim İzleri ve
  // Ayarlar için (bkz. AuthenticatedApp.tsx'teki P1-14 yorumu: denetim izi
  // organizasyon geneli olmalı).
  tasks: Task[];
  users: User[];
  blockers: TaskBlocker[];

  onViewTask: (taskId: string) => void;
  onNavigateTab: (tab: AppTabId, params?: Record<string, string>) => void;

  // TaskBoard
  onAddTask: () => void;
  updateTaskStatus: (taskId: string, newStatus: TaskStatus, evidence?: string, evidenceType?: Task['evidenceType']) => Promise<void>;
  updateTask: (taskId: string, data: Partial<Task>) => Promise<void>;
  taskBoardFilters: TaskBoardFilters;
  onTaskBoardFiltersChange: (partial: Partial<TaskBoardFilters>) => void;
  pendingTaskIds: Set<string>;

  // BlockerList
  resolveBlocker: (blockerId: string) => Promise<void>;
  updateBlocker: (blockerId: string, reason: string) => Promise<void>;
  deleteBlocker: (blockerId: string) => Promise<void>;

  // TeamList
  registeredDepartments: Department[];
  updateUserRole: (userId: string, data: Partial<User>) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  addUser: (data: { email: string; fullName: string; role: UserRole; departmentId?: string }) => Promise<void>;
  onCreateDepartment: (name: string) => Promise<string>;
  onRenameDepartment: (oldId: string, newId: string) => Promise<{ tasksUpdated: number; usersUpdated: number }>;
  onDeleteDepartment: (id: string) => Promise<void>;

  // Settings
  triggerToast: (title: string, body: string, type?: 'info' | 'success' | 'warning' | 'danger') => void;
  sessionTimeoutMs: number;
  settingsTab: 'general' | 'sla' | 'security' | 'data';
  onSettingsTabChange: (tab: 'general' | 'sla' | 'security' | 'data') => void;
}

export function buildAppScreens(p: BuildAppScreensParams): Record<AppTabId, ReactNode> {
  return {
    dashboard: (
      <Dashboard
        tasks={p.filteredTasksByFocus} users={p.filteredUsersByFocus} user={p.user}
        onViewTask={(t) => p.onViewTask(t.id)}
        onNavigateTab={p.onNavigateTab}
        isLoading={p.isDataLoading}
        isFiltered={p.globalFocusDept !== 'ALL'}
      />
    ),
    tasks: (
      <TaskBoard
        tasks={p.filteredTasksByFocus} users={p.filteredUsersByFocus} currentUser={p.user}
        onAddTask={p.onAddTask}
        onViewTask={(t) => p.onViewTask(t.id)}
        isLoading={p.isDataLoading}
        updateTaskStatus={p.updateTaskStatus}
        updateTask={p.updateTask}
        filters={p.taskBoardFilters}
        onFiltersChange={p.onTaskBoardFiltersChange}
        pendingTaskIds={p.pendingTaskIds}
      />
    ),
    blockers: (
      <BlockerList
        tasks={p.filteredTasksByFocus} blockers={p.filteredBlockersByFocus} resolvedBlockers={p.filteredResolvedBlockersByFocus} users={p.filteredUsersByFocus}
        isAdmin={p.isAdmin || p.user.role === 'Manager'}
        isSystemAdmin={p.isAdmin}
        onResolve={p.resolveBlocker}
        onEditBlocker={p.updateBlocker}
        onDeleteBlocker={p.deleteBlocker}
        onViewTask={(t) => p.onViewTask(t.id)}
        isLoading={p.isDataLoading}
      />
    ),
    team: (
      <TeamList
        users={p.filteredUsersByFocus} tasks={p.filteredTasksByFocus} currentUser={p.user}
        departments={p.registeredDepartments}
        onUpdateUser={p.updateUserRole}
        onDeleteUser={p.deleteUser}
        onAddUser={p.addUser}
        onCreateDepartment={p.onCreateDepartment}
        onRenameDepartment={p.onRenameDepartment}
        onDeleteDepartment={p.onDeleteDepartment}
        isLoading={p.isDataLoading}
      />
    ),
    reports: (
      <Reports
        tasks={p.filteredTasksByFocus} users={p.filteredUsersByFocus} blockers={p.filteredBlockersByFocus}
        onNavigateTab={p.onNavigateTab}
        isLoading={p.isDataLoading}
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
        tasks={p.tasks} users={p.users}
      />
    ),
    settings: (
      <Settings
        tasks={p.tasks} users={p.users} blockers={p.blockers} triggerToast={p.triggerToast} currentUser={p.user}
        isLoading={p.isDataLoading} sessionTimeoutMs={p.sessionTimeoutMs}
        activeSubTab={p.settingsTab} onActiveSubTabChange={p.onSettingsTabChange}
      />
    ),
  };
}
