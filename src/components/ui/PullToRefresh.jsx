import React, { useRef, useState, useCallback } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { RefreshCw } from 'lucide-react';

const THRESHOLD = 70;
const MAX_PULL = 100;

export default function PullToRefresh({ onRefresh, children }) {
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const pulling = useRef(false);
  const y = useMotionValue(0);
  const rotate = useTransform(y, [0, THRESHOLD], [0, 360]);
  const opacity = useTransform(y, [0, THRESHOLD * 0.4, THRESHOLD], [0, 0.5, 1]);
  const scale = useTransform(y, [0, THRESHOLD], [0.5, 1]);

  const handleTouchStart = useCallback((e) => {
    // Only allow pull if scrolled to top
    const el = e.currentTarget;
    if (el.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
    pulling.current = true;
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!pulling.current || startY.current === null || refreshing) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta < 0) { pulling.current = false; return; }
    const clamped = Math.min(delta * 0.5, MAX_PULL);
    y.set(clamped);
    if (clamped > 5) e.preventDefault();
  }, [refreshing, y]);

  const handleTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;
    startY.current = null;

    if (y.get() >= THRESHOLD && !refreshing) {
      setRefreshing(true);
      await animate(y, THRESHOLD * 0.7, { type: 'spring', stiffness: 300 });
      await onRefresh();
      setRefreshing(false);
    }
    await animate(y, 0, { type: 'spring', stiffness: 300, damping: 30 });
  }, [y, refreshing, onRefresh]);

  return (
    <div
      className="relative overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      <motion.div
        style={{ height: y, opacity }}
        className="flex items-center justify-center overflow-hidden"
      >
        <motion.div style={{ rotate, scale }}>
          <RefreshCw
            className={`w-5 h-5 ${refreshing ? 'text-primary animate-spin' : 'text-muted-foreground'}`}
          />
        </motion.div>
      </motion.div>

      {children}
    </div>
  );
}