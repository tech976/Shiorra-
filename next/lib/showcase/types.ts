export type AccentKey = 'ginger' | 'iron' | 'energy';

export type Beat = {
  eyebrow: string;
  title: string;
  body: string;
  range: [number, number]; // both in [0, 1], inclusive
};

export type FrameSequence = {
  dir: string;
  total: number;
  pad: number;
  ext: 'jpg' | 'webp';
};

export type ShowcaseProduct = {
  id: AccentKey;
  name: string;
  badge: string;
  accentKey: AccentKey;
  sequence: FrameSequence;
  beats: Beat[];
};
