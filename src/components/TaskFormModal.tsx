import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, parse, isBefore, startOfDay } from 'date-fns';
import { Task, User, Department, TaskPrioritySchema } from '../types';
import { PRIORITY_LABELS, ROLE_LABELS } from '../constants';
import { cn } from '../lib/utils';
import { FileText, Target, Users, Calendar, AlertCircle, Building } from 'lucide-react';
import { DatePicker } from './ui/DatePicker';
import { Button } from './ui/Button';
import { logger } from '../lib/logger';

const DEADLINE_FORMAT = 'yyyy-MM-dd';

/**
 * Şema, `originalDeadline` (düzenleme modunda görevin MEVCUT mühleti,
 * DEADLINE_FORMAT'ta) parametresine göre üretilir: bir SLA takip uygulamasında
 * geçmiş tarihe mühlet vermek görevi anında CRISIS adayı yapıyordu (bkz.
 * tasarım denetimi F26), bu yüzden YENİ seçilen bir tarih bugünden önce
 * olamaz. Ancak zaten aşılmış (SLA ihlali) bir görevi düzenlerken mühlete
 * DOKUNULMAMIŞSA bu kural devreye girmez — aksi halde gecikmiş bir görevin
 * yalnızca başlığını düzeltmek bile imkansız hale gelirdi.
 */
const createTaskSchema = (originalDeadline?: string) => z.object({
  title: z.string().min(1, 'Başlık zorunludur.').trim(),
  description: z.string().min(1, 'Açıklama zorunludur.').trim(),
  assigneeId: z.string().min(1, 'Sorumlu seçimi zorunludur.'),
  coordinatorId: z.string().optional(),
  // Görevin departmanı normalde SORUMLUDAN türetilir (bkz. processForm) — bu
  // alan yalnızca sorumlunun departmanı yokken (tipik olarak Admin'e atanan
  // görevlerde) kullanıcıdan AÇIKÇA istenir. Zorunluluğu şemada değil
  // processForm'da uygulanır: gerekli olup olmadığı seçili sorumluya bağlıdır
  // ve zod şeması bu bağlamı göremez.
  departmentId: z.string().optional(),
  priority: TaskPrioritySchema,
  deadline: z.string().min(1, 'Mühlet seçilmelidir.')
}).refine(data => {
  if (data.coordinatorId && data.coordinatorId === data.assigneeId) {
    return false;
  }
  return true;
}, {
  message: "İrtibatlı kişi, sorumlu kişi ile aynı olamaz.",
  path: ["coordinatorId"]
}).refine(data => {
  if (data.deadline === originalDeadline) return true;
  const parsed = parse(data.deadline, DEADLINE_FORMAT, new Date());
  if (Number.isNaN(parsed.getTime())) return true; // format hatası ayrı kuralca zaten yakalanır
  return !isBefore(startOfDay(parsed), startOfDay(new Date()));
}, {
  message: "Mühlet bugünden önce olamaz.",
  path: ["deadline"]
});

type TaskFormValues = z.infer<ReturnType<typeof createTaskSchema>>;

interface TaskFormModalProps {
  users: User[];
  currentUser: User | null;
  /** departments koleksiyonundaki kayıtlı birimler. Yalnızca sorumlunun
   *  departmanı yokken gösterilen "birim seç" alanını besler. */
  departments?: Department[];
  task?: Task;
  parentId?: string;
  initialTitle?: string;
  onSubmit: (taskData: Partial<Task>) => Promise<void> | void;
  onClose: () => void;
  /** Formun `isDirty` durumu her değiştiğinde çağrılır — kapatan taraf
   *  (AuthenticatedApp) bunu, kirli bir formu Escape/backdrop ile sessizce
   *  kapatmadan önce onay istemek için kullanır (bkz. tasarım denetimi F31). */
  onDirtyChange?: (isDirty: boolean) => void;
}

export const TaskFormModal = ({ users, currentUser, departments = [], task, parentId, initialTitle, onSubmit, onClose, onDirtyChange }: TaskFormModalProps) => {
  const isSubTask = Boolean(parentId);
  const originalDeadlineStr = task?.deadline ? new Date(task.deadline).toISOString().split('T')[0] : undefined;
  const taskSchema = React.useMemo(() => createTaskSchema(originalDeadlineStr), [originalDeadlineStr]);
  const todayStr = format(new Date(), DEADLINE_FORMAT);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting, isDirty }
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: task?.title || initialTitle || '',
      description: task?.description || '',
      assigneeId: task?.assigneeId || '',
      coordinatorId: task?.coordinatorId || '',
      departmentId: task?.departmentId || '',
      priority: task?.priority || 'Medium',
      deadline: originalDeadlineStr || '',
    }
  });

  const assigneeId = watch('assigneeId');
  const deadline = watch('deadline');

  React.useEffect(() => {
    onDirtyChange?.(isDirty);
    // Form kapanınca (unmount) dirty bayrağı çağırana asılı kalmamalı.
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange]);

  const getAssignableRoles = (role?: string) => {
    if (role === 'Admin') return ['Admin', 'Manager', 'Staff'];
    if (role === 'Manager') return ['Manager', 'Staff'];
    return ['Staff'];
  };

  const allowedRoles = isSubTask
    ? ['Staff']
    : getAssignableRoles(currentUser?.role);

  const roleFilteredUsers = users.filter(u => allowedRoles.includes(u.role));
  // Düzenleme modunda, görevin MEVCUT sorumlusunun rolü düzenleyenin izinli-rol
  // listesinde olmayabilir (ör. bir Manager, bir Admin'e atanmış bir görevi
  // düzenlerken — Manager'ın izinli listesi Admin içermiyor). Eskiden bu
  // durumda mevcut sorumlu <select> seçeneklerinde hiç görünmüyordu; kullanıcı
  // yalnızca açıklama gibi ilgisiz bir alanı değiştirmek isterken bile
  // sorumluyu istemeden değiştirmiş oluyordu (bkz. kod denetimi). Mevcut
  // sorumlu, izinli listede yoksa da seçeneklere eklenir ve altında bir uyarı
  // gösterilir.
  const currentAssignee = task ? users.find(u => u.uid === task.assigneeId) : undefined;
  const currentAssigneeOutOfScope = Boolean(currentAssignee && !roleFilteredUsers.some(u => u.uid === currentAssignee.uid));
  const assignableUsers = currentAssigneeOutOfScope && currentAssignee
    ? [currentAssignee, ...roleFilteredUsers]
    : roleFilteredUsers;

  // ─── Departman türetimi (bkz. kod denetimi P0-1) ─────────────────────────
  // Görevin departmanı ARTIK GÖREVİ OLUŞTURANDAN DEĞİL, ATANAN KİŞİDEN
  // türetilir. Eski davranış (currentUser?.departmentId) P0-1'in kaynağıydı:
  // Admin'in departmanı tipik olarak boş olduğundan Admin'in oluşturduğu her
  // görev departmansız kalıyor ve firestore.rules'taki "departmanı yoksa
  // serbest" fallback'leri yüzünden tüm organizasyona okunur hale geliyordu.
  const selectedAssignee = users.find(u => u.uid === assigneeId);
  const assigneeDepartment = selectedAssignee?.departmentId ?? '';

  // Sorumlunun departmanı yoksa (tipik olarak görev bir Admin'e atanıyorsa)
  // departman ARTIK ZORUNLU bir form alanı olarak kullanıcıdan istenir —
  // sessizce boş bırakmak, kapatılan boşluğu geri açardı.
  const needsExplicitDepartment = !task && assigneeId !== '' && assigneeDepartment === '';

  // Müdür yalnızca KENDİ departmanında görev oluşturabilir (firestore.rules
  // tasks create kuralı) — bu yüzden seçenekleri de o birimle sınırlanır,
  // aksi halde kullanıcıya ancak sunucudan dönen ham bir izin hatası kalırdı.
  const isManagerCreator = !task && currentUser?.role === 'Manager';
  const selectableDepartments = isManagerCreator && currentUser?.departmentId
    ? departments.filter(d => d.id === currentUser.departmentId)
    : departments;

  const explicitDepartment = watch('departmentId') ?? '';
  const effectiveDepartment = needsExplicitDepartment ? explicitDepartment : assigneeDepartment;

  const coordinatorUsers = users.filter(
    u => u.role !== 'Admin'
      && u.uid !== assigneeId
      && (!isSubTask || u.role === 'Staff')
  );

  const processForm = async (data: TaskFormValues) => {
    // Departman zorunluluğu zod şemasında değil burada uygulanır: gerekli olup
    // olmadığı seçili sorumluya bağlı (bkz. taskSchema'daki departmentId notu).
    if (!task) {
      if (effectiveDepartment === '') {
        setError('departmentId', {
          message: 'Sorumlunun bağlı olduğu bir birim yok — talimatın birimini seçmelisiniz.',
        });
        return;
      }
      if (isManagerCreator && currentUser?.departmentId && effectiveDepartment !== currentUser.departmentId) {
        // Sunucu tarafı bunu zaten reddederdi (tasks create kuralı); burada
        // anlaşılır bir mesaja çevrilir.
        setError('assigneeId', {
          message: 'Bu personel sizin biriminizde değil — yalnızca kendi biriminize talimat atayabilirsiniz.',
        });
        return;
      }
    }

    try {
      // updatedAt burada elle gönderilmiyor — taskService.createTask/updateTask
      // bunu zaten kendisi (senkron anına göre) set ediyor. Burada gönderilmesi
      // yalnızca denetim izi diff'inde anlamsız bir "UpdatedAt" satırı olarak
      // görünmesine yol açıyordu (bkz. kod denetimi).
      const taskData: Partial<Task> = {
        title: data.title,
        description: data.description,
        assigneeId: data.assigneeId,
        coordinatorId: data.coordinatorId || undefined,
        priority: data.priority,
        deadline: new Date(data.deadline).getTime(),
      };

      if (!task) {
        taskData.status = 'ASSIGNED';
        taskData.creatorId = currentUser?.uid;
        taskData.createdAt = Date.now();
        // Departman artık ZORUNLU ve sorumludan türetilir (yukarıdaki
        // "Departman türetimi" bloğuna bakın) — boş kalması yukarıdaki
        // doğrulamada zaten engellendi.
        taskData.departmentId = effectiveDepartment;
        if (parentId) {
          taskData.parentId = parentId;
        }
      }

      // onSubmit'in promise'i await edilir ki react-hook-form'un isSubmitting'i
      // gerçek Firestore round-trip'i süresince true kalsın — aksi halde
      // "ATAMAYI TAMAMLA" butonu network gecikmesi sırasında tekrar
      // tıklanabilir hale gelip aynı görevi iki kez oluşturabilirdi (bkz. kod
      // denetimi).
      await onSubmit(taskData);
    } catch (err) {
      logger.error('TaskFormModal submit error:', err);
    }
  };

  return (
    <form onSubmit={handleSubmit(processForm)} className="flex flex-col gap-8 font-sans">
      <div className="flex flex-col gap-8">
        {/* Başlık */}
        <div className="flex flex-col gap-3">
          <label htmlFor="task-title-input" className="text-micro font-semibold text-text-muted uppercase tracking-caps px-1 flex items-center gap-2.5">
            <Target className="w-3.5 h-3.5 text-[color:var(--gold-text)] stroke-[1.2]" />
            Operasyonel Hedef
          </label>
          <input
            id="task-title-input"
            type="text"
            placeholder="Talimat Başlığı"
            {...register('title')}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? "task-title-error" : undefined}
            className={cn(
              "text-[28px] font-light text-text-heading font-display tracking-tight outline-none bg-field-surface placeholder:text-text-muted/30 w-full border-b border-text-muted/20 pb-3 transition-colors focus:border-executive-blue/50 rounded-t-sm focus-visible:ring-2 focus-visible:ring-executive-blue/40 focus-visible:ring-offset-2",
              errors.title && "border-status-danger/50 focus:border-status-danger/50"
            )}
          />
          {errors.title && <span id="task-title-error" role="alert" className="text-status-danger text-micro px-1 uppercase tracking-wider">{errors.title.message}</span>}
        </div>
        
        {/* Açıklama */}
        <div className="flex flex-col gap-3">
          <label htmlFor="task-description-textarea" className="text-micro font-semibold text-text-muted uppercase tracking-caps px-1 flex items-center gap-2.5">
            <FileText className="w-3.5 h-3.5 text-executive-blue stroke-[1.2]" />
            Kapsam & Detaylar
          </label>
          <textarea
            id="task-description-textarea"
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={errors.description ? "task-description-error" : undefined}
            className={cn(
              "w-full min-h-[140px] resize-none bg-field-surface border border-executive-blue/[0.05] text-text-heading placeholder:text-text-muted/30 rounded-xl px-5 py-4 text-[14px] font-light leading-relaxed transition-all outline-none focus:border-executive-blue/30 focus:ring-4 focus:ring-executive-blue/5",
              errors.description && "border-status-danger/50"
            )}
            placeholder="İşin detaylarını ve başarı kriterlerini tanımlayın..."
            {...register('description')}
          />
          {errors.description && <span id="task-description-error" role="alert" className="text-status-danger text-micro px-1 uppercase tracking-wider">{errors.description.message}</span>}
        </div>

        {/* Görevlendirmeler */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="flex flex-col gap-3">
             <label htmlFor="task-assignee-select" className="text-micro font-semibold text-text-muted uppercase tracking-caps px-1 flex items-center gap-2.5">
               <Users className="w-3.5 h-3.5 text-executive-blue stroke-[1.2]" />
               Sorumlu
             </label>
             {isSubTask && (
               <p className="text-micro text-status-warning/80 px-1 tracking-wide flex items-center gap-1.5">
                 <AlertCircle className="w-3 h-3 flex-shrink-0" />
                 Alt talimatlar yalnızca memurlara atanabilir.
               </p>
             )}
             {currentAssigneeOutOfScope && (
               <p className="text-micro text-status-warning/80 px-1 tracking-wide flex items-center gap-1.5">
                 <AlertCircle className="w-3 h-3 flex-shrink-0" />
                 Mevcut sorumlu ({currentAssignee?.fullName}) sizin atayabileceğiniz rol dışında — değiştirmezseniz aynı kalır.
               </p>
             )}
             <select
              id="task-assignee-select"
              {...register('assigneeId')}
              aria-invalid={errors.assigneeId ? true : undefined}
              aria-describedby={errors.assigneeId ? "task-assignee-error" : undefined}
              className={cn(
                "w-full bg-field-surface border border-executive-blue/[0.05] rounded-xl px-4 py-3 outline-none text-body font-medium text-text-heading transition-all focus:border-executive-blue/30 focus:ring-4 focus:ring-executive-blue/5",
                errors.assigneeId && "border-status-danger/50"
              )}
            >
              <option value="" className="bg-surface-base text-text-heading">Sorumlu Seçiniz</option>
              {assignableUsers.map(m => (
                <option key={m.uid} value={m.uid} className="bg-surface-base text-text-heading">{m.fullName}</option>
              ))}
            </select>
            {errors.assigneeId && <span id="task-assignee-error" role="alert" className="text-status-danger text-micro px-1 uppercase tracking-wider">{errors.assigneeId.message}</span>}
          </div>

          <div className="flex flex-col gap-3">
             <label htmlFor="task-coordinator-select" className="text-micro font-semibold text-text-muted uppercase tracking-caps px-1 flex items-center gap-2.5">
               <Users className="w-3.5 h-3.5 text-text-muted/40 stroke-[1.2]" />
               İrtibatlı
             </label>
             <select
              id="task-coordinator-select"
              {...register('coordinatorId')}
              aria-invalid={errors.coordinatorId ? true : undefined}
              aria-describedby={errors.coordinatorId ? "task-coordinator-error" : undefined}
              className={cn(
                "w-full bg-field-surface border border-executive-blue/[0.05] rounded-xl px-4 py-3 outline-none text-body font-medium text-text-heading transition-all focus:border-executive-blue/30 focus:ring-4 focus:ring-executive-blue/5",
                errors.coordinatorId && "border-status-danger/50"
              )}
            >
              <option value="" className="bg-surface-base text-text-heading">İrtibatlı Seçiniz (İsteğe Bağlı)</option>
              {coordinatorUsers.map(m => (
                <option key={m.uid} value={m.uid} className="bg-surface-base text-text-heading">{m.fullName} — {ROLE_LABELS[m.role]}</option>
              ))}
            </select>
             {errors.coordinatorId ? (
                <span id="task-coordinator-error" role="alert" className="text-status-danger text-micro px-1 uppercase tracking-wider">{errors.coordinatorId.message}</span>
             ) : (
                <p className="text-micro text-text-muted/40 px-1 tracking-wide">
                  Sorumludan farklı biri seçilmelidir.
                </p>
             )}
          </div>

          {needsExplicitDepartment && (
            <div className="flex flex-col gap-3 md:col-span-2">
              <label htmlFor="task-department-select" className="text-micro font-semibold text-text-muted uppercase tracking-caps px-1 flex items-center gap-2.5">
                <Building className="w-3.5 h-3.5 text-[color:var(--gold-text)] stroke-[1.2]" />
                Sorumlu Birim
              </label>
              <p className="text-micro text-status-warning/80 px-1 tracking-wide flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3 flex-shrink-0" />
                Seçilen sorumlu bir birime bağlı değil — talimatın hangi birime ait olduğunu belirtmelisiniz.
              </p>
              <select
                id="task-department-select"
                {...register('departmentId')}
                aria-invalid={errors.departmentId ? true : undefined}
                aria-describedby={errors.departmentId ? "task-department-error" : undefined}
                className={cn(
                  "w-full bg-field-surface border border-executive-blue/[0.05] rounded-xl px-4 py-3 outline-none text-body font-medium text-text-heading transition-all focus:border-executive-blue/30 focus:ring-4 focus:ring-executive-blue/5",
                  errors.departmentId && "border-status-danger/50"
                )}
              >
                <option value="" className="bg-surface-base text-text-heading">Birim Seçiniz</option>
                {selectableDepartments.map(d => (
                  <option key={d.id} value={d.id} className="bg-surface-base text-text-heading">{d.name}</option>
                ))}
              </select>
              {errors.departmentId && <span id="task-department-error" role="alert" className="text-status-danger text-micro px-1 uppercase tracking-wider">{errors.departmentId.message}</span>}
            </div>
          )}

          <div className="flex flex-col gap-3">
             <label htmlFor="task-priority-select" className="text-micro font-semibold text-text-muted uppercase tracking-caps px-1 flex items-center gap-2.5">
               <AlertCircle className="w-3.5 h-3.5 text-[color:var(--gold-text)] stroke-[1.2]" />
               Öncelik
             </label>
             <select
              id="task-priority-select"
              {...register('priority')}
              aria-invalid={errors.priority ? true : undefined}
              aria-describedby={errors.priority ? "task-priority-error" : undefined}
              className="w-full bg-field-surface border border-executive-blue/[0.05] rounded-xl px-4 py-3 outline-none text-body font-medium text-text-heading transition-all focus:border-executive-blue/30 focus:ring-4 focus:ring-executive-blue/5"
            >
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value} className="bg-surface-base text-text-heading">{label}</option>
              ))}
            </select>
            {errors.priority && <span id="task-priority-error" role="alert" className="text-status-danger text-micro px-1 uppercase tracking-wider">{errors.priority.message}</span>}
          </div>

          <div className="flex flex-col gap-3">
            <label htmlFor="task-deadline" className="text-micro font-semibold text-text-muted uppercase tracking-caps px-1 flex items-center gap-2.5">
              <Calendar className="w-3.5 h-3.5 text-executive-blue stroke-[1.2]" />
              SLA Mühleti
            </label>
            <DatePicker
              id="task-deadline"
              value={deadline}
              onChange={(v) => setValue('deadline', v, { shouldValidate: true, shouldDirty: true })}
              ariaLabel="SLA mühleti"
              minDate={todayStr}
              ariaInvalid={!!errors.deadline}
              ariaDescribedBy={errors.deadline ? "task-deadline-error" : undefined}
              icon={<Calendar className="w-3.5 h-3.5 text-executive-blue/60 stroke-[1.2] flex-shrink-0" aria-hidden="true" />}
              triggerClassName={cn(
                "w-full flex items-center gap-3 bg-field-surface border border-executive-blue/[0.05] rounded-xl px-4 py-3 text-body transition-all focus:border-executive-blue/30 focus:ring-4 focus:ring-executive-blue/5",
                errors.deadline && "border-status-danger/50"
              )}
            />
            {errors.deadline && <span id="task-deadline-error" role="alert" className="text-status-danger text-micro px-1 uppercase tracking-wider">{errors.deadline.message}</span>}
          </div>
        </div>
      </div>

      {/* Aksiyonlar */}
      <div className="flex justify-end gap-5 pt-10 border-t border-makam-border/5">
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
          className="px-10 h-14 font-normal"
        >
          İPTAL
        </Button>
        {/* Paylaşımlı Button'ın isLoading'i — eskiden gönderim sırasında etiket
            metni tamamen "İŞLENİYOR..." ile değiştiriliyordu; uygulamanın geri
            kalanı (TeamList/AuditLogList/BlockerList/TaskDetails/Settings/vb.)
            etiketi koruyup yanına dönen bir spinner ekleyen TEK bir kalıp
            kullanıyor (bkz. kod denetimi: iki farklı loading-state dili). */}
        <Button
          type="submit"
          isLoading={isSubmitting}
          className="px-12 h-14 font-semibold tracking-label"
        >
          {task ? 'GÜNCELLE' : 'ATAMAYI TAMAMLA'}
        </Button>
      </div>
    </form>
  );
};
