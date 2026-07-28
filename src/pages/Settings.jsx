import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, Wallet, User, Paintbrush, Globe, Database, ChevronRight, Cloud, Upload, Download, LogOut, ArrowLeft, Lock, Smartphone } from 'lucide-react';
import { motion } from 'framer-motion';
import { importData, exportData } from '../store/db';
import { syncAll } from '../store/sync';
import { usePwaInstall } from '../components/PwaInstallPrompt';
import './Settings.css';

import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';

export default function Settings() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const { loadData } = useData();
  const { logout } = useAuth();
  const { isInstalled, promptInstall, isIos } = usePwaInstall();

  const handleInstallClick = () => {
    if (isIos) {
      alert("To install on iOS:\n1. Tap the Share button in Safari\n2. Tap 'Add to Home Screen'");
    } else {
      promptInstall();
    }
  };

  const handleExport = async () => {
    // ...
    try {
      const jsonData = await exportData();
      const blob = new Blob([jsonData], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = 'budget_backup.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error(err);
      alert('Failed to export data');
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        await importData(e.target.result);
        alert('Data imported successfully! Syncing to server...');
        if (loadData) await loadData();
        await syncAll();
      } catch (err) {
        console.error(err);
        alert('Failed to import data. Make sure it is a valid backup file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const isMobileDevice = typeof window !== 'undefined' && (/android|iphone|ipad|ipod/i.test(navigator.userAgent) || window.innerWidth <= 768);

  const settingsGroups = [
    {
      title: "Data Management",
      items: [
        { label: "Categories", icon: Tag, path: "/settings/categories" },
        { label: "Accounts", icon: Wallet, path: "/settings/accounts" },
        { label: "Payees", icon: User, path: "/settings/payees" },
      ]
    },
    {
      title: "Cloud Sync",
      items: [
        { label: "PocketBase Sync", icon: Cloud, path: "/settings/sync" },
        { label: "Security & Encryption", icon: Lock, path: "/settings/security" }
      ]
    },
    {
      title: "Preferences & Data",
      items: [
        { label: "Appearance", icon: Paintbrush, path: "/settings/appearance" },
        { label: "Currency", icon: Globe, path: "/settings/currency" },
        ...(!isInstalled && isMobileDevice ? [{ label: "Install App / Add to Home Screen", icon: Smartphone, action: handleInstallClick }] : []),
        { label: "Import Data", icon: Upload, action: () => fileInputRef.current?.click() },
        { label: "Export Data", icon: Download, action: handleExport },
      ]
    },
    {
      title: "Account",
      items: [
        { label: "Sign Out", icon: LogOut, action: logout }
      ]
    }
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }
  };

  return (
    <div className="page-container settings-page">
      <div className="settings-header">
        <button className="icon-btn" onClick={() => navigate(sessionStorage.getItem('lastNonSettingsPath') || '/')} title="Go Back">
          <ArrowLeft size={24} />
        </button>
        <h1 className="page-title" style={{ margin: 0 }}>Settings</h1>
      </div>

      <motion.div 
        className="settings-content"
        variants={containerVariants}
        initial="hidden"
        animate="show"
      >
        {settingsGroups.map((group, gIdx) => (
          <motion.div key={gIdx} className="settings-group" variants={itemVariants}>
            <h3 className="settings-group-title">{group.title}</h3>
            <div className="settings-list">
              {group.items.map((item, iIdx) => (
                <button 
                  key={iIdx} 
                  className="settings-row"
                  onClick={() => {
                    if (item.disabled) return;
                    if (item.action) item.action();
                    else if (item.path) navigate(item.path);
                  }}
                  disabled={item.disabled}
                >
                  <div className="settings-row-left">
                    <div className="settings-icon-wrap">
                      <item.icon size={20} />
                    </div>
                    <span className="settings-label">{item.label}</span>
                  </div>
                  {!item.action && <ChevronRight size={20} className="settings-arrow" />}
                </button>
              ))}
            </div>
          </motion.div>
        ))}
      </motion.div>
      <input type="file" accept=".json" style={{ display: 'none' }} ref={fileInputRef} onChange={handleImport} />
    </div>
  );
}
