import React from 'react';
import { ShieldCheck, Activity, ArrowRight } from 'lucide-react';
import { Logo } from './Logo';
import { useResolvedTheme } from '../hooks/useResolvedTheme';

interface LoginProps {
  onLogin: () => void;
  isLoading?: boolean;
}

export const Login = ({ onLogin, isLoading }: LoginProps) => {
  const resolvedTheme = useResolvedTheme();
  return (
    <div className="min-h-dvh bg-surface-base flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden font-sans">
      <h1 className="sr-only">MAKAM Kurumsal Giriş</h1>
      {/* Executive background plane */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-executive-gold/25 to-transparent" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(22,21,19,0.025)_1px,transparent_1px),linear-gradient(to_bottom,rgba(22,21,19,0.025)_1px,transparent_1px)] bg-[size:72px_72px] opacity-60" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-executive-gold/[0.035] to-transparent" />
      </div>

      <div className="max-w-md w-full flex flex-col gap-10 relative z-10">
        <div
          className="flex flex-col items-center"
        >
          <Logo size="lg" variant={resolvedTheme} className="flex-col !gap-6 text-center" />
        </div>

        <div
          className="flex flex-col gap-8"
        >
          <div className="makam-card backdrop-filter-none p-5 sm:p-8 flex flex-col gap-7 sm:gap-9 shadow-[0_24px_70px_rgba(22,21,19,0.055)] border-surface-border bg-makam-glass">
            <div className="flex flex-col gap-6">
              <div
                className="flex items-center gap-5 group transition-transform duration-300 motion-safe:hover:translate-x-1.5"
              >
                <div className="w-12 h-12 rounded-full bg-makam-glass border border-makam-border/5 flex items-center justify-center text-executive-blue group-hover:bg-executive-blue group-hover:text-[color:var(--executive-blue-text)] transition-all duration-slow shadow-inner">
                  <ShieldCheck className="w-5 h-5 stroke-[1.2]" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-title font-normal text-text-heading tracking-tight font-display">Kurumsal Güvenlik</span>
                  <p className="text-micro text-text-muted font-medium uppercase tracking-caps">Uçtan Uca Yetki Denetimi</p>
                </div>
              </div>
              
              <div
                className="flex items-center gap-5 group transition-transform duration-300 motion-safe:hover:translate-x-1.5"
              >
                <div className="w-12 h-12 rounded-full bg-makam-glass border border-makam-border/5 flex items-center justify-center text-[color:var(--gold-text)] group-hover:bg-executive-gold group-hover:text-[color:var(--btn-primary-text)] transition-all duration-slow shadow-inner">
                  <Activity className="w-5 h-5 stroke-[1.2]" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-title font-normal text-text-heading tracking-tight font-display">Stratejik Analiz</span>
                  <p className="text-micro text-text-muted font-medium uppercase tracking-caps">Anlık Operasyonel Veri Akışı</p>
                </div>
              </div>
            </div>

            <button
              onClick={onLogin}
              disabled={isLoading}
              aria-busy={isLoading || undefined}
              aria-describedby="login-description"
              className="makam-button-primary w-full h-14 text-body tracking-label font-medium group cursor-pointer motion-safe:hover:scale-[1.01] motion-safe:active:scale-[0.98]"
            >
              {isLoading ? 'DİZGEYE BAĞLANILIYOR...' : (
                <span className="flex items-center justify-center gap-2">
                  KURUMSAL GİRİŞ YAP
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform stroke-[2]" />
                </span>
              )}
            </button>
            <p id="login-description" className="text-caption text-text-muted text-center leading-relaxed">
              Yetkilendirilmiş Google hesabınızla güvenli giriş yapın.
            </p>
          </div>

          <div className="flex flex-col items-center gap-3">
            <p className="text-micro text-text-muted font-medium uppercase tracking-caps text-center leading-loose">
              HİZMETİÇİ<br />STRATEJİK KARAR YÖNETİM DİZGESİ
            </p>
            <div className="w-12 h-[1px] bg-makam-border/10" />
          </div>
        </div>
      </div>
    </div>
  );
};
