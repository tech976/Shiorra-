import type { ShowcaseProduct } from './types';

// Each product is one h-[300vh] scroll chapter. The canvas plays its `total`
// frames as the user scrolls; `beats` is the narrative copy that fades in at
// scroll-progress ranges keyed to the visual moments.
//
// To wire real assets:
//   1. Drop {0001..0120}.jpg into /public/shiorra/<id>/
//   2. Drop poster.jpg into /public/shiorra/<id>/
//   3. Bump `sequence.total` accordingly (defaults assume 120 frames).
//
// Until then, the preloader will fall back to the poster frame and the canvas
// will display a single still — the chapter scaffolding still works.

export const PRODUCTS: ShowcaseProduct[] = [
  {
    id: 'ginger',
    name: 'Shiōrra Ginger+',
    badge: 'Daily digestive support',
    accentKey: 'ginger',
    sequence: { dir: '/shiorra/ginger', total: 120, pad: 4, ext: 'jpg' },
    beats: [
      {
        eyebrow: 'Bioavailability',
        title: 'Active form, ready to absorb.',
        body: 'Standardized ginger extract paired with active vitamin B6 (P5P) — your body uses it the moment it lands.',
        range: [0.05, 0.32],
      },
      {
        eyebrow: 'Digestive Harmony',
        title: 'Gentle daily rhythm.',
        body: 'Warming support for queasiness, slower digestion, and the days your gut needs a little patience.',
        range: [0.38, 0.68],
      },
      {
        eyebrow: 'For the first trimester',
        title: 'Calm, in one capsule.',
        body: 'One vegecap, any time of day — with or without food.',
        range: [0.74, 0.95],
      },
    ],
  },
  {
    id: 'iron',
    name: 'Shiōrra Iron+',
    badge: 'For pregnancy & postpartum',
    accentKey: 'iron',
    sequence: { dir: '/shiorra/iron', total: 120, pad: 4, ext: 'jpg' },
    beats: [
      {
        eyebrow: 'Cellular Energy',
        title: 'Hemoglobin, gently built.',
        body: 'Ferrous Bisglycinate 27 mg with active folate and B12 — the team your body needs to actually make new red cells.',
        range: [0.05, 0.32],
      },
      {
        eyebrow: 'Oxygen Transport',
        title: 'Every breath, working harder.',
        body: 'Iron is how oxygen reaches the cells that need it. Without enough, the day feels twice as heavy.',
        range: [0.38, 0.68],
      },
      {
        eyebrow: '2–4× absorption',
        title: 'No metallic aftertaste.',
        body: 'Chelated iron — ~90% gentler on the stomach than ferrous sulfate.',
        range: [0.74, 0.95],
      },
    ],
  },
  {
    id: 'energy',
    name: 'Shiōrra Energy+',
    badge: 'Sustained daily vitality',
    accentKey: 'energy',
    sequence: { dir: '/shiorra/energy', total: 120, pad: 4, ext: 'jpg' },
    beats: [
      {
        eyebrow: 'Cognitive Focus',
        title: 'Sharper, without the spike.',
        body: 'Taurine + standardized ginseng — supports mental alertness without the caffeine crash.',
        range: [0.05, 0.32],
      },
      {
        eyebrow: 'Sustained Release',
        title: 'Steady, all day.',
        body: 'B-complex actives convert food into usable energy — a long line, not a fast peak.',
        range: [0.38, 0.68],
      },
      {
        eyebrow: 'Caffeine-free',
        title: 'Multi-nutrient support.',
        body: 'Vitamins, minerals and amino acids — not a stimulant. Just nutrition.',
        range: [0.74, 0.95],
      },
    ],
  },
];
