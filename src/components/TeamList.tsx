import { useState, useMemo, useCallback } from 'react';
import { UserPlus, Building } from 'lucide-react';
import { List } from 'react-window';
import { User, UserRole, Task, Department } from '../types';
import { SegmentedTabs } from './ui/SegmentedTabs';
import { Button } from './ui/Button';
import { Skeleton } from './ui/Skeleton';
import { PageHeader } from './ui/PageHeader';
import { PageShell } from './ui/PageShell';
import { PANEL_FRAME_CLASSNAME } from './ui/Panel';
import { DepartmentManager } from './teamList/DepartmentManager';
import { useIsAdmin } from '../hooks/useIsAdmin';
import {
  buildActiveTaskCountByUser, makeGetActiveTaskCount, buildStaffByDepartment,
  getIndependentStaff, computeCapacitySummary, computeDepartmentCapacity,
} from './teamList/helpers';
import { CapacityBand } from './teamList/CapacityBand';
import { UserCard } from './teamList/UserCard';
import { OrgTree } from './teamList/OrgTree';
import { UserProfileModal } from './teamList/UserProfileModal';
import { AddUserModal, EditUserModal, DeleteUserDialog } from './teamList/UserFormModals';
import { VirtualizedUserRow, type UserRowData } from './teamList/VirtualizedUserRow';

// Sanallaştırma (react-window) — P2-19: `useFirestoreData.ts` kullanıcıları
// `limit(1000)` ile çekiyor ve bu ekran öncesinde TÜM kadroyu tek seferde
// DOM'a basıyordu (bkz. kod denetimi). Desen `TaskBoard.tsx`'teki ile
// AYNIDIR: `react-window`'un `List` (rowComponent/rowCount/rowHeight/rowProps)
// API'si + konteyner yüksekliği `Math.min(satır × yükseklik, ÜST_SINIR)`.
//
// react-window'un satır bazlı virtualizasyonu TEK SÜTUNLU bir liste
// gerektirir — kadro ızgarası ise 1/2/3 sütunlu responsive bir CSS Grid'dir.
// Bu iki deseni uzlaştırmak yerine (ör. ekran genişliğini JS'te izleyip
// "satır başına kart sayısı"nı hesaplamak), küçük kadrolarda (P2-19'un
// örneklediği 20-30 kişilik ölçek) MEVCUT ızgara aynen korunur — sanallaştırma
// yalnızca eşiğin ÜZERİNDE (ör. 1000 kişilik bir organizasyon) devreye girip
// tek sütunlu bir satır listesine geçer. Bu, görev talimatındaki "küçük
// listelerde gereksiz karmaşıklık/kötü UX yaratmasın" kısıtını karşılar.
const VIRTUALIZE_THRESHOLD = 30;
const ROW_HEIGHT = 68;
const LIST_MAX_HEIGHT = 640;

interface TeamListProps {
  users: User[];
  tasks: Task[];
  currentUser: User | null;
  /** departments koleksiyonundaki KAYITLI birimler (bkz. useDepartments).
   *  AuthenticatedApp'teki users/tasks'tan TÜRETİLEN `departments` listesiyle
   *  karıştırılmamalı — o yalnızca salt-okunur odak filtresini besler; atama
   *  yalnızca gerçek referans varlıklara yapılabilir. */
  departments: Department[];
  onUpdateUser: (userId: string, data: Partial<User>) => void;
  onDeleteUser: (userId: string) => void;
  onAddUser: (data: { email: string; fullName: string; role: UserRole; departmentId?: string }) => void;
  onCreateDepartment: (name: string) => Promise<string>;
  /** Yeniden adlandırma gerçek bir "rename" değil bir TAŞIMAdır (name ==
   *  doküman ID invaryantı) — bkz. departmentService.renameDepartment. */
  onRenameDepartment: (oldId: string, newId: string) => Promise<{ tasksUpdated: number; usersUpdated: number }>;
  onDeleteDepartment: (id: string) => Promise<void>;
  isLoading?: boolean;
}

const TeamListSkeleton = () => (
  <PageShell aria-label="Kadro yükleniyor..." role="status">
    <div className="flex items-center justify-between pb-4 border-b border-executive-blue/[0.04]">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-8 w-40" rounded="full" />
    </div>
    <Skeleton className="h-4 w-full" rounded="full" />
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="makam-card p-5 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11" rounded="full" />
            <div className="flex flex-col gap-2 flex-1">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-5 w-24" rounded="full" />
        </div>
      ))}
    </div>
  </PageShell>
);

export const TeamList = ({ users, tasks, currentUser, departments, onUpdateUser, onDeleteUser, onAddUser, onCreateDepartment, onRenameDepartment, onDeleteDepartment, isLoading = false }: TeamListProps) => {
  const isAdmin = useIsAdmin(currentUser);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'tree'>('grid');

  const handleEdit = useCallback((user: User) => {
    setEditingUser(user);
    setIsEditModalOpen(true);
  }, []);

  const handleDeleteClick = useCallback((user: User) => {
    setUserToDelete(user);
    setIsDeleteModalOpen(true);
  }, []);

  const confirmDelete = () => {
    if (userToDelete) {
      onDeleteUser(userToDelete.uid);
      setIsDeleteModalOpen(false);
      setUserToDelete(null);
    }
  };

  // Kullanıcı başına aktif görev sayısını tek geçişte hesaplayıp Map'te tutar —
  // aksi halde her personel için tasks dizisi ayrı ayrı filtrelenir (O(kullanıcı × görev)
  // yerine burada tek O(görev) geçiş + O(1) lookup).
  const activeTaskCountByUser = useMemo(() => buildActiveTaskCountByUser(tasks), [tasks]);
  const getActiveTaskCount = useMemo(() => makeGetActiveTaskCount(activeTaskCountByUser), [activeTaskCountByUser]);

  const staffUsers = useMemo(() => users.filter(u => u.role === 'Staff'), [users]);
  const staffByDepartment = useMemo(() => buildStaffByDepartment(users), [users]);
  const independentStaff = useMemo(() => getIndependentStaff(users), [users]);

  const { capacityPercent, availableStaffCount, overloadedStaffCount, hasCapacityData } = useMemo(
    () => computeCapacitySummary(staffUsers, getActiveTaskCount),
    [staffUsers, getActiveTaskCount]
  );
  const departmentCapacity = useMemo(
    () => computeDepartmentCapacity(staffByDepartment, getActiveTaskCount),
    [staffByDepartment, getActiveTaskCount]
  );

  const userRowKey = useCallback((index: number, data: UserRowData) => data.users[index]?.uid ?? index, []);
  const userRowProps = useMemo<UserRowData>(() => ({
    users,
    currentUser,
    isAdmin,
    getActiveTaskCount,
    onSelect: setSelectedUser,
    onEdit: handleEdit,
    onDelete: handleDeleteClick,
  }), [users, currentUser, isAdmin, getActiveTaskCount, handleEdit, handleDeleteClick]);
  const userListHeight = Math.min(users.length * ROW_HEIGHT, LIST_MAX_HEIGHT);

  if (isLoading) return <TeamListSkeleton />;

  return (
    <PageShell>

      {/* ── Header ───────────────────────────────────────────────── */}
      <PageHeader
        icon={Building}
        tone="gold"
        title="KURUMSAL ORGANİZASYON"
        subtitle={`${users.length} Personel`}
        actions={<>
          {/* View mode switcher toggle */}
          <SegmentedTabs
            variant="pill"
            ariaLabel="Kadro görünümü"
            activeId={viewMode}
            onChange={(id) => setViewMode(id as typeof viewMode)}
            tabs={[
              { id: 'grid', label: 'Kadro Listesi' },
              { id: 'tree', label: 'Şema Görünümü' },
            ]}
          />

          {isAdmin && (
            // Eskiden TaskBoard'un "Yeni Talimat" butonuyla farklı tracking
            // taşıyordu (bkz. Faz 1 tracking denetimi); ikisi de artık AYNI
            // Button varyantı.
            <Button variant="gold" size="sm" onClick={() => setIsAddModalOpen(true)}>
              <UserPlus className="w-3.5 h-3.5 stroke-[2]" />
              <span className="hidden sm:block">Yeni Kadro</span>
            </Button>
          )}
        </>}
      />

      <CapacityBand
        capacityPercent={capacityPercent}
        availableStaffCount={availableStaffCount}
        overloadedStaffCount={overloadedStaffCount}
        hasCapacityData={hasCapacityData}
        departmentCapacity={departmentCapacity}
      />

      {/* ── Birim Yönetimi (yalnızca Admin) ─────────────────────── */}
      {/* Yalnızca UI nezaketi: firestore.rules departman create/update/delete'i
          zaten isAdmin() ile kapatır (bkz. departments match bloğu). */}
      {isAdmin && (
        <DepartmentManager
          departments={departments}
          users={users}
          tasks={tasks}
          onRename={onRenameDepartment}
          onDelete={onDeleteDepartment}
        />
      )}

      {/* ── Personnel Cards Grid / Org Tree ─────────────────────── */}
      {viewMode === 'grid' ? (
        users.length > VIRTUALIZE_THRESHOLD ? (
          // Sanallaştırılmış tek sütunlu liste (bkz. yukarıdaki VIRTUALIZE_THRESHOLD
          // yorumu) — yalnızca büyük kadrolarda (P2-19) devreye girer.
          <div className={PANEL_FRAME_CLASSNAME}>
            <List
              rowComponent={VirtualizedUserRow}
              rowCount={users.length}
              rowHeight={ROW_HEIGHT}
              rowProps={userRowProps}
              rowKey={userRowKey}
              style={{ height: userListHeight }}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {users.map((user, i) => (
              <UserCard
                key={user.uid}
                user={user}
                index={i}
                currentUser={currentUser}
                isAdmin={isAdmin}
                userTaskCount={getActiveTaskCount(user)}
                onSelect={setSelectedUser}
                onEdit={handleEdit}
                onDelete={handleDeleteClick}
              />
            ))}
          </div>
        )
      ) : (
        <OrgTree
          users={users}
          tasks={tasks}
          staffByDepartment={staffByDepartment}
          independentStaff={independentStaff}
          onSelect={setSelectedUser}
        />
      )}

      {/* ── User Detail Modal ─────────────────────────────────── */}
      <UserProfileModal
        selectedUser={selectedUser}
        onClose={() => setSelectedUser(null)}
        onEditRequest={handleEdit}
        currentUser={currentUser}
        isAdmin={isAdmin}
        users={users}
        tasks={tasks}
      />

      {/* ── Add User Modal ────────────────────────────────────── */}
      <AddUserModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        users={users}
        departments={departments}
        isAdmin={isAdmin}
        onCreateDepartment={onCreateDepartment}
        onAddUser={onAddUser}
      />

      {/* ── Edit User Modal ───────────────────────────────────── */}
      <EditUserModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        editingUser={editingUser}
        isAdmin={isAdmin}
        departments={departments}
        onCreateDepartment={onCreateDepartment}
        onSave={onUpdateUser}
      />

      {/* ── Delete Modal ──────────────────────────────────────── */}
      <DeleteUserDialog
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        userToDelete={userToDelete}
        tasks={tasks}
        onConfirm={confirmDelete}
      />
    </PageShell>
  );
};
