'use client';
import { MotionValue, useTransform, motion } from 'framer-motion';
import type { ShowcaseProduct, Beat, AccentKey } from '@/lib/showcase/types';

const accentTextClass: Record<AccentKey, string> = {
  ginger: 'text-ginger-deep',
  iron: 'text-iron-deep',
  energy: 'text-energy-deep',
};
const chipClass: Record<AccentKey, string> = {
  ginger: 'bg-ginger-soft text-ginger-deep',
  iron: 'bg-iron-soft text-iron-deep',
  energy: 'bg-energy-soft text-energy-deep',
};

export function ProductInfo({
  product,
  progress,
}: {
  product: ShowcaseProduct;
  progress: MotionValue<number>;
}) {
  return (
    <div className="space-y-12 max-w-md">
      <header className="space-y-4">
        <span
          className={`inline-block px-3 py-1.5 rounded-full text-[11px] font-bold tracking-wider uppercase ${chipClass[product.accentKey]}`}
        >
          {product.badge}
        </span>
        <h2 className="font-display text-5xl font-bold tracking-tight text-ink-900 leading-[1.04]">
          {product.name}
        </h2>
      </header>

      <div className="relative h-[440px]">
        {product.beats.map((beat, i) => (
          <BeatPanel
            key={i}
            beat={beat}
            progress={progress}
            accent={accentTextClass[product.accentKey]}
          />
        ))}
      </div>
    </div>
  );
}

function BeatPanel({
  beat,
  progress,
  accent,
}: {
  beat: Beat;
  progress: MotionValue<number>;
  accent: string;
}) {
  const [start, end] = beat.range;
  const enter = start + 0.04;
  const exit = end - 0.04;

  const opacity = useTransform(progress, [start, enter, exit, end], [0, 1, 1, 0]);
  const y = useTransform(progress, [start, enter, exit, end], [24, 0, 0, -24]);
  const blur = useTransform(progress, [start, enter, exit, end], [8, 0, 0, 8]);
  const filter = useTransform(blur, (b) => `blur(${b}px)`);

  return (
    <motion.div style={{ opacity, y, filter }} className="absolute inset-0 space-y-4">
      <p className={`text-xs font-bold tracking-[0.14em] uppercase ${accent}`}>{beat.eyebrow}</p>
      <h3 className="font-display text-3xl font-semibold text-ink-900 leading-tight">{beat.title}</h3>
      <p className="text-ink-500 text-base leading-relaxed">{beat.body}</p>
    </motion.div>
  );
}
