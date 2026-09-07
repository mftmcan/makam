/// <reference types="vitest" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      react(), 
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['makam-logo.svg', 'makam-logo-192.png', 'makam-logo-512.png', 'favicon.ico', 'robots.txt'],
        manifest: {
          name: 'MAKAM Stratejik Yönetim',
          short_name: 'MAKAM',
          description: 'Makam Harekat ve Stratejik Yönetim Sistemi',
          theme_color: '#161513',
          background_color: '#FAF8F5',
          display: 'standalone',
          orientation: 'portrait-primary',
          start_url: '/',
          icons: [
            {
              src: 'makam-logo-192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'makam-logo-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        },
        // #8 — Workbox offline cache stratejileri
        workbox: {
          globPatterns: mode === 'production' ? ['**/*.{js,css,html,svg}'] : [],
          runtimeCaching: [
            {
              // Firestore/Firebase API → NetworkFirst: canlı veri öncelikli
              urlPattern: /^https:\/\/firestore\.googleapis\.com/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'firestore-cache',
                expiration: { maxEntries: 50, maxAgeSeconds: 300 },
                networkTimeoutSeconds: 10,
              },
            },
            {
              // Firebase Auth → NetworkFirst
              urlPattern: /^https:\/\/identitytoolkit\.googleapis\.com/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'firebase-auth-cache',
                expiration: { maxEntries: 10, maxAgeSeconds: 3600 },
              },
            },
            {
              // Google Fonts → CacheFirst: hızlı yükleme
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
            {
              // Static JS/CSS chunks → StaleWhileRevalidate
              urlPattern: /\.(js|css)$/,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'static-resources',
                expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 7 },
              },
            },
          ],
        },
        devOptions: {
          enabled: true
        }
      })
    ],
    build: {
      // vendor-firebase (app+auth+firestore+messaging, AÇILIŞTA gerekli — bkz.
      // manualChunks yorumu) minify sonrası ~740 kB HAM boyutta, Vite'ın
      // varsayılan 600 kB uyarı eşiğini aşıyor. Bu YANLIŞ pozitif bir uyarı:
      // gerçek performans bütçesi (ağdan indirilen, GZIP boyutu) zaten
      // .size-limit.json'da "Firebase vendor paketi" için 200 KB olarak
      // ayrıca takip ediliyor ve ~179 KB ile rahatça içinde. Firebase SDK'yı
      // daha küçük parçalara bölmek (ör. auth/firestore'u ayırmak) gerçek bir
      // fayda sağlamaz — dördü de aynı anda, aynı entry noktasında gerekiyor,
      // yalnızca aynı toplam byte'ı daha fazla HTTP isteğine böler. Eşik,
      // gerçek boyutun (740 kB) biraz üzerine (800 kB) çekilerek bu BİLİNEN/
      // izlenen paket için uyarı susturuldu; gelecekte GERÇEKTEN beklenmedik
      // bir şişme olursa (ör. yeni bir ağır bağımlılık) eşik yine tetiklenir.
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          // vendor-charts (recharts) ve vendor-pdf (jsPDF) BİLEREK manualChunks'tan
          // çıkarıldı: bu ikisini adlandırılmış chunk olarak zorlamak, yalnızca
          // Dashboard/Reports'un lazy() dynamic import'u üzerinden erişilebilir
          // olmalarına rağmen, Rollup'ın ana giriş dosyasına bu chunk'lardan
          // STATİK import eklemesine yol açıyordu (ölçüldü — network log'da
          // vendor-charts.js login ekranında ~86ms'de "High priority" olarak
          // indiriliyordu, modulePreload/SW precache filtreleriyle önlenemedi).
          // Rollup'ın otomatik chunk bölme mantığı dynamic import sınırına saygı
          // gösteriyor; bu ikisi artık yalnızca Dashboard/Reports chunk'ı içine
          // veya ona özel otomatik bir chunk'a gömülüyor.
          // Buradaki dört paketin ORTAK özelliği: dördü de AÇILIŞTA (entry'den
          // statik olarak) gerekiyor, dolayısıyla adlandırılmış bir chunk'a
          // almak erişim grafiğini değiştirmez — yalnızca maliyeti görünür
          // kılar ve .size-limit.json'da ayrı bir bütçeye bağlar. recharts/
          // jspdf'in bu listede OLMAMA gerekçesi (yukarıdaki uzun not) tam da
          // bunun tersidir: onlar yalnızca lazy() sınırının ardından gerekli.
          //
          // vendor-router: react-router BrowserRouter'ı main.tsx'te, yani
          // Login ekranı dahil ilk yüklemede kuruluyor (bkz. main.tsx'teki
          // gerekçe — derin link giriş sırasında kaybolmasın). Ayrı chunk
          // olmasaydı ~14 kB gzip sessizce `index` paketine eklenecek ve
          // "uygulama kodumuz ne kadar büyüdü" ölçümünü bulanıklaştıracaktı.
          manualChunks: {
            'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/messaging'],
            'vendor-motion':   ['motion'],
            'vendor-date':     ['date-fns'],
            'vendor-router':   ['react-router-dom'],
          },
          // recharts/jspdf'i manualChunks'a koymuyoruz (yukarıdaki not), ama
          // Rollup'ın bu iki paketi taşıyan otomatik chunk'a verdiği isim
          // (facade module'e göre, ör. "BarChart" veya "exportService")
          // dependency güncellemelerinde değişebiliyor ve .size-limit.json'daki
          // glob'ları sessizce kırıyordu. chunkFileNames burada yalnızca DOSYA
          // ADINI sabitliyor — manualChunks'ın aksine chunk sınırlarını/erişim
          // grafiğini etkilemediği için static-import regresyonunu geri getirmez.
          chunkFileNames: (chunkInfo) => {
            const ids = chunkInfo.moduleIds ?? [];
            // Yalnızca Reports/Dashboard'un KENDİ route chunk'ları (lazy()'nin
            // dynamic-import facade'i) hariç tutulur — bunlar recharts'ı doğrudan
            // import ettiği için modül listesinde recharts geçebilir ama kendi
            // route isimlerini korumalı, yanlışlıkla vendor-charts'a eşleşmemeli.
            // Eskiden bunun proxy'si "tüm modüller node_modules altında mı"
            // (saflık) kontrolüydü, ama Reports hem Dashboard'un hem kendisinin
            // kullandığı bir helper (dashboard/helpers.ts, computeCompletionRatePercent
            // için) import etmeye başlayınca, o helper recharts'la AYNI iki route'tan
            // erişim kümesine sahip olduğundan Rollup ikisini tek bir paylaşımlı
            // chunk'ta birleştirdi — chunk artık "saf" değildi ve vendor-charts
            // yeniden adlandırması sessizce devre dışı kaldı (bkz. kod denetimi).
            // Doğrudan yapısal ayrım daha sağlamdır: route facade'leri Rollup'ta
            // isDynamicEntry=true olarak işaretlenir, paylaşımlı (otomatik
            // bölünmüş) vendor chunk'lar değildir — hangi app modüllerinin
            // yanına sürüklendiğinden bağımsız çalışır.
            const isRouteFacadeChunk = chunkInfo.isDynamicEntry || chunkInfo.isEntry;
            if (!isRouteFacadeChunk && ids.some(id => /[\\/]node_modules[\\/]recharts[\\/]/.test(id))) {
              return 'assets/vendor-charts-[hash].js';
            }
            // jspdf'in exportService.ts dışında statik importer'ı yok (yalnızca
            // Reports.tsx'in dynamic import()'u üzerinden erişiliyor), bu yüzden
            // recharts'ın aksine saflık şartı gerekmiyor — jspdf içeren tek chunk
            // her zaman bu lazy PDF facade'idir.
            if (ids.some(id => /[\\/]node_modules[\\/]jspdf[\\/]/.test(id))) {
              return 'assets/vendor-pdf-[hash].js';
            }
            return 'assets/[name]-[hash].js';
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        include: ['src/lib/**', 'src/services/**', 'src/hooks/**', 'src/components/**'],
        exclude: ['src/test/**', 'src/components/ui/**', 'node_modules/**'],
        // CLAUDE.md'de belgelenen kapsam hedefi src/lib + src/services'tir —
        // src/hooks/src/components henüz sistematik olarak birim testli değil
        // (çoğunlukla e2e/manuel test kapsıyor), bu yüzden tüm `include`
        // üzerinden TEK bir global eşik anlamsız olurdu (~%45 gibi düşük ve
        // yanıltıcı bir sayıya kilitlenirdi). Bunun yerine yalnızca zaten iyi
        // test edilen iki klasöre, MEVCUT ölçümün (lib ~%79, services ~%76)
        // biraz altında bir taban konur — eşiksiz olduğundan (bkz. kod
        // denetimi) kapsam zamanla sessizce erozyona uğrayabiliyordu.
        thresholds: {
          'src/lib/**': { statements: 70, branches: 55, functions: 70, lines: 70 },
          'src/services/**': { statements: 65, branches: 50, functions: 65, lines: 65 },
        },
      },
    },
  };
});
