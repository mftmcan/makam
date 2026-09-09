import { useState, useEffect } from 'react';
import { AlertTriangle, Shield } from 'lucide-react';
import type { Department, Task, User, UserRole } from '../../types';
import { ROLE_LABELS } from '../../constants';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DepartmentPicker } from './subcomponents';

interface AddUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  departments: Department[];
  isAdmin: boolean;
  onCreateDepartment: (name: string) => Promise<string>;
  onAddUser: (data: { email: string; fullName: string; role: UserRole; departmentId?: string }) => void;
}

export function AddUserModal({ isOpen, onClose, users, departments, isAdmin, onCreateDepartment, onAddUser }: AddUserModalProps) {
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('Staff');
  const [newDept, setNewDept] = useState('');
  const [addUserError, setAddUserError] = useState('');

  const handleClose = () => {
    onClose();
    setAddUserError('');
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
      // Bkz. departman artık bir referanstır, üzerinde string dönüşümü
      // yapılmaz (bkz. kod denetimi P0-2).
      departmentId: newDept,
    });
    onClose();
    setNewEmail('');
    setNewName('');
    setNewRole('Staff');
    setNewDept('');
    setAddUserError('');
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Yeni Kadro Tanımla">
      <form onSubmit={handleAddSubmit} className="flex flex-col gap-4">
        {addUserError && (
          <div className="flex items-start gap-2 p-2.5 bg-status-danger/10 border border-status-danger/20 rounded-xl">
            <AlertTriangle className="w-3.5 h-3.5 text-status-danger flex-shrink-0 mt-0.5" />
            <p className="text-micro text-status-danger font-semibold uppercase tracking-label leading-relaxed">{addUserError}</p>
          </div>
        )}
        <Input label="Tam İsim" placeholder="Örn: Ali Yılmaz" value={newName} onChange={(e) => setNewName(e.target.value)} required />
        <Input label="E-posta" placeholder="orn@makam.com" type="email" value={newEmail} onChange={(e) => { setNewEmail(e.target.value); setAddUserError(''); }} required />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="add-user-role-select" className="text-micro font-medium text-text-tertiary uppercase tracking-eyebrow px-0.5">Yetki Seviyesi</label>
          <Select id="add-user-role-select" value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)} options={[
            { value: 'Staff', label: ROLE_LABELS.Staff },
            { value: 'Manager', label: ROLE_LABELS.Manager },
            { value: 'Admin', label: ROLE_LABELS.Admin },
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
          <Button variant="secondary" type="button" onClick={handleClose}>İptal</Button>
          <Button type="submit">Kadroyu Onayla</Button>
        </div>
      </form>
    </Modal>
  );
}

interface EditUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingUser: User | null;
  isAdmin: boolean;
  departments: Department[];
  onCreateDepartment: (name: string) => Promise<string>;
  onSave: (userId: string, data: Partial<User>) => void;
}

export function EditUserModal({ isOpen, onClose, editingUser, isAdmin, departments, onCreateDepartment, onSave }: EditUserModalProps) {
  const [editRole, setEditRole] = useState<UserRole>('Staff');
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editDept, setEditDept] = useState('');

  // editingUser her değiştiğinde (yeni bir "Düzenle" tıklaması) form alanları
  // o kullanıcının GÜNCEL değerleriyle senkronize edilir.
  useEffect(() => {
    if (editingUser) {
      setEditRole(editingUser.role);
      setEditName(editingUser.fullName);
      setEditEmail(editingUser.email);
      setEditDept(editingUser.departmentId || '');
    }
  }, [editingUser]);

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
      onSave(
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
              departmentId: editDept,
            }
          : { fullName: editName.trim() }
      );
      onClose();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Kadro Revizyonu">
      <div className="flex flex-col gap-4">
        <Input label="Tam İsim" value={editName} onChange={(e) => setEditName(e.target.value)} required />
        {isAdmin ? (
          <>
            <Input label="E-posta" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-user-role-select" className="text-micro font-medium text-text-tertiary uppercase tracking-eyebrow px-0.5">Yetki Seviyesi</label>
              <Select id="edit-user-role-select" value={editRole} onChange={(e) => setEditRole(e.target.value as UserRole)} options={[
                { value: 'Staff', label: ROLE_LABELS.Staff },
                { value: 'Manager', label: ROLE_LABELS.Manager },
                { value: 'Admin', label: ROLE_LABELS.Admin },
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
            <p className="text-micro text-text-tertiary font-medium uppercase tracking-label leading-relaxed">
              E-posta, yetki seviyesi ve departman yalnızca Admin tarafından değiştirilebilir.
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
          <Button variant="secondary" onClick={onClose}>İptal</Button>
          <Button onClick={handleSave}>Güncelle</Button>
        </div>
      </div>
    </Modal>
  );
}

interface DeleteUserDialogProps {
  isOpen: boolean;
  onClose: () => void;
  userToDelete: User | null;
  tasks: Task[];
  onConfirm: () => void;
}

export function DeleteUserDialog({ isOpen, onClose, userToDelete, tasks, onConfirm }: DeleteUserDialogProps) {
  const activeTaskCount = userToDelete
    ? tasks.filter(t =>
        (t.assigneeId === userToDelete.uid || t.assigneeId === userToDelete.email) &&
        t.status !== 'COMPLETED' && t.status !== 'CANCELLED'
      ).length
    : 0;

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Kadrodan Çıkar"
      message={<><strong className="text-status-danger font-medium">{userToDelete?.fullName}</strong> isimli personeli dizgeden çıkarmak istediğinize emin misiniz?</>}
      confirmLabel="Dizgeden Çıkar"
      onConfirm={onConfirm}
      warning={activeTaskCount > 0
        ? `Bu personelin üzerinde ${activeTaskCount} aktif talimat var. Silme işleminden sonra bu talimatlar sahipsiz kalacaktır — devam etmeden önce sorumluluğu başka bir personele devretmeniz önerilir.`
        : null}
    />
  );
}
