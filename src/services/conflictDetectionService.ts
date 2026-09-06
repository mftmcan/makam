/**
 * Optimistic Locking ile Çakışma Tespit ve Çözüm Servisi
 * 
 * Makam, görev güncellemelerinde lockVersion kullanır.
 * İki kullanıcı aynı görevi aynı anda düzenlerse, ikincisi
 * "version mismatch" hatası alır ve kullanıcı uyarılır.
 */

/** Çakışma modalının "sizin değişikliğiniz" satırını ve "Benimkini Uygula"
 *  aksiyonunu (taze lockVersion ile aynı değişikliği yeniden dener) besler.
 *  useAppHandlers.ts'teki updateTask/updateTaskStatus catch bloklarında
 *  üretilir. */
export interface ConflictContext {
  attemptedChangeSummary: string;
  retry: () => void;
}

export interface ConflictInfo extends ConflictContext {
  taskId: string;
  taskTitle: string;
  expectedVersion: number;
  serverVersion: number;
}

type ConflictHandler = (info: ConflictInfo) => void;

class ConflictDetectionService {
  private handlers: ConflictHandler[] = [];

  /**
   * Çakışma bildirimi için handler kaydeder.
   * App.tsx veya ilgili bileşenler kullanır.
   */
  subscribe(handler: ConflictHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler);
    };
  }

  /**
   * Firestore güncelleme hatasından çakışma tespiti.
   * taskService.ts içinde çağrılır.
   */
  detectConflict(
    error: unknown, taskId: string, taskTitle: string, expectedVersion: number, serverVersion?: number,
    context?: ConflictContext
  ): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    // offlineQueue.ts'teki senkron-replay çağrıları context vermez (bkz. o
    // dosyadaki gerekçe: kuyruk arka planda toplu tekrar denerken tek bir
    // mutasyon için anlamlı bir "retry" kapatması kurmak, o akışın kendi
    // döngü/parça mantığını burada tekrarlamayı gerektirirdi) — bu durumda
    // modal hâlâ açılır ama "Benimkini Uygula" no-op'tur, yalnızca bilgi
    // amaçlıdır. App.tsx'teki canlı düzenleme yolu (updateTask/updateTaskStatus)
    // her zaman gerçek bir context sağlar.
    const resolvedContext: ConflictContext = context ?? {
      attemptedChangeSummary: 'Bu talimatı güncellemek',
      retry: () => {},
    };

    // Firestore transaction çakışması veya versiyon uyuşmazlığı — VERSION_MISMATCH
    // formatı taskService.ts'te büyük harfle atılıyor, önceki 'version' (küçük harf)
    // kontrolü hiçbir zaman eşleşmiyordu ve bu bildirim asla tetiklenmiyordu.
    const isConflict =
      msg.includes('VERSION_MISMATCH') ||
      msg.includes('ABORTED') ||
      msg.includes('contention') ||
      msg.includes('lock');

    if (isConflict) {
      this.notify({
        taskId,
        taskTitle,
        expectedVersion,
        serverVersion: serverVersion ?? expectedVersion + 1, // Hata mesajından parse edilemezse tahmini yedek
        ...resolvedContext,
      });
      return true;
    }
    return false;
  }

  private notify(info: ConflictInfo) {
    console.warn(`[ConflictDetection] Çakışma tespit edildi: görev=${info.taskId}, beklenen versiyon=${info.expectedVersion}`);
    this.handlers.forEach(h => h(info));
  }
}

export const conflictDetectionService = new ConflictDetectionService();
