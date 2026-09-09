// SettingsCard/ActionButton/StatusBanner buradan ui/'a taşındı (bkz. tasarım
// denetimi: ikisi zaten Settings.tsx dışında da kullanılıyordu ya da tamamen
// domain'den bağımsızdı). SlaPriorityInput BURADA KALIR — İş Günü/İş Saati
// birimleri ve SLA önceliği kavramı gerçekten Ayarlar'a özel, ui/'ın
// domain'den bağımsız bileşen kütüphanesine ait değil.

// ── SLA Priority Input ────────────────────────────────────────────────────────
// Settings.tsx'te Rutin/Normal/Öncelikli/İvedi için 4 kez neredeyse birebir
// kopyalanmış value+unit çiftini tek bileşene indirger (bkz. kod denetimi).
export interface SlaPriorityInputProps {
  label: string;
  value: number;
  unit: 'days' | 'hours';
  onValueChange: (value: number) => void;
  onUnitChange: (unit: 'days' | 'hours') => void;
  disabled?: boolean;
}

export const SlaPriorityInput = ({ label, value, unit, onValueChange, onUnitChange, disabled }: SlaPriorityInputProps) => (
  <div className="flex flex-col gap-1">
    <label className="text-micro font-medium text-text-tertiary uppercase tracking-label">{label}</label>
    <div className="flex gap-1.5">
      <input
        type="number"
        min="1"
        max="365"
        value={value}
        onChange={(e) => onValueChange(Math.max(1, parseInt(e.target.value) || 0))}
        disabled={disabled}
        className="w-2/3 h-9 px-3 text-body-sm bg-makam-glass border border-executive-blue/10 rounded-xl focus-visible:outline-none focus-visible:border-executive-gold disabled:bg-text-muted/5 disabled:text-text-tertiary disabled:cursor-not-allowed font-display transition-colors"
      />
      <select
        value={unit}
        onChange={(e) => onUnitChange(e.target.value as 'days' | 'hours')}
        disabled={disabled}
        className="w-1/3 h-9 px-1.5 text-micro bg-makam-glass border border-executive-blue/10 rounded-xl focus-visible:outline-none focus-visible:border-executive-gold disabled:bg-text-muted/5 disabled:text-text-tertiary disabled:cursor-not-allowed transition-colors"
      >
        <option value="days" className="bg-surface-base text-text-heading">İş Günü</option>
        <option value="hours" className="bg-surface-base text-text-heading">İş Saati</option>
      </select>
    </div>
  </div>
);
