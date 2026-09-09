import React, { Component, ErrorInfo, ReactNode } from 'react';
import { RefreshCw, Home, ShieldAlert } from 'lucide-react';
import { Logo } from './Logo';
import { Button } from './ui/Button';
import { logError } from '../services/errorLoggingService';

interface Props {
  children: ReactNode;
  // 'full' — kök seviyesindeki tek global sınır (App.tsx'i tamamen sarar):
  // tüm uygulama kabuğunu (Sidebar/AppHeader dahil) tam ekran bir hata
  // sayfasıyla değiştirir. 'inline' — yalnızca aktif sekmenin içerik alanını
  // sarar: bir sekmedeki render hatası artık Sidebar/AppHeader/MobileDock'u
  // görünmez kılmıyor, kullanıcı çalışan başka bir sekmeye geçebiliyor (bkz.
  // kod denetimi: eskiden TEK global sınır vardı, herhangi bir sekmedeki
  // hata tüm dizgeyi tam ekran hata sayfasına düşürüyordu).
  variant?: 'full' | 'inline';
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** logError'ın döndürdüğü error_logs doküman ID'si — kullanıcıya "Destek
   *  Referansı" olarak gösterilir (bkz. kod denetimi: bu ID üretiliyordu ama
   *  hiçbir zaman kullanıcıya yansıtılmıyordu). Log yazımı asenkron olduğundan
   *  ayrı bir setState ile, ilk render'dan sonra doldurulur. */
  supportReference: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    supportReference: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, supportReference: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Konsola yaz (geliştirme ortamı)
    console.error('[ErrorBoundary] Uncaught error:', error);
    // Firestore'a yapılandırılmış log yaz (üretim gözlemlenebilirliği)
    logError(error, 'ErrorBoundary', {
      context: {
        componentStack: errorInfo.componentStack?.slice(0, 1000),
      },
    }).then((supportReference) => {
      if (supportReference) this.setState({ supportReference });
    });
  }

  private handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  // 'inline' sınırlar için sayfayı YENİDEN YÜKLEMEDEN yalnızca yerel hata
  // durumunu temizler — diğer sekmeler zaten etkilenmediğinden tam sayfa
  // reload burada gereksiz. Ayrıca aktif sekme değiştiğinde AuthenticatedApp
  // bu bileşeni `key={activeTab}` ile zaten yeniden monte eder — o key artık
  // uiStore'dan değil URL'den türetilir (bkz. hooks/useActiveTab.ts).
  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  private getErrorMessage(): { message: string; isFirebaseError: boolean } {
    let errorMessage = 'Beklenmedik bir operasyonel hata oluştu.';
    let isFirebaseError = false;
    try {
      const parsedError = JSON.parse(this.state.error?.message || '');
      if (parsedError.error && parsedError.operationType) {
        errorMessage = `Veritabanı erişim protokolü ihlali: ${parsedError.operationType} işlemi sırasında yetki kısıtlaması tespit edildi.`;
        isFirebaseError = true;
      }
    } catch {
      // Not a JSON error
    }
    return { message: errorMessage, isFirebaseError };
  }

  private renderInline() {
    const { message, isFirebaseError } = this.getErrorMessage();
    return (
      <div className="min-h-[320px] flex items-center justify-center p-8 font-sans">
        <div className="max-w-md w-full makam-card !p-8 flex flex-col items-center text-center gap-6 bg-makam-glass border-surface-border">
          <div className="w-14 h-14 bg-status-danger/10 text-status-danger rounded-2xl flex items-center justify-center border border-status-danger/20 shadow-inner">
            <ShieldAlert className="w-7 h-7 stroke-[1.2]" />
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-lg font-light text-text-heading tracking-tight font-display uppercase">Modül Yüklenemedi</h3>
            <p className="text-text-muted text-body font-light leading-relaxed">
              {message}
            </p>
            {isFirebaseError && (
              <div className="inline-flex mx-auto mt-2 px-4 py-1.5 bg-status-danger/10 border border-status-danger/20 rounded-full">
                <p className="text-micro text-status-danger font-medium uppercase tracking-label">
                  Yetki Doğrulama Hatası (RBAC Protocol)
                </p>
              </div>
            )}
            {this.state.supportReference && (
              <p className="text-text-muted/60 text-micro font-mono mt-1">
                Destek Referansı: {this.state.supportReference}
              </p>
            )}
          </div>

          <Button
            onClick={this.handleRetry}
            className="w-full h-11 tracking-label"
          >
            <RefreshCw className="w-4 h-4 mr-2 stroke-[1.5]" />
            TEKRAR DENE
          </Button>
        </div>
      </div>
    );
  }

  private renderFull() {
    const { message, isFirebaseError } = this.getErrorMessage();
    return (
      <div className="min-h-screen bg-surface-base flex items-center justify-center p-8 font-sans">
        <div className="max-w-lg w-full makam-card !p-12 flex flex-col items-center text-center gap-10 bg-makam-glass border-surface-border shadow-2xl backdrop-blur-[40px]">
          <Logo size="lg" withText={false} />

          <div className="w-20 h-20 bg-status-danger/10 text-status-danger rounded-2xl flex items-center justify-center border border-status-danger/20 shadow-inner">
            <ShieldAlert className="w-10 h-10 stroke-[1.2]" />
          </div>

          <div className="flex flex-col gap-4">
            <h2 className="text-3xl font-light text-text-heading tracking-tight font-display uppercase">Dizge Kesintisi</h2>
            <p className="text-text-muted text-[15px] font-light leading-relaxed">
              {message}
            </p>
            {isFirebaseError && (
              <div className="inline-flex mx-auto mt-4 px-6 py-2 bg-status-danger/10 border border-status-danger/20 rounded-full">
                <p className="text-micro text-status-danger font-medium uppercase tracking-label">
                  Yetki Doğrulama Hatası (RBAC Protocol)
                </p>
              </div>
            )}
            {this.state.supportReference && (
              <p className="text-text-muted/60 text-caption font-mono mt-1">
                Destek Referansı: {this.state.supportReference}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-4 w-full pt-8 border-t border-makam-border/5">
            <Button
              onClick={this.handleReload}
              className="w-full h-16 tracking-label"
            >
              <RefreshCw className="w-5 h-5 mr-3 stroke-[1.5]" />
              DİZGEYİ YENİLE
            </Button>
            <Button
              variant="secondary"
              onClick={() => window.location.href = '/'}
              className="w-full h-16 tracking-label"
            >
              <Home className="w-5 h-5 mr-3 stroke-[1.5]" />
              ANA SAYFAYA DÖN
            </Button>
          </div>
        </div>
      </div>
    );
  }

  public render() {
    if (this.state.hasError) {
      return this.props.variant === 'inline' ? this.renderInline() : this.renderFull();
    }

    return this.props.children;
  }
}
