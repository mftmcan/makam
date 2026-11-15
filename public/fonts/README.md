# Yerel fontlar

Inter, Outfit ve JetBrains Mono SIL Open Font License 1.1 ile dağıtılır.
Özgün lisanslar `INTER-OFL.txt`, `OUTFIT-OFL.txt` ve
`JETBRAINS-MONO-OFL.txt` dosyalarındadır. Font dosyalarındaki
özgün telif ve lisans metaverileri korunmuştur.

`inter-tr.woff2` ve `outfit-tr.woff2`, özgün Latin Extended dosyalarından
üretilen küçük Türkçe ekleridir: Ğ, ğ, İ, Ş ve ş. Diğer Türkçe karakterler
(ı, ç, ö, ü dahil) zaten Latin dosyalarında bulunur. Tam Latin Extended
dosyaları farklı dillerdeki kişi adları için yedek olarak tutulur.

Eklerin iç font adları `MAKAM Inter TR` ve `MAKAM Outfit TR` olarak
ayrılmıştır; CSS font-family eşlemesi özgün ailelerle aynı görünümü korur.
Glif ölçüleri ve değişken ağırlık aralığı üretim betiğinde doğrulanır.

İsteğe bağlı yeniden üretim, ayrı bir Python ortamında:

```sh
pip install -r scripts/font-requirements.txt
python scripts/subsetFonts.py
```

Normal uygulama derlemesinde Python gerekmez; üretilen WOFF2 dosyaları
depoya dahildir. İlk yüklenen dört fontun toplam boyutu `.size-limit.json`
içinde ayrıca denetlenir.

Kaynaklar: [Inter](https://github.com/rsms/inter),
[Outfit](https://github.com/Outfitio/Outfit-Fonts).
