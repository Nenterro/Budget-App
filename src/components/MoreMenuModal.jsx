import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { NavLink } from 'react-router-dom';
import { Settings, Database, X, Palette, HelpCircle, Info, Calculator, Smartphone } from 'lucide-react';
import { usePwaInstall } from './PwaInstallPrompt';
import './MoreMenuModal.css';

export default function MoreMenuModal({ isOpen, onClose }) {
  const { isInstalled, promptInstall, isIos } = usePwaInstall();

  const handleInstallClick = () => {
    onClose();
    if (isIos) {
      alert("To install on iOS:\n1. Tap the Share button in Safari\n2. Tap 'Add to Home Screen'");
    } else {
      promptInstall();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          className="more-modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div 
            className="more-modal-content"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="more-modal-header">
              <h3>More Options</h3>
              <button className="close-btn" onClick={onClose}><X size={20} /></button>
            </div>
            
            <div className="more-modal-body">
              <NavLink to="/stats" className="more-menu-item" onClick={onClose}>
                <div className="more-icon-circle"><Calculator size={20} /></div>
                <span>Detailed Stats</span>
              </NavLink>
              <NavLink to="/settings" className="more-menu-item" onClick={onClose}>
                <div className="more-icon-circle"><Settings size={20} /></div>
                <span>General Settings</span>
              </NavLink>
              {!isInstalled && (
                <button className="more-menu-item" onClick={handleInstallClick} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit' }}>
                  <div className="more-icon-circle" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}><Smartphone size={20} /></div>
                  <span style={{ color: '#f59e0b', fontWeight: 600 }}>Install App</span>
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
