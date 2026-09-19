import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from './Sparkline';

describe('Sparkline', () => {
  it('2\'den az veri noktasıyla hiçbir şey render etmez', () => {
    const { container } = render(<Sparkline data={[5]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('boş veriyle hiçbir şey render etmez', () => {
    const { container } = render(<Sparkline data={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('tüm değerler eşitse (düz çizgi) sıfıra bölme olmadan render eder', () => {
    const { container } = render(<Sparkline data={[3, 3, 3, 3]} />);
    const polyline = container.querySelector('polyline');
    expect(polyline).toBeInTheDocument();
    // Tüm y koordinatları eşit olmalı (düz bir çizgi) — NaN değil.
    const points = polyline!.getAttribute('points')!.split(' ').map(p => p.split(',')[1]);
    expect(new Set(points).size).toBe(1);
    expect(points[0]).not.toBe('NaN');
  });

  it('artan bir seri için noktaları soldan sağa, aşağıdan yukarıya çizer', () => {
    const { container } = render(<Sparkline data={[1, 5, 10]} width={30} height={10} />);
    const polyline = container.querySelector('polyline')!;
    const points = polyline.getAttribute('points')!.split(' ').map(p => p.split(',').map(Number));
    // En düşük değer (1) en altta (y=height), en yüksek (10) en üstte (y=0).
    expect(points[0][1]).toBe(10);
    expect(points[2][1]).toBe(0);
  });

  it('svg dekoratif kabul edilip aria-hidden taşır (sayı zaten ayrıca erişilebilir)', () => {
    const { container } = render(<Sparkline data={[1, 2]} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
