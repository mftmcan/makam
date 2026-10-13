/**
 * Paylaşılan Recharts tooltip/legend stili — 3 grafik (SlaTrendChart,
 * StaffWorkloadChart, StatusDistributionChart) birebir aynı inline style
 * nesnelerini kopyalıyordu. Tek kaynağa indirildi (bkz. premium drift analizi B4/B5).
 * Değerler tasarım sistemi token'larından türetilir:
 * - fontSize: 11px → --text-body-sm (12px) civarı, tooltip compact olduğu için 11px sabit
 * - legend fontSize: 9px → --text-micro (10px) civarı, 9px sabit
 * - letterSpacing: 0.15em → --tracking-label (0.15em) birebir
 */
export const CHART_TOOLTIP_CONTENT_STYLE = {
  backgroundColor: 'var(--color-surface-base)',
  borderColor: 'var(--color-surface-border)',
  borderRadius: '14px',
  fontSize: '11px',
  boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
  backdropFilter: 'blur(20px)',
  color: 'var(--color-text-heading)',
} as const;

export const CHART_TOOLTIP_ITEM_STYLE = {
  color: 'var(--color-text-body)',
} as const;

export const CHART_LEGEND_FORMATTER_STYLE = {
  fontSize: '9px',
  color: 'var(--text-light)',
  textTransform: 'uppercase' as const,
  letterSpacing: 'var(--tracking-label)',
} as const;

export const CHART_AXIS_TICK_STYLE = {
  fill: 'var(--text-light)',
} as const;