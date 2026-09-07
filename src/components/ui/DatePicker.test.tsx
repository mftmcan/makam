import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DatePicker } from './DatePicker';

const getTrigger = () => screen.getByRole('button', { name: 'Test tarihi' });

describe('DatePicker', () => {
  it('geçerli bir value için etiket olarak formatlanmış tarihi gösterir', () => {
    render(<DatePicker value="2026-08-24" onChange={vi.fn()} ariaLabel="Test tarihi" />);
    expect(getTrigger().textContent).toBe('24 Ağu 2026');
  });

  it('boş/geçersiz value için "—" gösterir, çökmez', () => {
    render(<DatePicker value="" onChange={vi.fn()} ariaLabel="Test tarihi" />);
    expect(getTrigger().textContent).toBe('—');
  });

  it('bir gün seçildiğinde onChange yyyy-MM-dd formatında çağrılır', () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-08-24" onChange={onChange} ariaLabel="Test tarihi" />);
    fireEvent.click(getTrigger());
    const dialog = screen.getByRole('dialog', { name: 'Test tarihi' });

    fireEvent.click(within(dialog).getByText('15'));

    expect(onChange).toHaveBeenCalledWith('2026-08-15');
  });

  it('seçili gün hücresi aria-selected=true taşır', () => {
    render(<DatePicker value="2026-08-24" onChange={vi.fn()} ariaLabel="Test tarihi" />);
    fireEvent.click(getTrigger());
    const dialog = screen.getByRole('dialog', { name: 'Test tarihi' });

    const selectedDay = within(dialog).getByText('24');
    expect(selectedDay.closest('[role="gridcell"]')).toHaveAttribute('aria-selected', 'true');
  });

  it('takvim WAI-ARIA grid deseniyle (grid > row > columnheader/gridcell) yapılandırılmıştır', () => {
    render(<DatePicker value="2026-08-24" onChange={vi.fn()} ariaLabel="Test tarihi" />);
    fireEvent.click(getTrigger());
    const dialog = screen.getByRole('dialog', { name: 'Test tarihi' });

    const grid = within(dialog).getByRole('grid');
    expect(within(grid).getAllByRole('columnheader')).toHaveLength(7);
    // En az 5 hafta satırı (haftasonu başlığı satırı hariç) — bir ay ızgarası
    // her zaman 5 veya 6 hafta satırı içerir.
    expect(within(grid).getAllByRole('row').length).toBeGreaterThanOrEqual(6);
    expect(within(grid).getAllByRole('gridcell').length).toBeGreaterThanOrEqual(35);
  });

  it('dışarı tıklanınca takvim kapanır', () => {
    render(
      <div>
        <DatePicker value="2026-08-24" onChange={vi.fn()} ariaLabel="Test tarihi" />
        <button>Dışarıdaki eleman</button>
      </div>
    );
    fireEvent.click(getTrigger());
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.mouseDown(screen.getByText('Dışarıdaki eleman'));

    // Kapanış AnimatePresence exit animasyonu ile gecikmeli olabilir — tetikleyici
    // butonun aria-expanded durumu, animasyon zamanlamasından bağımsız otorite kaynağıdır.
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false');
  });
});
