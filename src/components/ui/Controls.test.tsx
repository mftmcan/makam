import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';

describe('Ortak form kontrolleri', () => {
  it('yüklenirken disabled=false verilse bile ikinci işlemi engeller', () => {
    const onClick = vi.fn();
    render(<Button isLoading disabled={false} onClick={onClick}>Kaydet</Button>);
    const button = screen.getByRole('button', { name: 'Kaydet' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it.each(['default', 'sm'] as const)('Input %s yardım metnini ve hatayı birlikte duyurur', variant => {
    render(<><p id="help">En az üç karakter</p><Input variant={variant} label="Başlık" error="Başlık gerekli" aria-describedby="help" /></>);
    expect(screen.getByRole('textbox', { name: 'Başlık' })).toHaveAccessibleDescription('En az üç karakter Başlık gerekli');
    expect(screen.getByRole('alert')).toHaveTextContent('Başlık gerekli');
  });

  it.each(['default', 'ghost'] as const)('Select %s hatayı ve alan adını korur', variant => {
    render(<><p id="help">Bir birim seçin</p><Select variant={variant} label="Birim" error="Birim gerekli" aria-describedby="help" options={[]} /></>);
    expect(screen.getByRole('combobox', { name: 'Birim' })).toHaveAccessibleDescription('Bir birim seçin Birim gerekli');
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
  });
});
