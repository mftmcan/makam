import tseslint from 'typescript-eslint';
import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  {
    ignores: [
      'dist/**/*',
      'dev-dist/**/*',
      'node_modules/**/*',
      'functions/**/*',
      'playwright-report/**/*',
      'test-results/**/*',
      'coverage/**/*',
    ]
  },
  // ─── TypeScript / TSX Parsing ──────────────────────────────────────────────
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['src/**/*.{ts,tsx}', '*.{ts,tsx}'],
  })),
  {
    files: ['src/**/*.{ts,tsx}', '*.{ts,tsx}'],
    rules: {
      // Üretim kodunda bugün itibarıyla SIFIR `any` var (doğrulandı, bkz. kod
      // denetimi) — 'error' bunu bir ratchet olarak kilitler. Test dosyaları
      // aşağıdaki override ile ayrı tutulur (mock/spy tiplemesi genellikle
      // `any` gerektirir ve bu, üretim kod kalitesiyle karıştırılmamalı).
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Test dosyalarında `any`, mock/spy dönüş tiplerini taklit ederken sık
    // kaçınılmazdır (ör. `vi.mocked(fn).mockResolvedValueOnce(x as any)`) ve
    // üretim koduna hiç gönderilmez — bu yüzden üretim kodundaki
    // 'error' kuralından AYRI, kendi başına 'off' tutulur. Eskiden tek bir
    // ortak 'warn' kuralı + `--max-warnings=187` ratchet'i vardı: bu, her yeni
    // test dosyasının ratchet sayısını el yordamıyla güncellemesini
    // gerektiriyordu ve üretim kodunda gerçek bir `any` sızıntısını 187
    // uyarının içinde görünmez kılıyordu (bkz. kod denetimi P2-21).
    files: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // ─── Firebase Security Rules ──────────────────────────────────────────────
  {
    ...firebaseRulesPlugin.configs['flat/recommended'],
  },
  // ─── JSX Accessibility ────────────────────────────────────────────────────
  {
    files: ['src/**/*.{tsx,jsx}'],
    plugins: {
      'jsx-a11y': jsxA11y,
    },
    settings: {
      // `motion.div`/`motion.tr`/`motion.span` (framer-motion) native DOM
      // elemanlarına render olur ama jsx-a11y bunları component olarak görüp
      // hiç denetlemiyordu — click-events-have-key-events gibi kurallar bu
      // yüzden 58+ motion.* kullanımını sessizce atlıyordu (bkz. kod
      // denetimi F1). Eşleme, kuralların bu elemanları karşılık geldikleri
      // native etiketmiş gibi denetlemesini sağlar.
      'jsx-a11y': {
        components: {
          'motion.div': 'div',
          'motion.tr': 'tr',
          'motion.span': 'span',
          'motion.button': 'button',
          'motion.li': 'li',
          'motion.a': 'a',
          'motion.ul': 'ul',
          'motion.section': 'section',
          'motion.article': 'article',
          'motion.header': 'header',
          'motion.footer': 'footer',
          'motion.nav': 'nav',
          'motion.aside': 'aside',
          'motion.p': 'p',
          'motion.img': 'img',
          'motion.svg': 'svg',
          'motion.path': 'path',
        },
      },
    },
    rules: {
      // Kritik erişilebilirlik kuralları
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-has-content': 'warn',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-proptypes': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/aria-unsupported-elements': 'error',
      // Klavye erişilebilirliği doğrudan işlevsellik anlamına geldiğinden
      // (bir mouse-only handler klavye kullanıcısı için tamamen erişilemez
      // olur) 'error'a yükseltildi — önceden 'warn' idi ve CI'da tek güvenlik
      // ağı Lighthouse'un genel a11y skoruydu (bkz. kod denetimi).
      'jsx-a11y/click-events-have-key-events': 'error',
      'jsx-a11y/interactive-supports-focus': 'warn',
      'jsx-a11y/label-has-associated-control': 'error',
      'jsx-a11y/no-aria-hidden-on-focusable': 'error',
      'jsx-a11y/no-redundant-roles': 'warn',
      'jsx-a11y/role-has-required-aria-props': 'error',
    },
  },
];
