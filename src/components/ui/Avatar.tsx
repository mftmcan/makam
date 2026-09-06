import React from 'react';
import { cn } from '../../lib/utils';

interface AvatarProps {
  name: string;
  photoURL?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  ring?: boolean;
}

const SIZE_MAP = {
  xs: { container: 'w-6 h-6',   text: 'text-micro' },
  sm: { container: 'w-8 h-8',   text: 'text-body-sm' },
  md: { container: 'w-9 h-9',   text: 'text-[14px]' },
  lg: { container: 'w-10 h-10', text: 'text-[16px]' },
  xl: { container: 'w-14 h-14', text: 'text-[22px]' },
};

/**
 * #10 — Avatar Bileşeni
 * Google OAuth photoURL varsa fotoğraf gösterir, yoksa ismin ilk harfini gösterir.
 */
export const Avatar = ({ name, photoURL, size = 'md', className, ring = false }: AvatarProps) => {
  const { container, text } = SIZE_MAP[size];
  const initial = name?.charAt(0)?.toUpperCase() ?? '?';
  // photoURL değiştiğinde (ör. farklı bir kullanıcıya ait Avatar yeniden
  // kullanıldığında) hata durumu sıfırlanmalı — aksi halde önceki URL'nin
  // hatası yeni, geçerli bir URL için de fallback göstermeye devam ederdi.
  const [imgError, setImgError] = React.useState(false);
  React.useEffect(() => { setImgError(false); }, [photoURL]);
  const showPhoto = Boolean(photoURL) && !imgError;

  return (
    <div
      className={cn(
        container,
        'rounded-full flex-shrink-0 overflow-hidden',
        'border border-executive-blue/[0.06] shadow-inner',
        ring && 'ring-2 ring-surface-elevated ring-offset-1',
        className
      )}
    >
      {showPhoto ? (
        <img
          src={photoURL!}
          alt={name}
          className="w-full h-full object-cover"
          onError={() => {
            // Fotoğraf yüklenemezse (404/ağ hatası) baş harfe dön — eskiden
            // yalnızca <img>'i gizliyordu, dokümante edilen "yoksa ilk harf"
            // fallback'i hiç render edilmiyordu (bkz. kod denetimi):
            // kullanıcı boş bir daire görüyordu.
            setImgError(true);
          }}
        />
      ) : (
        <div
          className={cn(
            'w-full h-full flex items-center justify-center',
            'bg-executive-blue/[0.04] text-executive-blue font-light',
            text
          )}
        >
          {initial}
        </div>
      )}
    </div>
  );
};
