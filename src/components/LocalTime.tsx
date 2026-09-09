import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';

export const LocalTime = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-makam-glass border border-makam-border/5 rounded-full shadow-sm">
      <Clock className="w-3.5 h-3.5 text-executive-blue animate-pulse" />
      <div className="flex items-center gap-2">
        <span className="text-caption font-medium text-text-heading tracking-widest tabular-nums">
          {format(time, 'HH:mm:ss')}
        </span>
        <span className="w-[1px] h-3 bg-makam-border/10" />
        <span className="text-micro font-medium text-text-muted uppercase tracking-caps">
          {format(time, 'd MMMM yyyy', { locale: tr })}
        </span>
      </div>
    </div>
  );
};
