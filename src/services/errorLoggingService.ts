/**
 * errorLoggingService — Firestore Tabanlı Yapılandırılmış Hata Kaydı
 *
 * Sentry.io gerektirmeden üretim hatalarını Firestore'a yazar.
 * ErrorBoundary.componentDidCatch ve kritik async handler'lardan çağrılır.
 *
 * Ücretsiz plan (Spark) uyumlu — Cloud Functions KULLANMAZ.
 * Firestore'a doğrudan yazar.
 *
 * ⚠️ TEMİZLİK: Bu koleksiyonun ŞU AN otomatik temizliği YOKTUR. Eski yorum
 * "TTL tabanlı temizlik için Security Rules'a güvenir" diyordu — Security Rules
 * TTL temizliği YAPMAZ, yalnızca erişimi kısıtlar (bkz. backend denetimi).
 * Gerçek temizlik `functions/src/cleanup.ts`'te (30 günden eski kayıtları siler)
 * ama proje Spark planında olduğundan o fonksiyon deploy EDİLMEMİŞTİR — yani
 * `error_logs` şu anda sınırsız büyüyor. Kalıcı çözüm seçenekleri: Firestore
 * TTL policy (Timestamp tipinde bir `expiresAt` alanı gerektirir; bu dosya
 * `Date.now()` yani number yazıyor) veya `taskService.cleanupDatabase()`'in
 * (Ayarlar > Dizge Optimizasyonu) bu koleksiyonu da kapsayacak şekilde
 * genişletilmesi.
 */
import { db, collection, addDoc } from '../firebase';
import { auth } from '../firebase';

export interface ErrorLogEntry {
  /** Hata mesajı */
  message: string;
  /** Hata stack trace (varsa) */
  stack?: string;
  /** Hatanın kaynağı: 'ErrorBoundary' | 'async' | 'firestore' | 'manual' */
  source: 'ErrorBoundary' | 'async' | 'firestore' | 'manual';
  /** İşlem tipi — Firestore operasyonu için */
  operationType?: string;
  /** Etkilenen Firestore path */
  path?: string;
  /** Ek bağlam bilgisi */
  context?: Record<string, unknown>;
  /** Oturum açmış kullanıcı UID */
  userId?: string;
  /** ISO timestamp */
  timestamp: number;
  /** Uygulama sürümü */
  appVersion: string;
  /** Kullanıcı ajanı */
  userAgent: string;
}

const APP_VERSION = '2.3.0';

/**
 * Firestore'a yapılandırılmış hata kaydı yazar.
 * Silently fails — hata loglama sistemi asla uygulamayı çökertmemeli.
 *
 * Dönüş değeri (oluşturulan `error_logs` dokümanının ID'si, ya da loglama
 * başarısızsa `null`) kullanıcıya gösterilen hata mesajında "Destek
 * Referansı" olarak sunulabilir — errorLoggingService kaydı zaten tutuyordu
 * ama bu ID hiçbir zaman kullanıcıya geri yansıtılmıyordu (bkz. kod
 * denetimi, src/lib/errorMessages.ts).
 */
export async function logError(
  error: unknown,
  source: ErrorLogEntry['source'],
  options: {
    operationType?: string;
    path?: string;
    context?: Record<string, unknown>;
  } = {}
): Promise<string | null> {
  try {
    const entry: ErrorLogEntry = {
      message: error instanceof Error ? error.message : String(error),
      stack:   error instanceof Error ? error.stack?.slice(0, 2000) : undefined,
      source,
      operationType: options.operationType,
      path:          options.path,
      context:       options.context,
      userId:        auth.currentUser?.uid,
      timestamp:     Date.now(),
      appVersion:    APP_VERSION,
      userAgent:     navigator.userAgent.slice(0, 200),
    };

    // Tanımsız alanları temizle (Firestore undefined kabul etmez)
    const clean = Object.fromEntries(
      Object.entries(entry).filter(([, v]) => v !== undefined)
    );

    const docRef = await addDoc(collection(db, 'error_logs'), clean);
    return docRef?.id ?? null;
  } catch {
    // Hata loglama başarısız olursa sessizce geç — sonsuz döngüyü önle
    console.warn('[ErrorLogging] Firestore log yazımı başarısız — sessizce geçildi.');
    return null;
  }
}
