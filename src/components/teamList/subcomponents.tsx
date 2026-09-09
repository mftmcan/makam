import { useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import type { User, UserRole, Task, Department } from '../../types';
import { cn } from '../../lib/utils';
import { Avatar } from '../ui/Avatar';
import { Select } from '../ui/Select';
import { ROLE_LABELS } from '../../constants';
import { logger } from '../../lib/logger';

// Rol rozeti her zaman "dolu" (belirgin arka plan + kenarlık) kalmalı ki
// Kadro kartlarındaki nötr/ghost departman rozetiyle karışmasın — Manager'ın
// eski %4 opaklığı, %5 opaklıktaki surface-glass departman zeminiyle neredeyse
// ayırt edilemiyordu (bkz. kod denetimi).
// Admin (Müftü) en üst yetki rolüdür — hata/alarm rengiyle (status-danger)
// işaretlenmesi yanlış bir sinyal veriyordu (bkz. tasarım denetimi); marka
// altınıyla ayrıcalıklı bir rol olarak işaretleniyor. Manager/Staff nötr
// tonlarda, aralarındaki hiyerarşi metin/kenarlık ağırlığıyla ayrışıyor.
export const roleConfig: Record<UserRole, { bg: string; text: string; border: string }> = {
  Admin:   { bg: 'bg-executive-gold/10', text: 'text-[color:var(--gold-text)]', border: 'border-executive-gold/25' },
  Manager: { bg: 'bg-transparent',       text: 'text-text-muted',     border: 'border-text-muted/25' },
  Staff:   { bg: 'bg-transparent',       text: 'text-text-tertiary',  border: 'border-text-tertiary/20' },
};

/** `<Select>` içinde "yeni birim oluştur" akışını açan sentinel değer.
 *  Gerçek bir departman ID'si olamayacak biçimde seçildi (departman adları
 *  `__x__` kalıbına uyamaz — bkz. departmentService.isUsableAsDepartmentId). */
const NEW_DEPARTMENT_OPTION = '__yeni__';

export interface DepartmentPickerProps {
  id: string;
  value: string;
  onChange: (departmentId: string) => void;
  departments: Department[];
  /** Yalnızca Admin yeni birim oluşturabilir (firestore.rules bunu ayrıca
   *  zorunlu kılar) — burada gizlemek yalnızca UI nezaketidir. */
  canCreate: boolean;
  onCreateDepartment: (name: string) => Promise<string>;
  disabled?: boolean;
}

/**
 * Departman ATAMA girdisi — serbest metin `<Input>`in yerini alır.
 *
 * NEDEN (bkz. kod denetimi P0-2): departman değeri firestore.rules'ta TAM
 * STRING EŞİTLİĞİYLE karşılaştırılıyor (`existing().departmentId ==
 * getUserDepartment()`). Serbest metin girişinde tek bir yazım hatası ya
 * kimsenin göremediği bir "hayalet departman" üretiyor ya da bir Müdürü kendi
 * biriminden koparıyordu. Artık değer yalnızca var olan bir departmandan
 * seçilebilir; yeni birim, bilinçli ve ayrı bir adımla oluşturulur.
 */
export const DepartmentPicker = ({
  id, value, onChange, departments, canCreate, onCreateDepartment, disabled = false,
}: DepartmentPickerProps) => {
  const [isCreating, setIsCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSelectChange = (next: string) => {
    if (next === NEW_DEPARTMENT_OPTION) {
      setIsCreating(true);
      setDraftName('');
      setError('');
      return;
    }
    onChange(next);
  };

  const handleConfirmCreate = async () => {
    setError('');
    setIsSaving(true);
    try {
      // Oluşturulan birim, kaydedilir kaydedilmez seçili hale gelir — aksi
      // halde kullanıcı "oluşturdum ama atanmadı" durumunda kalırdı.
      const createdId = await onCreateDepartment(draftName);
      onChange(createdId);
      setIsCreating(false);
      setDraftName('');
    } catch (err) {
      logger.error('[DepartmentPicker] Birim oluşturulamadı:', err);
      setError(err instanceof Error ? err.message : 'Birim oluşturulamadı.');
    } finally {
      setIsSaving(false);
    }
  };

  // Kullanıcının MEVCUT departmanı listede yoksa (backfill öncesi yazılmış
  // eski bir değer) seçenek olarak yine de gösterilir — aksi halde yalnızca
  // ismini düzeltmek isteyen bir Admin, farkında olmadan personeli departmansız
  // bırakırdı (TaskFormModal'daki "kapsam dışı mevcut sorumlu" ile aynı ilke).
  const isOrphanValue = value !== '' && !departments.some(d => d.id === value);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-micro font-medium text-text-tertiary uppercase tracking-eyebrow px-0.5">
        Departman / Birim
      </label>
      <Select
        id={id}
        value={isCreating ? NEW_DEPARTMENT_OPTION : value}
        disabled={disabled || isSaving}
        onChange={(e) => handleSelectChange(e.target.value)}
        options={[
          { value: '', label: 'Departmansız (Genel Merkez)' },
          ...(isOrphanValue ? [{ value, label: `${value} (kayıtlı birim değil)` }] : []),
          ...departments.map(d => ({ value: d.id, label: d.name })),
          ...(canCreate ? [{ value: NEW_DEPARTMENT_OPTION, label: '+ Yeni Birim Oluştur' }] : []),
        ]}
      />

      {isOrphanValue && !isCreating && (
        <p className="text-micro text-status-warning/80 px-1 tracking-wide flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
          Bu birim departman kayıtlarında yok — kaydetmeden önce listeden geçerli bir birim seçin.
        </p>
      )}

      {isCreating && (
        <div className="flex flex-col gap-2 p-2.5 bg-surface-glass border border-surface-border rounded-xl">
          <label htmlFor={`${id}-new`} className="text-micro font-medium text-text-tertiary uppercase tracking-eyebrow">
            Yeni Birim Adı
          </label>
          <input
            id={`${id}-new`}
            type="text"
            value={draftName}
            autoFocus
            placeholder="Örn: Operasyon"
            onChange={(e) => { setDraftName(e.target.value); setError(''); }}
            className="w-full bg-field-surface border border-executive-blue/[0.05] rounded-xl px-3 py-2 text-body text-text-heading outline-none focus:border-executive-blue/30"
          />
          {error && (
            <p className="text-micro text-status-danger font-semibold uppercase tracking-label flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setIsCreating(false); setDraftName(''); setError(''); }}
              className="px-3 py-1.5 rounded-lg text-micro font-bold uppercase tracking-wider text-text-muted hover:text-text-heading transition-colors"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={isSaving || draftName.trim().length === 0}
              onClick={() => { void handleConfirmCreate(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-executive-blue text-[color:var(--executive-blue-text)] text-micro font-bold uppercase tracking-wider disabled:opacity-40 transition-opacity"
            >
              {isSaving && <Loader2 className="w-3 h-3 animate-spin" />}
              Birimi Oluştur
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export interface OrgNodeCardProps {
  user: User;
  tasks: Task[];
  onSelect: (user: User) => void;
  isMini?: boolean;
}

export const OrgNodeCard = ({ user, tasks, onSelect, isMini = false }: OrgNodeCardProps) => {
  const rc = roleConfig[user.role];
  const userTasks = tasks.filter(t => (t.assigneeId === user.uid || t.assigneeId === user.email) && t.status !== 'COMPLETED' && t.status !== 'CANCELLED');

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      onClick={() => onSelect(user)}
      role="button"
      tabIndex={0}
      aria-label={`${user.fullName} detaylarını görüntüle`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(user);
        }
      }}
      className={cn(
        "flex items-center gap-3 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-xl p-2.5 shadow-card hover:shadow-card-hover cursor-pointer hover:bg-surface-elevated transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue",
        isMini ? "w-44" : "w-52"
      )}
    >
      <Avatar name={user.fullName} photoURL={user.photoURL} size={isMini ? "sm" : "md"} ring className="flex-shrink-0" />
      <div className="flex flex-col gap-0.5 min-w-0 flex-1 text-left">
        <span className="text-caption font-medium text-executive-blue truncate font-display leading-none">{user.fullName}</span>
        <span className="text-micro text-text-tertiary truncate leading-none mt-0.5">{user.departmentId || 'Genel Merkez'}</span>
        {!isMini && (
          <span className={cn("inline-block self-start text-micro font-bold uppercase tracking-wider px-1 py-0.5 rounded border mt-1", rc.bg, rc.text, rc.border)}>
            {ROLE_LABELS[user.role]}
          </span>
        )}
      </div>
      {userTasks.length > 0 && (
        <span className={cn(
          "w-5 h-5 flex items-center justify-center rounded-full text-micro font-bold flex-shrink-0 border transition-all duration-300",
          userTasks.length >= 5 ? "bg-status-danger/10 border-status-danger/25 text-status-danger animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.2)]" :
          userTasks.length >= 3 ? "bg-status-warning/10 border-status-warning/25 text-status-warning" :
          "bg-status-success/10 border-status-success/25 text-status-success"
        )}>
          {userTasks.length}
        </span>
      )}
    </motion.div>
  );
};
