import { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { Edit2, Mail, Building, Shield, Target, History, Loader2, CheckCircle2, AlertTriangle, Activity, ArrowRight } from 'lucide-react';
import type { AuditLog, Task, TaskStatus, User } from '../../types';
import { cn, formatTimeAgo, formatDateTimeShort } from '../../lib/utils';
import { isCompletedOnTime } from '../../lib/sla';
import { ROLE_LABELS, STATUS_LABELS, STATUS_BADGE_VARIANT } from '../../constants';
import { AUDIT_FIELD_LABELS, formatAuditValue } from '../../lib/auditLabels';
import { auditLogService } from '../../services/auditLogService';
import { useUIStore } from '../../store/uiStore';
import { logger } from '../../lib/logger';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { roleConfig } from './subcomponents';
import { staggerDelay } from '../../lib/motion';

interface UserProfileModalProps {
  selectedUser: User | null;
  onClose: () => void;
  onEditRequest: (user: User) => void;
  currentUser: User | null;
  isAdmin: boolean;
  users: User[];
  tasks: Task[];
}

/**
 * Kadro profili modalı — kendi sekme (Sorumluluk Alanı / Denetim İzi) state'ini
 * ve denetim izi fetch'ini kendi içinde yönetir (TeamList'ten taşındı).
 * Denetim İzi sekmesi yalnızca Admin'e VEYA kendi profiline bakan kullanıcıya
 * gösterilir — bu geçmiş ilgili görevin başlık/açıklama/kanıt gibi alan-bazlı
 * değişikliklerini içerdiğinden, başka departmandaki bir görev için de
 * sızdırılabiliyordu (bkz. kod denetimi + firestore.rules'taki audit_logs
 * departman kısıtı).
 */
export function UserProfileModal({ selectedUser, onClose, onEditRequest, currentUser, isAdmin, users, tasks }: UserProfileModalProps) {
  const addToast = useUIStore(state => state.addToast);
  const [modalTab, setModalTab] = useState<'tasks' | 'logs'>('tasks');
  const [userLogs, setUserLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const canEditOrViewOwnAudit = !!selectedUser && (isAdmin || selectedUser.uid === currentUser?.uid);

  useEffect(() => {
    if (!selectedUser || !canEditOrViewOwnAudit) {
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
  }, [selectedUser, currentUser?.uid, canEditOrViewOwnAudit]);

  const selectedUserAllTasks = useMemo(() => {
    if (!selectedUser) return [];
    return tasks.filter(t => t.assigneeId === selectedUser.uid || t.assigneeId === selectedUser.email);
  }, [tasks, selectedUser]);

  const tasksById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);

  // Modal DAİMA aynı şekilde render edilir (isOpen tek başına açık/kapalı
  // durumunu yönetir, bkz. ui/Modal AnimatePresence exit geçişi) — içerik
  // yalnızca `selectedUser` varken hesaplanır/basılır, aksi halde Modal
  // kapanırken içerik aniden kaybolur/geçiş animasyonu bozulurdu.
  const rc = selectedUser ? roleConfig[selectedUser.role] : null;
  const completedTasks = selectedUserAllTasks.filter(t => t.status === 'COMPLETED');
  // lib/sla.ts'teki isCompletedOnTime üzerinden — Dashboard/Reports ile aynı
  // tanım kullanılır (bkz. kod denetimi: eskiden burada bağımsız bir formül
  // vardı, ekranlar arası çelişkili SLA yüzdesi üretiyordu).
  const completedWithSla = completedTasks.filter(isCompletedOnTime);
  const slaSuccessRate = completedTasks.length > 0
    ? Math.round((completedWithSla.length / completedTasks.length) * 100)
    : 100;

  return (
    <Modal isOpen={!!selectedUser} onClose={onClose} title="Kadro Profili" size="lg">
      {selectedUser && rc && (
      <div className="flex flex-col gap-5 font-sans">
        {/* Profile header */}
        <div className="flex flex-col md:flex-row md:items-center gap-4 p-4 bg-surface-glass rounded-2xl border border-executive-blue/[0.04]">
          <Avatar
            name={selectedUser.fullName}
            photoURL={selectedUser.photoURL}
            size="xl"
            ring
            className="rounded-2xl flex-shrink-0"
          />
          <div className="flex flex-col gap-1 flex-1 min-w-0 w-full">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[18px] font-medium text-executive-blue font-display tracking-tight truncate">
                {selectedUser.fullName}
              </h3>
              {canEditOrViewOwnAudit && (
                <button
                  onClick={() => { onClose(); onEditRequest(selectedUser); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-elevated border border-executive-blue/[0.06] rounded-xl text-micro font-medium text-text-muted hover:text-executive-blue hover:bg-surface-glass transition-all shadow-sm flex-shrink-0"
                >
                  <Edit2 className="w-3 h-3" />
                  Düzenle
                </button>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-micro text-text-tertiary flex items-center gap-1">
                <Mail className="w-2.5 h-2.5" />
                {selectedUser.email}
              </span>
              <span className="text-micro text-text-tertiary flex items-center gap-1">
                <Building className="w-2.5 h-2.5" />
                {selectedUser.departmentId || 'Genel Merkez'}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              <span className={cn(
                'inline-flex items-center gap-1 text-micro font-medium uppercase tracking-caps px-2 py-0.5 rounded-full border',
                rc.bg, rc.text, rc.border
              )}>
                <Shield className="w-2.5 h-2.5" />
                {ROLE_LABELS[selectedUser.role]}
              </span>
            </div>

            {/* Operational Score Metrikleri */}
            <div className="grid grid-cols-2 gap-3 mt-3.5">
              <div className="p-2.5 bg-makam-glass border border-surface-border rounded-xl flex flex-col gap-0.5">
                <span className="text-micro text-text-tertiary uppercase tracking-wider font-bold">Bitirilen Talimat</span>
                <span className="text-body font-bold text-executive-blue font-display">{completedTasks.length} Talimat</span>
              </div>
              <div className="p-2.5 bg-makam-glass border border-surface-border rounded-xl flex flex-col gap-0.5">
                <span className="text-micro text-text-tertiary uppercase tracking-wider font-bold">SLA Uyum Başarısı</span>
                <span className={cn(
                  'text-body font-bold font-display',
                  slaSuccessRate >= 80 ? 'text-status-success' :
                  slaSuccessRate >= 50 ? 'text-status-warning' :
                  'text-status-danger'
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
                  'flex-1 py-1.5 rounded-lg text-micro uppercase tracking-wider font-bold transition-all duration-300 cursor-pointer text-center',
                  modalTab === 'tasks' ? 'bg-executive-blue text-[color:var(--executive-blue-text)] shadow-sm' : 'text-text-muted hover:text-text-heading'
                )}
              >
                Sorumluluk Alanı
              </button>
              {canEditOrViewOwnAudit && (
                <button
                  onClick={() => setModalTab('logs')}
                  className={cn(
                    'flex-1 py-1.5 rounded-lg text-micro uppercase tracking-wider font-bold transition-all duration-300 cursor-pointer text-center',
                    modalTab === 'logs' ? 'bg-executive-blue text-[color:var(--executive-blue-text)] shadow-sm' : 'text-text-muted hover:text-text-heading'
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
              <Target className="w-3.5 h-3.5 text-[color:var(--gold-text)]" />
              <span className="text-micro font-medium text-text-tertiary uppercase tracking-eyebrow">
                Sorumluluk Alanı — {selectedUserAllTasks.length} Talimat
              </span>
            </div>
            <div className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto custom-scrollbar pr-1">
              {selectedUserAllTasks.length > 0 ? (
                selectedUserAllTasks.map((task, i) => (
                  <motion.div
                    key={task.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: staggerDelay(i, 0.03) }}
                    className="flex items-center gap-3 p-3 bg-makam-glass border border-surface-border rounded-xl group cursor-pointer hover:bg-surface-elevated hover:shadow-sm transition-all"
                  >
                    <div className={cn(
                      'w-7 h-7 rounded-xl flex items-center justify-center border flex-shrink-0',
                      task.status === 'COMPLETED' ? 'bg-status-success/10 text-status-success border-status-success/20' :
                      task.status === 'BLOCKED' ? 'bg-status-danger/10 text-status-danger border-status-danger/20' :
                      task.status === 'IN_PROGRESS' ? 'bg-executive-blue/5 text-executive-blue border-executive-blue/10' :
                      'bg-surface-glass text-text-tertiary border-surface-border'
                    )}>
                      {task.status === 'COMPLETED' ? <CheckCircle2 className="w-3.5 h-3.5 stroke-[1.3]" /> :
                       task.status === 'BLOCKED' ? <AlertTriangle className="w-3.5 h-3.5 stroke-[1.3]" /> :
                       <Activity className="w-3.5 h-3.5 stroke-[1.3]" />}
                    </div>
                    <div className="flex flex-col gap-1.5 flex-1 min-w-0 items-start">
                      <span className="text-body-sm font-medium text-executive-blue line-clamp-1 font-display tracking-tight">
                        {task.title}
                      </span>
                      <Badge variant={STATUS_BADGE_VARIANT[task.status] ?? 'default'}>
                        {STATUS_LABELS[task.status] || task.status}
                      </Badge>
                    </div>
                    <span className="text-micro text-text-tertiary flex-shrink-0">{formatTimeAgo(task.updatedAt, task.status)}</span>
                  </motion.div>
                ))
              ) : (
                <EmptyState size="sm" icon={<CheckCircle2 className="w-8 h-8 stroke-[1]" />} message="Kayıtlı Talimat Yok" />
              )}
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-3 mt-1">
              <History className="w-3.5 h-3.5 text-[color:var(--gold-text)]" />
              <span className="text-micro font-medium text-text-tertiary uppercase tracking-eyebrow">
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
                      transition={{ delay: staggerDelay(i, 0.03) }}
                      className="flex flex-col gap-2 p-3 bg-makam-glass border border-surface-border rounded-xl"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-caption font-medium text-executive-blue truncate max-w-[220px] font-display">
                          {relatedTask?.title || 'Bilinmeyen Talimat'}
                        </span>
                        <span className="text-micro text-text-tertiary font-mono">
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
                                <span className="text-micro font-medium text-text-tertiary uppercase tracking-caps bg-surface-glass px-1 py-0.5 rounded border border-surface-border">
                                  {label}
                                </span>
                                <span className="text-micro text-status-danger/70 line-through">{formatAuditValue(field, change.old, users)}</span>
                                <ArrowRight className="w-2 h-2 text-text-tertiary flex-shrink-0" />
                                <span className="text-micro font-medium text-status-success">{formatAuditValue(field, change.new, users)}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-micro font-medium text-text-tertiary uppercase tracking-caps bg-surface-glass px-1 py-0.5 rounded border border-surface-border">Durum</span>
                          <Badge variant={STATUS_BADGE_VARIANT[log.newValue as TaskStatus] ?? 'default'}>
                            {STATUS_LABELS[log.newValue as TaskStatus] ?? String(log.newValue)}
                          </Badge>
                        </div>
                      )}
                    </motion.div>
                  );
                })
              ) : (
                <EmptyState size="sm" icon={<History className="w-8 h-8 stroke-[1]" />} message="Kayıtlı İşlem Yok" />
              )}
            </div>
          </div>
        )}
      </div>
      )}
    </Modal>
  );
}
