import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import './PullToRefresh.css';

const PULL_THRESHOLD = 70; // px distance required to trigger refresh

export default function PullToRefresh() {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const startYRef = useRef(0);
  const isPullingRef = useRef(false);

  useEffect(() => {
    const mainContentEl = document.querySelector('.main-content') || window;

    const handleTouchStart = (e) => {
      const scrollTop = mainContentEl.scrollTop !== undefined ? mainContentEl.scrollTop : window.scrollY;
      // Only enable pull-to-refresh if at the very top of the page
      if (scrollTop <= 0) {
        startYRef.current = e.touches[0].clientY;
        isPullingRef.current = true;
      } else {
        isPullingRef.current = false;
      }
    };

    const handleTouchMove = (e) => {
      if (!isPullingRef.current || isRefreshing) return;

      const scrollTop = mainContentEl.scrollTop !== undefined ? mainContentEl.scrollTop : window.scrollY;
      if (scrollTop > 0) {
        isPullingRef.current = false;
        setPullDistance(0);
        return;
      }

      const currentY = e.touches[0].clientY;
      const diffY = currentY - startYRef.current;

      if (diffY > 0) {
        // Resistance formula for smooth pulling feel
        const dist = Math.min(100, Math.pow(diffY, 0.85) * 1.8);
        setPullDistance(dist);
      } else {
        setPullDistance(0);
      }
    };

    const handleTouchEnd = () => {
      if (!isPullingRef.current || isRefreshing) return;

      if (pullDistance >= PULL_THRESHOLD) {
        setIsRefreshing(true);
        setPullDistance(PULL_THRESHOLD);
        
        // Full app & session refresh
        setTimeout(() => {
          window.location.reload();
        }, 400);
      } else {
        setPullDistance(0);
      }

      isPullingRef.current = false;
    };

    const targetEl = document.querySelector('.main-content') || document;

    targetEl.addEventListener('touchstart', handleTouchStart, { passive: true });
    targetEl.addEventListener('touchmove', handleTouchMove, { passive: true });
    targetEl.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      targetEl.removeEventListener('touchstart', handleTouchStart);
      targetEl.removeEventListener('touchmove', handleTouchMove);
      targetEl.removeEventListener('touchend', handleTouchEnd);
    };
  }, [pullDistance, isRefreshing]);

  if (pullDistance <= 0 && !isRefreshing) return null;

  const isPastThreshold = pullDistance >= PULL_THRESHOLD;
  const rotation = isRefreshing ? 360 : (pullDistance / PULL_THRESHOLD) * 360;

  return (
    <AnimatePresence>
      <motion.div 
        className="pull-to-refresh-container"
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: Math.min(pullDistance, PULL_THRESHOLD) - 10, opacity: 1 }}
        exit={{ y: -50, opacity: 0 }}
        transition={{ type: 'spring', damping: 20, stiffness: 200 }}
      >
        <div className={`pull-to-refresh-pill ${isPastThreshold ? 'active' : ''} ${isRefreshing ? 'refreshing' : ''}`}>
          <RefreshCw 
            size={18} 
            className={`pull-icon ${isRefreshing ? 'spin' : ''}`} 
            style={{ transform: `rotate(${rotation}deg)` }} 
          />
          <span className="pull-text">
            {isRefreshing 
              ? 'Refreshing session...' 
              : isPastThreshold 
                ? 'Release to refresh' 
                : 'Pull down to refresh'}
          </span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
