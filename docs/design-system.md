# MAKAM Tasarım Sistemi

Bu doküman, `src/index.css` ve `src/components/ui/` içine dağılmış tasarım
kararlarının tek noktadan referansıdır. Buradaki her karar kod içinde zaten
yorumla gerekçelendirilmiştir — bu dosya onları TEKRARLAMAZ, **nerede
bulunacaklarını** ve **nasıl kullanılacaklarını** gösterir. Bir token/bileşenin
"neden böyle" olduğunu öğrenmek için ilgili kaynak dosyadaki yorumu okuyun.

Kimlik: "Obsidian Midnight & Satin Gold" — sakin, kurumsal, dokunulmamış lüks
hissi ("Quiet Luxury"). İki ana renk: **executive-blue** (mürekkep, birincil
kurumsal renk, tema-duyarlı kutuplaşır) ve **executive-gold** (Satin Gold,
vurgu/CTA rengi).

## Renk

Tüm renkler `src/index.css`'te `:root` / `.dark` bloklarında CSS custom
property olarak tanımlı, `@theme` bloğunda Tailwind adlarına eşlenir
(`--color-executive-blue` gibi).

- **Tema-duyarlı "dinamik" renkler**: `--color-executive-blue-dynamic` light'ta
  koyu (#161513), dark'ta açık (#F5F3EF) — sabit değil, temaya göre kutuplaşan
  bir "mürekkep" rengi. `--executive-blue-text` / `--gold-text` /
  `--status-*-text` bunun TERSİ yönde kutuplaşan metin karşılıkları (dolu
  zemin üzerinde AA kontrastı garanti eder — bkz. `index.css:110-143`).
- **Status renkleri** (`--status-success/warning/danger/info`) light'ta
  koyu-doygun, dark'ta pastel-desatüre (bkz. `index.css:151-154` vs
  `211-214`) — sabit `text-white` bu ikisinden birinde AA'yı ihlal eder, bu
  yüzden her ikisinin kendi `-text` karşılığı var.
- **Yeni bir renk eklerken**: hem `:root` hem `.dark` bloğunda tanımlayın
  (dosyanın kendi kuralı), ve eğer dolu bir zemin üzerinde metin taşıyacaksa
  bir `-text` karşılığı ekleyip AA kontrastını (4.5:1) doğrulayın.

## Tipografi

Font aileleri self-hosted (`/fonts/*.woff2`, Google Fonts CDN'i performans
nedeniyle kaldırıldı): **Inter** (`font-sans`, gövde), **Outfit**
(`font-display`, başlık — `font-serif` de aynı fonta çözülür, geriye dönük
uyumluluk için), **JetBrains Mono** (`font-mono`, nadiren: zaman damgaları,
hata kodları).

**Boyut ölçeği** (`index.css:258-277`):

| Token | Değer | Kullanım |
|---|---|---|
| `text-micro` | 10px | mikro etiket, rozet |
| `text-caption` | 11px | alt-etiket |
| `text-body-sm` | 12px | tablo hücresi |
| `text-body` | 13px | gövde (varsayılan) |
| `text-body-lg` | 14px | isimlendirme |
| `text-field` | 15px | form alanı metni |
| `text-title` | 16px | modal/bölüm başlığı |
| `text-title-lg` | 18px | büyük başlık |
| `text-metric` | 22px | KPI/istatistik rakamı |

≤9.5px'lik TÜM arbitrary değerler `text-micro`'ya toplanmıştır — 14px+ bandı
ise BİLİNÇLİ OLARAK gevşek: bir KPI'ın 32px'i ile bir modal başlığının 20px'i
arasındaki fark sürüklenme değil, gerçek bir hiyerarşi kararı (bkz.
`index.css:263-271`). Yeni bir `text-[Npx]` yazmadan önce yukarıdaki
tabloya bakın; 14px+ için tabloda karşılığı yoksa ve gerçekten tekrar eden bir
değer değilse (tek seferlik, bağlama özgü), arbitrary değer kullanmak sorun
değil.

**Harf aralığı (tracking)** (`index.css:285-287`):

| Token | Değer | Kullanım |
|---|---|---|
| `tracking-label` | 0.15em | form label, tablo hücresi, dar mikro etiket |
| `tracking-caps` | 0.2em | varsayılan uppercase mikro etiket + rozet |
| `tracking-eyebrow` | 0.3em | sayfa/bölüm başlığı eyebrow'u |

## Gölge / Elevation

İki ayrı aile, birbirine karıştırılmaz:

1. **Kart dinlenme/hover** (`index.css:301-302`): `shadow-card` /
   `shadow-card-hover` — durağan kartların (Panel, Badge dışında) temel
   yükselti çifti.
2. **Yüzen katman (overlay)** (`index.css:311-313`): `shadow-popover` (takvim/
   menü), `shadow-sheet` (mobil dock taşma paneli, uygulama içi bildirim),
   `shadow-overlay` (tam ekran modal paneli) — üç farklı "ne kadar yükseklikte
   yüzüyor" seviyesi.

Durum noktalarının renkli "glow" gölgeleri (her biri kendi durum rengiyle
`0 0 Npx var(--color-durum)` biçiminde arbitrary bir `shadow-` değeri — burada
gerçek sınıf sözdizimiyle yazılmadı: Tailwind v4 bu dosyayı da tarar ve
sözde-sınıfı derleyip build uyarısı üretiyordu),
logo drop-shadow'ları ve `Badge`/`PremiumIcon`'un iç parlaklık (`inset`)
gölgeleri (`--shadow-badge-inset`) bu iki aileden BİLİNÇLİ OLARAK ayrı —
kendi rengine/bağlamına özgüdürler.

## Layout primitifleri

- **`ui/PageShell.tsx`** — her ekranın dış konteyneri (`max-w-[1440px] mx-auto
  font-sans` + dikey `gap-5`). `withMobileDockPadding` yalnızca Dashboard'da
  (alt PWA toast'ıyla çakışmasın diye ekstra `pb-24`).
- **`ui/PageHeader.tsx`** — "ikon çipi + eyebrow başlık + alt-etiket + sağda
  aksiyonlar" kalıbı, 7 ekranın hepsinde. `tone` (ink/gold/danger/success)
  ikon çipinin rengini, `titleTone` başlığın kendi rengini kontrol eder.
- **`ui/Panel.tsx`** — `PANEL_CLASSNAME` (dolgulu cam panel) ve
  `PANEL_FRAME_CLASSNAME` (tablo/liste çerçevesi, `p-0 overflow-hidden`
  varyantı) — `motion.div`'e `cn(PANEL_CLASSNAME, ...)` olarak uygulanır.

## Bileşen envanteri (`src/components/ui/`)

Temel: `Button`, `Input` (variant='default'|'sm', `icon` prop'u), `Select`
(variant='default'|'ghost'), `Badge` (6 varyant, glow renkleri `color-mix` ile
gerçek status token'larına bağlı), `Avatar`, `Tooltip`, `DatePicker`,
`ConfirmDialog`, `SegmentedTabs`, `StatusBanner`, `ActionButton`,
`SettingsCard`, `RollingNumber`, `PremiumIcon`, `FormalDocumentModal`.

Durum/geri bildirim: `Skeleton` (+ modül-özel iskeletler:
`TaskCardSkeleton`, `TableRowSkeleton`, `GridTableRowSkeleton`,
`AuditLogListSkeleton`, `DashboardSkeleton`), `EmptyState` (size='sm'|'lg',
`dimIcon`), `Modal` (`useModalBehavior`: focus-trap/`inert`/Escape/modal-stack).

**`ui/dataTable/`** — Table/DataTable ailesi:
- `types.ts` — `DataTableColumn<T>` (header/width/align/sortField/cell),
  `SortState`, `nextSortState()` (kapalı→artan→azalan→kapalı döngüsü).
- `DataTableHeader.tsx` — sıralanabilir başlık satırı (native `<table>` için).
- `SimpleDataTable.tsx` — native `<table>`, sanallaştırma YOK (küçük veri
  setleri — bkz. Reports'un yönetici performans tablosu). `renderRow` prop'u
  satır-seviyesi kontrolü (motion, onClick, aria) çağırana bırakır.
- `GridDataTable.tsx` — sanallaştırılmış CSS Grid (react-window) — büyük
  listeler (TaskBoard). `cell` KULLANMAZ, satır içeriği kendi
  `rowComponent`'ine bırakılır (bkz. dosyanın kendi JSDoc'u — ARIA zinciri
  gerekçesi orada). **Her tabloya uymaz**: gerçek bir `role="table"/"row"/
  "cell"` yapısı gerektiği yerde kullanın — düz bir tıklanabilir kart-satırı
  listesi (ör. TeamList'in sanallaştırılmış dalı) için UYGUN DEĞİLDİR, orada
  react-window'un `List`i doğrudan kullanılır.

## Motion (`src/lib/motion.ts`)

- `SPRING_PANEL` (`stiffness: 200, damping: 28`) — sayfa açılışında BİR KEZ
  animasyonlanan büyük panel/kart girişi.
- `SPRING_ROW` (`stiffness: 260, damping: 28`) — listede TEKRARLANAN
  (stagger'lı) satır/kart girişi.
- `staggerDelay(index, baseDelay)` — `index * baseDelay`. `baseDelay`
  BİLİNÇLİ OLARAK sabitlenmez: kısa listeler daha yavaş (0.06), uzun listeler
  daha hızlı (0.03) stagger kullanır ki toplam animasyon süresi makul kalsın.

MobileDock'un ikon/nokta mikro-etkileşimleri (420-500 stiffness aralığı) ve
Sidebar'ın aktif-zemin `layoutId` geçişi (300/30) bu aileye BİLİNÇLİ OLARAK
dahil değildir — "giriş animasyonu" değil, anlık dokunsal geri bildirim
taşırlar, çok daha sert/hızlı olmaları gerekir.

## Odak halkası (focus-visible)

Standart renk **mavi** (`ring-executive-blue`) — projedeki `focus-visible:
ring-*` kullanımlarının ezici çoğunluğu zaten bu rengi kullanır, global
güvenlik ağı (`index.css` `:focus-visible` fallback, bileşen kendi ring'ini
tanımlamayı unutursa devreye girer) da aynı rengi taşır.

**İstisna**: sil/onayla/uyar gibi işlevsel bir eylem taşıyan elementlerin
kendi durum rengini (`ring-status-danger` vb.) kullanması BİLİNÇLİDİR —
buraya dokunmayın, eylemin anlamını taşır.

## Yeni bir ekran/bileşen eklerken kontrol listesi

1. Dış konteyner → `PageShell`, başlık → `PageHeader`.
2. Tekrarlanan panel/kart çerçevesi → `PANEL_CLASSNAME`/`PANEL_FRAME_CLASSNAME`
   (yeniden yazmayın).
3. Tablo/liste gerekiyorsa → önce `ui/dataTable/`'a bakın (`SimpleDataTable`
   küçük/statik, `GridDataTable` büyük/sanallaştırılmış VE gerçek tablo
   semantiği gereken yerler için).
4. Yükleme durumu → `Skeleton` ailesi (yeni bir modül-özel iskelet
   gerekiyorsa mevcut desenlere bakın, `ui/Skeleton.tsx`).
5. Boş durum → `EmptyState` (elle kesikli-çerçeve kutusu yazmayın).
6. Giriş animasyonu → `SPRING_PANEL`/`SPRING_ROW` + `staggerDelay` (yeni bir
   stiffness/damping çifti icat etmeyin).
7. Odak halkası → mavi, durum-özel bir anlam taşımıyorsa.
8. Yeni bir mikro/etiket punto veya tracking değeri gerekiyorsa → önce
   yukarıdaki tablolara bakın; gerçekten yeni bir tekrar eden ihtiyaçsa
   `index.css`'e token olarak ekleyin, tek seferlik arbitrary değer olarak
   bırakmayın.
