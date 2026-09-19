import { Users, Calendar, FileText, Download, Loader2 } from 'lucide-react';
import { DatePicker } from '../ui/DatePicker';

interface ReportsHeaderActionsProps {
  selectedDept: string;
  onSelectedDeptChange: (dept: string) => void;
  departmentsList: string[];
  dateFrom: string;
  onDateFromChange: (date: string) => void;
  dateTo: string;
  onDateToChange: (date: string) => void;
  onExportCSV: () => void;
  onExportPDF: () => void;
  isExporting: boolean;
}

/** ── Reports Sayfa Başlığı Aksiyonları ────────────────────────────────────
 *  Reports.tsx'ten ayrıştırıldı (bkz. kod denetimi — dosya bölme): birim
 *  filtresi, tarih aralığı seçici, CSV/PDF dışa aktarma. Saf sunum, kendi
 *  state'i yok (dateFrom/dateTo/selectedDept/isExporting Reports.tsx'te kalır
 *  — dışa aktarma işleyicileri filtre state'ine bağımlı olduğundan). */
export const ReportsHeaderActions = ({
  selectedDept, onSelectedDeptChange, departmentsList,
  dateFrom, onDateFromChange, dateTo, onDateToChange,
  onExportCSV, onExportPDF, isExporting,
}: ReportsHeaderActionsProps) => (
  <>
    {/* Birim Filtresi */}
    <div className="flex items-center gap-2 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl px-3 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-executive-blue has-[:focus-visible]:ring-offset-1">
      <Users className="w-3.5 h-3.5 text-executive-blue stroke-[1.5] flex-shrink-0" aria-hidden="true" />
      <select
        value={selectedDept}
        onChange={e => onSelectedDeptChange(e.target.value)}
        className="text-caption text-text-heading bg-transparent outline-none border-none cursor-pointer pr-4 font-medium"
        aria-label="Birim Filtresi"
      >
        <option value="ALL" className="bg-surface-base text-text-heading">Tüm Birimler</option>
        {departmentsList.map(dept => (
          <option key={dept} value={dept} className="bg-surface-base text-text-heading">
            {dept}
          </option>
        ))}
      </select>
    </div>

    <div className="flex items-center gap-2 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl px-3 py-2">
      <Calendar className="w-3.5 h-3.5 text-executive-blue stroke-[1.5] flex-shrink-0" aria-hidden="true" />
      <DatePicker
        id="report-date-from"
        value={dateFrom}
        onChange={onDateFromChange}
        ariaLabel="Rapor başlangıç tarihi"
      />
      <span className="text-micro text-text-tertiary mx-1">—</span>
      <DatePicker
        id="report-date-to"
        value={dateTo}
        onChange={onDateToChange}
        ariaLabel="Rapor bitiş tarihi"
      />
    </div>

    <button
      onClick={onExportCSV}
      aria-label="Raporu CSV olarak dışa aktar"
      className="flex items-center gap-1.5 px-3 py-2 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl text-micro uppercase tracking-widest text-text-muted hover:text-executive-blue hover:bg-surface-elevated transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
    >
      <FileText className="w-3.5 h-3.5" aria-hidden="true" />
      CSV
    </button>

    <button
      onClick={onExportPDF}
      disabled={isExporting}
      aria-label="Raporu PDF olarak dışa aktar"
      className="flex items-center gap-1.5 px-3 py-2 bg-executive-blue text-[color:var(--executive-blue-text)] rounded-2xl text-micro uppercase tracking-widest hover:bg-executive-blue/90 transition-all shadow-lg shadow-executive-blue/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2"
    >
      {isExporting ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
      )}
      {isExporting ? 'Hazırlanıyor...' : 'PDF'}
    </button>
  </>
);
