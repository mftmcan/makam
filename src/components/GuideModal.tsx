import React from 'react';
import {
  BookOpen, GitCommit, Clock, Award, AlertTriangle, Flame, ArrowRight,
} from 'lucide-react';
import { Modal } from './ui/Modal';
import { SettingsCard } from './ui/SettingsCard';
import { Badge } from './ui/Badge';

interface GuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FLOW_STEPS: { label: string; note?: string }[] = [
  { label: 'Talimat Verildi' },
  { label: 'İcra Aşamasında' },
  { label: 'Onay Sürecinde', note: 'yalnız Memur/Müdür tamamlaması sonrası' },
  { label: 'İcra Edildi' },
];

const SLA_ROWS: { priority: string; limit: string }[] = [
  { priority: 'Rutin', limit: '15 iş günü' },
  { priority: 'Normal', limit: '5 iş günü' },
  { priority: 'Öncelikli', limit: '2 iş günü' },
  { priority: 'İvedi', limit: '4 mesai saati' },
];

export const GuideModal = ({ isOpen, onClose }: GuideModalProps) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Kılavuz" size="xl">
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 pb-1">
          <div className="w-9 h-9 rounded-xl bg-executive-blue/5 text-executive-blue flex items-center justify-center flex-shrink-0">
            <BookOpen className="w-4.5 h-4.5 stroke-[1.5]" />
          </div>
          <p className="text-caption text-text-muted font-light leading-relaxed">
            Kadronun bilmesi gereken çalışma kuralları, mühlet disiplinleri ve icra sonrası
            belgelerin verilme koşulları burada özetlenir.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ── Talimat Yaşam Döngüsü ── */}
          <SettingsCard title="Talimat Yaşam Döngüsü" description="Olağan akış" icon={GitCommit} accentColor="gold" index={0}>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
              {FLOW_STEPS.map((step, i) => (
                <React.Fragment key={step.label}>
                  <div className="flex flex-col items-start gap-0.5">
                    <Badge variant="default">{step.label}</Badge>
                    {step.note && <span className="text-micro text-text-tertiary pl-1 max-w-[130px] leading-tight">{step.note}</span>}
                  </div>
                  {i < FLOW_STEPS.length - 1 && <ArrowRight className="w-3 h-3 text-text-tertiary flex-shrink-0" aria-hidden="true" />}
                </React.Fragment>
              ))}
            </div>
            <p className="text-caption text-text-muted font-light leading-relaxed mt-1">
              Kadro, kendisine ayrılmış her talimatı önce <strong className="font-medium text-text-heading">SÜRECİ BAŞLAT</strong> ile
              icraya alır. Müftü rolü dışındaki kadro tamamladığında talimat doğrudan kapanmaz,
              önce Makam onayına sunulur. Bir engel çıkarsa talimat <strong className="font-medium text-text-heading">Engellendi</strong> durumuna
              alınır ve engel giderilene kadar mühlet sayacı durur. Bir Müdür, talimatı başka bir Müdür&rsquo;e
              (izin/mazeret gibi durumlarda) devredebilir; bu sırada talimat <strong className="font-medium text-text-heading">Yetki Devri Bekleniyor</strong> durumuna
              alınır ve mühlet sayacı yine durur.
            </p>
          </SettingsCard>

          {/* ── Mühlet ve Mesai Kuralları ── */}
          <SettingsCard title="Mühlet ve Mesai Kuralları" description="Öncelik bazlı SLA" icon={Clock} accentColor="gold" index={1}>
            <div className="flex flex-col gap-1.5">
              {SLA_ROWS.map(row => (
                <div key={row.priority} className="flex items-center justify-between px-2.5 py-1.5 bg-executive-gold/[0.04] rounded-lg">
                  <span className="text-caption font-medium text-text-heading">{row.priority}</span>
                  <span className="text-micro text-[color:var(--gold-text)] font-semibold tabular-nums">{row.limit}</span>
                </div>
              ))}
            </div>
            <p className="text-caption text-text-muted font-light leading-relaxed mt-1">
              Mühletler yalnızca mesai saatleri (09:00 &ndash; 18:00) içinde işler; hafta sonu ve resmî
              tatiller sayılmaz. Bir talimat <strong className="font-medium text-text-heading">Engellendi</strong> veya{' '}
              <strong className="font-medium text-text-heading">Onay Sürecinde</strong> beklerken mühlet sayacı otomatik olarak durur,
              tekrar icraya alındığında kaldığı yerden devam eder.
            </p>
          </SettingsCard>

          {/* ── Liyakat Belgesi ── */}
          <SettingsCard title="Liyakat Belgesi" description="Ne zaman verilir" icon={Award} accentColor="gold" index={2}>
            <p className="text-caption text-text-muted font-light leading-relaxed">
              Bir talimat <strong className="font-medium text-text-heading">mühleti içinde</strong> (bitiş tarihinden önce
              veya tam zamanında) tamamlandığında, Talimat Detayı ekranındaki
              &ldquo;Sonuç Belgeleri&rdquo; bölümünde otomatik olarak görüntülenebilir hâle gelir.
              Ayrıca bir belge talebi veya onay süreci gerekmez — icra mühlet içinde tamamlanır tamamlanmaz hazırdır.
            </p>
          </SettingsCard>

          {/* ── İkaz Belgesi ── */}
          <SettingsCard title="İkaz Belgesi" description="Ne zaman verilir" icon={AlertTriangle} accentColor="red" index={3}>
            <p className="text-caption text-text-muted font-light leading-relaxed">
              Bir talimat <strong className="font-medium text-text-heading">mühleti aşıldıktan sonra</strong> tamamlandığında,
              aynı bölümde bir İkaz Belgesi görüntülenebilir hâle gelir. Bu, gecikmenin resmî
              kaydıdır ve icra edilen iş gecikmeli de olsa kapanışı engellemez.
            </p>
          </SettingsCard>
        </div>

        {/* ── Kriz Eskalasyonu (tam genişlik) ── */}
        <SettingsCard title="Kriz Eskalasyonu" description="Otomatik yükseltme kuralı" icon={Flame} accentColor="red" index={4} fullWidth>
          <p className="text-caption text-text-muted font-light leading-relaxed">
            Dizge her gün <strong className="font-medium text-text-heading">08:00&rsquo;de</strong> otomatik bir denetim çalıştırır:
            tamamlanmamış veya lağvedilmemiş bir talimat <strong className="font-medium text-text-heading">24 saattir hiç güncellenmemişse</strong> otomatik
            olarak <strong className="font-medium text-text-heading">Kriz</strong> durumuna yükseltilir ve ilgili yöneticiler bilgilendirilir.
            Bunu önlemenin yolu basittir: talimat üzerinde düzenli olarak durum/yorum/kanıt güncellemesi yaparak
            &ldquo;aktif&rdquo; tutmak.
          </p>
        </SettingsCard>
      </div>
    </Modal>
  );
};
