/* ============================================================
   AWARD-WINNING MOTION LAYER
   - GSAP + ScrollTrigger synced to Lenis smooth-scroll
   - Hero split-char reveal with stagger easing
   - Magnetic CTAs (subtle attraction toward cursor)
   - Desktop custom cursor (dot + ring, grows on hover)
   - Scroll-mask image reveals (clip-path wipe)
   - Number ramp-up counters (data-count)
   - Marquee strip pinning (horizontal-on-vertical scroll)
   - Parallax product images (data-parallax)
   ============================================================ */

(() => {
    if (typeof gsap === 'undefined') return;

    /* ---------- LENIS ↔ ScrollTrigger sync ---------- */
    if (window.gsap && window.ScrollTrigger) {
        gsap.registerPlugin(ScrollTrigger);

        if (window.lenis) {
            window.lenis.on('scroll', ScrollTrigger.update);
            gsap.ticker.add((time) => window.lenis.raf(time * 1000));
            gsap.ticker.lagSmoothing(0);
        }
    }

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isDesktop = window.matchMedia('(min-width: 900px)').matches && !('ontouchstart' in window);

    /* ============================================================
       1) HERO SPLIT-CHAR REVEAL
       Each character of the H1 rises from below with stagger.
       ============================================================ */
    const splitTargets = document.querySelectorAll('h1.split-words, h1[data-split], .hero h1');
    splitTargets.forEach(el => {
        if (el.dataset.splitDone) return;
        el.dataset.splitDone = 'true';

        // Walk children — preserve interior spans, split text nodes only
        const splitNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const frag = document.createDocumentFragment();
                const words = node.textContent.split(/(\s+)/);
                words.forEach(word => {
                    if (/^\s+$/.test(word)) {
                        frag.appendChild(document.createTextNode(word));
                        return;
                    }
                    if (!word) return;
                    const w = document.createElement('span');
                    w.className = 'aw-word';
                    [...word].forEach(ch => {
                        const c = document.createElement('span');
                        c.className = 'aw-char';
                        c.textContent = ch;
                        w.appendChild(c);
                    });
                    frag.appendChild(w);
                });
                node.parentNode.replaceChild(frag, node);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                Array.from(node.childNodes).forEach(splitNode);
            }
        };
        splitNode(el);
    });

    // Preempt IntersectionObserver race: any .reveal elements in the hero
    // get marked visible immediately so GSAP-driven entrances aren't fighting
    // a parent opacity:0 from the .reveal CSS rule.
    document.querySelectorAll('.hero .reveal').forEach(el => el.classList.add('is-visible'));

    if (!reduce) {
        const chars = document.querySelectorAll('.hero .aw-char');
        if (chars.length) {
            gsap.set(chars, { yPercent: 110, opacity: 0 });
            gsap.to(chars, {
                yPercent: 0,
                opacity: 1,
                duration: 1.1,
                ease: 'expo.out',
                stagger: 0.018,
                delay: 0.15
            });
        }

        const heroLead = document.querySelector('.hero__lead, .hero__copy .stars, .hero__cta, .hero__bullets');
        document.querySelectorAll('.hero__copy > *:not(h1):not(.eyebrow)').forEach((el, i) => {
            gsap.from(el, {
                y: 28,
                opacity: 0,
                duration: 0.9,
                ease: 'power3.out',
                delay: 0.55 + (i * 0.08)
            });
        });

        const heroEyebrow = document.querySelector('.hero__eyebrow');
        if (heroEyebrow) gsap.from(heroEyebrow, { y: 14, opacity: 0, duration: 0.7, ease: 'power3.out', delay: 0 });

        const heroVisual = document.querySelector('.hero__visual');
        if (heroVisual) {
            // Mark visible so the CSS .reveal default (opacity:0) doesn't fight us,
            // then fromTo to explicit opacity:1, scale:1 destinations.
            heroVisual.classList.add('is-visible');
            gsap.fromTo(heroVisual,
                { scale: 1.08, opacity: 0 },
                { scale: 1, opacity: 1, duration: 1.4, ease: 'expo.out', delay: 0.2, clearProps: 'transform,opacity' }
            );
        }
    }

    /* ============================================================
       2) MAGNETIC BUTTONS (desktop only)
       CTAs subtly attract toward the cursor.
       ============================================================ */
    if (isDesktop && !reduce) {
        document.querySelectorAll('.btn, .magnetic').forEach(btn => {
            btn.addEventListener('mousemove', (e) => {
                const r = btn.getBoundingClientRect();
                const x = e.clientX - (r.left + r.width / 2);
                const y = e.clientY - (r.top + r.height / 2);
                gsap.to(btn, {
                    x: x * 0.22,
                    y: y * 0.22,
                    duration: 0.5,
                    ease: 'power3.out'
                });
            });
            btn.addEventListener('mouseleave', () => {
                gsap.to(btn, { x: 0, y: 0, duration: 0.6, ease: 'elastic.out(1, 0.45)' });
            });
        });
    }

    /* ============================================================
       3) CUSTOM CURSOR (desktop only)
       Dot + ring; ring grows when hovering interactive elements.
       ============================================================ */
    if (isDesktop && !reduce) {
        const dot = document.createElement('div');
        const ring = document.createElement('div');
        dot.className = 'aw-cursor-dot';
        ring.className = 'aw-cursor-ring';
        document.body.appendChild(dot);
        document.body.appendChild(ring);
        document.body.classList.add('has-aw-cursor');

        const dotPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        const ringPos = { ...dotPos };
        const target = { ...dotPos };

        document.addEventListener('mousemove', (e) => {
            target.x = e.clientX;
            target.y = e.clientY;
        }, { passive: true });

        const tickCursor = () => {
            dotPos.x += (target.x - dotPos.x) * 0.55;
            dotPos.y += (target.y - dotPos.y) * 0.55;
            ringPos.x += (target.x - ringPos.x) * 0.18;
            ringPos.y += (target.y - ringPos.y) * 0.18;
            dot.style.transform  = `translate3d(${dotPos.x}px, ${dotPos.y}px, 0) translate(-50%, -50%)`;
            ring.style.transform = `translate3d(${ringPos.x}px, ${ringPos.y}px, 0) translate(-50%, -50%)`;
            requestAnimationFrame(tickCursor);
        };
        requestAnimationFrame(tickCursor);

        const interactiveSel = 'a, button, .btn, [role="button"], input, textarea, label, .compare-card, .review-card, [data-cursor]';
        document.querySelectorAll(interactiveSel).forEach(el => {
            el.addEventListener('mouseenter', () => document.body.classList.add('aw-cursor-hover'));
            el.addEventListener('mouseleave', () => document.body.classList.remove('aw-cursor-hover'));
        });

        document.addEventListener('mouseleave', () => document.body.classList.add('aw-cursor-out'));
        document.addEventListener('mouseenter', () => document.body.classList.remove('aw-cursor-out'));
    }

    /* ============================================================
       4) SCROLL-MASK IMAGE REVEALS
       Wraps imgs in a clip-path mask that wipes open on scroll-in.
       ============================================================ */
    if (!reduce && window.ScrollTrigger) {
        const revealImgs = document.querySelectorAll(
            '.product-gallery__main img, .compare-card__media img, .magazine__col img, [data-reveal-mask]'
        );
        revealImgs.forEach(img => {
            // Skip anything inside the hero — hero has its own opacity+scale entrance
            if (img.closest('.hero')) return;
            const wrap = img.closest('.aw-mask-wrap');
            if (!wrap) {
                const w = document.createElement('span');
                w.className = 'aw-mask-wrap';
                img.parentNode.insertBefore(w, img);
                w.appendChild(img);
            }
        });

        document.querySelectorAll('.aw-mask-wrap').forEach(w => {
            gsap.fromTo(w,
                { clipPath: 'inset(100% 0 0 0)' },
                {
                    clipPath: 'inset(0% 0 0 0)',
                    duration: 1.4,
                    ease: 'expo.out',
                    scrollTrigger: { trigger: w, start: 'top 88%', once: true }
                }
            );
            const inner = w.querySelector('img');
            if (inner) {
                gsap.fromTo(inner,
                    { scale: 1.18 },
                    {
                        scale: 1,
                        duration: 1.6,
                        ease: 'expo.out',
                        scrollTrigger: { trigger: w, start: 'top 88%', once: true }
                    }
                );
            }
        });
    }

    /* ============================================================
       5) NUMBER RAMP-UP COUNTERS
       Any element with data-count="89" animates 0 → 89 on enter.
       Optional data-count-suffix="%".
       ============================================================ */
    if (window.ScrollTrigger) {
        document.querySelectorAll('[data-count]').forEach(el => {
            const end = parseFloat(el.dataset.count);
            const suffix = el.dataset.countSuffix || '';
            const decimals = (el.dataset.count.split('.')[1] || '').length;
            const obj = { v: 0 };
            ScrollTrigger.create({
                trigger: el,
                start: 'top 85%',
                once: true,
                onEnter: () => {
                    gsap.to(obj, {
                        v: end,
                        duration: 1.6,
                        ease: 'power2.out',
                        onUpdate: () => {
                            el.textContent = obj.v.toFixed(decimals) + suffix;
                        }
                    });
                }
            });
        });
    }

    /* ============================================================
       6) PARALLAX product imagery
       data-parallax="0.15" → translates Y with scroll
       ============================================================ */
    if (!reduce && window.ScrollTrigger) {
        document.querySelectorAll('[data-parallax]').forEach(el => {
            const factor = parseFloat(el.dataset.parallax) || 0.12;
            gsap.to(el, {
                yPercent: -factor * 100,
                ease: 'none',
                scrollTrigger: {
                    trigger: el,
                    start: 'top bottom',
                    end: 'bottom top',
                    scrub: true
                }
            });
        });
    }

    /* ============================================================
       7) PIN HORIZONTAL SCROLL — for any [data-pin-horizontal]
       Section pins; inner row scrolls horizontally as page scrolls vertically.
       ============================================================ */
    if (!reduce && window.ScrollTrigger && isDesktop) {
        document.querySelectorAll('[data-pin-horizontal]').forEach(section => {
            const track = section.querySelector('[data-pin-track]');
            if (!track) return;
            const distance = () => track.scrollWidth - window.innerWidth + 80;
            gsap.to(track, {
                x: () => -distance(),
                ease: 'none',
                scrollTrigger: {
                    trigger: section,
                    pin: true,
                    scrub: 0.8,
                    end: () => '+=' + distance(),
                    invalidateOnRefresh: true,
                    anticipatePin: 1
                }
            });
        });
    }

    /* ============================================================
       8) Generic "rise-on-scroll" — adds class for any [data-rise]
       Subtle complement to existing .reveal — for headlines we want
       a stronger, GSAP-controlled ease.
       ============================================================ */
    if (!reduce && window.ScrollTrigger) {
        document.querySelectorAll('[data-rise]').forEach(el => {
            gsap.from(el, {
                y: 60,
                opacity: 0,
                duration: 1.1,
                ease: 'expo.out',
                scrollTrigger: { trigger: el, start: 'top 88%', once: true }
            });
        });
    }
})();
