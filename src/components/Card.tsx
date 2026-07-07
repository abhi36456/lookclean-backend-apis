'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  animateHover?: boolean;
}

export default function Card({ children, className = '', animateHover = false }: CardProps) {
  if (animateHover) {
    return (
      <motion.div
        whileHover={{ y: -4, scale: 1.01 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        className={`glass-card p-6 rounded-2xl ${className}`}
      >
        {children}
      </motion.div>
    );
  }

  return <div className={`glass-panel p-6 rounded-2xl ${className}`}>{children}</div>;
}
