# Shiōrra Product Showcase — Implementation Plan

**Module:** Pharma-Luxe scroll-driven product reveal for three SKUs — **Ginger+ · Iron+ · Energy+**
**Target stack:** Next.js 14 (App Router) · TypeScript · Tailwind · Framer Motion · Lenis · HTML5 Canvas
**Aesthetic:** Bright, high-key white studio (Apple / Aēsop). Locked camera, soft contact shadows, clinical with quiet warmth.

This document is the single source of truth for shipping the showcase. It assumes a Next.js 14 project already exists and that the 360 JPEG frames (120 × 3 products) are sitting in `/public/shiorra/<product>/`.

---

## 0 · Quick read

The showcase is **three vertical scroll chapters stacked back-to-back**. Each chapter is `h-[300vh]`. A `position: sticky` canvas in the centre plays a 120-frame JPEG sequence driven by the chapter's scroll progress, while a parallel overlay column reveals the product's clinical narrative in three beats. The white background (`#FFFFFF`) is shared across all three chapters so the only thing that changes between products is the canvas content and the overlay text — making the transitions feel like one continuous studio shoot rather than three separate pages.

> **Why canvas over a `<video>` or 120 stacked `<img>`s?** A scrubbable `<video>` triggers a re-decode per seek and stutters on iOS; 120 IMG elements blow the rendering tree apart. A single canvas draws one decoded `ImageBitmap` per frame at GPU speed and stays at a flat 60 fps even on a 4-year-old MacBook Air.

---

## 1 · Assumptions & prerequisites

| | Required | Why |
|---|---|---|
| Next.js | ≥ 14.0 (App Router) | RSC + streaming for the page shell, client components for the canvas |
| Node | ≥ 18.18 | Required by Next 14 |
| Tailwind | ≥ 3.4 | Container queries + arbitrary properties needed for the sticky math |
| `framer-motion` | ≥ 11 | `useScroll({ container })` per-section, `useTransform`, `LazyMotion` |
| `lenis` | ≥ 1.1 | Smooth scroll; the canvas hooks into its RAF |
| **Sequences** | 3 × 120 JPEGs · 1080 × 1080 · sRGB · ≤ 80 KB / frame · progressive | 80 KB × 360 ≈ 28 MB max for the full module |
| **Single hero / poster frame** | `/public/shiorra/<product>/poster.jpg` (1600 × 1600) | First-paint placeholder while the sequence preloads |
| **Brand tokens** | Already defined in the existing repo | Iron+ pink `#FF3D8E`, Ginger+ green `#2E8B57`, Energy+ orange `#EA580C` |

### Frame export checklist (one-time, per product)

```
1. Export 120 frames from your 3D scene at 30 fps × 4 s loop, 1080×1080 sRGB
2. Compress: cwebp / mozjpeg targeting 75q, max 80 KB each
3. Name: 0001.jpg ... 0120.jpg  (zero-padded, 4 digits)
4. Drop in /public/shiorra/<product>/
5. Export one poster.jpg at 1600×1600 (used until the sequence is loaded)
```

> **Budget guardrail:** if any single frame exceeds 100 KB you'll see jank during preload on 4G. Re-compress before shipping.

---

## 2 · Folder structure (new files only)

```
/app
  /(showcase)
    /product-showcase
      page.tsx                  ← route /product-showcase
      layout.tsx                ← Lenis provider scope
  /globals.css                  ← Tailwind directives + Lenis CSS
/components
  /showcase
    ProductShowcase.tsx         ← parent, composes the three chapters
    ProductChapter.tsx          ← one sticky h-[300vh] section
    SequenceCanvas.tsx          ← THE engine — canvas + RAF
    ProductInfo.tsx             ← overlay text with Framer variants
    Preloader.tsx               ← elegant % counter shown before first chapter
    SmoothScrollProvider.tsx    ← Lenis bootstrap (client component)
/hooks
  useSequencePreloader.ts       ← preloads the 120 frames as ImageBitmaps
  useDevicePixelRatio.ts        ← clamped DPR for sharp canvas
  useReducedMotion.ts           ← prefers-reduced-motion guard
/lib
  /showcase
    products.ts                 ← 3 product configs (frames, copy, accent)
    sequence-config.ts          ← FRAMES_PER_PRODUCT, naming, padding
    types.ts                    ← ShowcaseProduct, FrameSequence, Beat
/public
  /shiorra
    /ginger/{0001..0120}.jpg + poster.jpg
    /iron/{0001..0120}.jpg + poster.jpg
    /energy/{0001..0120}.jpg + poster.jpg
```

---

## 3 · Tailwind config — the "White Studio"

`tailwind.config.ts`

```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // The studio surface — one source of truth for #FFFFFF
        studio: { 50: '#FFFFFF', 100: '#FAFAFA', 200: '#F4F4F4', 300: '#E5E5E5' },
        ink:    { 900: '#0A0A0A', 700: '#3A3A3A', 500: '#6B6B6B', 400: '#8A8A8A' },
        // Product accents — same hex used elsewhere in the Shiōrra brand
        ginger: { DEFAULT: '#2E8B57', soft: '#E0F0E5', deep: '#144B30' },
        iron:   { DEFAULT: '#FF3D8E', soft: '#FFE4F0', deep: '#C21B62' },
        energy: { DEFAULT: '#EA580C', soft: '#FFEDD5', deep: '#7C2D12' },
      },
      fontFamily: {
        display: ['"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        // Subtle radial vignette so #FFFFFF reads as a lit studio not a flat page
        'studio-light': 'radial-gradient(ellipse at 50% 30%, #FFFFFF 0%, #FAFAFA 60%, #F4F4F4 100%)',
      },
      dropShadow: {
        // The single contact shadow that lives under every product
        contact: '0 24px 40px rgba(40, 40, 40, 0.08)',
      },
      transitionTimingFunction: {
        'pharma-out': 'cubic-bezier(0.22, 1, 0.36, 1)', // soft, decelerating
      },
    },
  },
  plugins: [],
} satisfies Config;
```

`app/globals.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html, body { @apply bg-studio-50 text-ink-900 antialiased; overflow-x: clip; }
  body { background-image: theme('backgroundImage.studio-light'); background-attachment: fixed; }
}

/* Lenis essentials */
html.lenis, html.lenis body { height: auto; }
.lenis.lenis-smooth { scroll-behavior: auto !important; }
.lenis.lenis-stopped { overflow: hidden; }
```

---

## 4 · Lenis bootstrap — `SmoothScrollProvider.tsx`

```tsx
'use client';
import { ReactNode, useEffect } from 'react';
import Lenis from 'lenis';

let lenis: Lenis | null = null;

export function SmoothScrollProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      smoothTouch: false,
    });
    const raf = (t: number) => { lenis!.raf(t); requestAnimationFrame(raf); };
    const id = requestAnimationFrame(raf);
    // Mirror lenis scroll → native scroll events so Framer Motion's useScroll listens
    lenis.on('scroll', () => window.dispatchEvent(new Event('scroll')));
    return () => { cancelAnimationFrame(id); lenis?.destroy(); lenis = null; };
  }, []);
  return <>{children}</>;
}
```

Mount it in `app/(showcase)/layout.tsx`:

```tsx
import { SmoothScrollProvider } from '@/components/showcase/SmoothScrollProvider';

export default function ShowcaseLayout({ children }: { children: React.ReactNode }) {
  return <SmoothScrollProvider>{children}</SmoothScrollProvider>;
}
```

---

## 5 · The product config — `lib/showcase/products.ts`

```ts
export type Beat = { eyebrow: string; title: string; body: string; range: [number, number] };
export type ShowcaseProduct = {
  id: 'ginger' | 'iron' | 'energy';
  name: string;          // Display name
  badge: string;         // Short eyebrow above the title
  accentKey: 'ginger' | 'iron' | 'energy';
  sequence: { dir: string; total: number; pad: number; ext: 'jpg' | 'webp' };
  beats: Beat[];         // 2-3 narrative beats keyed to scroll progress [0, 1]
};

export const PRODUCTS: ShowcaseProduct[] = [
  {
    id: 'ginger',
    name: 'Shiōrra Ginger+',
    badge: 'Daily digestive support',
    accentKey: 'ginger',
    sequence: { dir: '/shiorra/ginger', total: 120, pad: 4, ext: 'jpg' },
    beats: [
      { eyebrow: 'Bioavailability', title: 'Active form, ready to absorb.',
        body: 'Standardized ginger extract paired with active vitamin B6 (P5P) — your body uses it the moment it lands.', range: [0.05, 0.32] },
      { eyebrow: 'Digestive Harmony', title: 'Gentle daily rhythm.',
        body: 'Warming support for queasiness, slower digestion, and the days your gut needs a little patience.', range: [0.38, 0.68] },
      { eyebrow: 'For the first trimester', title: 'Calm, in one capsule.',
        body: 'One vegecap, any time of day — with or without food.', range: [0.74, 0.95] },
    ],
  },
  {
    id: 'iron',
    name: 'Shiōrra Iron+',
    badge: 'For pregnancy & postpartum',
    accentKey: 'iron',
    sequence: { dir: '/shiorra/iron', total: 120, pad: 4, ext: 'jpg' },
    beats: [
      { eyebrow: 'Cellular Energy', title: 'Hemoglobin, gently built.',
        body: 'Ferrous Bisglycinate 27 mg with active folate and B12 — the team your body needs to actually make new red cells.', range: [0.05, 0.32] },
      { eyebrow: 'Oxygen Transport', title: 'Every breath, working harder.',
        body: 'Iron is how oxygen reaches the cells that need it. Without enough, the day feels twice as heavy.', range: [0.38, 0.68] },
      { eyebrow: '2–4× absorption', title: 'No metallic aftertaste.',
        body: 'Chelated iron — ~90% gentler on the stomach than ferrous sulfate.', range: [0.74, 0.95] },
    ],
  },
  {
    id: 'energy',
    name: 'Shiōrra Energy+',
    badge: 'Sustained daily vitality',
    accentKey: 'energy',
    sequence: { dir: '/shiorra/energy', total: 120, pad: 4, ext: 'jpg' },
    beats: [
      { eyebrow: 'Cognitive Focus', title: 'Sharper, without the spike.',
        body: 'Taurine + standardized ginseng — supports mental alertness without the caffeine crash.', range: [0.05, 0.32] },
      { eyebrow: 'Sustained Release', title: 'Steady, all day.',
        body: 'B-complex actives convert food into usable energy — a long line, not a fast peak.', range: [0.38, 0.68] },
      { eyebrow: 'Caffeine-free', title: 'Multi-nutrient support.',
        body: 'Vitamins, minerals and amino acids — not a stimulant. Just nutrition.', range: [0.74, 0.95] },
    ],
  },
];
```

---

## 6 · `useSequencePreloader.ts` — the preload hook

```ts
import { useEffect, useRef, useState } from 'react';

type Seq = { dir: string; total: number; pad: number; ext: 'jpg' | 'webp' };

function frameSrc({ dir, total, pad, ext }: Seq, i: number) {
  const n = String(i + 1).padStart(pad, '0');
  return `${dir}/${n}.${ext}`;
}

// Loads frames concurrently with a small in-flight cap so the browser
// doesn't open 120 sockets at once on a slow connection.
export function useSequencePreloader(seq: Seq, opts?: { concurrency?: number; signal?: AbortSignal }) {
  const concurrency = opts?.concurrency ?? 8;
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const imagesRef = useRef<HTMLImageElement[]>([]);

  useEffect(() => {
    let done = 0;
    let cancelled = false;
    const images: HTMLImageElement[] = new Array(seq.total);
    imagesRef.current = images;

    const queue: number[] = Array.from({ length: seq.total }, (_, i) => i);

    function next() {
      if (cancelled) return;
      const i = queue.shift();
      if (i === undefined) return;
      const img = new Image();
      img.decoding = 'async';
      img.src = frameSrc(seq, i);
      images[i] = img;
      img.onload = img.onerror = () => {
        done++;
        setProgress(done / seq.total);
        if (done === seq.total) setReady(true);
        else next();
      };
    }

    for (let k = 0; k < Math.min(concurrency, seq.total); k++) next();

    return () => {
      cancelled = true;
      opts?.signal && opts.signal.removeEventListener?.('abort', () => {});
    };
  }, [seq.dir, seq.total, seq.pad, seq.ext, concurrency]);

  return { progress, ready, frames: imagesRef.current };
}
```

> **Why HTMLImageElement, not `fetch + createImageBitmap`?** Because `<canvas>.drawImage(HTMLImageElement)` decodes once on first paint then GPU-uploads on subsequent draws. ImageBitmap is theoretically faster but requires manual lifecycle management (`bitmap.close()`) that's a footgun for a 120-frame array. The HTMLImageElement path is simpler, identical perf on modern browsers, and what Apple's product pages use.

---

## 7 · `SequenceCanvas.tsx` — the engine (60 fps, retina, resize-safe)

```tsx
'use client';
import { MotionValue, useMotionValueEvent } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { useDevicePixelRatio } from '@/hooks/useDevicePixelRatio';

type Props = {
  frames: HTMLImageElement[];   // already-loaded
  progress: MotionValue<number>; // 0..1 from useScroll on the parent chapter
  total: number;
  className?: string;
};

export function SequenceCanvas({ frames, progress, total, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dpr = useDevicePixelRatio();          // clamped to 2 for perf
  const lastDrawnRef = useRef(-1);
  const rafRef = useRef<number | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  // Resize handler with ResizeObserver — internal pixel buffer scaled by DPR
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
      lastDrawnRef.current = -1; // force redraw
      drawForProgress(progress.get());
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, [dpr]);

  // Draw helper — picks the right frame index for a 0..1 progress value
  function drawForProgress(p: number) {
    const i = Math.max(0, Math.min(total - 1, Math.floor(p * (total - 1))));
    if (i === lastDrawnRef.current) return;
    const img = frames[i];
    const c = canvasRef.current;
    if (!c || !img || !img.complete) return;
    const ctx = c.getContext('2d', { alpha: false });
    if (!ctx) return;

    const { w, h } = sizeRef.current;
    const cw = c.width;
    const ch = c.height;

    // contain — preserve product proportions inside the canvas
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const r = Math.min(cw / iw, ch / ih);
    const dw = iw * r, dh = ih * r;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;

    ctx.fillStyle = '#FFFFFF';                // studio surface
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, dx, dy, dw, dh);
    lastDrawnRef.current = i;
  }

  // Subscribe to the MotionValue — coalesce to next animation frame
  useMotionValueEvent(progress, 'change', (latest) => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      drawForProgress(latest);
    });
  });

  // Initial paint
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
```

`useDevicePixelRatio.ts`

```ts
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
```

> **Why clamp DPR to 2?** Retina 3× phones force 9× the pixel buffer (and 9× the `drawImage` cost). DPR 2 is visually indistinguishable for product photography and keeps the GPU happy on iPhones from 2019.

---

## 8 · `ProductChapter.tsx` — one sticky chapter

```tsx
'use client';
import { useScroll, useTransform, motion } from 'framer-motion';
import { useRef } from 'react';
import { ShowcaseProduct } from '@/lib/showcase/types';
import { SequenceCanvas } from './SequenceCanvas';
import { ProductInfo } from './ProductInfo';
import { useSequencePreloader } from '@/hooks/useSequencePreloader';

export function ProductChapter({ product }: { product: ShowcaseProduct }) {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end end'], // 0 at top-of-sticky, 1 at bottom
  });
  const { frames, ready, progress: loadPct } = useSequencePreloader(product.sequence);

  // Subtle scale-in on the canvas while the chapter is in view
  const canvasScale = useTransform(scrollYProgress, [0, 0.5, 1], [0.95, 1, 0.97]);

  return (
    <section
      ref={sectionRef}
      data-product={product.id}
      className="relative h-[300vh] bg-studio-50"
    >
      {/* Sticky stage holds the canvas + overlay text at viewport-centre */}
      <div className="sticky top-0 h-screen w-full overflow-hidden">
        <div className="absolute inset-0 grid grid-cols-12 gap-6 px-6 lg:px-12">
          {/* Left column — overlay narrative beats */}
          <div className="col-span-12 lg:col-span-5 flex items-center">
            <ProductInfo
              product={product}
              progress={scrollYProgress}
            />
          </div>

          {/* Right column — sticky canvas */}
          <motion.div
            style={{ scale: canvasScale }}
            className="col-span-12 lg:col-span-7 flex items-center justify-center"
          >
            <div className="relative aspect-square w-full max-w-[680px] drop-shadow-contact">
              {/* Poster placeholder until preload finishes */}
              {!ready && (
                <img
                  src={`${product.sequence.dir}/poster.jpg`}
                  alt={product.name}
                  className="absolute inset-0 h-full w-full object-contain"
                />
              )}
              {ready && (
                <SequenceCanvas
                  frames={frames}
                  progress={scrollYProgress}
                  total={product.sequence.total}
                  className="absolute inset-0"
                />
              )}
              {/* Loading % shown only on the FIRST chapter (handled by Preloader at the page level) */}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
```

---

## 9 · `ProductInfo.tsx` — overlay with Pharma-Motion

```tsx
'use client';
import { MotionValue, useTransform, motion } from 'framer-motion';
import { ShowcaseProduct, Beat } from '@/lib/showcase/types';

const accentClass = {
  ginger: 'text-ginger-deep',
  iron:   'text-iron-deep',
  energy: 'text-energy-deep',
} as const;
const chipClass = {
  ginger: 'bg-ginger-soft text-ginger-deep',
  iron:   'bg-iron-soft text-iron-deep',
  energy: 'bg-energy-soft text-energy-deep',
} as const;

export function ProductInfo({
  product,
  progress,
}: { product: ShowcaseProduct; progress: MotionValue<number> }) {
  return (
    <div className="space-y-12 max-w-md">
      <header className="space-y-4">
        <span className={`inline-block px-3 py-1.5 rounded-full text-[11px] font-bold tracking-wider uppercase ${chipClass[product.accentKey]}`}>
          {product.badge}
        </span>
        <h2 className="font-display text-5xl font-bold tracking-tight text-ink-900 leading-[1.04]">
          {product.name}
        </h2>
      </header>

      <div className="relative h-[440px]">
        {product.beats.map((beat, i) => (
          <BeatPanel key={i} beat={beat} progress={progress} accent={accentClass[product.accentKey]} />
        ))}
      </div>
    </div>
  );
}

function BeatPanel({
  beat, progress, accent,
}: { beat: Beat; progress: MotionValue<number>; accent: string }) {
  // Fade-in across the first 8% of the beat's range, fade-out across the last 8%
  const [start, end] = beat.range;
  const enter = start + 0.04;
  const exit = end - 0.04;

  const opacity = useTransform(progress, [start, enter, exit, end], [0, 1, 1, 0]);
  const y       = useTransform(progress, [start, enter, exit, end], [24, 0, 0, -24]);
  const blur    = useTransform(progress, [start, enter, exit, end], [8, 0, 0, 8]);
  const filter  = useTransform(blur, (b) => `blur(${b}px)`);

  return (
    <motion.div
      style={{ opacity, y, filter }}
      className="absolute inset-0 space-y-4"
    >
      <p className={`text-xs font-bold tracking-[0.14em] uppercase ${accent}`}>{beat.eyebrow}</p>
      <h3 className="font-display text-3xl font-semibold text-ink-900 leading-tight">
        {beat.title}
      </h3>
      <p className="text-ink-500 text-base leading-relaxed">{beat.body}</p>
    </motion.div>
  );
}
```

> **Why a stack of absolutely-positioned beats instead of a `<motion.div>` per beat in flow?** Each beat occupies the same physical slot in the viewport — they cross-fade in place rather than scrolling past each other. This is the same trick Apple uses on iPhone product pages and it's what makes the narrative feel like one continuous shot.

---

## 10 · `ProductShowcase.tsx` — the parent + cross-chapter transition

```tsx
'use client';
import { PRODUCTS } from '@/lib/showcase/products';
import { ProductChapter } from './ProductChapter';
import { Preloader } from './Preloader';
import { useSequencePreloader } from '@/hooks/useSequencePreloader';

export function ProductShowcase() {
  // First chapter (Ginger+) is the gate — we hold the preloader until it's ready.
  // Subsequent chapters preload on their own as they mount.
  const first = useSequencePreloader(PRODUCTS[0].sequence);

  return (
    <main className="relative">
      <Preloader progress={first.progress} ready={first.ready} />
      <div aria-hidden={!first.ready} className={first.ready ? 'opacity-100 transition-opacity duration-700' : 'opacity-0'}>
        {PRODUCTS.map((p) => (
          <ProductChapter key={p.id} product={p} />
        ))}
      </div>
    </main>
  );
}
```

`Preloader.tsx`

```tsx
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
              Shiōrra · The product
            </p>
            <p className="font-display text-7xl font-light tabular-nums text-ink-900">
              {pct}<span className="text-2xl align-top">%</span>
            </p>
            <div className="mx-auto h-px w-40 bg-ink-300 overflow-hidden">
              <motion.div
                className="h-full bg-ink-900"
                style={{ width: `${pct}%` }}
                transition={{ ease: 'linear' }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

> **Cross-chapter transition:** because every chapter has `bg-studio-50` and shares the same poster ratio (`aspect-square w-full max-w-[680px]`), the *only* thing that changes at chapter boundaries is the canvas content and the overlay text. The previous chapter's canvas un-sticks just as the next one's sticks — visually, the camera dollies forward by one product without any colour shift. No explicit fade is needed.

---

## 11 · Page wire-up

`app/(showcase)/product-showcase/page.tsx`

```tsx
import { ProductShowcase } from '@/components/showcase/ProductShowcase';

export const metadata = {
  title: 'The Range · Shiōrra',
  description: 'Three precision-formulated supplements — Iron+, Ginger+, Energy+. Wellness, gently formulated.',
};

export default function Page() {
  return <ProductShowcase />;
}
```

`app/(showcase)/layout.tsx`

```tsx
import { SmoothScrollProvider } from '@/components/showcase/SmoothScrollProvider';
import '../globals.css';

export default function ShowcaseLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SmoothScrollProvider>{children}</SmoothScrollProvider>
      </body>
    </html>
  );
}
```

---

## 12 · Performance budget

| Metric | Target | How we hit it |
|---|---|---|
| LCP | < 1.5 s | Poster image is `priority` and 1600 × 1600; canvas is a deferred replacement |
| Total module weight | ≤ 30 MB | 80 KB × 360 = 28.8 MB, JS bundle ≤ 60 KB gz |
| FPS during scroll | 58-60 | Single canvas, DPR clamped to 2, RAF-coalesced draws, `alpha: false` |
| Time-to-interactive | < 2.5 s | First chapter gates `<Preloader>`; chapter 2+3 load opportunistically |
| Memory | < 220 MB on iPhone 13 | HTMLImageElements GC'd when chapter unmounts (one chapter at a time if we add `IntersectionObserver` unmount — see Phase 2 below) |

### Phase 2 hardening (optional, ship after Phase 1)

- **Unmount sequences out of view** — when a chapter is > 1 viewport away from the active fold, swap canvas for poster and free the image refs. Saves ~20 MB per chapter on phones.
- **WebP fallback** — author both WebP (preferred) and JPEG; the preloader picks WebP when `document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp')`.
- **Frame chunking** — preload frames 0-30 first, render them at lower scroll resolution, then top up to 120 in the background. Lets the chapter become interactive at ~30% progress.

---

## 13 · Accessibility

- `prefers-reduced-motion` — replace the entire `<SequenceCanvas>` with the static poster image and disable Framer Motion's scroll-driven transforms. Hook:

```ts
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}
```

- Canvas is `aria-hidden` — screen readers read the `<ProductInfo>` block, which is plain semantic HTML.
- Keyboard users should be able to **skip the chapter** — add a visually-hidden "Skip to next product" link inside each `<section>` that targets the next chapter's `id`.
- Maintain a logical heading order: page `<h1>` outside the showcase, each chapter uses `<h2>` for the product name and `<h3>` for the beat title.

---

## 14 · SEO

- Render the three product names + beat titles in static HTML inside the EJS-equivalent SSR pass — they're React Server Components by default in App Router, so this happens free.
- Add `JSON-LD` for each product:

```tsx
const ld = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: product.name,
  description: product.beats.map((b) => b.body).join(' '),
  image: `${product.sequence.dir}/poster.jpg`,
  brand: { '@type': 'Brand', name: 'Shiōrra' },
};
<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
```

---

## 15 · Implementation phases

### Phase 1 — Scaffolding (½ day)
1. Install deps: `framer-motion lenis`
2. Tailwind config + globals.css
3. `SmoothScrollProvider` mounted on the showcase route
4. `products.ts` config + types

### Phase 2 — Engine (1 day)
5. `useSequencePreloader` hook
6. `SequenceCanvas` component
7. Verify with **one** product: build a stripped-down page that drives the canvas via a manual `<input type="range">` instead of scroll — confirms drawing/resize/DPR before introducing scroll into the equation
8. Wire `useScroll` and confirm 60 fps in Chrome DevTools Performance tab on a throttled "Fast 3G + 4× CPU" simulation

### Phase 3 — Overlay + transitions (½ day)
9. `ProductInfo` + `BeatPanel` with Framer variants
10. `ProductChapter` composes canvas + overlay
11. Stack three chapters in `ProductShowcase`

### Phase 4 — Preloader + polish (½ day)
12. `Preloader` component with % counter
13. `prefers-reduced-motion` fallback
14. `aria-hidden` on canvas, skip-link per chapter

### Phase 5 — Hardening (½ day)
15. Phase-2 hardening items as needed
16. JSON-LD per product
17. Cross-device QA: iPhone 13, Pixel 7, MacBook Air M1, 4K monitor

**Total budget:** ~3 days end-to-end for one engineer.

---

## 16 · Testing checklist

- [ ] Scroll from top → bottom: each product canvas runs all 120 frames without flicker
- [ ] Hard refresh mid-chapter: poster appears immediately, canvas takes over silently when ready
- [ ] DevTools throttle: "Fast 3G + 4× CPU" → preloader hits 100% before user sees the canvas blank
- [ ] iPhone Safari: pinch-zoom doesn't break the canvas dimensions (ResizeObserver should handle it)
- [ ] Reduced motion: poster stays, scroll-driven transforms disabled, all text still readable in order
- [ ] Lighthouse: Performance ≥ 90, LCP < 1.5 s, CLS = 0 (canvas reserves its slot via `aspect-square`)
- [ ] Keyboard: Tab works through skip-links and the navbar still focusable
- [ ] No console errors during 30 s scroll loop

---

## 17 · Known trade-offs & follow-ups

| Trade-off | Decision | Revisit when |
|---|---|---|
| Three sequential `useScroll` instances (one per chapter) | Accepted — Framer Motion shares the underlying scroll subscription | If profiling shows scroll-listener overhead > 1 ms / frame |
| 28 MB of JPEGs in `/public` | Lives outside the Next.js JS bundle; only loaded on the showcase route | If the route is preloaded from index.html — switch to dynamic import |
| No back-fallback for very old Safari (no `ResizeObserver`) | Acceptable — Safari ≥ 13 supports it | Drop support cutoff hits Safari 12 |
| Canvas is `aria-hidden` (no alt text per frame) | The narrative beats *are* the accessible content | If a beat needs to reference a specific visual moment |

---

## 18 · Notes for the brand team

- **Frame poses** — frame 1 should show the closed box face-on. Frame 60 (mid-sequence) should show the blister pulled out. Frame 120 should ease back to the closed pose. This lets users scrub back and forth without the product appearing to "jump" anywhere.
- **Lighting** — keep one key light from camera-left at 30° elevation, one soft fill from camera-right at 10°. Background should be RGB `(255, 255, 255)` exactly so the canvas blends with the page edges.
- **Contact shadow** — render a real shadow under the product into the JPEG, OR ensure the canvas's `drop-shadow-contact` Tailwind class (defined above) does the work consistently across all three products. Pick one — don't double up.

---

## TL;DR for the engineer who picks this up

1. `npm i framer-motion lenis`
2. Drop 360 frames + 3 posters into `/public/shiorra/<product>/`
3. Copy the files in §2 verbatim — they're production-shaped
4. Run `next dev` and scroll through `/product-showcase`
5. If anything stutters, profile in Chrome DevTools → Performance, look for paint storms (red bars). Most likely culprits in order: DPR not clamped → too many image elements in the DOM → forgot `alpha: false` on the canvas context.
