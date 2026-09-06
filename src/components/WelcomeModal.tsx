import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { GuideModal } from './GuideModal';
import { ROLE_LABELS } from '../constants';
import type { User, UserRole } from '../types';

/** localStorage anahtarı — kullanıcıya özeldir (aynı cihazda birden fazla
 *  kullanıcı giriş yapabilir, bkz. AuthenticatedApp.tsx'teki "aynı cihazdaki
 *  bir sonraki kullanıcı" senaryosu). Bilinçli olarak Firestore'a YAZILMAZ:
 *  bu tamamen istemci-taraflı, kalıcı/kritik olmayan bir tercih — cihaz
 *  değiştirince karşılamanın tekrar görünmesi zararsızdır (bkz. görev tanımı
 *  P2-17), users şemasına yeni bir alan eklemek gereksiz bir Firestore
 *  bağımlılığı yaratırdı. */
const onboardingSeenKey = (uid: string) => `makam-onboarding-seen-${uid}`;

/** Her rolün ekranda GERÇEKTEN gördüğü/yapabildiği şeylere göre yazılmıştır
 *  (bkz. constants.ts TAB_ROLES, firestore.rules tasks create kuralı) —
 *  uydurma genel geçer maddeler değil. */
const ROLE_WELCOME_POINTS: Record<UserRole, string[]> = {
  Admin: [
    'Organizasyon genelini yönetirsiniz: tüm birimlerin talimatlarını, kadrosunu ve denetim izlerini görebilirsiniz.',
    '"Raporlar" ve "Denetim İzleri" sekmeleri yalnızca sizin rolünüze açıktır.',
    'Yeni kullanıcı eklemek, rol/departman atamak "Kadro" sekmesinden yapılır.',
  ],
  Manager: [
    'Biriminizin talimatlarını ve kadrosunu yönetirsiniz; "Birim Odak Filtresi" ile diğer birimlere de göz atabilirsiniz.',
    'Kadronuza yeni talimat verebilir, tamamlanan işleri onaya alıp kapatabilirsiniz.',
    'Bir engel çıkarsa "Engeller" sekmesinden takip edip çözebilir, gerekirse talimatı başka bir Müdür’e devredebilirsiniz.',
  ],
  Staff: [
    'Size atanan talimatları "Talimatlar" sekmesinde görürsünüz.',
    'Bir talimatı icraya almak için "Süreci Başlat"a basarsınız — mühlet sayacı o andan itibaren işler.',
    'Bir engelle karşılaşırsanız talimat üzerinden bildirip Müdürünüzün müdahalesini bekleyebilirsiniz.',
  ],
};

interface WelcomeModalProps {
  user: User;
}

/**
 * İlk giriş karşılaması (P2-17). Kullanıcı bu cihazda/tarayıcıda MAKAM'ı daha
 * önce hiç görmediyse (localStorage'da anahtar yoksa) rol-duyarlı, 2-3
 * maddelik BASİT bir karşılama gösterir. YAGNI: ayrı bir wizard/carousel
 * bileşeni İCAT EDİLMEDİ — mevcut `ui/Modal.tsx` kabuğu kullanılıyor.
 *
 * "Kılavuzu İncele" butonu, kapsamlı çalışma kurallarını içeren mevcut
 * GuideModal'ı açar — bu akış GuideModal'ın AppHeader'daki elle-açma yolunu
 * (BookOpen ikonu) DEĞİŞTİRMEZ, ikisi tamamen bağımsız çalışır: kullanıcı
 * karşılamayı "Anladım" ile kapatsa da, "Kılavuzu İncele"yi hiç kullanmasa
 * da, BookOpen butonu her zaman kılavuzu açabilir.
 */
export function WelcomeModal({ user }: WelcomeModalProps) {
  const [isWelcomeOpen, setIsWelcomeOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(onboardingSeenKey(user.uid));
      if (!seen) setIsWelcomeOpen(true);
    } catch {
      // localStorage erişilemiyorsa (gizli sekme kotası, devre dışı bırakılmış
      // depolama vb.) karşılama sessizce atlanır — kritik bir veri kaybı değil.
    }
  }, [user.uid]);

  const dismiss = () => {
    try {
      window.localStorage.setItem(onboardingSeenKey(user.uid), '1');
    } catch {
      // Yazılamazsa bir sonraki girişte karşılama tekrar görünür — zararsız.
    }
    setIsWelcomeOpen(false);
  };

  const points = ROLE_WELCOME_POINTS[user.role];

  return (
    <>
      <Modal isOpen={isWelcomeOpen} onClose={dismiss} title="Hoş Geldiniz" size="sm">
        <div className="flex flex-col gap-4">
          <p className="text-body-sm text-text-muted font-light leading-relaxed">
            Sayın <strong className="font-medium text-text-heading">{user.fullName}</strong>, MAKAM&rsquo;a{' '}
            <strong className="font-medium text-text-heading">{ROLE_LABELS[user.role]}</strong> rolüyle hoş geldiniz.
          </p>

          <ul className="flex flex-col gap-2.5">
            {points.map((point) => (
              <li key={point} className="flex items-start gap-2.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-[color:var(--gold-text)] stroke-[1.5] mt-0.5 flex-shrink-0" aria-hidden="true" />
                <span className="text-caption text-text-muted font-light leading-relaxed">{point}</span>
              </li>
            ))}
          </ul>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-executive-blue/[0.04]">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { dismiss(); setIsGuideOpen(true); }}
            >
              Kılavuzu İncele
            </Button>
            <Button variant="gold" size="sm" onClick={dismiss}>
              Anladım
            </Button>
          </div>
        </div>
      </Modal>

      <GuideModal isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />
    </>
  );
}
