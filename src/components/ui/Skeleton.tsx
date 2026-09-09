/**
 * Skeleton — Yükleme iskelet animasyonu
 * 
 * Gerçek içerik yüklenene kadar gösterilen pulsing placeholder'lar.
 * Kullanıcıya içeriğin yüklenmekte olduğunu hissettirerek
 * algılanan performansı iyileştirir (no-CLS, layout stable).
 */
import React from 'react';
import { cn } from '../../lib/utils';
import { PageShell } from './PageShell';

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
  /** Yuvarlak mi (avatar gibi) yoksa dikdörtgen mi? */
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full';
}

export const Skeleton = ({ className, style, rounded = 'md' }: SkeletonProps) => {
  const roundedMap = {
    none: 'rounded-none',
    sm:   'rounded-lg',
    md:   'rounded-xl',
    lg:   'rounded-2xl',
    full: 'rounded-full',
  };

  return (
    <div
      className={cn(
        'bg-gradient-to-r from-text-heading/[0.04] via-text-heading/[0.08] to-text-heading/[0.04]',
        'bg-[length:200%_100%] animate-skeleton',
        roundedMap[rounded],
        className
      )}
      style={style}
      aria-hidden="true"
      role="presentation"
    />
  );
};

/**
 * TaskCardSkeleton — Görev kartı yükleme iskeleti
 */
export const TaskCardSkeleton = () => (
  <div className="makam-card p-5 flex flex-col gap-4">
    <div className="flex items-start justify-between">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-6 w-16" rounded="full" />
    </div>
    <Skeleton className="h-3 w-1/2" />
    <div className="flex items-center gap-2 mt-1">
      <Skeleton className="h-7 w-7" rounded="full" />
      <Skeleton className="h-3 w-24" />
    </div>
    <div className="flex items-center gap-2 pt-2 border-t border-executive-blue/[0.04]">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-3 w-20" />
    </div>
  </div>
);

/**
 * TableRowSkeleton — Tablo satırı yükleme iskeleti
 */
export const TableRowSkeleton = ({ cols = 5 }: { cols?: number }) => (
  <div className="flex items-center gap-4 px-5 py-4 border-b border-executive-blue/[0.03]">
    {Array.from({ length: cols }).map((_, i) => (
      <Skeleton
        key={i}
        className="h-3 flex-1"
        style={{ maxWidth: i === 0 ? '200px' : i === cols - 1 ? '60px' : '120px' } as React.CSSProperties}
      />
    ))}
  </div>
);

/**
 * GridTableRowSkeleton — `TableRowSkeleton`'ın CSS Grid kardeşi. GridDataTable
 * (sanallaştırılmış tablo — TaskBoard, TeamList'in >30 kişi dalı) kendi
 * `gridTemplateColumns`'ını satırlarla paylaşmak zorunda; flex tabanlı
 * `TableRowSkeleton` bu hizayı koruyamaz (bkz. tasarım denetimi).
 */
export const GridTableRowSkeleton = ({ gridTemplateColumns, cols = 5 }: { gridTemplateColumns: string; cols?: number }) => (
  <div style={{ gridTemplateColumns }} className="grid items-center px-4 py-3.5 border-b border-executive-blue/[0.03]">
    {Array.from({ length: cols }).map((_, i) => (
      <Skeleton
        key={i}
        className="h-3"
        style={{ width: i === Math.floor(cols / 2) ? '60%' : (i === 0 || i === cols - 1) ? '16px' : '80px' } as React.CSSProperties}
      />
    ))}
  </div>
);

/**
 * AuditLogRowSkeleton / AuditLogListSkeleton — Denetim İzleri yükleme iskeleti
 *
 * Diğer altı modülün (Dashboard/Reports/TeamList/BlockerList/Settings/
 * TaskBoard) HER BİRİNDE o modülün gerçek satır/kart yapısını taklit eden
 * özel bir iskelet varken, Denetim İzleri yalnızca genel bir Loader2 spinner'ı
 * kullanıyordu — tasarım sisteminde bu tek istisnaydı (bkz. tasarım denetimi).
 * AuditLogList.tsx'teki gerçek satırla AYNI üç sütunlu (Aktör / Talimat /
 * Değişiklik) yapıyı taklit eder.
 */
export const AuditLogRowSkeleton = () => (
  <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-xl">
    <div className="flex items-center gap-6 flex-1">
      <Skeleton className="h-8 w-8" rounded="full" />
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-2.5 w-24" />
      </div>
    </div>
    <div className="flex flex-col gap-1 flex-[1.2] pt-2.5 sm:pt-0 sm:pl-4">
      <Skeleton className="h-2.5 w-20" />
      <Skeleton className="h-3 w-40" />
    </div>
    <div className="flex flex-col gap-2 flex-[1.6] pt-2.5 sm:pt-0 sm:pl-4">
      <Skeleton className="h-2.5 w-28" />
      <Skeleton className="h-3 w-full max-w-[220px]" />
    </div>
  </div>
);

export const AuditLogListSkeleton = () => (
  <PageShell aria-label="Denetim izleri yükleniyor..." role="status">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-executive-blue/[0.04]">
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-8 w-8" rounded="lg" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-2.5 w-20" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-9 w-40" rounded="lg" />)}
      </div>
    </div>
    <div className="flex flex-col gap-5">
      {[...Array(5)].map((_, i) => <AuditLogRowSkeleton key={i} />)}
    </div>
  </PageShell>
);

/**
 * DashboardSkeleton — Dashboard tam sayfa yükleme iskeleti
 *
 * Gerçek Dashboard'un üç bölümünü aynı sırayla ve aynı oranlarda taklit eder
 * (bkz. tasarım denetimi — eskiden 4 kartlı sabit bir ızgara vardı, gerçek
 * ekran sağlık banner'ı + 6 kartlı ızgara + grafik alanından oluşuyordu, bu da
 * yükleme anındaki düzenin gerçek içerikten farklı görünüp CLS hissi
 * yaratmasına yol açıyordu): Stratejik Sağlık Endeksi banner'ı, 6 kartlık
 * StatCard ızgarası (Dashboard.tsx:242 ile aynı breakpoint'ler) ve
 * Performans Analitiği grafik kartı.
 */
export const DashboardSkeleton = () => (
  <PageShell aria-label="Yükleniyor..." role="status">
    {/* Stratejik Sağlık Endeksi banner'ı */}
    <div className="makam-card p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12" rounded="lg" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-2.5 w-32" />
        </div>
      </div>
      <div className="flex items-center gap-8">
        <div className="flex flex-col gap-2 items-start md:items-end">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="flex flex-col gap-1.5 items-center">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-2.5 w-20" />
        </div>
      </div>
    </div>

    {/* StatCard ızgarası — mobil: 2 sütun, tablet: 3, masaüstü: 6 (Dashboard.tsx ile aynı) */}
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="makam-card p-5 flex flex-col gap-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-2 w-full" rounded="full" />
        </div>
      ))}
    </div>

    {/* Performans Analitiği grafik kartı */}
    <div className="makam-card p-4 flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-2.5 w-20" />
        </div>
        <Skeleton className="h-7 w-20" rounded="full" />
      </div>
      <Skeleton className="h-[160px] sm:h-[200px] lg:h-[220px] w-full" rounded="lg" />
      <div className="flex items-center gap-3 pt-2 border-t border-executive-blue/[0.04]">
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="h-2.5 w-20" />
      </div>
    </div>
  </PageShell>
);
