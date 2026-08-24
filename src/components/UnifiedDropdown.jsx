import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import './UnifiedDropdown.css';

const MARGIN = 8;
const MIN_MENU_HEIGHT = 120;
const ROW_ESTIMATE = 44;

// Exported so the clamping can be unit tested. Anchoring a portalled menu to a
// moving trigger is exactly the kind of arithmetic that looks obviously right
// and puts the menu off-screen in one particular case.
export function computeMenuPosition({ rect, viewportW, viewportH, naturalHeight }) {
  const spaceBelow = viewportH - rect.bottom - MARGIN;
  const spaceAbove = rect.top - MARGIN;
  const openUpwards = spaceBelow < Math.min(naturalHeight, MIN_MENU_HEIGHT) && spaceAbove > spaceBelow;

  const available = Math.max(openUpwards ? spaceAbove : spaceBelow, MIN_MENU_HEIGHT);
  // Never taller than the viewport itself, whatever the content wants.
  const maxHeight = Math.min(naturalHeight, available, viewportH - MARGIN * 2);

  // Clamped on both edges in both directions. Clamping only the near edge left
  // a hole: a trigger sitting below the fold (its sheet still animating up)
  // opened "upwards" from y=900 on a 780px screen and still ended below it.
  const preferredTop = openUpwards ? rect.top - MARGIN - maxHeight : rect.bottom + MARGIN;
  const top = Math.max(MARGIN, Math.min(preferredTop, viewportH - MARGIN - maxHeight));

  const width = Math.min(rect.width, viewportW - MARGIN * 2);
  const left = Math.max(MARGIN, Math.min(rect.left, viewportW - MARGIN - width));

  return { top, left, width, maxHeight, openUpwards };
}

export default function UnifiedDropdown({ value, options, onChange, placeholder = "Select..." }) {
  const [isOpen, setIsOpen] = useState(false);
  // null until measured. The menu is not rendered before then, because an
  // unpositioned portal lands at the end of <body>, far below the page.
  const [position, setPosition] = useState(null);

  const containerRef = useRef(null);
  const menuRef = useRef(null);
  const positionRef = useRef(null);

  const selectedOption = options.find(opt => opt.value === value);
  const displayLabel = selectedOption ? selectedOption.label : placeholder;

  const measure = useCallback(() => {
    const trigger = containerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();

    // Measure the menu itself once it exists; the old code assumed every row
    // was exactly 44px, which decided "open upwards" off a number that could be
    // far from the truth.
    const naturalHeight = menuRef.current
      ? menuRef.current.scrollHeight
      : Math.min(options.length * ROW_ESTIMATE + 16, 260);

    const next = computeMenuPosition({
      rect,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      naturalHeight
    });
    const prev = positionRef.current;
    if (prev
      && Math.abs(prev.top - next.top) < 0.5
      && Math.abs(prev.left - next.left) < 0.5
      && Math.abs(prev.width - next.width) < 0.5
      && Math.abs(prev.maxHeight - next.maxHeight) < 0.5) {
      return; // nothing moved; skip the re-render
    }
    positionRef.current = next;
    setPosition(next);
  }, [options.length]);

  // Re-anchored every frame while open.
  //
  // Position used to be computed once, in an effect that ran after the menu had
  // already been painted, and never again. Opening a dropdown inside the
  // shared-expense sheet while that sheet was still springing up therefore
  // measured a trigger that was still near the bottom of the screen, produced a
  // negative offset, and parked the menu below the viewport for good — which is
  // why it worked only about half the time. Scrolling the sheet afterwards had
  // the same effect. Following the trigger costs a few frames of
  // getBoundingClientRect while a menu is open, and stops the moment it closes.
  useLayoutEffect(() => {
    if (!isOpen) {
      positionRef.current = null;
      setPosition(null);
      return undefined;
    }

    let frame = requestAnimationFrame(function tick() {
      measure();
      frame = requestAnimationFrame(tick);
    });
    measure();

    return () => cancelAnimationFrame(frame);
  }, [isOpen, measure]);

  useEffect(() => {
    if (!isOpen) return undefined;

    // pointerdown rather than mousedown: it fires for touch and pen too, and
    // before the synthetic mouse events a tap generates.
    const handlePointerDown = (event) => {
      const insideTrigger = containerRef.current?.contains(event.target);
      const insideMenu = menuRef.current?.contains(event.target);
      if (!insideTrigger && !insideMenu) setIsOpen(false);
    };

    // Captured, so this runs before the modal's own Escape handler and can stop
    // it — otherwise Escape with a dropdown open closed the whole modal.
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setIsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen]);

  const handleSelect = (val) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div className="unified-dropdown" ref={containerRef}>
      {/* A real button, and explicitly type="button": this renders inside the
          transaction form, where a default-type button would submit it. */}
      <button
        type="button"
        className={`dropdown-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(open => !open)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="dropdown-label">{displayLabel}</span>
        <ChevronDown size={18} className="dropdown-icon" />
      </button>

      {isOpen && createPortal(
        <div
          className="dropdown-menu glass-panel"
          ref={menuRef}
          role="listbox"
          style={{
            position: 'fixed',
            top: position ? `${position.top}px` : 0,
            left: position ? `${position.left}px` : 0,
            width: position ? `${position.width}px` : 'auto',
            maxHeight: position ? `${position.maxHeight}px` : MIN_MENU_HEIGHT,
            // Laid out but not painted until it has somewhere real to be.
            visibility: position ? 'visible' : 'hidden',
            margin: 0,
            right: 'auto',
            bottom: 'auto',
            zIndex: 3000,
            overflowY: 'auto'
          }}
        >
          {options.map((opt) => (
            <button
              type="button"
              key={opt.value}
              role="option"
              aria-selected={opt.value === value}
              className={`dropdown-item ${opt.value === value ? 'selected' : ''}`}
              onClick={() => handleSelect(opt.value)}
            >
              {opt.label}
            </button>
          ))}
          {options.length === 0 && (
            <div className="dropdown-empty">No options available</div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
