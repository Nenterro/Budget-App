import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Smartphone, Download, Share, PlusSquare, X, Check } from 'lucide-react';
import './PwaInstallPrompt.css';

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    // Check if app is already running in standalone mode (installed PWA)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                         window.navigator.standalone || 
                         document.referrer.includes('android-app://');
    if (isStandalone) {
      setIsInstalled(true);
    }

    // Detect iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const iosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIos(iosDevice);

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return { deferredPrompt, isInstalled, isIos, promptInstall };
}

export default function PwaInstallBanner() {
  const { deferredPrompt, isInstalled, isIos, promptInstall } = usePwaInstall();
  const [showBanner, setShowBanner] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem('PWA_BANNER_DISMISSED');
    if (!isInstalled && !dismissed) {
      // Show banner if deferredPrompt is captured or on iOS
      if (deferredPrompt || isIos) {
        setShowBanner(true);
      }
    }
  }, [deferredPrompt, isInstalled, isIos]);

  const handleInstallClick = async () => {
    if (isIos) {
      setShowIosGuide(true);
    } else {
      const success = await promptInstall();
      if (success) {
        setShowBanner(false);
      }
    }
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem('PWA_BANNER_DISMISSED', 'true');
  };

  if (isInstalled || !showBanner) return null;

  return (
    <>
      <AnimatePresence>
        {showBanner && (
          <motion.div 
            className="pwa-install-banner"
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            transition={{ type: 'spring', damping: 20 }}
          >
            <div className="pwa-banner-content">
              <div className="pwa-icon-box">
                <Smartphone size={20} />
              </div>
              <div className="pwa-banner-text">
                <span className="pwa-banner-title">Install Budget App</span>
                <span className="pwa-banner-subtitle">Add to Home Screen for 1-tap access</span>
              </div>
            </div>
            <div className="pwa-banner-actions">
              <button className="pwa-install-btn" onClick={handleInstallClick}>
                <Download size={14} /> Install
              </button>
              <button className="pwa-dismiss-btn" onClick={handleDismiss} title="Dismiss">
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* iOS Safari Instructions Modal */}
      <AnimatePresence>
        {showIosGuide && (
          <motion.div 
            className="pwa-ios-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowIosGuide(false)}
          >
            <motion.div 
              className="pwa-ios-modal-content"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="pwa-ios-header">
                <h3>Install on iPhone / iPad</h3>
                <button className="close-btn" onClick={() => setShowIosGuide(false)}><X size={20} /></button>
              </div>
              <div className="pwa-ios-steps">
                <div className="pwa-ios-step">
                  <div className="step-num">1</div>
                  <div className="step-text">
                    Tap the <strong>Share</strong> button in Safari's bottom toolbar.
                  </div>
                  <Share size={22} className="step-icon" />
                </div>
                <div className="pwa-ios-step">
                  <div className="step-num">2</div>
                  <div className="step-text">
                    Scroll down and tap <strong>Add to Home Screen</strong>.
                  </div>
                  <PlusSquare size={22} className="step-icon" />
                </div>
              </div>
              <button className="pwa-ios-done-btn" onClick={() => { setShowIosGuide(false); handleDismiss(); }}>
                <Check size={16} /> Got It
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
