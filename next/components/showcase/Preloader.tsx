'use client';
import { motion, AnimatePresence } from 'framer-motion';

export function Preloader({ progress, ready }: { progress: number; ready: boolean }) {
  const pct = Math.round(progress * 100);
  return (
    <AnimatePresence>
      {!ready && (
        <motion.div
          key="preloader"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-50 grid place-items-center bg-studio-50"
        >
          <div className="text-center space-y-6">
            <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-ink-400">
              Shiōrra · The Product
            </p>
            <p className="font-display text-7xl font-light tabular-nums text-ink-900">
              {pct}
              <span className="text-2xl align-top">%</span>
            </p>
            <div className="mx-auto h-px w-40 bg-ink-300 overflow-hidden">
              <div
                className="h-full bg-ink-900 transition-[width] duration-150 ease-linear"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
