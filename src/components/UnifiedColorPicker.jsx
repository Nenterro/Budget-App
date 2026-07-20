import { useState, useRef, useEffect } from 'react';
import { HexColorPicker } from 'react-colorful';
import './UnifiedColorPicker.css';

export default function UnifiedColorPicker({ color, onChange, children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [hexInput, setHexInput] = useState(color);
  const popoverRef = useRef(null);

  // Update input when color prop changes externally
  useEffect(() => {
    setHexInput(color);
  }, [color]);

  // Click outside to close
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

  const handleHexChange = (e) => {
    const val = e.target.value;
    setHexInput(val);
    
    // Simple hex validation (allow 3 or 6 char hex)
    if (/^#([0-9A-F]{3}){1,2}$/i.test(val)) {
      onChange(val);
    }
  };

  const handlePickerChange = (newColor) => {
    onChange(newColor);
    setHexInput(newColor);
  };

  return (
    <div className="unified-color-picker" ref={popoverRef}>
      {children ? (
        <div onClick={() => setIsOpen(!isOpen)} style={{ cursor: 'pointer' }}>
          {children}
        </div>
      ) : (
        <button 
          type="button"
          className="color-picker-trigger" 
          onClick={() => setIsOpen(!isOpen)}
        >
          <div className="color-preview-circle" style={{ backgroundColor: color }}></div>
          <span className="color-hex-label">{color}</span>
        </button>
      )}

      {isOpen && (
        <div className="color-popover glass-panel">
          <HexColorPicker color={color} onChange={handlePickerChange} style={{ width: '100%', height: '200px' }} />
          
          <div className="hex-input-wrapper">
            <span className="hex-hash">#</span>
            <input 
              type="text" 
              value={hexInput.replace('#', '')} 
              onChange={(e) => handleHexChange({ target: { value: '#' + e.target.value }})}
              placeholder="Hex Code"
              maxLength={6}
              spellCheck={false}
            />
          </div>
        </div>
      )}
    </div>
  );
}
