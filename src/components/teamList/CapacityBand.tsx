import { cn } from '../../lib/utils';
import type { DepartmentCapacityRow } from './helpers';

interface CapacityBandProps {
  capacityPercent: number;
  availableStaffCount: number;
  overloadedStaffCount: number;
  hasCapacityData: boolean;
  departmentCapacity: DepartmentCapacityRow[];
}

/** Kadro Kapasite Endeksi başlık şeridi — organizasyon geneli + (2+ departman
 *  varsa) departman bazlı kırılım. */
export function CapacityBand({
  capacityPercent, availableStaffCount, overloadedStaffCount, hasCapacityData, departmentCapacity,
}: CapacityBandProps) {
  return (
    <div className="flex flex-col gap-3 p-3.5 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center gap-3">
          <span className="text-micro text-text-muted uppercase tracking-wider font-bold">Kadro Kapasite Endeksi:</span>
          {hasCapacityData ? (
            <>
              <div className="w-24 h-1.5 bg-executive-blue/5 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-300',
                    capacityPercent >= 85 ? 'bg-status-danger' :
                    capacityPercent >= 55 ? 'bg-status-warning' :
                    'bg-status-success'
                  )}
                  style={{ width: `${capacityPercent}%` }}
                />
              </div>
              <span className="text-caption font-bold text-text-heading">%{capacityPercent}</span>
            </>
          ) : (
            <span className="text-micro text-text-tertiary">Kapasite verisi için en az 1 aktif talimat gerekli</span>
          )}
        </div>
        <div className="flex gap-4 text-micro text-text-muted uppercase tracking-wider font-bold">
          <span>Müsait Kadro: <span className="text-status-success font-bold">{availableStaffCount}</span></span>
          <span>Aşırı Yüklü: <span className={overloadedStaffCount > 0 ? 'text-status-danger font-bold animate-pulse' : 'text-text-muted font-bold'}>{overloadedStaffCount}</span></span>
        </div>
      </div>

      {/* Departman bazlı kırılım — yalnızca 2+ departman temsil ediliyorsa
          anlamlı (tek departmanda zaten yukarıdaki toplamla birebir aynı
          sayıyı tekrar eder, bkz. tasarım denetimi). */}
      {hasCapacityData && departmentCapacity.length > 1 && (
        <div className="flex flex-wrap gap-2.5 pt-3 border-t border-executive-blue/[0.04]">
          {departmentCapacity.map(row => (
            <div key={row.department} className="flex items-center gap-2 px-2.5 py-1.5 bg-surface-glass border border-surface-border rounded-xl">
              <span className="text-micro text-text-muted uppercase tracking-wider font-bold truncate max-w-[110px]">{row.department}</span>
              <div className="w-14 h-1 bg-executive-blue/5 rounded-full overflow-hidden flex-shrink-0">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-300',
                    row.percent >= 85 ? 'bg-status-danger' :
                    row.percent >= 55 ? 'bg-status-warning' :
                    'bg-status-success'
                  )}
                  style={{ width: `${row.percent}%` }}
                />
              </div>
              <span className="text-micro font-bold text-text-heading tabular-nums">%{row.percent}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
