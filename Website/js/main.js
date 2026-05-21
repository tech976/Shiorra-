(() => {
    const $  = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

    /* Footer year */
    const y = $('#year'); if (y) y.textContent = new Date().getFullYear();

    /* Sticky header — switches to glass-blur after scroll */
    const header = $('#siteHeader');
    const onScroll = () => header && header.classList.toggle('is-scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    /* Mobile nav */
    const nav = $('#primaryNav'), toggle = $('#navToggle');
    if (toggle && nav) {
        toggle.addEventListener('click', () => {
            const open = nav.classList.toggle('is-open');
            toggle.setAttribute('aria-expanded', String(open));
        });
        $$('#navMenu a').forEach(a => a.addEventListener('click', () => {
            if (a.classList.contains('nav__sub-toggle')) return;
            nav.classList.remove('is-open');
            toggle.setAttribute('aria-expanded', 'false');
        }));
    }

    /* Shop dropdown — click-toggle, Esc + outside-click close */
    const subToggles = $$('.nav__sub-toggle');
    const closeAllSubs = () => $$('.nav__has-sub.is-open').forEach(p => {
        p.classList.remove('is-open');
        p.querySelector('.nav__sub-toggle')?.setAttribute('aria-expanded', 'false');
    });
    subToggles.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const parent = btn.closest('.nav__has-sub');
            const opening = !parent.classList.contains('is-open');
            closeAllSubs();
            if (opening) {
                parent.classList.add('is-open');
                btn.setAttribute('aria-expanded', 'true');
            }
        });
    });
    if (subToggles.length) {
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.nav__has-sub')) closeAllSubs();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeAllSubs();
        });
    }

    /* Scroll-spy active nav link */
    const links = $$('#navMenu a');
    const sections = links
        .map(a => {
            const href = a.getAttribute('href') || '';
            return href.length > 1 && href.startsWith('#') ? $(href) : null;
        })
        .filter(Boolean);
    const setActive = () => {
        const offset = window.scrollY + 140;
        let cur = null;
        sections.forEach(s => { if (s.offsetTop <= offset) cur = s.id; });
        links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${cur}`));
    };
    window.addEventListener('scroll', setActive, { passive: true });
    setActive();

    /* FAQ accordion */
    $$('.faq-item').forEach(item => {
        const btn = $('.faq-item__btn', item);
        const panel = $('.faq-item__panel', item);
        if (!btn || !panel) return;

        if (item.classList.contains('is-open')) {
            requestAnimationFrame(() => { panel.style.maxHeight = panel.scrollHeight + 'px'; });
        }
        btn.addEventListener('click', () => {
            const open = item.classList.toggle('is-open');
            btn.setAttribute('aria-expanded', String(open));
            panel.style.maxHeight = open ? panel.scrollHeight + 'px' : '0';
        });
    });

    /* Reveal on scroll */
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver(entries => {
            entries.forEach(en => {
                if (en.isIntersecting) {
                    en.target.classList.add('is-visible');
                    io.unobserve(en.target);
                }
            });
        }, { threshold: 0.12 });
        $$('.reveal').forEach(el => io.observe(el));
    } else {
        $$('.reveal').forEach(el => el.classList.add('is-visible'));
    }

})();
