import React from 'react';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  withText?: boolean;
  variant?: 'light' | 'dark';
}

export const Logo = ({ className, size = 'md', withText = true, variant = 'dark' }: LogoProps) => {
  const sizes = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
    xl: 'w-24 h-24'
  };

  // variant='dark'  → Koyu arka plan üzerinde → logo açık/platin renkler kullanır
  // variant='light' → Açık arka plan üzerinde → logo koyu/obsidian renkler kullanır
  const isOnDarkBg = variant === 'dark';

  return (
    <div className={cn('flex items-center gap-3 sm:gap-4 select-none group', className)}>
      <svg
        viewBox="0 0 100 100"
        className={cn(
          sizes[size],
          'relative z-10 shrink-0',
          isOnDarkBg
            ? 'drop-shadow-[0_6px_18px_rgba(0,0,0,0.55)]'
            : 'drop-shadow-[0_6px_20px_rgba(22,21,19,0.22)]',
          'will-change-transform transform-gpu'
        )}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* ── Gold family ──
               Açık zeminde taçın en parlak durağı krem/beyaza yakın (#FFF3D1)
               kaldığında beyaz modal arka planıyla neredeyse birleşip
               görünmez oluyordu (About modal'da doğrulandı) — dış halka
               (ringGrad) için zaten yapılan variant ayrımı buraya da
               taşındı: açık zeminde gradyan bir kademe koyu başlar. */}
          <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            {isOnDarkBg ? (
              <>
                <stop offset="0%"   stopColor="#FFF3D1" />
                <stop offset="30%"  stopColor="#E5C16D" />
                <stop offset="55%"  stopColor="#C5A059" />
                <stop offset="80%"  stopColor="#9E7933" />
                <stop offset="100%" stopColor="#70531C" />
              </>
            ) : (
              <>
                <stop offset="0%"   stopColor="#E5C16D" />
                <stop offset="30%"  stopColor="#C5A059" />
                <stop offset="55%"  stopColor="#9E7933" />
                <stop offset="80%"  stopColor="#70531C" />
                <stop offset="100%" stopColor="#4A3814" />
              </>
            )}
          </linearGradient>
          <linearGradient id="goldHighlight" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor={isOnDarkBg ? '#FFFFFF'  : '#E5C16D'} />
            <stop offset="25%"  stopColor="#FFEBB3" />
            <stop offset="60%"  stopColor="#E5C16D" />
            <stop offset="100%" stopColor="#C5A059" />
          </linearGradient>

          {/* ── Pillar — dark bg: platinum/white; light bg: deep obsidian ── */}
          <linearGradient id="pillarFace" x1="0%" y1="0%" x2="100%" y2="100%">
            {isOnDarkBg ? (
              <>
                <stop offset="0%"   stopColor="#FFFFFF" />
                <stop offset="35%"  stopColor="#E2E2E6" />
                <stop offset="70%"  stopColor="#A5A6AB" />
                <stop offset="100%" stopColor="#6E6F73" />
              </>
            ) : (
              <>
                <stop offset="0%"   stopColor="#3A3631" />
                <stop offset="40%"  stopColor="#27241F" />
                <stop offset="100%" stopColor="#141210" />
              </>
            )}
          </linearGradient>
          <linearGradient id="pillarBevel" x1="0%" y1="0%" x2="100%" y2="0%">
            {isOnDarkBg ? (
              <>
                <stop offset="0%"   stopColor="#FFFFFF" />
                <stop offset="50%"  stopColor="#F1F1F5" />
                <stop offset="100%" stopColor="#D2D2D6" />
              </>
            ) : (
              <>
                <stop offset="0%"   stopColor="#5A5348" />
                <stop offset="50%"  stopColor="#46413C" />
                <stop offset="100%" stopColor="#302D29" />
              </>
            )}
          </linearGradient>

          {/* ── Glass backdrop ── */}
          <linearGradient id="glassGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            {isOnDarkBg ? (
              <>
                <stop offset="0%"   stopColor="#FFFFFF" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#E2E2E6" stopOpacity="0.02" />
              </>
            ) : (
              <>
                <stop offset="0%"   stopColor="#C5A059" stopOpacity="0.07" />
                <stop offset="100%" stopColor="#9E7933" stopOpacity="0.01" />
              </>
            )}
          </linearGradient>

          {/* ── Watch-dial ring ── */}
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#E5C16D" stopOpacity={isOnDarkBg ? 0.4  : 0.9} />
            <stop offset="50%"  stopColor="#C5A059" stopOpacity={isOnDarkBg ? 0.18 : 0.55} />
            <stop offset="100%" stopColor="#70531C" stopOpacity={isOnDarkBg ? 0.05 : 0.22} />
          </linearGradient>

          {/* ── V glow filter ── */}
          <filter id="vGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={isOnDarkBg ? '2.5' : '1.8'} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* ── 3D Realistic Gold Specular Lighting Filter ── */}
          <filter id="gold3D" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="0.8" result="blur" />
            <feDiffuseLighting in="blur" lightingColor="#FFF5D6" surfaceScale="3" diffuseConstant="1.2" result="diffuse">
              <feDistantLight azimuth="135" elevation="45" />
            </feDiffuseLighting>
            <feSpecularLighting in="blur" lightingColor="#FFFFFF" surfaceScale="3" specularConstant="2.4" specularExponent="30" result="specular">
              <feDistantLight azimuth="135" elevation="45" />
            </feSpecularLighting>
            <feComposite in="SourceGraphic" in2="diffuse" operator="arithmetic" k1="0.65" k2="0.65" k3="0" k4="0" result="litGraphic" />
            <feBlend in="specular" in2="litGraphic" mode="screen" result="final" />
            <feComposite in="final" in2="SourceAlpha" operator="in" />
          </filter>
        </defs>
        {/* ── Thin Outer Ring ── */}
        <circle cx="50" cy="50" r="43" stroke="url(#ringGrad)" strokeWidth="0.8" fill="none" opacity="0.45" />

        {/* ── Base Platform Line ── */}
        <motion.line
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.95 }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          x1="24" y1="66" x2="76" y2="66"
          stroke="url(#goldGradient)"
          strokeWidth="1.5"
          strokeLinecap="round"
          filter="url(#gold3D)"
        />

        {/* ── Outer M Crown ── */}
        <motion.path
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.5, ease: 'easeInOut', delay: 0.1 }}
          d="M32,66 L32,36 L50,54 L68,36 L68,66"
          fill="none"
          stroke="url(#goldGradient)"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#gold3D)"
        />

        {/* ── Inner M Crown ── */}
        <motion.path
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.85 }}
          transition={{ duration: 1.5, ease: 'easeInOut', delay: 0.25 }}
          d="M38,66 L38,46 L50,58 L62,46 L62,66"
          fill="none"
          stroke="url(#goldGradient)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#gold3D)"
        />

        {/* ── Peak Diamond ── */}
        <motion.path
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, type: 'spring', delay: 0.45 }}
          d="M50,21 L53,24 L50,27 L47,24 Z"
          fill="url(#goldGradient)"
          filter="url(#gold3D)"
          style={{ transformOrigin: '50px 24px' }}
        />

        {/* ── Pulse Precision Point ── */}
        <g>
          <motion.circle
            animate={{ r: [2, 4.5, 2], opacity: [0.15, 0.35, 0.15] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            cx="50" cy="66" r="3"
            fill="url(#goldGradient)"
          />
          <motion.circle
            animate={{ r: [1.2, 2.4, 1.2] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            cx="50" cy="66" r="1.8"
            fill="url(#goldHighlight)"
          />
        </g>
      </svg>

      {withText && (
        <div className="flex flex-col justify-center">
          <span
            className={cn(
              'font-display font-light leading-none tracking-label uppercase',
              size === 'sm' ? 'text-[16px]' :
              size === 'md' ? 'text-[20px]' :
              size === 'lg' ? 'text-[26px]' : 'text-[34px]',
              isOnDarkBg ? 'text-white' : 'text-[#1A1917]'
            )}
          >
            MAKAM
          </span>
        </div>
      )}
    </div>
  );
};
