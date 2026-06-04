'use client';
import { useScroll, useTransform, motion } from 'framer-motion';
import { useRef } from 'react';
import type { ShowcaseProduct } from '@/lib/showcase/types';
import { SequenceCanvas } from './SequenceCanvas';
import { ProductInfo } from './ProductInfo';
import { useSequencePreloader } from '@/hooks/useSequencePreloader';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export function ProductChapter({ product }: { product: ShowcaseProduct }) {
  const sectionRef = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end end'],
  });
  const { frames, ready } = useSequencePreloader(product.sequence);

  // Subtle scale-in on the canvas while the chapter is in view.
  const canvasScale = useTransform(scrollYProgress, [0, 0.5, 1], reduced ? [1, 1, 1] : [0.95, 1, 0.97]);
  const poster = `${product.sequence.dir}/poster.jpg`;

  return (
    <section
      ref={sectionRef}
      data-product={product.id}
      className="relative h-[300vh] bg-studio-50"
      aria-labelledby={`chapter-${product.id}-heading`}
    >
      {/* Skip link for keyboard users */}
      <a
        href={`#chapter-after-${product.id}`}
        className="sr-only focus:not-sr-only fixed top-2 left-2 bg-ink-900 text-studio-50 px-3 py-2 z-50 rounded"
      >
        Skip {product.name}
      </a>

      <div className="sticky top-0 h-screen w-full overflow-hidden">
        <div className="absolute inset-0 grid grid-cols-12 gap-6 px-6 lg:px-12 items-center">
          {/* Left — narrative beats */}
          <div className="col-span-12 lg:col-span-5">
            <h2 id={`chapter-${product.id}-heading`} className="sr-only">
              {product.name}
            </h2>
            <ProductInfo product={product} progress={scrollYProgress} />
          </div>

          {/* Right — sticky canvas */}
          <motion.div
            style={{ scale: canvasScale }}
            className="col-span-12 lg:col-span-7 flex items-center justify-center"
          >
            <div className="relative aspect-square w-full max-w-[680px] drop-shadow-contact">
              {/* Poster placeholder always rendered behind the canvas so the
                  white box never flashes; the canvas paints on top once ready. */}
              <img
                src={poster}
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full object-contain"
                onError={(e) => {
                  // Fallback: hide the broken poster icon if poster.jpg is missing
                  (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                }}
              />
              {ready && !reduced && (
                <SequenceCanvas
                  frames={frames}
                  progress={scrollYProgress}
                  total={product.sequence.total}
                  fallbackSrc={poster}
                  className="absolute inset-0"
                />
              )}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Anchor target for the skip link */}
      <div id={`chapter-after-${product.id}`} aria-hidden />
    </section>
  );
}
