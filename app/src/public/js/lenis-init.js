/* Lenis smooth-scroll bootstrap — runs after CDN script loads
   https://github.com/darkroomengineering/lenis                       */
(() => {
    if (typeof Lenis === 'undefined') return;

    const lenis = new Lenis({
        duration: 1.15,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        smoothTouch: false,
        syncTouch: false,
        touchMultiplier: 1.2,
        infinite: false,
        autoResize: true,
        wheelMultiplier: 1
    });

    function raf(time) {
        lenis.raf(time);
        requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

    // Expose globally so other scripts can use lenis.scrollTo() etc.
    window.lenis = lenis;

    // Re-fire native scroll event so existing scroll-listeners (progress bar,
    // scroll-spy, IntersectionObserver) keep working in lock-step with Lenis.
    lenis.on('scroll', () => {
        window.dispatchEvent(new Event('scroll'));
    });

    // Native anchor links — let Lenis animate them
    document.addEventListener('click', (e) => {
        const a = e.target.closest('a[href^="#"]');
        if (!a) return;
        const id = a.getAttribute('href');
        if (id === '#' || id.length < 2) return;
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        lenis.scrollTo(target, { offset: -80, duration: 1.4 });
    });
})();
