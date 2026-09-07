/**
 * OfflineBanner — Çevrimdışı mod ve bekleyen kuyruk sayısını gösterir.
 * Sıfır state'te render edilmez (null).
 */
import React, { useState } from 'react';
import { ChevronDown, RefreshCw, X, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { STATUS_LABELS } from '../constants';
import type { OfflineMutation, FailedMutation } from '../lib/offlineQueue';

interface Props {
  isOffline: boolean;
  queueLength: number;
  /** Kuyruktaki mutasyonların ayrıntı listesi — eskiden yalnızca sayı
   *  gösteriliyordu, kullanıcı NEYİN beklediğini göremiyordu (bkz. tasarım
   *  denetimi F8). */
  pendingMutations?: OfflineMutation[];
  /** useOfflineQueue().syncNow — eskiden hiçbir yerden çağrılmıyordu (bkz.
   *  tasarım denetimi F8: bağlantı gelince otomatik senkron zaten olur, ama
   *  kullanıcının "şimdi dene" diyebileceği bir kontrol yoktu). */
  onSyncNow?: () => void;
  /** Sunucu tarafından kalıcı olarak reddedilip kuyruktan düşürülmüş
   *  mutasyonlar — eskiden yalnızca geçici bir toast vardı, kullanıcı
   *  kaçırırsa NEYİN uygulanmadığını bir daha göremiyordu (bkz. tasarım
   *  denetimi 3.3). */
  failedMutations?: FailedMutation[];
  onDismissFailed?: (id: string) => void;
  onClearFailed?: () => void;
}

/** Bir kuyruk kaydının kısa, okunabilir özeti — kullanıcıya ham
 *  collection/action çiftini değil ("tasks update") anlamlı bir eylem adını
 *  gösterir. */
function summarizeMutation(m: OfflineMutation): string {
  if (m.collectionName === 'tasks') {
    if (m.statusTransition) return `Durum değişikliği → ${STATUS_LABELS[m.statusTransition.newStatus] ?? m.statusTransition.newStatus}`;
    if (m.action === 'create') return 'Yeni talimat';
    if (m.action === 'delete') return 'Talimat silme';
    return 'Talimat güncellemesi';
  }
  if (m.collectionName === 'blockers') {
    return m.action === 'create' ? 'Yeni engel bildirimi' : 'Engel güncellemesi';
  }
  if (m.collectionName === 'users') {
    return m.action === 'create' ? 'Yeni personel kaydı' : 'Personel güncellemesi';
  }
  return `${m.collectionName} — ${m.action}`;
}

function formatQueuedAgo(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'az önce';
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  return `${hours} sa önce`;
}

/** Ham hata kodunu/mesajını kullanıcıya gösterilecek Türkçe bir cümleye
 *  çevirir — isNonRetryableError'ın (offlineQueue.ts) tanıdığı kod/kalıplarla
 *  BİREBİR eşleşir; tanınmayan bir mesaj olduğu gibi gösterilir (zaten
 *  taskStateMachine'in kendi Türkçe iş-kuralı mesajlarından biridir). */
function describeFailureReason(reason: string): string {
  if (reason === 'permission-denied') return 'Bu işlem için yetkiniz olmadığı sunucu tarafından tespit edildi.';
  if (reason === 'invalid-argument') return 'Gönderilen veri sunucu tarafından geçersiz sayıldı.';
  if (reason.startsWith('INVALID_TRANSITION:')) return reason.slice('INVALID_TRANSITION:'.length).trim() || 'Geçersiz durum geçişi.';
  return reason;
}

export function OfflineBanner({
  isOffline, queueLength, pendingMutations = [], onSyncNow,
  failedMutations = [], onDismissFailed, onClearFailed,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFailedExpanded, setIsFailedExpanded] = useState(false);
  const hasFailed = failedMutations.length > 0;
  if (!isOffline && queueLength === 0 && !hasFailed) return null;

  return (
    <div className="z-[200] relative">
    {(isOffline || queueLength > 0) && (
    <div
      className="bg-executive-gold/10 border-b border-executive-gold/20 backdrop-blur-md"
    >
      <div
        role="status"
        aria-live="polite"
        className="py-2.5 px-6 flex items-center justify-between mx-auto max-w-[1440px] w-full gap-3"
      >
        <button
          type="button"
          onClick={() => setIsExpanded(v => !v)}
          disabled={queueLength === 0}
          aria-expanded={queueLength > 0 ? isExpanded : undefined}
          aria-controls="offline-queue-detail"
          className="flex items-center gap-3.5 min-w-0 disabled:cursor-default"
        >
          <span
            className="w-2 h-2 rounded-full bg-executive-gold animate-ping flex-shrink-0"
            aria-hidden="true"
          />
          <span className="text-micro font-medium text-[color:var(--gold-text)] uppercase tracking-[0.25em] font-sans truncate">
            {isOffline
              ? 'Çevrimdışı Mod — Resmî Kayıtlar Lokal Sıraya Alındı'
              : `${queueLength} Adet Değişiklik Sıraya Alındı, Senkronize Ediliyor...`}
          </span>
          {queueLength > 0 && (
            <ChevronDown
              aria-hidden="true"
              className={cn('w-3.5 h-3.5 text-[color:var(--gold-text)] flex-shrink-0 transition-transform', isExpanded && 'rotate-180')}
            />
          )}
        </button>

        {!isOffline && queueLength > 0 && onSyncNow && (
          <button
            type="button"
            onClick={onSyncNow}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-micro font-semibold uppercase tracking-[0.15em] text-[color:var(--gold-text)] border border-executive-gold/30 hover:bg-executive-gold/15 transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            Şimdi Senkronize Et
          </button>
        )}
      </div>

      {isExpanded && queueLength > 0 && (
        <div id="offline-queue-detail" className="px-6 pb-3 mx-auto max-w-[1440px] w-full">
          <ul className="flex flex-col gap-1.5 border-t border-executive-gold/20 pt-2.5">
            {pendingMutations.map(m => (
              <li key={m.id} className="flex items-center justify-between gap-3 text-micro">
                <span className="text-text-heading font-medium truncate">{summarizeMutation(m)}</span>
                <span className="text-text-tertiary uppercase tracking-wider flex-shrink-0">{formatQueuedAgo(m.timestamp)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
    )}

    {hasFailed && (
      <div className="bg-status-danger/10 border-b border-status-danger/20 backdrop-blur-md">
        <div
          role="status"
          aria-live="polite"
          className="py-2.5 px-6 flex items-center justify-between mx-auto max-w-[1440px] w-full gap-3"
        >
          <button
            type="button"
            onClick={() => setIsFailedExpanded(v => !v)}
            aria-expanded={isFailedExpanded}
            aria-controls="offline-failed-detail"
            className="flex items-center gap-3.5 min-w-0"
          >
            <span className="w-2 h-2 rounded-full bg-status-danger flex-shrink-0" aria-hidden="true" />
            <span className="text-micro font-medium text-status-danger uppercase tracking-[0.25em] font-sans truncate">
              {failedMutations.length} Adet İşlem Reddedildi, Uygulanamadı
            </span>
            <ChevronDown
              aria-hidden="true"
              className={cn('w-3.5 h-3.5 text-status-danger flex-shrink-0 transition-transform', isFailedExpanded && 'rotate-180')}
            />
          </button>

          {onClearFailed && (
            <button
              type="button"
              onClick={onClearFailed}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-micro font-semibold uppercase tracking-[0.15em] text-status-danger border border-status-danger/30 hover:bg-status-danger/15 transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
            >
              <Trash2 className="w-3 h-3" aria-hidden="true" />
              Tümünü Temizle
            </button>
          )}
        </div>

        {isFailedExpanded && (
          <div id="offline-failed-detail" className="px-6 pb-3 mx-auto max-w-[1440px] w-full">
            <ul className="flex flex-col gap-2 border-t border-status-danger/20 pt-2.5">
              {failedMutations.map(f => (
                <li key={f.id} className="flex items-start justify-between gap-3 text-micro">
                  <span className="min-w-0 flex flex-col gap-0.5">
                    <span className="text-text-heading font-medium truncate">{summarizeMutation(f.mutation)}</span>
                    <span className="text-text-muted font-light">{describeFailureReason(f.reason)}</span>
                  </span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-text-tertiary uppercase tracking-wider">{formatQueuedAgo(f.failedAt)}</span>
                    {onDismissFailed && (
                      <button
                        type="button"
                        onClick={() => onDismissFailed(f.id)}
                        aria-label="Bu bildirimi kapat"
                        className="text-text-tertiary hover:text-status-danger transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue rounded-full"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )}
    </div>
  );
}
