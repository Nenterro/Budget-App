import { useState, useRef, useEffect } from 'react';
import { Tag, ShoppingCart, Coffee, Car, Home, Heart, Zap, Book, Monitor, Gift, Plane, Smartphone, Film, Music, Scissors, Shirt, Smile, Anchor, Utensils, Droplet, Flame, Map, Briefcase, Camera, Key } from 'lucide-react';
import './IconPicker.css';

export const CATEGORY_ICONS = {
  Tag, ShoppingCart, Coffee, Car, Home, Heart, Zap, Book, Monitor, Gift, Plane, 
  Smartphone, Film, Music, Scissors, Shirt, Smile, Anchor, Utensils, Droplet, 
  Flame, Map, Briefcase, Camera, Key
};

export default function IconPicker({ iconName, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef(null);

  const CurrentIcon = CATEGORY_ICONS[iconName] || Tag;

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const selectIcon = (name) => {
    onChange(name);
    setIsOpen(false);
  };

  return (
    <div className="icon-picker-container" ref={popoverRef}>
      <button 
        type="button" 
        className="icon-picker-trigger"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="current-icon-wrap">
          <CurrentIcon size={20} />
        </div>
        <span className="icon-picker-label">{iconName || 'Default'}</span>
      </button>

      {isOpen && (
        <div className="icon-popover glass-panel">
          <div className="icon-grid">
            {Object.keys(CATEGORY_ICONS).map(name => {
              const IconComp = CATEGORY_ICONS[name];
              const isActive = (iconName === name) || (!iconName && name === 'Tag');
              return (
                <button
                  key={name}
                  type="button"
                  className={`icon-swatch ${isActive ? 'active' : ''}`}
                  onClick={() => selectIcon(name)}
                  title={name}
                >
                  <IconComp size={20} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
