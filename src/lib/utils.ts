import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { Timestamp } from 'firebase/firestore';
import type { User } from '../types';

/**
 * tailwind-merge kendi tema uzantılarımızı (bkz. index.css @theme:
 * --text-micro/caption/body-sm/body) tanımıyor; varsayılan config bunları
 * boyut değil RENK sınıfı sanıp gerçek bir `text-[color:var(...)]`/
 * `text-status-*` sınıfını SESSİZCE eliyordu (bkz. tasarım denetimi 3.1
 * sonrası bulunan gerçek regresyon: TaskDetails'teki "SÜRECİ BAŞLAT" butonu
 * altın zemin üzerinde mirasla gelen düşük kontrastlı bir renge düşüyordu).
 * Bu dört ismi açıkça `font-size` grubuna eklemek, boyut/renk çakışma
 * tespitinin doğru grupta kalmasını sağlar.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': ['text-micro', 'text-caption', 'text-body-sm', 'text-body'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTimeAgo(timestamp: number | Timestamp, status?: string) {
  const ms = timestamp instanceof Timestamp ? timestamp.toMillis() : timestamp;
  const diff = Date.now() - ms;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  
  if (status === 'COMPLETED') {
    if (days > 0) return `${days} Gün Önce İcra Edildi`;
    if (hours > 0) return `${hours} Saat Önce İcra Edildi`;
    return 'Az Önce İcra Edildi';
  }
  
  if (status === 'CANCELLED') {
    if (days > 0) return `${days} Gün Önce Lağvedildi`;
    if (hours > 0) return `${hours} Saat Önce Lağvedildi`;
    return 'Az Önce Lağvedildi';
  }

  if (days > 0) return `${days} Gündür Bekliyor`;
  if (hours > 0) return `${hours} Saattir Bekliyor`;
  return 'Yeni';
}

// ─── Tarih/saat formatlama ────────────────────────────────────────────────
// Ortak tr-TR formatlayıcılar — eskiden AuditLogList/BlockerList/TeamList/
// WarningModal/CertificateModal/Dashboard her biri kendi çıplak
// toLocaleDateString/toLocaleString/toLocaleTimeString çağrısını bağımsız
// olarak yazıyordu (bkz. kod denetimi). date-fns kullanan yerler (LocalTime,
// TaskBoard, TaskDetails, Reports) bilinçli olarak buraya taşınmadı — zaten
// tutarlı, ayrı bir formatlama kütüphanesi kullanıyorlar.

function toMillis(timestamp: number | Timestamp): number {
  return timestamp instanceof Timestamp ? timestamp.toMillis() : timestamp;
}

/** "24.08.2026" — kısa tarih. */
export function formatDate(timestamp: number | Timestamp): string {
  return new Date(toMillis(timestamp)).toLocaleDateString('tr-TR');
}

/** "24.08.2026 14:35:00" — tarih + saat. */
export function formatDateTime(timestamp: number | Timestamp): string {
  return new Date(toMillis(timestamp)).toLocaleString('tr-TR');
}

/** "24 Ağustos 2026" — uzun biçim tarih (belge/sertifika başlıkları için). */
export function formatLongDate(timestamp: number | Timestamp = Date.now()): string {
  return new Date(toMillis(timestamp)).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "14:35" — yalnızca saat. */
export function formatTime(timestamp: number | Timestamp): string {
  return new Date(toMillis(timestamp)).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

/** "24.08.2026 14:35" — tarih + saat (saniyesiz, formatDateTime'dan farkı budur). */
export function formatDateTimeShort(timestamp: number | Timestamp): string {
  return new Date(toMillis(timestamp)).toLocaleDateString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * uid VE email'e göre çift anahtarlı bir kullanıcı lookup Map'i kurar —
 * Firestore'da `assigneeId`/`changedBy` gibi referans alanları bazen uid
 * bazen (henüz ilk girişini yapmamış davet edilmiş bir kullanıcı için) email
 * olabildiğinden ikisiyle de arama yapılabilmesi gerekir. Eskiden TaskBoard/
 * TaskDetails/BlockerList her biri bu ~6 satırlık kurulumu bağımsız olarak
 * kopyalıyordu (bkz. kod denetimi).
 */
export function buildUsersById(users: User[]): Map<string, User> {
  const map = new Map<string, User>();
  for (const u of users) {
    map.set(u.uid, u);
    map.set(u.email, u);
  }
  return map;
}

export function cleanData<T extends object>(obj: T): T {
  const result = { ...obj } as Record<string, unknown>;
  Object.keys(result).forEach(key => {
    if (result[key] === undefined) {
      delete result[key];
    }
  });
  return result as T;
}

/**
 * Bir Blob'u kullanıcının tarayıcısına dosya olarak indirir (geçici bir
 * object URL + görünmez <a> elemanı üzerinden). exportService.ts (CSV) ve
 * Settings.tsx (tam sistem yedeği + denetim izi arşivi) içinde üç kez
 * neredeyse birebir kopyalanmış bir desen olduğundan tek yere toplandı —
 * bkz. kod denetimi.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
