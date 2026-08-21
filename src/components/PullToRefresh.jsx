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
  // The handlers used to read pullDistance/isRefreshing straight from state,
  // which put both in the effect's dependency array — so all three touch
  // listeners were torn down and re-attached on every frame of a drag.
  const pullDistanceRef = useRef(0);
  const isRefreshingRef = useRef(false);

  const updatePull = (dist) => {
    pullDistanceRef.current = dist;
    setPullDistance(dist);
  };

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
      if (!isPullingRef.current || isRefreshingRef.current) return;

      const scrollTop = mainContentEl.scrollTop !== undefined ? mainContentEl.scrollTop : window.scrollY;
      if (scrollTop > 0) {
        isPullingRef.current = false;
        updatePull(0);
        return;
      }

      const currentY = e.touches[0].clientY;
      const diffY = currentY - startYRef.current;

      if (diffY > 0) {
        // Resistance formula for smooth pulling feel
        const dist = Math.min(100, Math.pow(diffY, 0.85) * 1.8);
        updatePull(dist);
      } else {
        updatePull(0);
      }
    };

    const handleTouchEnd = () => {
      if (!isPullingRef.current || isRefreshingRef.current) return;

      if (pullDistanceRef.current >= PULL_THRESHOLD) {
        isRefreshingRef.current = true;
        setIsRefreshing(true);
        updatePull(PULL_THRESHOLD);
        
        // Full app & session refresh
        setTimeout(() => {
          window.location.reload();
        }, 400);
      } else {
        updatePull(0);
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
  }, []);

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
