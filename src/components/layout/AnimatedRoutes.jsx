import React, { Suspense, useRef, useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

function getDepth(pathname) {
  return pathname.split('/').filter(Boolean).length;
}

const Loader = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
  </div>
);

const variants = {
  initial: (dir) => ({
    x: dir > 0 ? '100%' : dir < 0 ? '-25%' : 0,
    opacity: dir === 0 ? 0 : 1,
  }),
  animate: { x: 0, opacity: 1 },
  exit: (dir) => ({
    x: dir > 0 ? '-25%' : dir < 0 ? '100%' : 0,
    opacity: dir === 0 ? 0 : 0.5,
  }),
};

const transition = {
  type: 'tween',
  ease: [0.25, 0.46, 0.45, 0.94],
  duration: 0.28,
};

// Use this as a single wrapper inside AppLayout around <Outlet />
export default function AnimatedOutlet({ children }) {
  const location = useLocation();
  const prevDepthRef = useRef(getDepth(location.pathname));
  const prevPathRef = useRef(location.pathname);

  const currentDepth = getDepth(location.pathname);
  let dir = 0;
  if (location.pathname !== prevPathRef.current) {
    dir = currentDepth - prevDepthRef.current;
  }

  // Update refs after computing direction
  useLayoutEffect(() => {
    prevDepthRef.current = getDepth(location.pathname);
    prevPathRef.current = location.pathname;
  }, [location.pathname]);

  return (
    <div style={{ overflow: 'hidden', position: 'relative' }}>
      <AnimatePresence mode="wait" initial={false} custom={dir}>
        <motion.div
          key={location.pathname}
          custom={dir}
          variants={variants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={transition}
          style={{ willChange: 'transform, opacity' }}
        >
          <Suspense fallback={<Loader />}>
            {children}
          </Suspense>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}