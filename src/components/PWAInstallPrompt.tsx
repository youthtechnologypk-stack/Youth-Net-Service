import React, { useState } from 'react';
import {
  Download,
  Smartphone,
  Share2,
  PlusSquare,
  X,
  CheckCircle2,
  Sparkles,
  ShieldCheck,
  ChevronRight,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { SystemRole } from '../types/auth';

export interface PWAInstallPromptProps {
  role?: SystemRole | string;
  variant?: 'banner' | 'button' | 'card';
  forceVisibleOnDesktop?: boolean;
}

export const PWAInstallPrompt: React.FC<PWAInstallPromptProps> = ({
  role = 'AGENT',
  variant = 'banner',
  forceVisibleOnDesktop = false,
}) => {
  const { isInstallable, isInstalled, isIOS, isMobileViewport, install } = usePWAInstall();
  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('pwa_prompt_dismissed') === 'true';
    } catch {
      return false;
    }
  });
  const [showIOSGuide, setShowIOSGuide] = useState<boolean>(false);
  const [showAndroidGuide, setShowAndroidGuide] = useState<boolean>(false);
  const [isInstalling, setIsInstalling] = useState<boolean>(false);

  // If already running in standalone mode (already installed), don't show prompt
  if (isInstalled) {
    return null;
  }

  // If dismissed during this session and it's a banner, suppress banner
  if (isDismissed && variant === 'banner') {
    return null;
  }

  // Only show on mobile unless forced
  if (!isMobileViewport && !forceVisibleOnDesktop && variant === 'banner') {
    return null;
  }

  const handleDismiss = () => {
    setIsDismissed(true);
    try {
      sessionStorage.setItem('pwa_prompt_dismissed', 'true');
    } catch {
      // ignore
    }
  };

  const handleInstallClick = async () => {
    setIsInstalling(true);
    if (isInstallable) {
      const success = await install();
      setIsInstalling(false);
      if (success) {
        setIsDismissed(true);
      }
    } else if (isIOS) {
      setIsInstalling(false);
      setShowIOSGuide(true);
    } else {
      setIsInstalling(false);
      // If browser hasn't fired beforeinstallprompt yet, show guide modal
      setShowAndroidGuide(true);
    }
  };

  // Role-specific descriptions
  const getRoleContent = () => {
    const cleanRole = String(role).toUpperCase();
    if (cleanRole === 'AGENT') {
      return {
        badge: 'Field Recovery App',
        title: 'Install Field Agent App',
        desc: 'Add Youth Net NOC to your home screen for quick offline ticket updates & cash receipt generation.',
        accent: 'from-emerald-500/20 via-slate-900 to-slate-900 border-emerald-500/40 text-emerald-400',
        btnBg: 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold',
      };
    }
    if (cleanRole === 'CLIENT') {
      return {
        badge: 'Subscriber Self-Service',
        title: 'Install Subscriber App',
        desc: 'Add Youth Net to your phone for 1-tap bill payments, live speed monitoring, and Wi-Fi management.',
        accent: 'from-cyan-500/20 via-slate-900 to-slate-900 border-cyan-500/40 text-cyan-400',
        btnBg: 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold',
      };
    }
    return {
      badge: 'Progressive Web App',
      title: 'Install Youth Net NOC',
      desc: 'Install as a standalone native app on your mobile device for high-performance offline caching.',
      accent: 'from-indigo-500/20 via-slate-900 to-slate-900 border-indigo-500/40 text-indigo-400',
      btnBg: 'bg-indigo-600 hover:bg-indigo-500 text-white font-bold',
    };
  };

  const content = getRoleContent();

  // Variant 1: Compact Button
  if (variant === 'button') {
    return (
      <>
        <button
          type="button"
          onClick={handleInstallClick}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition shadow-md shadow-emerald-950/40 cursor-pointer active:scale-95"
          title="Install Youth Net NOC on your home screen"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Install App</span>
        </button>

        {/* Guided iOS Modal */}
        {showIOSGuide && (
          <IOSInstallModal onClose={() => setShowIOSGuide(false)} title={content.title} />
        )}

        {/* Guided Android Modal */}
        {showAndroidGuide && (
          <AndroidInstallModal onClose={() => setShowAndroidGuide(false)} title={content.title} />
        )}
      </>
    );
  }

  // Variant 2: In-portal Card
  if (variant === 'card') {
    return (
      <>
        <div
          className={`p-4 rounded-xl border bg-gradient-to-r ${content.accent} shadow-xl relative overflow-hidden space-y-3`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-slate-950 border border-slate-800 p-1.5 shrink-0 shadow-lg flex items-center justify-center">
                <img
                  src="/icon.svg"
                  alt="Youth Net NOC"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <Smartphone className="w-6 h-6 text-emerald-400 fallback-icon" />
              </div>
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider font-bold block text-slate-400">
                  {content.badge} &bull; Standalone
                </span>
                <h4 className="text-sm font-bold text-white">{content.title}</h4>
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="text-slate-400 hover:text-white p-1 rounded-lg"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed font-sans">{content.desc}</p>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleInstallClick}
              disabled={isInstalling}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-xs shadow-lg transition active:scale-95 cursor-pointer ${content.btnBg}`}
            >
              <Download className="w-4 h-4" />
              <span>{isInstalling ? 'Opening...' : 'Install App to Home Screen'}</span>
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="px-3 py-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 text-xs font-mono transition"
            >
              Later
            </button>
          </div>
        </div>

        {/* Guided iOS Modal */}
        {showIOSGuide && (
          <IOSInstallModal onClose={() => setShowIOSGuide(false)} title={content.title} />
        )}

        {/* Guided Android Modal */}
        {showAndroidGuide && (
          <AndroidInstallModal onClose={() => setShowAndroidGuide(false)} title={content.title} />
        )}
      </>
    );
  }

  // Variant 3: Top/Floating Mobile Banner
  return (
    <>
      <div className="bg-slate-900/95 border-b sm:border border-emerald-500/30 sm:rounded-2xl p-3 sm:p-4 shadow-2xl backdrop-blur-md relative z-30 mb-4 transition-all animate-fadeIn">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-800 p-1.5 shrink-0 flex items-center justify-center shadow-md">
              <img src="/icon.svg" alt="App Icon" className="w-full h-full object-contain" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-xs sm:text-sm truncate">
                  {content.title}
                </span>
                <span className="hidden xs:inline-block px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                  PWA
                </span>
              </div>
              <p className="text-[11px] text-slate-300 truncate max-w-xs sm:max-w-md font-sans">
                {content.desc}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleInstallClick}
              disabled={isInstalling}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition shadow-md cursor-pointer active:scale-95 ${content.btnBg}`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isInstalling ? 'Opening...' : 'Install'}</span>
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg transition"
              title="Close banner"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Guided iOS Modal */}
      {showIOSGuide && (
        <IOSInstallModal onClose={() => setShowIOSGuide(false)} title={content.title} />
      )}

      {/* Guided Android Modal */}
      {showAndroidGuide && (
        <AndroidInstallModal onClose={() => setShowAndroidGuide(false)} title={content.title} />
      )}
    </>
  );
};

/**
 * Step-by-step iOS Safari Install Guide Modal
 */
const IOSInstallModal: React.FC<{ onClose: () => void; title: string }> = ({ onClose, title }) => (
  <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
    <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4 text-xs font-sans">
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2 text-white font-bold text-sm">
          <Smartphone className="w-4 h-4 text-cyan-400" />
          <span>Install on iPhone / iPad</span>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="text-slate-300 space-y-3">
        <p className="text-slate-400">
          iOS Safari requires manual confirmation to install web apps to your home screen:
        </p>

        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2.5">
          <div className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 flex items-center justify-center font-bold font-mono text-[10px] shrink-0">
              1
            </span>
            <div>
              <span className="font-bold text-white block">Tap the Share Button</span>
              <span className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                Look for <Share2 className="w-3.5 h-3.5 text-cyan-400 inline" /> in Safari's bottom
                navigation bar.
              </span>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center justify-center font-bold font-mono text-[10px] shrink-0">
              2
            </span>
            <div>
              <span className="font-bold text-white block">Select "Add to Home Screen"</span>
              <span className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                Scroll down the share menu and tap{' '}
                <PlusSquare className="w-3.5 h-3.5 text-emerald-400 inline" />{' '}
                <strong>Add to Home Screen</strong>.
              </span>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800 flex items-center justify-center font-bold font-mono text-[10px] shrink-0">
              3
            </span>
            <div>
              <span className="font-bold text-white block">Tap "Add" in Top Right</span>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                Youth Net NOC will launch as a standalone app directly from your screen.
              </span>
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={onClose}
        className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs transition cursor-pointer"
      >
        Got It
      </button>
    </div>
  </div>
);

/**
 * Step-by-step Android/Chrome Install Guide Modal
 */
const AndroidInstallModal: React.FC<{ onClose: () => void; title: string }> = ({
  onClose,
  title,
}) => (
  <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
    <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4 text-xs font-sans">
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2 text-white font-bold text-sm">
          <Smartphone className="w-4 h-4 text-emerald-400" />
          <span>Install Youth Net NOC</span>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="text-slate-300 space-y-3">
        <p className="text-slate-400">
          Install the full standalone app directly through your mobile browser:
        </p>

        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2.5">
          <div className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center justify-center font-bold font-mono text-[10px] shrink-0">
              1
            </span>
            <div>
              <span className="font-bold text-white block">Tap Browser Menu (&vellip;)</span>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                Open Chrome or Edge options menu in the top or bottom corner.
              </span>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 flex items-center justify-center font-bold font-mono text-[10px] shrink-0">
              2
            </span>
            <div>
              <span className="font-bold text-white block">Tap "Install App" or "Add to Home"</span>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                Confirm installation to get offline caching &amp; full screen experience.
              </span>
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={onClose}
        className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition cursor-pointer"
      >
        Done
      </button>
    </div>
  </div>
);

export default PWAInstallPrompt;
