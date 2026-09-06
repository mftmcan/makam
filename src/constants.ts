import { TaskStatus, TaskPriority, UserRole } from './types';

export type AppTabId = 'dashboard' | 'tasks' | 'blockers' | 'team' | 'reports' | 'audit' | 'settings';

/** Sekme → izinli roller eşlemesi — TEK doğruluk kaynağı. App.tsx'teki RBAC
 *  güvenlik duvarı ile Sidebar/MobileDock'un menü filtrelemesi hepsi buradan
 *  okur; üçü bağımsız kopyalanmış olsaydı biri güncellenip diğerleri
 *  unutulduğunda sessiz bir güvenlik/UX tutarsızlığı (görünen ama erişilemeyen
 *  ya da erişilebilen ama görünmeyen bir sekme) oluşabilirdi (bkz. kod denetimi). */
export const TAB_ROLES: Record<AppTabId, UserRole[]> = {
  dashboard: ['Admin', 'Manager', 'Staff'],
  tasks: ['Admin', 'Manager', 'Staff'],
  blockers: ['Admin', 'Manager'],
  team: ['Admin', 'Manager'],
  reports: ['Admin'],
  audit: ['Admin'],
  settings: ['Admin', 'Manager', 'Staff'],
};

/** URL route'larının türetildiği sekme listesi — TAB_ROLES'un anahtarlarından
 *  ÜRETİLİR, elle yazılmış ikinci bir liste DEĞİLDİR. Bir sekme eklendiğinde
 *  route'u, RBAC guard'ı ve `AppTabId` tipi tek hamlede birlikte güncellenir
 *  (bkz. kod denetimi P1-6: routing katmanı eklenirken buraya paralel bir
 *  "route tanımları" dizisi konulsaydı, TAB_ROLES ile sessizce sapabilirdi). */
export const APP_TAB_IDS = Object.keys(TAB_ROLES) as AppTabId[];

/** URL yolu = sekme kimliği. Ayrı bir eşleme tablosu bilinçli olarak YOKTUR:
 *  `/dashboard` ↔ `'dashboard'` birebir aynı string olduğundan senkronizasyonu
 *  unutulabilecek bir ara katman oluşmaz. */
export const tabPath = (tab: AppTabId) => `/${tab}`;

/** Yetkisiz/eşleşmeyen her route'un düştüğü varsayılan ekran — TAB_ROLES'ta
 *  TÜM rollere açık olduğu için yönlendirme döngüsü oluşturamaz. */
export const DEFAULT_TAB: AppTabId = 'dashboard';

/** AppHeader'ın ekran başlığı — eskiden AppHeader içinde yedi ayrı satırlık
 *  `activeTab === 'x' && '...'` koşul zinciriydi; route katmanıyla birlikte
 *  sekme kimliğinden türetilebilir tek bir tabloya taşındı. */
export const TAB_TITLES: Record<AppTabId, string> = {
  dashboard: 'Stratejik Harekat Merkezi',
  tasks: 'Talimatlar',
  blockers: 'Engeller',
  team: 'Kadro',
  reports: 'Raporlar',
  audit: 'Denetim İzleri',
  settings: 'Dizge Ayarları',
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  ASSIGNED: 'Talimat Verildi',
  PENDING_DELEGATION: 'Yetki Devri Bekleniyor',
  IN_PROGRESS: 'İcra Aşamasında',
  BLOCKED: 'Engellenmiş',
  AWAITING_APPROVAL: 'Onay Sürecinde',
  COMPLETED: 'İcra Edildi',
  CANCELLED: 'Lağvedildi',
  CRISIS: 'Kriz — Gecikmiş',
};

/** STATUS_LABELS'ın tek/iki kelimelik kısa biçimi — pipeline şeridi (TaskDetails),
 *  pasta grafik dilimleri (Reports) gibi dar alanlarda kullanılır. Bu iki yer
 *  eskiden birbirinden bağımsız, zamanla birbirinden sapmış kendi kopyalarını
 *  tutuyordu (ör. "Devir Bekliyor" / "Devrediliyor", "Engel" / "Engelli") —
 *  bkz. kod denetimi. */
export const STATUS_LABELS_SHORT: Record<TaskStatus, string> = {
  ASSIGNED: 'Atandı',
  PENDING_DELEGATION: 'Devir Bekliyor',
  IN_PROGRESS: 'İşlemde',
  BLOCKED: 'Engel',
  AWAITING_APPROVAL: 'Onayda',
  COMPLETED: 'Tamam',
  CANCELLED: 'İptal',
  CRISIS: 'Kriz',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  Low: 'Rutin',
  Medium: 'Normal',
  High: 'Öncelikli',
  Urgent: 'İvedi',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  Admin: 'Müftü',
  Manager: 'Müdür',
  Staff: 'Memur',
};

/** Hareketsizlik nedeniyle otomatik oturum kapatma VARSAYILANI (30 dakika).
 *  Eskiden 24 saatti — pratikte "oturum hiç kapanmaz" demekti ve paylaşılan/
 *  kurumsal bir cihazda açık bırakılmış bir MAKAM oturumu ertesi güne kadar
 *  erişilebilir kalıyordu (bkz. kod denetimi). Artık yalnızca bir varsayılan:
 *  Admin, `system/settings` dokümanındaki `sessionTimeoutMs` alanıyla bunu
 *  Ayarlar ekranından değiştirebilir (bkz. settingsService.saveSessionTimeout,
 *  useSessionTimeout). */
export const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** Oturum kapanmadan önce kullanıcıya "Devam Et" seçeneği sunulan süre. */
export const SESSION_TIMEOUT_WARNING_MS = 60 * 1000;

/** Admin'in seçebileceği alt/üst sınırlar. Alt sınır, kullanıcının uyarı
 *  modalını fark edemeyeceği kadar kısa süreleri (uyarı penceresinden kısa
 *  bir zaman aşımı) engeller; üst sınır ise "pratikte kapanmayan oturum"
 *  ayarına geri dönülmesini engeller. */
export const SESSION_TIMEOUT_MIN_MS = 5 * 60 * 1000;
export const SESSION_TIMEOUT_MAX_MS = 8 * 60 * 60 * 1000;

/** Firestore'dan gelen ham değeri güvenli aralığa oturtur; geçersiz/eksik
 *  değerlerde varsayılana döner. İstemci ve Ayarlar formu AYNI kaynağı
 *  kullansın diye burada tek noktada tanımlıdır. */
export function normalizeSessionTimeoutMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SESSION_TIMEOUT_MS;
  return Math.min(SESSION_TIMEOUT_MAX_MS, Math.max(SESSION_TIMEOUT_MIN_MS, Math.round(value)));
}

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  Low: 'bg-surface-border/[0.04] text-text-muted border-surface-border/50',
  Medium: 'bg-executive-blue/[0.04] text-executive-blue/80 border-executive-blue/[0.08]',
  High: 'bg-executive-gold/[0.05] text-[color:var(--gold-text)] border-executive-gold/15',
  Urgent: 'bg-status-danger/[0.05] text-status-danger border-status-danger/10',
};

/** Badge bileşeninin `variant` prop'una eşleme — öncelik rozetlerinin tüm
 *  ekranlarda (BlockerList, TaskBoard, vb.) tutarlı görünmesi için tek kaynak. */
export const PRIORITY_BADGE_VARIANT: Record<TaskPriority, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary'> = {
  Low: 'default',
  Medium: 'info',
  High: 'warning',
  Urgent: 'danger',
};

/** Badge bileşeninin `variant` prop'una eşleme — durum rozetlerinin tüm
 *  ekranlarda (AuditLogList, Dashboard, TaskBoard, TaskDetails, TeamList)
 *  tutarlı görünmesi için tek kaynak. Eskiden her ekran bu eşlemeyi bağımsız
 *  olarak yeniden yazıyordu ve biri (TaskBoard) diğerlerinden sapmıştı
 *  (IN_PROGRESS → 'primary' vs 'info') — bkz. kod denetimi. */
export const STATUS_BADGE_VARIANT: Record<TaskStatus, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary'> = {
  ASSIGNED: 'default',
  PENDING_DELEGATION: 'warning',
  IN_PROGRESS: 'info',
  BLOCKED: 'danger',
  AWAITING_APPROVAL: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'default',
  CRISIS: 'danger',
};

/** Boş-durum metinleri — eskiden her ekran aynı koşul için kendi metnini
 *  yazıyordu (ör. Reports'ta "Veri bulunamadı" vs "Yönetici kaydı
 *  bulunamadı." — aynı boş managerPerformance listesi için mobil/masaüstü
 *  görünümlerinde İKİ farklı metin, bkz. tasarım denetimi F22). Tek kaynağa
 *  taşındı ki aynı koşul her zaman aynı cümleyle anlatılsın. */
export const EMPTY_STATE_MESSAGES = {
  NO_DATA_IN_RANGE: 'Seçili aralıkta talimat yok',
  NO_MANAGER_RECORDS: 'Yönetici kaydı bulunamadı',
  NO_DATA_SHORT: 'Veri Yok',
} as const;
