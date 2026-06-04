'use client';
import { useEffect, useState } from 'react';

export function useDevicePixelRatio(max = 2) {
  const [dpr, setDpr] = useState(1);
  useEffect(() => {
    const update = () => setDpr(Math.min(max, window.devicePixelRatio || 1));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [max]);
  return dpr;
}
