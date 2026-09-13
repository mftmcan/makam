import React from 'react';
import { LucideIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';

interface PremiumIconProps {
  icon: LucideIcon;
  variant?: 'gold' | 'blue' | 'glass';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  active?: boolean;
  'aria-hidden'?: boolean;
}

export const PremiumIcon = ({
  icon: Icon,
  variant = 'glass',
  size = 'md',
  className,
  active = false,
  'aria-hidden': ariaHidden
}: PremiumIconProps) => {
  // Sabit "appleIconSquircle" id'si her PremiumIcon örneğinde tekrarlanıyordu
  // — Sidebar gibi birden çok örneğin aynı sayfada render edildiği yerlerde
  // DOM'da geçersiz/tekrarlı ID oluşuyor, `url(#appleIconSquircle)`
  // referansının hangi örneğe bağlanacağı spesifikasyon gereği belirsiz
  // kalıyordu (bkz. kod denetimi). React.useId() her örnek için kararlı,
  // benzersiz bir kimlik üretir.
  const clipPathId = `appleIconSquircle-${React.useId()}`;
  const clipPathUrl = `url(#${clipPathId})`;

  const sizes = {
    sm: 'w-8 h-8 p-1.5',
    md: 'w-10 h-10 p-2',
    lg: 'w-12 h-12 p-2.5'
  };

  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6'
  };

  const variants = {
    gold: 'bg-gradient-to-br from-executive-gold/20 to-executive-gold/5 text-[color:var(--gold-text)] border-executive-gold/20 shadow-[inset_0_1px_1.5px_rgba(255,255,255,0.08)]',
    blue: 'bg-gradient-to-br from-executive-blue/20 to-executive-blue/5 text-executive-blue border-executive-blue/20 shadow-[inset_0_1px_1.5px_rgba(255,255,255,0.08)]',
    glass: 'bg-makam-glass backdrop-blur-md text-text-muted border-surface-border shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]'
  };

  return (
    <>
      {/* Mathematical G2 Curvature Continuous Squircle Definition for Icons */}
      <svg width="0" height="0" className="absolute">
        <defs>
          <clipPath id={clipPathId} clipPathUnits="objectBoundingBox">
            <path d="M 0.5,0 
                     C 0.88,0 1,0.12 1,0.5 
                     C 1,0.88 0.88,1 0.5,1 
                     C 0.12,1 0,0.88 0,0.5 
                     C 0,0.12 0.12,0 0.5,0 Z" />
          </clipPath>
        </defs>
      </svg>

      <motion.div
        aria-hidden={ariaHidden}
        whileHover={{ scale: 1.08, rotate: [0, -3, 3, 0] }}
        whileTap={{ scale: 0.95 }}
        style={{ clipPath: clipPathUrl }}
        className={cn(
          "relative flex items-center justify-center border transition-all duration-500 rounded-[14px]",
          "will-change-transform transform-gpu backface-hidden", // GPU acceleration for subpixel aliasing
          sizes[size],
          active
            ? "bg-gradient-to-br from-white to-[#F5F3EF] text-[color:var(--btn-primary-text)] border-white/70 shadow-[inset_0_1.5px_2.5px_rgba(255,255,255,0.85),inset_0_-1px_1.5px_rgba(0,0,0,0.1),0_10px_24px_rgba(22,21,19,0.12)] ring-1 ring-executive-gold/20"
            : variants[variant],
          className
        )}
      >
        <Icon 
          className={cn(iconSizes[size], "relative z-10")} 
          strokeWidth={1.3} // Fine line elegance
        />

        {/* Precision Watch Dial Ticks Overlay (Active State Only) */}
        {active && (
          <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.25] z-0 scale-[0.9]">
            <circle cx="50" cy="50" r="46" stroke="#C5A059" strokeWidth="1.2" strokeDasharray="0.6 3.2" fill="none" />
          </svg>
        )}
        
        {/* Background Glow */}
        <AnimatePresence>
          {active && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              style={{ clipPath: clipPathUrl }}
              className="absolute inset-0 bg-executive-gold/10 blur-sm -z-0"
            />
          )}
        </AnimatePresence>

        {/* Subtle Shine Effect */}
        <div 
          style={{ clipPath: clipPathUrl }}
          className="absolute inset-0 overflow-hidden pointer-events-none"
        >
          <motion.div 
            animate={{ x: ['-100%', '200%'] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: "linear", repeatDelay: 6 }}
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent skew-x-[-20deg]"
          />
        </div>
      </motion.div>
    </>
  );
};
