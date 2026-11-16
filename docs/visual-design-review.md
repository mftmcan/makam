# Görsel tasarım incelemesi — 16 Kasım 2026

MAKAM'ın mevcut mürekkep/altın kimliği korunarak okunabilirlik, görsel
hiyerarşi, duyarlı yerleşim ve ortak bileşen tutarlılığı iyileştirildi.
“Premium SaaS” resmi bir uygunluk sertifikası değildir; burada somut ekran
bulguları, WCAG odaklı otomatik kontroller ve görsel regresyonlar esas alındı.

## Bulgular ve yapılan düzeltmeler

| Bulgu | Düzeltme |
| --- | --- |
| Rota odağı sayfayı kaydırıyor; sticky üst çubuk başlık ve aksiyonları örtüyordu. | `preventScroll` ile landmark odağı korunur, modül değişiminde sayfa başa alınır. Landmark'ın otomatik odağında dekoratif tam sayfa çerçevesi kaldırıldı. |
| 10 px, tamamı büyük harfli sayfa başlıkları yeterli hiyerarşi kurmuyordu. | Yedi modülde 22/26 px doğal yazımlı görünür `h2`, 13 px açıklama ve 40 px ikon alanı kullanıldı. Aksiyonlar dar alanda ayrı satıra geçer. |
| Kenarlıklar ve form yer tutucuları fazla silikti. | Açık/koyu temada panel sınırları belirginleştirildi. Ortak input/select 48 px yüksekliğe, 16 px metne ve 12 px köşelere getirildi. Form açıklamaları ve placeholder kontrastı düzeltildi. |
| Tipografi sınıflarının bir kısmı renk sanılıp buton metin rengini düşürüyordu. | Dokuz semantik yazı boyutu `tailwind-merge` yapılandırmasına kaydedildi. Renk kaybını yakalayan on regresyon testi eklendi. |
| Dar mobilde filtre etiketleri kesiliyordu. | Mobil filtreler tek sütuna ve 44 px yüksekliğe geçirildi; tablette iki sütun, yeterli masaüstü alanında tek satır kullanılır. |
| 1024 px'de üst çubuk ve altı KPI sütunu taşıyordu. | Üst çubuk boşlukları ve kullanıcı alanı duyarlı hale getirildi. KPI'lar bu genişlikte üç sütun, geniş masaüstünde altı sütundur. Sağlık özeti de alan yetmediğinde dikey yerleşir. |
| Ayarlar kartları dar içerik alanında iki sütuna zorlanıyordu. | Kartlar içerik konteyneri 640 px olduğunda iki sütuna geçer; mobil/tablet bölüm sekmeleri yataydır. |
| Müdahale kuyruğu etiketleri masaüstünde kısalıyordu. | Sayaçlar başlığın altına alındı; etiketler gerektiğinde satıra sarar. |
| Sıfır KPI değerleri çok soluk, göstergeler küçüktü. | Rakamlar 24/28 px ve orta ağırlığa getirildi; sıfırların opaklığı azaltılmaz. |
| Dashboard altında dock boşluğu iki kez ayrılıyordu. | Alt boşluk uygulama kabuğunda tek yerde yönetilir. |
| Dar giriş ekranında kart dolgusu kullanılabilir alanı azaltıyordu. | Mobil kart ve dış dolgu daraltıldı, masaüstü boşlukları korundu. |

## Doğrulama

- 7 modül; 320, 390, 768 ve 1440 px; açık/koyu tema: 56 ekran görüntüsü
  ve yatay taşma ölçümü. Ek kalıcı regresyon kontrolleri 320/768/1024 px'de
  başlığın üst çubuğun altında görünmesini ve sayfanın taşmamasını sınar.
- Giriş ve yeni talimat formu: 320/1440 px, iki tema; formda axe
  ciddi/kritik ihlal yok. Veri gönderilmedi, üretim verisine dokunulmadı.
- 804 birim testi geçti. Son modal düzeninden sonra ilgili 31 test ayrıca geçti.
- Kimlik doğrulamalı akışlar, iki temada axe taramaları, 28 görsel referans ve
  6 duyarlı yerleşim testi dahil 58 E2E testi geçti. Mobil projelerde yalnızca
  masaüstü projelerine ait 6 tekrar bilinçli olarak atlanır.
- Giriş ekranının dört görünümde 12 E2E testi geçti.
- TypeScript, ESLint, üretim derlemesi ve tüm paket boyutu limitleri geçti.
- Windows görsel referansları incelenip güncellendi.
- Dashboard ve talimatlar için dört görünümde 8 görsel karşılaştırma,
  referans güncelleme modu kapalıyken ayrıca geçti.

## Platform sınırı

Linux görsel referansları bu Windows ortamında üretilmedi. Değişiklikler
yayına alınmadan önce mevcut `e2e.yml` workflow'unun `update_snapshots=true`
seçeneğiyle Linux referansları üretilip incelenmelidir. Eski Linux PNG'leri
Windows çıktısıyla etiket değiştirilerek ezilmedi; normal Linux görsel
karşılaştırmasının yeni tasarımı eski referanslardan farklı bulması beklenir.
Görsel test eşiği gevşetilmedi ve testler kapatılmadı.
