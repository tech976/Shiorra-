'use client';
import { useEffect, useRef, useState } from 'react';
import type { FrameSequence } from '@/lib/showcase/types';

function frameSrc(seq: FrameSequence, i: number) {
  const n = String(i + 1).padStart(seq.pad, '0');
  return `${seq.dir}/${n}.${seq.ext}`;
}

/**
 * Preloads a frame sequence as HTMLImageElements with a small in-flight cap.
 *
 * Graceful fallback: if a frame fails to load (404, network, decode error) the
 * preloader still progresses — `ready` becomes true when every slot has either
 * loaded OR errored. The SequenceCanvas then renders whichever frames *are*
 * loaded and skips the empty slots silently. This means dev environments
 * without real frame assets still get a working scaffold built around poster.jpg.
 */
export function useSequencePreloader(seq: FrameSequence, opts?: { concurrency?: number }) {
  const concurrency = opts?.concurrency ?? 8;
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const imagesRef = useRef<HTMLImageElement[]>([]);

  useEffect(() => {
    if (seq.total <= 0) {
      setReady(true);
      return;
    }
    let cancelled = false;
    let done = 0;
    const images: HTMLImageElement[] = new Array(seq.total);
    imagesRef.current = images;
    const queue = Array.from({ length: seq.total }, (_, i) => i);

    function next() {
      if (cancelled) return;
      const i = queue.shift();
      if (i === undefined) return;
      const img = new Image();
      img.decoding = 'async';
      img.src = frameSrc(seq, i);
      images[i] = img;
      const onSettle = () => {
        if (cancelled) return;
        done++;
        setProgress(done / seq.total);
        if (done === seq.total) setReady(true);
        else next();
      };
      img.onload = onSettle;
      img.onerror = onSettle; // graceful: count errors as done
    }

    for (let k = 0; k < Math.min(concurrency, seq.total); k++) next();

    return () => {
      cancelled = true;
    };
  }, [seq.dir, seq.total, seq.pad, seq.ext, concurrency]);

  return { progress, ready, frames: imagesRef.current };
}
