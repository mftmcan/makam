import type { Transition } from 'motion/react';

/**
 * Sayfa açılışında BİR KEZ animasyonlanan büyük panel/kart girişi (bkz.
 * Dashboard/Reports/TaskBoard/BlockerList'in ana panelleri) — eskiden
 * `{ stiffness: 200, damping: 28 }` 13 yerde bağımsız olarak tekrarlanıyordu
 * (bkz. tasarım denetimi). Sidebar'ın aktif-zemin `layoutId` geçişi ve
 * MobileDock'un ikon/nokta mikro-etkileşimleri (420-500 stiffness aralığı,
 * çok daha sert/hızlı) BİLİNÇLİ OLARAK bu aileye dahil edilmedi — farklı bir
 * amaç taşıyorlar (giriş animasyonu değil, anlık dokunsal geri bildirim).
 */
export const SPRING_PANEL: Transition = { type: 'spring', stiffness: 200, damping: 28 };

/**
 * Listede TEKRARLANAN (stagger'lı) satır/kart girişi (bkz. BlockerList
 * kartı, Dashboard StatCard/InterventionRow, UserCard, SettingsCard,
 * Reports'un yönetici satırları) — eskiden `{ stiffness: 260, damping: 28 }`
 * (Reports'ta bir yerde 280/30 olarak neredeyse aynı ama ayrık) 7 yerde
 * bağımsız olarak tekrarlanıyordu.
 */
export const SPRING_ROW: Transition = { type: 'spring', stiffness: 260, damping: 28 };

/**
 * `i * baseDelay` stagger gecikmesi — `baseDelay` BİLİNÇLİ OLARAK çağırana
 * bırakılır: kısa listeler (ör. 6 kartlık StatCard ızgarası) daha yavaş
 * (0.06), uzun listeler (ör. onlarca satırlık denetim izi) daha hızlı (0.03)
 * stagger kullanıyordu ki toplam animasyon süresi makul kalsın (bkz. tasarım
 * denetimi) — bu varyasyon sürüklenme değil, liste uzunluğuna göre bilinçli
 * bir ayar; tek bir sabite indirgenmedi.
 */
export function staggerDelay(index: number, baseDelay: number): number {
  return index * baseDelay;
}
