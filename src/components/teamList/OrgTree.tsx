import type { Task, User } from '../../types';
import { OrgNodeCard } from './subcomponents';

interface OrgTreeProps {
  users: User[];
  tasks: Task[];
  staffByDepartment: Map<string, User[]>;
  independentStaff: User[];
  onSelect: (user: User) => void;
}

/** Kadro şema (org-chart) görünümü — Yönetim Kurulu → Birim Yöneticileri
 *  (+ kendi personeli) → yöneticisi olmayan bağımsız kadro. */
export function OrgTree({ users, tasks, staffByDepartment, independentStaff, onSelect }: OrgTreeProps) {
  return (
    <div className="flex flex-col items-center gap-12 py-8 overflow-x-auto w-full custom-scrollbar select-none bg-makam-glass border border-surface-border rounded-3xl p-6">
      {/* Level 1: Admins */}
      <div className="flex flex-col items-center gap-2">
        <span className="text-micro font-bold uppercase tracking-eyebrow text-status-danger bg-status-danger/10 border border-status-danger/20 px-2.5 py-1 rounded-full">Yönetim Kurulu</span>
        <div className="flex flex-wrap justify-center gap-6 mt-2">
          {users.filter(u => u.role === 'Admin').map(u => (
            <OrgNodeCard key={u.uid} user={u} tasks={tasks} onSelect={onSelect} />
          ))}
        </div>
      </div>

      {/* Connection Line */}
      <div className="w-[1px] h-8 bg-executive-blue/15" />

      {/* Level 2: Managers */}
      <div className="flex flex-col items-center gap-4 w-full">
        <span className="text-micro font-bold uppercase tracking-eyebrow text-executive-blue bg-executive-blue/5 border border-executive-blue/10 px-2.5 py-1 rounded-full">Birim Yöneticileri</span>
        <div className="flex flex-wrap justify-center gap-8 mt-2 w-full">
          {users.filter(u => u.role === 'Manager').map(u => {
            const staffInDept = staffByDepartment.get(u.departmentId ?? '') ?? [];
            return (
              <div key={u.uid} className="flex flex-col items-center gap-4 bg-executive-blue/[0.01] p-4 rounded-2xl border border-executive-blue/[0.03]">
                <OrgNodeCard user={u} tasks={tasks} onSelect={onSelect} />
                {staffInDept.length > 0 && (
                  <>
                    <div className="w-[1px] h-4 bg-executive-blue/10" />
                    {/* max-w sabit 400px'ti — dış konteynerin overflow-x-auto
                        (bkz. mobil tasarım denetimi) tam da bunun gibi bir
                        kadro grubunun mobil ekrandan (~360-400px) geniş
                        olduğu durumlar için bir kaçış yoluydu, ama custom-scrollbar
                        ile kaydırma ipucu görünmez olduğundan içerik sessizce
                        "kesilmiş" görünüyordu. Sınır artık viewport'u da
                        hesaba katıyor, gerçek taşmayı büyük ölçüde önler. */}
                    <div className="flex flex-wrap justify-center gap-2.5 max-w-[min(400px,calc(100vw-8rem))]">
                      {staffInDept.map(staff => (
                        <OrgNodeCard key={staff.uid} user={staff} tasks={tasks} onSelect={onSelect} isMini />
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
            <span className="text-micro font-bold uppercase tracking-eyebrow text-text-tertiary bg-surface-glass border border-surface-border px-2.5 py-1 rounded-full">Bağımsız Kadro</span>
            <div className="flex flex-wrap justify-center gap-3 mt-2">
              {independentStaff.map(u => (
                <OrgNodeCard key={u.uid} user={u} tasks={tasks} onSelect={onSelect} isMini />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
