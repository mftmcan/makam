import { useMemo, useState } from 'react';
import { Building, Edit2, Trash2, AlertTriangle, ChevronDown } from 'lucide-react';
import type { Department, Task, User } from '../../types';
import { cn } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useUIStore } from '../../store/uiStore';
import { logger } from '../../lib/logger';

/**
 * Admin'e özel "Birim Yönetimi" paneli — TeamList'in İÇİNE gömülüdür,
 * ayrı bir sekme/route DEĞİLDİR (bkz. AppRoutes.tsx: route ağacı TAB_ROLES'tan
 * türetilir; departman yönetimi için yeni bir sekme açmak hem yetki matrisini
 * hem de menüleri şişirirdi). Kadro ekranı zaten departmanların ATANDIĞI ve
 * kapasitesinin okunduğu yerdir — birimin kendisini yönetmek için doğal ev.
 *
 * Panel VARSAYILAN OLARAK KAPALIDIR: yıkıcı aksiyonlar (silme) içeriyor ve
 * günlük kadro işine ait değil, bilinçli bir yönetim adımıdır.
 */

/** Silme onayında harfi harfine yazılması gereken ifade — Settings.tsx'teki
 *  RESTORE_CONFIRM_PHRASE ile AYNI desen (P0-4). Türkçe büyük harf duyarlıdır
 *  ('i' → 'İ'), bu yüzden karşılaştırma normalize edilmeden BİREBİR yapılır:
 *  "yaklaşık doğru" bir metin onay sayılmaz. */
const DELETE_CONFIRM_PHRASE = 'BİRİMİ SİL';

export interface DepartmentManagerProps {
  departments: Department[];
  /** Kullanım sayıları YEREL listelerden türetilir — yalnızca bilgilendirme
   *  amaçlıdır ve silmenin gerçek kapısı DEĞİLDİR. Gerçek referans kontrolü
   *  sunucuya giden bir count() agregasyonuyla departmentService.deleteDepartment
   *  içinde yapılır: buradaki listeler odak filtresine takılmış veya bayat
   *  olabilir, o yüzden bunlara güvenip silmeye izin vermek yetim referans
   *  üretirdi. */
  users: User[];
  tasks: Task[];
  onRename: (oldId: string, newId: string) => Promise<{ tasksUpdated: number; usersUpdated: number }>;
  onDelete: (id: string) => Promise<void>;
}

export const DepartmentManager = ({ departments, users, tasks, onRename, onDelete }: DepartmentManagerProps) => {
  const addToast = useUIStore(state => state.addToast);
  const [isExpanded, setIsExpanded] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Department | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');

  // Tek geçişte departman başına kullanım sayısı (TeamList'teki
  // activeTaskCountByUser ile AYNI ilke — departman başına ayrı filter değil).
  const usageByDepartment = useMemo(() => {
    const map = new Map<string, { tasks: number; users: number }>();
    const bump = (key: string | undefined, kind: 'tasks' | 'users') => {
      if (!key) return;
      const row = map.get(key) ?? { tasks: 0, users: 0 };
      row[kind]++;
      map.set(key, row);
    };
    for (const t of tasks) bump(t.departmentId, 'tasks');
    for (const u of users) bump(u.departmentId, 'users');
    return map;
  }, [tasks, users]);

  const closeRename = () => { setRenameTarget(null); setRenameDraft(''); setError(''); };
  const closeDelete = () => { setDeleteTarget(null); setDeleteConfirmText(''); setError(''); };

  const handleRenameConfirm = async () => {
    if (!renameTarget) return;
    setError('');
    setIsBusy(true);
    try {
      const { tasksUpdated, usersUpdated } = await onRename(renameTarget.id, renameDraft);
      addToast({
        title: '✓ Birim Yeniden Adlandırıldı',
        body: `"${renameTarget.id}" → "${renameDraft.trim()}" · ${tasksUpdated} talimat, ${usersUpdated} personel kaydı taşındı.`,
        type: 'success',
      });
      closeRename();
    } catch (err) {
      logger.error('[DepartmentManager] Birim yeniden adlandırılamadı:', err);
      const message = err instanceof Error ? err.message : 'Birim yeniden adlandırılamadı.';
      setError(message);
      addToast({ title: '⚠️ Yeniden Adlandırma Başarısız', body: message, type: 'danger' });
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setError('');
    setIsBusy(true);
    try {
      await onDelete(deleteTarget.id);
      addToast({ title: '✓ Birim Silindi', body: `"${deleteTarget.id}" birimi kayıtlardan kaldırıldı.`, type: 'success' });
      closeDelete();
    } catch (err) {
      logger.error('[DepartmentManager] Birim silinemedi:', err);
      // En sık beklenen hata "hâlâ kullanılıyor" reddidir — modal bilinçli
      // olarak AÇIK kalır ki Admin, sayıyı görüp önce taşımayı yapabilsin.
      const message = err instanceof Error ? err.message : 'Birim silinemedi.';
      setError(message);
      addToast({ title: '⚠️ Birim Silinemedi', body: message, type: 'danger' });
    } finally {
      setIsBusy(false);
    }
  };

  const trimmedDraft = renameDraft.trim();
  const canConfirmRename = trimmedDraft.length > 0 && trimmedDraft !== renameTarget?.id;
  const isDeleteConfirmed = deleteConfirmText === DELETE_CONFIRM_PHRASE;

  return (
    <div className="flex flex-col bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(v => !v)}
        aria-expanded={isExpanded}
        className="flex items-center justify-between gap-3 px-3.5 py-3 text-left hover:bg-surface-elevated transition-colors"
      >
        <span className="flex items-center gap-2">
          <Building className="w-3.5 h-3.5 text-executive-gold stroke-[1.5]" />
          <span className="text-[10px] text-text-muted uppercase tracking-wider font-bold">
            Birim Yönetimi
          </span>
          <span className="text-[9px] text-text-tertiary tracking-wider">{departments.length} kayıtlı birim</span>
        </span>
        <ChevronDown className={cn('w-3.5 h-3.5 text-text-tertiary transition-transform', isExpanded && 'rotate-180')} />
      </button>

      {isExpanded && (
        <div className="flex flex-col gap-2 px-3.5 pb-3.5 pt-1 border-t border-executive-blue/[0.04]">
          <p className="text-[10px] text-text-tertiary leading-relaxed">
            Yeniden adlandırma, birime bağlı tüm talimat ve personel kayıtlarını yeni birime taşır. Bir birim yalnızca hiçbir kayıt tarafından kullanılmıyorken silinebilir.
          </p>

          {departments.length === 0 ? (
            <div className="py-6 flex items-center justify-center rounded-xl border border-dashed border-executive-blue/[0.05] bg-surface-glass">
              <span className="text-[9px] text-text-tertiary uppercase tracking-[0.35em]">Kayıtlı Birim Yok</span>
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {departments.map(dept => {
                const usage = usageByDepartment.get(dept.id);
                return (
                  <li
                    key={dept.id}
                    className="flex items-center gap-2 px-2.5 py-2 bg-surface-glass border border-surface-border rounded-xl"
                  >
                    <span className="text-[11px] font-medium text-executive-blue font-serif truncate flex-1 min-w-0">
                      {dept.name}
                    </span>
                    <span className="hidden sm:inline text-[8.5px] text-text-tertiary uppercase tracking-[0.2em] flex-shrink-0">
                      {usage ? `${usage.tasks} talimat · ${usage.users} personel` : 'kullanımda değil'}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setRenameTarget(dept); setRenameDraft(dept.id); setError(''); }}
                      title="Yeniden Adlandır"
                      aria-label={`${dept.name} birimini yeniden adlandır`}
                      className="w-7 h-7 flex items-center justify-center bg-makam-glass border border-executive-blue/[0.06] rounded-lg text-text-tertiary hover:text-executive-blue hover:bg-surface-elevated transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue flex-shrink-0"
                    >
                      <Edit2 className="w-3 h-3 stroke-[1.5]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDeleteTarget(dept); setDeleteConfirmText(''); setError(''); }}
                      title="Sil"
                      aria-label={`${dept.name} birimini sil`}
                      className="w-7 h-7 flex items-center justify-center bg-makam-glass border border-executive-blue/[0.06] rounded-lg text-text-tertiary hover:text-status-danger hover:bg-status-danger/10 transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger flex-shrink-0"
                    >
                      <Trash2 className="w-3 h-3 stroke-[1.5]" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* ── Yeniden Adlandırma ─────────────────────────────────────── */}
      <Modal isOpen={!!renameTarget} onClose={closeRename} title="Birimi Yeniden Adlandır">
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-text-muted font-light leading-relaxed">
            <strong className="text-executive-blue font-medium">{renameTarget?.name}</strong> birimine bağlı tüm talimat ve personel kayıtları yeni isme taşınacaktır. Bu işlem sırasında kayıtların güncellenme zamanı değişmez.
          </p>
          <div className="flex flex-col gap-2">
          {/* Label, ui/Input'un kendi `label` prop'u yerine htmlFor ile
              BAĞLANMIŞ olarak yazılır: o prop bir <label> üretir ama girdiye
              bağlamaz (htmlFor/id yok), yani ekran okuyucu ve testler için
              erişilebilir bir ad oluşmaz — Settings.tsx'teki onay girdisi de
              aynı nedenle bu deseni kullanır. */}
          <label htmlFor="department-rename-input" className="text-[10px] font-medium text-text-muted uppercase tracking-[0.2em] px-1">
            Yeni Birim Adı
          </label>
          <Input
            id="department-rename-input"
            value={renameDraft}
            onChange={(e) => { setRenameDraft(e.target.value); setError(''); }}
            placeholder="Örn: Operasyon"
            autoComplete="off"
            spellCheck={false}
            // Enter ile kazara gönderimi engelle — onay yalnızca butonla
            // verilir (Settings.tsx'teki geri yükleme onayıyla aynı ilke).
            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
          />
          </div>
          {error && (
            <div className="flex items-start gap-2 p-2.5 bg-status-danger/10 border border-status-danger/20 rounded-xl">
              <AlertTriangle className="w-3.5 h-3.5 text-status-danger flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-status-danger font-semibold uppercase tracking-[0.1em] leading-relaxed">{error}</p>
            </div>
          )}
          <div className="flex justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
            <Button variant="secondary" onClick={closeRename} disabled={isBusy}>İptal</Button>
            <Button onClick={() => { void handleRenameConfirm(); }} isLoading={isBusy} disabled={!canConfirmRename}>
              Taşımayı Onayla
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Silme (yazarak doğrulama) ──────────────────────────────── */}
      <Modal isOpen={!!deleteTarget} onClose={closeDelete} title="Birimi Sil">
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-text-muted font-light leading-relaxed">
            <strong className="text-status-danger font-medium">{deleteTarget?.name}</strong> birimini kayıtlardan kaldırmak üzeresiniz. Birim hâlâ bir talimat veya personel tarafından kullanılıyorsa işlem reddedilir.
          </p>

          <div className="flex flex-col gap-2">
            <label htmlFor="department-delete-confirm-input" className="text-[12px] text-text-heading font-normal leading-relaxed">
              Onaylamak için aşağıdaki kutuya <strong className="text-status-danger font-semibold tracking-wide">{DELETE_CONFIRM_PHRASE}</strong> yazın.
            </label>
            <Input
              id="department-delete-confirm-input"
              value={deleteConfirmText}
              onChange={(e) => { setDeleteConfirmText(e.target.value); setError(''); }}
              placeholder={DELETE_CONFIRM_PHRASE}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="department-delete-confirm-help"
              onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
            />
            <span id="department-delete-confirm-help" className="text-[10px] text-text-tertiary px-1 leading-relaxed">
              {isDeleteConfirmed
                ? 'Doğrulama tamamlandı — silme başlatılabilir.'
                : 'Doğrulama metni birebir eşleşmeden silme başlatılamaz.'}
            </span>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-2.5 bg-status-danger/10 border border-status-danger/20 rounded-xl">
              <AlertTriangle className="w-3.5 h-3.5 text-status-danger flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-status-danger font-semibold uppercase tracking-[0.1em] leading-relaxed">{error}</p>
            </div>
          )}

          <div className="flex justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
            <Button variant="secondary" onClick={closeDelete} disabled={isBusy}>İptal</Button>
            <Button variant="danger" onClick={() => { void handleDeleteConfirm(); }} isLoading={isBusy} disabled={!isDeleteConfirmed}>
              Birimi Sil
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
