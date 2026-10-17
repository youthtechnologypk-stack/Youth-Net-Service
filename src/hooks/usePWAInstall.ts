import { useState, useEffect } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(false);
  const [isIOS, setIsIOS] = useState<boolean>(false);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(false);

  useEffect(() => {
    // 1. Detect if running in standalone mode (already installed on home screen)
    const checkStandalone = () => {
      const isStandaloneMode =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsInstalled(isStandaloneMode);
    };

    checkStandalone();

    // 2. Detect mobile viewport & platform
    const checkMobile = () => {
      const isNarrow = window.innerWidth <= 768;
      const ua = window.navigator.userAgent.toLowerCase();
      const isMobileUA = /android|iphone|ipad|ipod|mobile|windows phone/.test(ua);
      setIsMobileViewport(isNarrow || isMobileUA);

      const isIOSDevice = /iphone|ipad|ipod/.test(ua);
      setIsIOS(isIOSDevice);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    // 3. Listen for browser beforeinstallprompt (Chromium, Android, Edge)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    // 4. Listen for app installed event
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async (): Promise<boolean> => {
    if (!deferredPrompt) {
      // In development or when beforeinstallprompt has not fired yet,
      // return false so caller can show guidance or fallback
      return false;
    }
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setIsInstalled(true);
        setDeferredPrompt(null);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    isMobileViewport,
    install,
  };
}

export default usePWAInstall;
