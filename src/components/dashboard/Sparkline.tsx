import { cn } from '../../lib/utils';

interface SparklineProps {
  /** Zaman sırasına göre (en eski → en yeni) değer dizisi. */
  data: number[];
  className?: string;
  width?: number;
  height?: number;
}

/**
 * StatCard içi mini trend grafiği — ham `<svg><polyline>` (dataviz mark-spec
 * "thin marks" ilkesi), recharts'ı her kart için ayrıca yüklemez. Değer,
 * kartın zaten görünür sayısına (RollingNumber) EK bir görsel katmandır —
 * tek başına bilgi taşımadığından (renk-yalnız kimlik değil, salt trend
 * ipucu) dekoratif kabul edilip `aria-hidden` ile işaretlenir.
 */
export const Sparkline = ({ data, className, width = 48, height = 16 }: SparklineProps) => {
  if (data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1; // tüm değerler eşitse (düz çizgi) sıfıra bölmeyi önle
  const step = width / (data.length - 1);
  const points = data
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`)
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible shrink-0', className)}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
