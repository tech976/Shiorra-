// Small client helper. Most pages are server-rendered; this just wires up
// a couple of progressive-enhancement bits.
(function () {
    // Product detail: clicking a thumb swaps the hero image
    document.querySelectorAll('.product__thumb').forEach((thumb) => {
        thumb.addEventListener('click', () => {
            const hero = document.querySelector('.product__hero-img');
            if (hero) hero.src = thumb.src;
        });
    });

    // Auto-dismiss flash messages after 6s
    document.querySelectorAll('.flash').forEach((el) => {
        setTimeout(() => {
            el.style.transition = 'opacity .4s ease';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 400);
        }, 6000);
    });
})();
