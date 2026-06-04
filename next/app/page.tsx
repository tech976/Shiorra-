import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen grid place-items-center">
      <div className="text-center space-y-8 max-w-md px-6">
        <p className="text-[11px] font-bold tracking-[0.18em] uppercase text-ink-400">
          Shiōrra · The Range
        </p>
        <h1 className="font-display text-6xl md:text-7xl font-bold tracking-tight leading-[1.02]">
          Three actives. <span className="italic font-light text-ink-700">One philosophy.</span>
        </h1>
        <p className="text-ink-500 text-lg leading-relaxed">
          Scroll-driven product showcase — Ginger+, Iron+, Energy+ — in a single white-studio walkthrough.
        </p>
        <Link
          href="/product-showcase"
          className="inline-flex items-center gap-2 bg-ink-900 text-studio-50 px-7 py-4 rounded-full text-sm font-bold uppercase tracking-wider transition hover:bg-ink-700"
        >
          Enter the showcase
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </Link>
      </div>
    </main>
  );
}
