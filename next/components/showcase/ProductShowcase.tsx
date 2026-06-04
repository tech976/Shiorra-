'use client';
import { PRODUCTS } from '@/lib/showcase/products';
import { ProductChapter } from './ProductChapter';
import { Preloader } from './Preloader';
import { useSequencePreloader } from '@/hooks/useSequencePreloader';

export function ProductShowcase() {
  // The first chapter gates the preloader. Subsequent chapters preload
  // opportunistically as they mount.
  const first = useSequencePreloader(PRODUCTS[0].sequence);

  return (
    <main className="relative">
      <Preloader progress={first.progress} ready={first.ready} />

      <div
        aria-hidden={!first.ready}
        className={
          first.ready
            ? 'opacity-100 transition-opacity duration-700 ease-pharma-out'
            : 'opacity-0'
        }
      >
        {PRODUCTS.map((p) => (
          <ProductChapter key={p.id} product={p} />
        ))}
      </div>

      <footer className="bg-studio-50 py-24 text-center">
        <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-ink-400 mb-3">
          The Range
        </p>
        <h3 className="font-display text-3xl font-semibold text-ink-900">
          Three actives.{' '}
          <span className="italic font-light text-ink-700">One philosophy.</span>
        </h3>
        <p className="text-ink-500 mt-4 max-w-md mx-auto px-6">
          Active-form ingredients. Clinical doses. Gentle every single day.
        </p>
      </footer>
    </main>
  );
}
