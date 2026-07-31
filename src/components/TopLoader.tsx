'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

export function triggerTopLoader() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('top-loader-start'));
  }
}

export default function TopLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const start = () => {
    setLoading(true);
    setProgress(15);
  };

  const complete = () => {
    setProgress(100);
    setTimeout(() => {
      setLoading(false);
      setProgress(0);
    }, 300);
  };

  // Listen to route changes
  useEffect(() => {
    complete();
  }, [pathname, searchParams]);

  // Listen for custom start event & global link clicks
  useEffect(() => {
    const handleStart = () => {
      start();
    };

    window.addEventListener('top-loader-start', handleStart);

    const handleAnchorClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest('a');
      if (anchor && anchor.href && anchor.target !== '_blank') {
        const url = new URL(anchor.href, window.location.href);
        if (url.origin === window.location.origin && url.pathname !== window.location.pathname) {
          start();
        }
      }
    };

    window.addEventListener('click', handleAnchorClick);

    return () => {
      window.removeEventListener('top-loader-start', handleStart);
      window.removeEventListener('click', handleAnchorClick);
    };
  }, []);

  // Increment progress smoothly while loading
  useEffect(() => {
    if (!loading) return;

    const timer1 = setTimeout(() => {
      setProgress((prev) => (prev < 60 ? 60 : prev));
    }, 150);

    const timer2 = setTimeout(() => {
      setProgress((prev) => (prev < 85 ? 85 : prev));
    }, 400);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [loading]);

  if (!loading && progress === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[99999] pointer-events-none h-[3px] bg-transparent">
      <div
        className="h-full bg-gradient-to-r from-amber-400 via-primary to-yellow-300 transition-all duration-300 ease-out shadow-[0_0_12px_rgba(212,175,106,0.8)]"
        style={{
          width: `${progress}%`,
          opacity: progress === 100 ? 0 : 1,
          transitionProperty: 'width, opacity',
        }}
      />
    </div>
  );
}
