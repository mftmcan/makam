import React, { useState, useEffect, useMemo, useCallback, type ReactElement } from 'react';
import { UserPlus, Shield, Mail, Building, Trash2, Edit2, Target, CheckCircle2, AlertTriangle, Activity, ArrowRight, History, Loader2 } from 'lucide-react';
import { List, type RowComponentProps } from 'react-window';
import { User, UserRole, Task, AuditLog, TaskStatus, Department } from '../types';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Modal } from './ui/Modal';
import { Avatar } from './ui/Avatar';
import { Badge } from './ui/Badge';
import { cn, formatTimeAgo, formatDateTimeShort } from '../lib/utils';
import { isCompletedOnTime } from '../lib/sla';
import { ROLE_LABELS, STATUS_LABELS, STATUS_BADGE_VARIANT } from '../constants';
import { motion } from 'motion/react';
import { auditLogService } from '../services/auditLogService';
import { useUIStore } from '../store/uiStore';
import { AUDIT_FIELD_LABELS, formatAuditValue } from '../lib/auditLabels';
import { roleConfig, OrgNodeCard, DepartmentPicker } from './teamList/subcomponents';
import { DepartmentManager } from './teamList/DepartmentManager';
import { Skeleton } from './ui/Skeleton';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { logger } from '../lib/logger';

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

interface UserRowData {
  users: User[];
  currentUser: User | null;
  isAdmin: boolean;
  getActiveTaskCount: (u: { uid: string; email: string }) => number;
  onSelect: (user: User) => void;
  onEdit: (user: User) => void;
  onDelete: (user: User) => void;
}

function VirtualizedUserRow({
  index, style, ariaAttributes, users, currentUser, isAdmin, getActiveTaskCount, onSelect, onEdit, onDelete,
}: RowComponentProps<UserRowData>): ReactElement | null {
  const user = users[index];
  if (!user) return null;
  const canEdit = isAdmin || user.uid === currentUser?.uid;
  const userTaskCount = getActiveTaskCount(user);
  const rc = roleConfig[user.role];

  return (
    <div style={style} {...ariaAttributes}>
      <div
        role="button"
        tabIndex={0}
        aria-label={user.fullName}
        onClick={() => onSelect(user)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(user);
          }
        }}
        className={cn(
          'group flex items-center gap-3 h-full px-3.5 box-border cursor-pointer border-b border-l-2 border-l-transparent border-b-surface-border/60 hover:bg-makam-glass transition-colors',
          userTaskCount >= 5 && 'border-l-status-danger'
        )}
      >
        <Avatar name={user.fullName} photoURL={user.photoURL} size="md" className="flex-shrink-0" />

        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="text-[12.5px] font-medium text-executive-blue truncate tracking-tight font-serif">
            {user.fullName}
          </span>
          <div className="flex items-center gap-1.5 text-[9px] text-text-tertiary min-w-0">
            <Mail className="w-2.5 h-2.5 flex-shrink-0 opacity-60" />
            <span className="truncate">{user.email}</span>
          </div>
        </div>

        <span className={cn(
          'hidden sm:inline-flex items-center gap-1 text-[8px] font-medium uppercase tracking-[0.2em] px-2 py-0.5 rounded-full border flex-shrink-0',
          rc.bg, rc.text, rc.border
        )}>
          <Shield className="w-2.5 h-2.5 stroke-[1.5]" />
          {ROLE_LABELS[user.role]}
        </span>

        {user.departmentId && (
          <span className="hidden md:inline-flex items-center gap-1 text-[8px] font-medium uppercase tracking-[0.2em] px-2 py-0.5 rounded-full bg-transparent text-text-tertiary border border-surface-border flex-shrink-0 max-w-[130px]">
            <Building className="w-2.5 h-2.5 flex-shrink-0" />
            <span className="truncate">{user.departmentId}</span>
          </span>
        )}

        {userTaskCount > 0 && (
          <span className={cn(
            'hidden lg:inline-flex items-center gap-1 text-[8px] font-medium uppercase tracking-[0.2em] px-2 py-0.5 rounded-full border flex-shrink-0',
            userTaskCount >= 5 ? 'bg-status-danger/[0.08] text-status-danger border-status-danger/25' :
            userTaskCount >= 3 ? 'bg-status-warning/[0.08] text-status-warning border-status-warning/25' :
            'bg-status-success/[0.08] text-status-success border-status-success/25'
          )}>
            <Activity className="w-2.5 h-2.5" />
            {userTaskCount}
          </span>
        )}

        {canEdit && (
          <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
            <button
              className="w-7 h-7 flex items-center justify-center bg-makam-glass border border-executive-blue/[0.06] rounded-lg text-text-tertiary hover:text-executive-blue hover:bg-surface-elevated transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
              onClick={(e) => { e.stopPropagation(); onEdit(user); }}
              title="Düzenle"
              aria-label={`${user.fullName} kaydını düzenle`}
            >
              <Edit2 className="w-3 h-3 stroke-[1.5]" />
            </button>
            {isAdmin && user.uid !== currentUser?.uid && (
              <button
                className="w-7 h-7 flex items-center justify-center bg-makam-glass border border-executive-blue/[0.06] rounded-lg text-text-tertiary hover:text-status-danger hover:bg-status-danger/10 transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger"
                onClick={(e) => { e.stopPropagation(); onDelete(user); }}
                title="Sil"
                aria-label={`${user.fullName} kaydını sil`}
              >
                <Trash2 className="w-3 h-3 stroke-[1.5]" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

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
  <div className="flex flex-col gap-5 py-4 max-w-[1440px] mx-auto" aria-label="Kadro yükleniyor..." role="status">
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
  </div>
);

export const TeamList = ({ users, tasks, currentUser, departments, onUpdateUser, onDeleteUser, onAddUser, onCreateDepartment, onRenameDepartment, onDeleteDepartment, isLoading = false }: TeamListProps) => {
  const addToast = useUIStore(state => state.addToast);
  const isAdmin = useIsAdmin(currentUser);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('Staff');
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editDept, setEditDept] = useState('');

  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('Staff');
  const [newDept, setNewDept] = useState('');
  const [addUserError, setAddUserError] = useState('');

  const [viewMode, setViewMode] = useState<'grid' | 'tree'>('grid');
  const [modalTab, setModalTab] = useState<'tasks' | 'logs'>('tasks');
  const [userLogs, setUserLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  useEffect(() => {
    // Denetim İzi yalnızca Admin'e VEYA kendi profiline bakan kullanıcıya
    // gösterilir. Eskiden herkes herkesin geçmişini görebiliyordu; bu geçmiş
    // ilgili görevin başlık/açıklama/kanıt gibi alan-bazlı değişikliklerini
    // içerdiğinden, başka departmandaki bir görev için de sızdırılabiliyordu
    // (bkz. kod denetimi + firestore.rules'taki audit_logs departman kısıtı).
    const canViewAuditTrail = !!selectedUser && (isAdmin || selectedUser.uid === currentUser?.uid);
    if (!selectedUser || !canViewAuditTrail) {
      setUserLogs([]);
      setModalTab('tasks');
      return;
    }
    const fetchUserLogs = async () => {
      setLoadingLogs(true);
      try {
        // Sunucu tarafında changedBy'a göre filtrelenir (uid VEYA email) —
        // önceki hâli son 80 GLOBAL kaydı çekip istemcide filtreliyordu, az
        // işlem yapan/pasif personelin geçmişi bu yüzden eksik görünebiliyordu.
        const logs = await auditLogService.queryUserLogs(selectedUser.uid, selectedUser.email);
        setUserLogs(logs);
      } catch (error) {
        logger.error('Error fetching user logs:', error);
        addToast({ title: '⚠️ Denetim İzi Yüklenemedi', body: 'Personel geçmişi getirilirken bir hata oluştu.', type: 'danger' });
      } finally {
        setLoadingLogs(false);
      }
    };
    fetchUserLogs();
    // currentUser NESNESİNİN TAMAMI değil, yalnızca uid'i bağımlılık olarak
    // kullanılır — useSLASync/useSelfHealing'te de uygulanan AYNI prensip:
    // photoURL/fcmTokens gibi alakasız bir alan değiştiğinde currentUser
    // yeni bir referansla set edilir, bu da (uid değişmediği halde) gereksiz
    // bir yeniden-fetch + kısa bir spinner flicker'ına yol açardı (bkz. kod
    // denetimi).
  }, [selectedUser, currentUser?.uid]);

  // useCallback: sanallaştırılmış liste açıkken (bkz. userRowProps altta) her
  // satıra geçirilen rowProps nesnesinin kimliği bu fonksiyonların referansına
  // bağlı — sabit bir referans olmadan her TeamList render'ında yeni bir
  // rowProps nesnesi (ve dolayısıyla react-window'un gereksiz yeniden ölçümü)
  // üretilirdi.
  const handleEdit = useCallback((user: User) => {
    setEditingUser(user);
    setEditRole(user.role);
    setEditName(user.fullName);
    setEditEmail(user.email);
    setEditDept(user.departmentId || '');
    setIsEditModalOpen(true);
  }, []);

  const handleSave = () => {
    // Edit User modalı gerçek bir <form> değil (bkz. altındaki JSX), bu yüzden
    // Input'lardaki `required` özniteliği hiçbir zaman devreye girmez — boş
    // isim/e-posta ile "Güncelle"ye basılırsa kullanıcı kaydı sessizce boş
    // alanlarla güncellenirdi (bkz. kod denetimi). Add User formundaki
    // (handleAddSubmit) aynı boş-alan koruması burada da zorunlu kılınır.
    if (!editName.trim() || (isAdmin && !editEmail.trim())) return;
    if (editingUser) {
      // Firestore kuralları, kullanıcının kendi profilini düzenlerken yalnızca
      // fullName/photoURL/fcmTokens değiştirmesine izin verir — role/email/
      // departmentId yalnızca Admin tarafından değiştirilebilir.
      onUpdateUser(
        editingUser.uid,
        isAdmin
          ? {
              role: editRole,
              fullName: editName.trim(),
              email: editEmail.toLowerCase().trim(),
              // .trim() BİLİNÇLİ olarak kaldırıldı: değer artık serbest metin
              // değil, DepartmentPicker'dan gelen bir departman ID'sidir ve
              // aynı zamanda departments dokümanının ID'sidir. Burada herhangi
              // bir dönüşüm uygulamak, referansı sessizce var olmayan bir
              // departmana kaydırabilirdi (bkz. kod denetimi P0-2).
              departmentId: editDept
            }
          : { fullName: editName.trim() }
      );
      setIsEditModalOpen(false);
    }
  };

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

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !newName) return;
    const normalizedEmail = newEmail.toLowerCase().trim();
    if (users.some(u => u.email.toLowerCase().trim() === normalizedEmail)) {
      setAddUserError('Bu e-posta adresine sahip bir personel zaten kayıtlı.');
      return;
    }
    onAddUser({
      email: normalizedEmail,
      fullName: newName.trim(),
      role: newRole,
      // Bkz. handleSave'deki aynı gerekçe — departman artık bir referanstır,
      // üzerinde string dönüşümü yapılmaz.
      departmentId: newDept
    });
    setIsAddModalOpen(false);
    setNewEmail('');
    setNewName('');
    setNewRole('Staff');
    setNewDept('');
    setAddUserError('');
  };

  // Kullanıcı başına aktif görev sayısını tek geçişte hesaplayıp Map'te tutar —
  // aksi halde her personel için tasks dizisi ayrı ayrı filtrelenir (O(kullanıcı × görev)
  // yerine burada tek O(görev) geçiş + O(1) lookup).
  const activeTaskCountByUser = useMemo(() => {
    const map = new Map<string, number>();
    const bump = (key: string | undefined) => {
      if (!key) return;
      map.set(key, (map.get(key) ?? 0) + 1);
    };
    for (const t of tasks) {
      if (t.status === 'COMPLETED' || t.status === 'CANCELLED') continue;
      bump(t.assigneeId);
    }
    return map;
  }, [tasks]);

  const getActiveTaskCount = useCallback((u: { uid: string; email: string }) =>
    (activeTaskCountByUser.get(u.uid) ?? 0) + (u.email !== u.uid ? (activeTaskCountByUser.get(u.email) ?? 0) : 0),
  [activeTaskCountByUser]);

  const staffUsers = useMemo(() => users.filter(u => u.role === 'Staff'), [users]);

  // Şema (tree) görünümünde her yönetici için ayrı ayrı users.filter()
  // çağırmak yerine (O(yönetici × personel)) departman başına tek geçişte
  // gruplanır (O(personel) + O(1) lookup).
  const staffByDepartment = useMemo(() => {
    const map = new Map<string, User[]>();
    for (const u of users) {
      if (u.role !== 'Staff') continue;
      const key = u.departmentId ?? '';
      const list = map.get(key);
      if (list) list.push(u); else map.set(key, [u]);
    }
    return map;
  }, [users]);

  const independentStaff = useMemo(() => users.filter(u =>
    u.role === 'Staff' && (!u.departmentId || !users.some(m => m.role === 'Manager' && m.departmentId === u.departmentId))
  ), [users]);

  const selectedUserAllTasks = useMemo(() => {
    if (!selectedUser) return [];
    return tasks.filter(t => t.assigneeId === selectedUser.uid || t.assigneeId === selectedUser.email);
  }, [tasks, selectedUser]);

  const tasksById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);

  const { capacityPercent, availableStaffCount, overloadedStaffCount, hasCapacityData } = useMemo(() => {
    let total = 0, available = 0, overloaded = 0;
    for (const u of staffUsers) {
      const count = getActiveTaskCount(u);
      total += count;
      if (count <= 2) available++;
      if (count >= 5) overloaded++;
    }
    const max = Math.max(1, staffUsers.length * 4);
    return {
      capacityPercent: Math.min(100, Math.round((total / max) * 100)),
      availableStaffCount: available,
      overloadedStaffCount: overloaded,
      hasCapacityData: total > 0,
    };
  }, [staffUsers, activeTaskCountByUser]);

  // Tek bir organizasyon-geneli yüzde, "hangi BİRİM gerçekten aşırı yüklü"
  // sorusuna cevap vermiyordu — iki dengeli departman ortalamada dengeli
  // görünüp aslında biri boşta biri tıka basa dolu olabilirdi (bkz. tasarım
  // denetimi). capacityPercent ile AYNI formül (aktif görev / (kişi × 4))
  // yalnızca departman bazında tekrarlanır. Departmansız ('') personel ayrı
  // bir grup olarak gösterilir, yoksayılmaz.
  const departmentCapacity = useMemo(() => {
    const rows: { department: string; percent: number; staffCount: number }[] = [];
    for (const [dept, staffList] of staffByDepartment.entries()) {
      if (staffList.length === 0) continue;
      let total = 0;
      for (const u of staffList) total += getActiveTaskCount(u);
      const max = Math.max(1, staffList.length * 4);
      rows.push({
        department: dept || 'Departmansız',
        percent: Math.min(100, Math.round((total / max) * 100)),
        staffCount: staffList.length,
      });
    }
    return rows.sort((a, b) => b.percent - a.percent);
  }, [staffByDepartment, activeTaskCountByUser]);

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
    <div className="flex flex-col gap-5 py-4 max-w-[1440px] mx-auto font-sans">

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-executive-blue/[0.04]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-executive-gold flex items-center justify-center shadow-lg">
            <Building className="w-4 h-4 text-[color:var(--btn-primary-text)] stroke-[1.5]" />
          </div>
          <div>
            <span className="text-[10px] font-medium text-executive-blue uppercase tracking-[0.4em] block leading-none">KURUMSAL ORGANİZASYON</span>
            <span className="text-[9px] text-text-tertiary uppercase tracking-[0.3em]">{users.length} Personel</span>
          </div>
        </div>
        
        <div className="flex items-center gap-3 flex-wrap">
          {/* View mode switcher toggle */}
          <div className="flex bg-surface-glass p-0.5 rounded-full border border-executive-blue/[0.04] items-center gap-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                "px-3 py-1.5 rounded-full text-[8.5px] uppercase tracking-wider font-bold transition-all duration-300 cursor-pointer",
                viewMode === 'grid' ? "bg-executive-blue text-[color:var(--executive-blue-text)] shadow-sm" : "text-text-muted hover:text-text-heading"
              )}
            >
              Kadro Listesi
            </button>
            <button
              onClick={() => setViewMode('tree')}
              className={cn(
                "px-3 py-1.5 rounded-full text-[8.5px] uppercase tracking-wider font-bold transition-all duration-300 cursor-pointer",
                viewMode === 'tree' ? "bg-executive-blue text-[color:var(--executive-blue-text)] shadow-sm" : "text-text-muted hover:text-text-heading"
              )}
            >
              Şema Görünümü
            </button>
          </div>

          {isAdmin && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-1.5 px-4 h-9 rounded-full bg-executive-gold text-[color:var(--btn-primary-text)] text-[9px] font-medium uppercase tracking-[0.3em] shadow-lg shadow-executive-gold/20 hover:shadow-xl hover:bg-executive-gold-hover hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
            >
              <UserPlus className="w-3.5 h-3.5 stroke-[2]" />
              <span className="hidden sm:block">Yeni Kadro</span>
            </button>
          )}
        </div>
      </div>

      {/* Team Capacity Header Band */}
      <div className="flex flex-col gap-3 p-3.5 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-text-muted uppercase tracking-wider font-bold">Kadro Kapasite Endeksi:</span>
            {hasCapacityData ? (
              <>
                <div className="w-24 h-1.5 bg-executive-blue/5 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300",
                      capacityPercent >= 85 ? "bg-status-danger" :
                      capacityPercent >= 55 ? "bg-status-warning" :
                      "bg-status-success"
                    )}
                    style={{ width: `${capacityPercent}%` }}
                  />
                </div>
                <span className="text-[11px] font-bold text-text-heading">%{capacityPercent}</span>
              </>
            ) : (
              <span className="text-[10px] text-text-tertiary">Kapasite verisi için en az 1 aktif talimat gerekli</span>
            )}
          </div>
          <div className="flex gap-4 text-[10px] text-text-muted uppercase tracking-wider font-bold">
            <span>Müsait Kadro: <span className="text-status-success font-bold">{availableStaffCount}</span></span>
            <span>Aşırı Yüklü: <span className={overloadedStaffCount > 0 ? "text-status-danger font-bold animate-pulse" : "text-text-muted font-bold"}>{overloadedStaffCount}</span></span>
          </div>
        </div>

        {/* Departman bazlı kırılım — yalnızca 2+ departman temsil ediliyorsa
            anlamlı (tek departmanda zaten yukarıdaki toplamla birebir aynı
            sayıyı tekrar eder, bkz. tasarım denetimi). */}
        {hasCapacityData && departmentCapacity.length > 1 && (
          <div className="flex flex-wrap gap-2.5 pt-3 border-t border-executive-blue/[0.04]">
            {departmentCapacity.map(row => (
              <div key={row.department} className="flex items-center gap-2 px-2.5 py-1.5 bg-surface-glass border border-surface-border rounded-xl">
                <span className="text-[9px] text-text-muted uppercase tracking-wider font-bold truncate max-w-[110px]">{row.department}</span>
                <div className="w-14 h-1 bg-executive-blue/5 rounded-full overflow-hidden flex-shrink-0">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300",
                      row.percent >= 85 ? "bg-status-danger" :
                      row.percent >= 55 ? "bg-status-warning" :
                      "bg-status-success"
                    )}
                    style={{ width: `${row.percent}%` }}
                  />
                </div>
                <span className="text-[9px] font-bold text-text-heading tabular-nums">%{row.percent}</span>
              </div>
            ))}
          </div>
        )}
      </div>

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
          <div className="bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl overflow-hidden shadow-[0_1px_8px_rgba(22,21,19,0.02)]">
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
          {users.map((user, i) => {
            const canEdit = isAdmin || user.uid === currentUser?.uid;
            const userTaskCount = getActiveTaskCount(user);
            const rc = roleConfig[user.role];

            return (
              <motion.div
                key={user.uid}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 28, delay: i * 0.04 }}
                whileHover={{ y: -2, scale: 1.005 }}
                onClick={() => setSelectedUser(user)}
                className={cn(
                  "group flex flex-col gap-3 p-4 bg-makam-glass backdrop-blur-xl border-x border-b border-surface-border rounded-2xl shadow-[0_1px_8px_rgba(22,21,19,0.02)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] hover:bg-surface-elevated hover:border-surface-border transition-all duration-300 cursor-pointer relative border-t-2",
                  userTaskCount >= 5 ? "border-t-status-danger" : "border-t-surface-border"
                )}
              >
                {/* Action buttons (hover) */}
                {canEdit && (
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all duration-300 translate-x-2 group-hover:translate-x-0 group-focus-within:translate-x-0">
                    <button
                      className="w-7 h-7 flex items-center justify-center bg-makam-glass border border-executive-blue/[0.06] rounded-lg text-text-tertiary hover:text-executive-blue hover:bg-surface-elevated transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
                      onClick={(e) => { e.stopPropagation(); handleEdit(user); }}
                      title="Düzenle"
                      aria-label={`${user.fullName} kaydını düzenle`}
                    >
                      <Edit2 className="w-3 h-3 stroke-[1.5]" />
                    </button>
                    {isAdmin && user.uid !== currentUser?.uid && (
                      <button
                        className="w-7 h-7 flex items-center justify-center bg-makam-glass border border-executive-blue/[0.06] rounded-lg text-text-tertiary hover:text-status-danger hover:bg-status-danger/10 transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger"
                        onClick={(e) => { e.stopPropagation(); handleDeleteClick(user); }}
                        title="Sil"
                        aria-label={`${user.fullName} kaydını sil`}
                      >
                        <Trash2 className="w-3 h-3 stroke-[1.5]" />
                      </button>
                    )}
                  </div>
                )}

                {/* Top: avatar + name */}
                <div className="flex items-center gap-3">
                  <Avatar
                    name={user.fullName}
                    photoURL={user.photoURL}
                    size="lg"
                    className="group-hover:scale-105 group-hover:rotate-3 transition-all duration-300"
                  />
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <h4 className="text-[13px] font-medium text-executive-blue truncate tracking-tight font-serif group-hover:text-executive-blue transition-colors">
                      {user.fullName}
                    </h4>
                    <div className="flex items-center gap-1.5 text-[9px] text-text-tertiary truncate">
                      <Mail className="w-2.5 h-2.5 flex-shrink-0 opacity-60" />
                      <span className="truncate">{user.email}</span>
                    </div>
                  </div>
                </div>

                {/* Divider */}
                <div className="h-px bg-executive-blue/[0.04]" />

                {/* Bottom: role + dept + active tasks */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={cn(
                      'inline-flex items-center gap-1 text-[8px] font-medium uppercase tracking-[0.2em] px-2 py-0.5 rounded-full border',
                      rc.bg, rc.text, rc.border
                    )}>
                      <Shield className="w-2.5 h-2.5 stroke-[1.5]" />
                      {ROLE_LABELS[user.role]}
                    </span>
                    {user.departmentId && (
                      // Dolu rol rozetinden bilinçli olarak ayrışsın diye tamamen
                      // ghost/outline: zemin dolgusu yok, yalnızca ince kenarlık
                      // (bkz. kod denetimi — rol ile departman rozeti aynı gri
                      // yoğunlukta olduğunda ilk bakışta ayırt edilemiyordu).
                      <span className="inline-flex items-center gap-1 text-[8px] font-medium uppercase tracking-[0.2em] px-2 py-0.5 rounded-full bg-transparent text-text-tertiary border border-surface-border">
                        <Building className="w-2.5 h-2.5" />
                        {user.departmentId}
                      </span>
                    )}
                  </div>
                  {userTaskCount > 0 && (
                    <span className={cn(
                      "inline-flex items-center gap-1 text-[8px] font-medium uppercase tracking-[0.2em] px-2 py-0.5 rounded-full border transition-all duration-300",
                      userTaskCount >= 5 ? "bg-status-danger/[0.08] text-status-danger border-status-danger/25 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.15)]" :
                      userTaskCount >= 3 ? "bg-status-warning/[0.08] text-status-warning border-status-warning/25" :
                      "bg-status-success/[0.08] text-status-success border-status-success/25"
                    )}>
                      <Activity className="w-2.5 h-2.5" />
                      {userTaskCount} {userTaskCount >= 5 ? 'Aşırı Yük' : userTaskCount >= 3 ? 'Dengeli' : 'Müsait'}
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
        )
      ) : (
        <div className="flex flex-col items-center gap-12 py-8 overflow-x-auto w-full no-scrollbar select-none bg-makam-glass border border-surface-border rounded-3xl p-6">
          {/* Level 1: Admins */}
          <div className="flex flex-col items-center gap-2">
            <span className="text-[8px] font-bold uppercase tracking-[0.3em] text-status-danger bg-status-danger/10 border border-status-danger/20 px-2.5 py-1 rounded-full">Yönetim Kurulu</span>
            <div className="flex flex-wrap justify-center gap-6 mt-2">
              {users.filter(u => u.role === 'Admin').map(u => (
                <OrgNodeCard key={u.uid} user={u} tasks={tasks} onSelect={setSelectedUser} />
              ))}
            </div>
          </div>

          {/* Connection Line */}
          <div className="w-[1px] h-8 bg-executive-blue/15" />

          {/* Level 2: Managers */}
          <div className="flex flex-col items-center gap-4 w-full">
            <span className="text-[8px] font-bold uppercase tracking-[0.3em] text-executive-blue bg-executive-blue/5 border border-executive-blue/10 px-2.5 py-1 rounded-full">Birim Yöneticileri</span>
            <div className="flex flex-wrap justify-center gap-8 mt-2 w-full">
              {users.filter(u => u.role === 'Manager').map(u => {
                const staffInDept = staffByDepartment.get(u.departmentId ?? '') ?? [];
                return (
                  <div key={u.uid} className="flex flex-col items-center gap-4 bg-executive-blue/[0.01] p-4 rounded-2xl border border-executive-blue/[0.03]">
                    <OrgNodeCard user={u} tasks={tasks} onSelect={setSelectedUser} />
                    {staffInDept.length > 0 && (
                      <>
                        <div className="w-[1px] h-4 bg-executive-blue/10" />
                        {/* max-w sabit 400px'ti — dış konteynerin overflow-x-auto
                            (bkz. mobil tasarım denetimi) tam da bunun gibi bir
                            kadro grubunun mobil ekrandan (~360-400px) geniş
                            olduğu durumlar için bir kaçış yoluydu, ama no-scrollbar
                            ile kaydırma ipucu görünmez olduğundan içerik sessizce
                            "kesilmiş" görünüyordu. Sınır artık viewport'u da
                            hesaba katıyor, gerçek taşmayı büyük ölçüde önler. */}
                        <div className="flex flex-wrap justify-center gap-2.5 max-w-[min(400px,calc(100vw-8rem))]">
                          {staffInDept.map(staff => (
                            <OrgNodeCard key={staff.uid} user={staff} tasks={tasks} onSelect={setSelectedUser} isMini />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Staff without matching department managers */}
          {independentStaff.length > 0 && (
            <>
              <div className="w-[1px] h-8 bg-executive-blue/15" />
              <div className="flex flex-col items-center gap-2">
                <span className="text-[8px] font-bold uppercase tracking-[0.3em] text-text-tertiary bg-surface-glass border border-surface-border px-2.5 py-1 rounded-full">Bağımsız Kadro</span>
                <div className="flex flex-wrap justify-center gap-3 mt-2">
                  {independentStaff.map(u => (
                    <OrgNodeCard key={u.uid} user={u} tasks={tasks} onSelect={setSelectedUser} isMini />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── User Detail Modal ─────────────────────────────────── */}
      <Modal isOpen={!!selectedUser} onClose={() => setSelectedUser(null)} title="Kadro Profili" size="lg">
        {selectedUser && (() => {
          const rc = roleConfig[selectedUser.role];
          // Admin ya da kendi profiline bakan kullanıcı — hem "profili
          // düzenle" butonu hem Denetim İzi sekmesinin görünürlüğü için AYNI
          // yetki kuralı; tek yerde hesaplanır (bkz. kod denetimi: eskiden bu
          // ifade üç kez bağımsız olarak tekrarlanıyordu).
          const canEditOrViewOwnAudit = isAdmin || selectedUser.uid === currentUser?.uid;
          const userAllTasks = selectedUserAllTasks;
          const completedTasks = userAllTasks.filter(t => t.status === 'COMPLETED');
          // lib/sla.ts'teki isCompletedOnTime üzerinden — Dashboard/Reports ile
          // aynı tanım kullanılır (bkz. kod denetimi: eskiden burada bağımsız
          // bir formül vardı, ekranlar arası çelişkili SLA yüzdesi üretiyordu).
          const completedWithSla = completedTasks.filter(isCompletedOnTime);
          const slaSuccessRate = completedTasks.length > 0
            ? Math.round((completedWithSla.length / completedTasks.length) * 100)
            : 100;

          return (
            <div className="flex flex-col gap-5 font-sans">
              {/* Profile header */}
              <div className="flex flex-col md:flex-row md:items-center gap-4 p-4 bg-surface-glass rounded-2xl border border-executive-blue/[0.04]">
                {/* #10 — Avatar (Modal) */}
                <Avatar
                  name={selectedUser.fullName}
                  photoURL={selectedUser.photoURL}
                  size="xl"
                  ring
                  className="rounded-2xl flex-shrink-0"
                />
                <div className="flex flex-col gap-1 flex-1 min-w-0 w-full">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[18px] font-medium text-executive-blue font-serif tracking-tight truncate">
                      {selectedUser.fullName}
                    </h3>
                    {canEditOrViewOwnAudit && (
                      <button
                        onClick={() => { setSelectedUser(null); handleEdit(selectedUser); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-elevated border border-executive-blue/[0.06] rounded-xl text-[9px] font-medium text-text-muted hover:text-executive-blue hover:bg-surface-glass transition-all shadow-sm flex-shrink-0"
                      >
                        <Edit2 className="w-3 h-3" />
                        Düzenle
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[10px] text-text-tertiary flex items-center gap-1">
                      <Mail className="w-2.5 h-2.5" />
                      {selectedUser.email}
                    </span>
                    <span className="text-[10px] text-text-tertiary flex items-center gap-1">
                      <Building className="w-2.5 h-2.5" />
                      {selectedUser.departmentId || 'Genel Merkez'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    <span className={cn(
                      'inline-flex items-center gap-1 text-[8px] font-medium uppercase tracking-[0.25em] px-2 py-0.5 rounded-full border',
                      rc.bg, rc.text, rc.border
                    )}>
                      <Shield className="w-2.5 h-2.5" />
                      {ROLE_LABELS[selectedUser.role]}
                    </span>
                  </div>

                  {/* Operational Score Metrikleri */}
                  <div className="grid grid-cols-2 gap-3 mt-3.5">
                    <div className="p-2.5 bg-makam-glass border border-surface-border rounded-xl flex flex-col gap-0.5">
                      <span className="text-[8px] text-text-tertiary uppercase tracking-wider font-bold">Bitirilen Talimat</span>
                      <span className="text-[13px] font-bold text-executive-blue font-serif">{completedTasks.length} Talimat</span>
                    </div>
                    <div className="p-2.5 bg-makam-glass border border-surface-border rounded-xl flex flex-col gap-0.5">
                      <span className="text-[8px] text-text-tertiary uppercase tracking-wider font-bold">SLA Uyum Başarısı</span>
                      <span className={cn(
                        "text-[13px] font-bold font-serif",
                        slaSuccessRate >= 80 ? "text-status-success" :
                        slaSuccessRate >= 50 ? "text-status-warning" :
                        "text-status-danger"
                      )}>
                        %{slaSuccessRate}
                      </span>
                    </div>
                  </div>
                  {/* Tab Selector inside profile details — Denetim İzi sekmesi
                      yalnızca Admin'e veya kendi profiline bakan kullanıcıya
                      gösterilir (bkz. kod denetimi: departman izolasyonu). */}
                  <div className="flex bg-surface-glass p-0.5 rounded-xl border border-executive-blue/[0.04] items-center gap-0.5 mt-2.5">
                    <button
                      onClick={() => setModalTab('tasks')}
                      className={cn(
                        "flex-1 py-1.5 rounded-lg text-[9px] uppercase tracking-wider font-bold transition-all duration-300 cursor-pointer text-center",
                        modalTab === 'tasks' ? "bg-executive-blue text-[color:var(--executive-blue-text)] shadow-sm" : "text-text-muted hover:text-text-heading"
                      )}
                    >
                      Sorumluluk Alanı
                    </button>
                    {canEditOrViewOwnAudit && (
                      <button
                        onClick={() => setModalTab('logs')}
                        className={cn(
                          "flex-1 py-1.5 rounded-lg text-[9px] uppercase tracking-wider font-bold transition-all duration-300 cursor-pointer text-center",
                          modalTab === 'logs' ? "bg-executive-blue text-[color:var(--executive-blue-text)] shadow-sm" : "text-text-muted hover:text-text-heading"
                        )}
                      >
                        Denetim İzi
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Tasks / Logs Tab views */}
              {modalTab === 'tasks' || !canEditOrViewOwnAudit ? (
                <div>
                  <div className="flex items-center gap-2 mb-3 mt-1">
                    <Target className="w-3.5 h-3.5 text-executive-gold" />
                    <span className="text-[9px] font-medium text-text-tertiary uppercase tracking-[0.35em]">
                      Sorumluluk Alanı — {userAllTasks.length} Talimat
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto custom-scrollbar pr-1">
                    {userAllTasks.length > 0 ? (
                      userAllTasks.map((task, i) => (
                        <motion.div
                          key={task.id}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.03 }}
                          className="flex items-center gap-3 p-3 bg-makam-glass border border-surface-border rounded-xl group cursor-pointer hover:bg-surface-elevated hover:shadow-sm transition-all"
                        >
                          <div className={cn(
                            'w-7 h-7 rounded-xl flex items-center justify-center border flex-shrink-0',
                            task.status === 'COMPLETED' ? 'bg-status-success/10 text-status-success border-status-success/20' :
                            task.status === 'BLOCKED'   ? 'bg-status-danger/10 text-status-danger border-status-danger/20' :
                            task.status === 'IN_PROGRESS'? 'bg-executive-blue/5 text-executive-blue border-executive-blue/10' :
                            'bg-surface-glass text-text-tertiary border-surface-border'
                          )}>
                            {task.status === 'COMPLETED' ? <CheckCircle2 className="w-3.5 h-3.5 stroke-[1.3]" /> :
                             task.status === 'BLOCKED'   ? <AlertTriangle className="w-3.5 h-3.5 stroke-[1.3]" /> :
                             <Activity className="w-3.5 h-3.5 stroke-[1.3]" />}
                          </div>
                          <div className="flex flex-col gap-1.5 flex-1 min-w-0 items-start">
                            <span className="text-[12px] font-medium text-executive-blue line-clamp-1 font-serif tracking-tight">
                              {task.title}
                            </span>
                            <Badge variant={STATUS_BADGE_VARIANT[task.status] ?? 'default'}>
                              {STATUS_LABELS[task.status] || task.status}
                            </Badge>
                          </div>
                          <span className="text-[9px] text-text-tertiary flex-shrink-0">{formatTimeAgo(task.updatedAt, task.status)}</span>
                        </motion.div>
                      ))
                    ) : (
                      <div className="py-12 flex flex-col items-center justify-center rounded-xl border border-dashed border-executive-blue/[0.05] bg-surface-glass">
                        <CheckCircle2 className="w-8 h-8 text-surface-border/50 stroke-[1] mb-2" />
                        <span className="text-[9px] text-text-tertiary uppercase tracking-[0.35em]">Kayıtlı Talimat Yok</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2 mb-3 mt-1">
                    <History className="w-3.5 h-3.5 text-executive-gold" />
                    <span className="text-[9px] font-medium text-text-tertiary uppercase tracking-[0.35em]">
                      Denetim İzi — {userLogs.length} Kayıt
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto custom-scrollbar pr-1">
                    {loadingLogs ? (
                      <div className="py-12 flex justify-center items-center">
                        <Loader2 className="w-5 h-5 animate-spin text-executive-blue" />
                      </div>
                    ) : userLogs.length > 0 ? (
                      userLogs.map((log, i) => {
                        const relatedTask = tasksById.get(log.taskId);
                        const hasChanges = log.changes && Object.keys(log.changes).length > 0;

                        return (
                          <motion.div
                            key={log.id}
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.03 }}
                            className="flex flex-col gap-2 p-3 bg-makam-glass border border-surface-border rounded-xl"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-medium text-executive-blue truncate max-w-[220px] font-serif">
                                {relatedTask?.title || 'Bilinmeyen Talimat'}
                              </span>
                              <span className="text-[8px] text-text-tertiary font-mono">
                                {formatDateTimeShort(log.timestamp)}
                              </span>
                            </div>
                            
                            {hasChanges ? (
                              <div className="flex flex-col gap-1 pl-1 border-l border-executive-blue/10">
                                {Object.entries(log.changes!)
                                  .filter(([field]) => field in AUDIT_FIELD_LABELS)
                                  .map(([field, change]) => {
                                  const label = AUDIT_FIELD_LABELS[field] ?? field;
                                  return (
                                    <div key={field} className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-[7.5px] font-medium text-text-tertiary uppercase tracking-[0.2em] bg-surface-glass px-1 py-0.5 rounded border border-surface-border">
                                        {label}
                                      </span>
                                      <span className="text-[8.5px] text-status-danger/70 line-through">{formatAuditValue(field, change.old, users)}</span>
                                      <ArrowRight className="w-2 h-2 text-text-tertiary flex-shrink-0" />
                                      <span className="text-[8.5px] font-medium text-status-success">{formatAuditValue(field, change.new, users)}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[7.5px] font-medium text-text-tertiary uppercase tracking-[0.2em] bg-surface-glass px-1 py-0.5 rounded border border-surface-border">Durum</span>
                                <Badge variant={STATUS_BADGE_VARIANT[log.newValue as TaskStatus] ?? 'default'}>
                                  {STATUS_LABELS[log.newValue as TaskStatus] ?? String(log.newValue)}
                                </Badge>
                              </div>
                            )}
                          </motion.div>
                        );
                      })
                    ) : (
                      <div className="py-12 flex flex-col items-center justify-center rounded-xl border border-dashed border-executive-blue/[0.05] bg-surface-glass">
                        <History className="w-8 h-8 text-surface-border/50 stroke-[1] mb-2" />
                        <span className="text-[9px] text-text-tertiary uppercase tracking-[0.35em]">Kayıtlı İşlem Yok</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* ── Add User Modal ────────────────────────────────────── */}
      <Modal isOpen={isAddModalOpen} onClose={() => { setIsAddModalOpen(false); setAddUserError(''); }} title="Yeni Kadro Tanımla">
        <form onSubmit={handleAddSubmit} className="flex flex-col gap-4">
          {addUserError && (
            <div className="flex items-start gap-2 p-2.5 bg-status-danger/10 border border-status-danger/20 rounded-xl">
              <AlertTriangle className="w-3.5 h-3.5 text-status-danger flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-status-danger font-semibold uppercase tracking-[0.1em] leading-relaxed">{addUserError}</p>
            </div>
          )}
          <Input label="Tam İsim" placeholder="Örn: Ali Yılmaz" value={newName} onChange={(e) => setNewName(e.target.value)} required />
          <Input label="E-posta" placeholder="orn@makam.com" type="email" value={newEmail} onChange={(e) => { setNewEmail(e.target.value); setAddUserError(''); }} required />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="add-user-role-select" className="text-[9px] font-medium text-text-tertiary uppercase tracking-[0.35em] px-0.5">Yetki Seviyesi</label>
            <Select id="add-user-role-select" value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)} options={[
              { value: 'Staff', label: ROLE_LABELS.Staff },
              { value: 'Manager', label: ROLE_LABELS.Manager },
              { value: 'Admin', label: ROLE_LABELS.Admin }
            ]} />
          </div>
          <DepartmentPicker
            id="add-user-department-select"
            value={newDept}
            onChange={setNewDept}
            departments={departments}
            canCreate={isAdmin}
            onCreateDepartment={onCreateDepartment}
          />
          <div className="flex justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
            <Button variant="secondary" type="button" onClick={() => { setIsAddModalOpen(false); setAddUserError(''); }}>İptal</Button>
            <Button type="submit">Kadroyu Onayla</Button>
          </div>
        </form>
      </Modal>

      {/* ── Edit User Modal ───────────────────────────────────── */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="Kadro Revizyonu">
        <div className="flex flex-col gap-4">
          <Input label="Tam İsim" value={editName} onChange={(e) => setEditName(e.target.value)} required />
          {isAdmin ? (
            <>
              <Input label="E-posta" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-user-role-select" className="text-[9px] font-medium text-text-tertiary uppercase tracking-[0.35em] px-0.5">Yetki Seviyesi</label>
                <Select id="edit-user-role-select" value={editRole} onChange={(e) => setEditRole(e.target.value as UserRole)} options={[
                  { value: 'Staff', label: ROLE_LABELS.Staff },
                  { value: 'Manager', label: ROLE_LABELS.Manager },
                  { value: 'Admin', label: ROLE_LABELS.Admin }
                ]} />
              </div>
              <DepartmentPicker
                id="edit-user-department-select"
                value={editDept}
                onChange={setEditDept}
                departments={departments}
                canCreate={isAdmin}
                onCreateDepartment={onCreateDepartment}
              />
            </>
          ) : (
            <div className="flex items-start gap-2 p-2.5 bg-surface-glass border border-surface-border rounded-xl">
              <Shield className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0 mt-0.5" />
              <p className="text-[9px] text-text-tertiary font-medium uppercase tracking-[0.15em] leading-relaxed">
                E-posta, yetki seviyesi ve departman yalnızca Admin tarafından değiştirilebilir.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
            <Button variant="secondary" onClick={() => setIsEditModalOpen(false)}>İptal</Button>
            <Button onClick={handleSave}>Güncelle</Button>
          </div>
        </div>
      </Modal>

      {/* ── Delete Modal ──────────────────────────────────────── */}
      <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} title="Kadrodan Çıkar">
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-text-muted font-light leading-relaxed">
            <strong className="text-status-danger font-medium">{userToDelete?.fullName}</strong> isimli personeli dizgeden çıkarmak istediğinize emin misiniz?
          </p>
          {userToDelete && (() => {
            const activeTaskCount = tasks.filter(t =>
              (t.assigneeId === userToDelete.uid || t.assigneeId === userToDelete.email) &&
              t.status !== 'COMPLETED' && t.status !== 'CANCELLED'
            ).length;
            return activeTaskCount > 0 ? (
              <div className="flex items-start gap-2 p-2.5 bg-status-danger/10 border border-status-danger/20 rounded-xl">
                <AlertTriangle className="w-3.5 h-3.5 text-status-danger flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-status-danger font-semibold uppercase tracking-[0.1em] leading-relaxed">
                  Bu personelin üzerinde {activeTaskCount} aktif talimat var. Silme işleminden sonra bu talimatlar sahipsiz kalacaktır — devam etmeden önce sorumluluğu başka bir personele devretmeniz önerilir.
                </p>
              </div>
            ) : null;
          })()}
          <div className="flex justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
            <Button variant="secondary" onClick={() => setIsDeleteModalOpen(false)}>İptal</Button>
            <Button variant="danger" onClick={confirmDelete}>Dizgeden Çıkar</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
