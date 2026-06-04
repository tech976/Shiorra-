'use client';
import { MotionValue, useMotionValueEvent } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { useDevicePixelRatio } from '@/hooks/useDevicePixelRatio';

type Props = {
  frames: HTMLImageElement[];
  progress: MotionValue<number>;
  total: number;
  fallbackSrc?: string; // shown if the picked frame failed to load
  className?: string;
};

/**
 * Canvas engine — renders a single frame from the preloaded sequence based on
 * the scroll progress MotionValue. Targets ~60 fps via:
 *   - clamped device-pixel-ratio (≤ 2)
 *   - draw call coalesced via requestAnimationFrame
 *   - `alpha: false` context (cheaper composite)
 *   - early-out when the desired frame index hasn't changed since last draw
 */
export function SequenceCanvas({ frames, progress, total, fallbackSrc, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dpr = useDevicePixelRatio();
  const lastDrawnRef = useRef(-1);
  const rafRef = useRef<number | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const fallbackImgRef = useRef<HTMLImageElement | null>(null);

  // Pre-load the fallback image once
  useEffect(() => {
    if (!fallbackSrc) return;
    const img = new Image();
    img.decoding = 'async';
    img.src = fallbackSrc;
    img.onload = () => {
      fallbackImgRef.current = img;
      lastDrawnRef.current = -1; // force redraw
      drawForProgress(progress.get());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallbackSrc]);

  // Keep the internal pixel buffer in sync with the CSS box.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      sizeRef.current = { w: width, h: height };
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
      lastDrawnRef.current = -1;
      drawForProgress(progress.get());
    });
    ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dpr]);

  function drawForProgress(p: number) {
    const i = Math.max(0, Math.min(total - 1, Math.floor(p * (total - 1))));
    if (i === lastDrawnRef.current) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d', { alpha: false });
    if (!ctx) return;

    let img: HTMLImageElement | null = frames[i] || null;
    if (!img || !img.complete || !img.naturalWidth) img = fallbackImgRef.current;
    if (!img || !img.complete || !img.naturalWidth) {
      // Nothing to draw yet — paint the studio surface so we don't see a flash.
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, c.width, c.height);
      return;
    }

    const cw = c.width;
    const ch = c.height;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const r = Math.min(cw / iw, ch / ih);
    const dw = iw * r;
    const dh = ih * r;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, dx, dy, dw, dh);
    lastDrawnRef.current = i;
  }

  useMotionValueEvent(progress, 'change', (latest) => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      drawForProgress(latest);
    });
  });

  // Initial paint when frames change
  useEffect(() => {
    drawForProgress(progress.get());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames.length]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ width: '100%', height: '100%', display: 'block', willChange: 'contents' }}
    />
  );
}
