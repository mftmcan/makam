# MAKAM kalite incelemesi

Tarih: 15 Kasım 2026

## Yapılan iyileştirmeler

### Veri güvenilirliği

- Çevrimdışı güncellemeler yalnızca ardışık ve uyumlu işlemler arasında
  birleştirilir. Aradaki silme, durum geçişi ve denetim kayıtlarının sırası korunur.
- Senkron sürerken eklenen işlem, gönderilmekte olan işlemin içine birleşip
  kaybolmaz. Geçici ağ hatasında bağımlı sonraki yazımlar bekletilir.
- Başarılı yazımdan sonra bekleyen işlemlerin sürümleri ve denetim anlık
  görüntüsünün `lockVersion` alanı birlikte ilerletilir.
- Geçici kimliklerin eşlenmesi, bağlı görev geçişlerini ve denetim kayıtlarını
  da kapsar.
- Tarayıcı depolamasına yazılamayan değişiklik için hata döndürülür;
  kaydedilmemiş işlem başarılı kabul edilmez.

### Oturum ve önbellek

- Oturum kapanışında veri deposu doğrudan temizlenir. Daha önce başlamış
  IndexedDB okuması, temizlenen eski oturum verisini geri yükleyemez.
- Hesap değişiminde veya profil dinleme hatasında önceki kullanıcı arayüzü
  açık tutulmaz.
- Firebase Auth ve Firestore HTTP yanıtları servis çalışanı önbelleğinden
  çıkarıldı; eski isimli önbellekler de temizlenir.
- Servis çalışanı güncellemesi kullanıcı eylemiyle uygulanır. Geliştirme
  ortamında servis çalışanı kaydı kapalıdır.
- Hosting'de uzun süreli `immutable` önbellek yalnızca sürümlenmiş `/assets/`
  dosyalarına uygulanır. `sw.js`, HTML ve manifest yeniden doğrulanır.

### Erişilebilirlik ve kullanım

- Modal kapanınca odak açan elemana döner; eski kaydırma stili korunur.
- İç içe pencerelerin kaydırma ve `inert` kilitleri ayrı sayaçlarla yönetilir.
- Tab döngüsü devre dışı, gizli ve negatif tabindex taşıyan alanları atlar;
  dışarı kaçan odağı geri alır.
- Yüklenen buton, çağıran `disabled={false}` verse de tekrar tıklanamaz.
- Kompakt giriş ve seçim alanları etiket/hata bilgilerini korur; hata metni
  çağıranın yardım metniyle birlikte ekran okuyucuya sunulur.
- Giriş ekranında okunabilirlik, mobil görünüm yüksekliği, hesap sağlayıcısı
  açıklaması ve yüklenme duyurusu iyileştirildi.
- Ana içerik bölgesi sayfa adıyla etiketlendi; mobilde sayfa başlığı eklendi.

### Güvenlik ve kalite altyapısı

- Uyumlu güvenlik yamaları kilit dosyasına uygulandı. Firebase'in gRPC
  bağımlılığı aynı ana sürümdeki yamalı sürüme taşındı.
- Tailwind ve PWA derleme araçları geliştirme bağımlılıklarına taşındı.
- Üretim ve geliştirme bağımlılıklarının tam taraması sıfır açıkla geçti.
  Her seviyedeki kayıtlı uyarı artık CI yayınını engeller.
- Firebase Admin 14, PWA 2 ve yamalı Vitest 4.1.12 sürümlerine geçildi.
  FTP, glob ve minimatch zincirlerine kapsamı belirli yamalı sürümler uygulandı.
- Upstream düzeltmesi olmayan deepmerge için MIT lisansı korunarak dar bir
  yerel yama eklendi. Gerçek saldırı girdileri ve Rollup'ın modül çözümlemesi
  test edildi; bakım politikası `vendor/deepmerge/README.md` içinde.
- Giriş testleri masaüstü/mobil ve açık/koyu tema matrisini kapsar.
- Görsel testler hedef sayfanın kimliği doğrulanmadan görüntü alamaz.
  Giriş ekranındaki `<main>` hedef ekranla karıştırılmaz.
- Emülatör ve giriş testlerinin rapor/çıktı klasörleri ayrıldı.
- Çevrimdışı işlem servisleri, kullanıcı şeması, veri SDK'ları ve Motion
  giriş sonrasına ertelendi. `src/firebaseCore.ts` hafif kimlik doğrulamayı,
  `src/firebase.ts` veri servislerini yönetir. Popup çözümleyicisi yalnızca
  giriş isteğinde kullanılır; erken Google iframe'i açılmaz.
- Ana giriş paketi yaklaşık **143,4 KB'den 85,2 KB'ye**, girişte kullanılan
  Firebase paketi **182 KB'den 31,5 KB'ye** indi. İlk yüklenen fontlar 86,2 KB;
  Türkçe ekler 3,1 ve 2,6 KB. Tam Latin Extended yedekleri korunur.
- Derleme `login-entry-boundary` kontrolüyle veri/animasyon SDK'larının
  giriş paketine statik import edilmesini reddeder. Font ve paket bütçeleri
  ayrıca denetlenir.
- Logo ve giriş etkileşimleri CSS'e taşındı; pahalı SVG ışıklandırması ve
  giriş kartının arka plan bulanıklığı sadeleştirildi. Hareket azaltma tercihi
  korunur. Giriş öncesi çevrimdışı hazır kartı gösterilmez; sürüm güncellemesi
  gerektiğinde giriş ekranından da uygulanabilir.

## Doğrulama

Kontroller yerel ortamda, kimlik doğrulamalı akışlar Firebase emülatörlerinde çalıştırıldı.

| Kontrol | Sonuç |
|---|---|
| Birim testleri ve kapsam eşikleri | 59 dosya, 794 test başarılı |
| Giriş E2E ve WCAG A/AA ciddi/kritik taraması | 12 test başarılı |
| TypeScript ve ESLint | Başarılı |
| Üretim derlemesi ve paket boyutu bütçeleri | Başarılı |
| Cloud Functions TypeScript derlemesi | Başarılı |
| Üretim ve geliştirme bağımlılıklarının tam taraması | 0 açık |
| Firestore erişim kuralları ve taşıma testleri | 225 test başarılı |
| Kimlik doğrulamalı ve görsel regresyon matrisi | 48 test başarılı |
| Lighthouse mobil performans, üç koşu medyanı | 94/100; zorunlu eşik >=90 başarılı |
| Lighthouse erişilebilirlik / iyi uygulamalar / SEO | 100 / 100 / 100 |

Son üç mobil performans puanı 95, 94 ve 86; medyan 94'tür. Medyan ilk
içerik boyaması 0,96 sn, en büyük içerik boyaması 2,94 sn, toplam engelleme
süresi 103 ms. Donanım/işletim sistemi değişkenliği nedeniyle tek en yüksek
puan yerine üç koşunun medyanı kalite kapısında kullanılır. Önceki raporda
mobil performans 56/100 ve geliştirme ağacında 32 uyarı kalmıştı; bu iki alan
artık yükseltilen kalite kapılarından geçiyor.

## Sürekli kalite kontrolleri

- Önceki raporda kalan geliştirme bağımlılığı uyarıları giderildi. Yerel
  yamayı audit sayısından bağımsız olarak saldırı regresyonları doğrular.
- Lighthouse CI artık üç mobil koşunun medyan performansının en az **90**,
  erişilebilirlik/iyi uygulamalar/SEO puanlarının en az **95** olmasını ister.
  Performans artık uyarı seviyesinde değildir; ihlal yayını engeller.
- Node.js 22.19+ gerekir. `npm ci --ignore-scripts` ile temiz kurulum,
  yerel yamanın çözülmesi ve üretim derlemesi doğrulandı.
- Font türevleri ve lisansları `public/fonts/README.md` içinde belgelenir.
  Normal uygulama derlemesinde Python gerekmez.

Performans ölçümü yerel üretim çıktısında, varsayılan Lighthouse mobil
daraltma ayarlarıyla yapılır. Başka ağır testlerle eşzamanlı çalıştırılmaz.
Son üç koşunun özeti `docs/performance-results.json` dosyasına kaydedilir.

Güvenlik sayıları kök `package-lock.json` ağacına aittir. Geliştirme araçları
üretim ağacından ayrı taranır. Canlı Firebase verisi değiştirilmedi ve yayın yapılmadı.
