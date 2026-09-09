import { Search, Filter, X } from 'lucide-react';
import type { User } from '../../types';
import { PRIORITY_LABELS, STATUS_LABELS } from '../../constants';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

interface FilterBarProps {
  search: string;
  setSearch: (value: string) => void;
  priorityFilter: string;
  setPriorityFilter: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  assigneeFilter: string;
  setAssigneeFilter: (value: string) => void;
  users: User[];
  hasActiveFilter: boolean;
  resetFilters: () => void;
  filteredCount: number;
  allFilteredSelected: boolean;
  selectedCount: number;
  selectAllFiltered: () => void;
  clearSelection: () => void;
}

const GHOST_SELECT_CLASSNAME = 'bg-transparent border-none text-micro font-medium text-text-muted uppercase tracking-label sm:tracking-caps focus:ring-0 cursor-pointer outline-none min-w-0 w-full';

/**
 * TaskBoard'un arama + öncelik/durum/sorumlu filtreleri + toplu seçim
 * kısayolları. `flex-[1_1_46%]`: min-w-0 + flex-1 üçünü de tek satıra
 * sıkıştırıp native `<select>` metnini (ör. "TÜM ÖNCELİKLER") elipsissiz
 * ortadan kesiyordu (bkz. mobil tasarım denetimi) — bu oran iki filtreyi bir
 * satırda tutacak kadar yer bırakır, sığmayan üçüncüsü/dördüncüsü elipsis
 * yerine okunaklı biçimde bir sonraki satıra sarar.
 *
 * Arama/filtreler artık `ui/Input` (variant="sm") ve `ui/Select`
 * (variant="ghost") üzerinden — eskiden native `<input>`/`<select>` elle
 * tekrarlanıyordu (bkz. tasarım denetimi, Faz 4 görsel-tutarlılık maddesi).
 */
export function FilterBar({
  search, setSearch, priorityFilter, setPriorityFilter, statusFilter, setStatusFilter,
  assigneeFilter, setAssigneeFilter, users, hasActiveFilter, resetFilters,
  filteredCount, allFilteredSelected, selectedCount, selectAllFiltered, clearSelection,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 bg-makam-glass backdrop-blur-xl border border-surface-border p-2.5 rounded-2xl shadow-sm">
      {/* Search */}
      <div className="flex-[1_1_100%] sm:flex-1 sm:min-w-[200px]">
        <Input
          variant="sm"
          icon={<Search className="w-3.5 h-3.5 stroke-[1.5]" />}
          placeholder="Ara..."
          aria-label="Talimatları ara"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Priority filter */}
      <div className="flex items-center gap-2 bg-makam-glass px-2.5 sm:px-3 rounded-xl border border-executive-blue/[0.05] h-8 min-w-0 flex-[1_1_46%] sm:flex-none">
        <Filter className="w-3 h-3 text-text-tertiary stroke-[1.5]" />
        <Select
          variant="ghost"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          aria-label="Öncelik filtresi"
          className={GHOST_SELECT_CLASSNAME}
          options={[
            { value: 'All', label: 'TÜM ÖNCELİKLER' },
            ...Object.entries(PRIORITY_LABELS).map(([val, label]) => ({ value: val, label: label.toUpperCase() })),
          ]}
        />
      </div>

      {/* Durum filtresi */}
      <div className="flex items-center gap-2 bg-makam-glass px-2.5 sm:px-3 rounded-xl border border-executive-blue/[0.05] h-8 min-w-0 flex-[1_1_46%] sm:flex-none">
        <Select
          variant="ghost"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Durum filtresi"
          className={GHOST_SELECT_CLASSNAME}
          options={[
            { value: 'All', label: 'TÜM DURUMLAR' },
            ...Object.entries(STATUS_LABELS).map(([val, label]) => ({ value: val, label: label.toUpperCase() })),
          ]}
        />
      </div>

      {/* Assignee filter */}
      <div className="flex items-center gap-2 bg-makam-glass px-2.5 sm:px-3 rounded-xl border border-executive-blue/[0.05] h-8 min-w-0 flex-[1_1_46%] sm:flex-none">
        <Select
          variant="ghost"
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          aria-label="Sorumlu filtresi"
          className={GHOST_SELECT_CLASSNAME}
          options={[
            { value: 'All', label: 'TÜM SORUMLULAR' },
            ...users.map(u => ({ value: u.uid, label: u.fullName.toUpperCase() })),
          ]}
        />
      </div>

      {hasActiveFilter && (
        <button
          onClick={resetFilters}
          className="text-micro font-medium text-status-danger/70 hover:text-status-danger px-3 uppercase tracking-label sm:tracking-caps transition-colors h-8 flex items-center justify-center gap-1 flex-1 sm:flex-none"
        >
          <X className="w-3 h-3" /> Sıfırla
        </button>
      )}

      {/* Toplu seçim kısayolları (P2-18) — "Tümünü Seç" yalnızca o an
          FİLTRELENMİŞ görünür listeyi seçer, filtre dışındaki görevleri DEĞİL
          (bkz. görev tanımı). */}
      {filteredCount > 0 && (
        <div className="flex items-center gap-1 flex-1 sm:flex-none justify-end sm:justify-start">
          <button
            onClick={selectAllFiltered}
            disabled={allFilteredSelected}
            className="text-micro font-medium text-executive-blue/70 hover:text-executive-blue px-2.5 h-8 rounded-lg hover:bg-executive-blue/5 uppercase tracking-label sm:tracking-caps transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap"
          >
            Tümünü Seç
          </button>
          <button
            onClick={clearSelection}
            disabled={selectedCount === 0}
            className="text-micro font-medium text-text-tertiary hover:text-status-danger px-2.5 h-8 rounded-lg hover:bg-status-danger/5 uppercase tracking-label sm:tracking-caps transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap"
          >
            Seçimi Temizle
          </button>
        </div>
      )}
    </div>
  );
}
