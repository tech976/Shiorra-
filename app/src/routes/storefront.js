const express = require('express');
const ctrl = require('../controllers/storefrontController');

const router = express.Router();

router.get('/', ctrl.home);
router.get('/shop', ctrl.shop);
router.get('/product/:slug', ctrl.product);
router.get('/about', ctrl.about);
router.get('/faq', ctrl.faq);
router.get('/reviews', ctrl.reviews);
router.get('/contact', ctrl.contact);
router.get('/track', ctrl.trackForm);
router.post('/track', ctrl.trackLookup);

// Static content pages — simple stubs so the polished footer's legal /
// info links don't 404. Each renders pages/static.ejs with title + body.
const staticPages = {
  '/terms': {
    title: 'Terms of Service · Shiōrra',
    heading: 'Terms of Service',
    sub: 'Last updated: November 2026',
    body: `
      <p>By using the Shiōrra website (shiorra.com), you agree to these terms.</p>
      <h2>Use of site</h2>
      <p>You may use this site to browse, learn about and order Shiōrra products. You may not use it for any illegal purpose, or in any way that could harm us, our suppliers, our customers or other site users.</p>
      <h2>Orders &amp; payment</h2>
      <p>All orders are subject to availability and our acceptance. Prices are in Indian Rupees and include applicable taxes. Payment is processed securely through Razorpay or our COD service.</p>
      <h2>Health disclaimer</h2>
      <p>Shiōrra products are nutritional supplements, not medicines. They do not diagnose, treat, cure or prevent any disease. Always consult your doctor before starting any supplement, especially during pregnancy.</p>
      <h2>Returns &amp; refunds</h2>
      <p>Unopened, sealed products may be returned within 30 days of delivery for a refund. Opened or used products cannot be returned for hygiene reasons.</p>
      <h2>Contact</h2>
      <p>Questions? Email <a href="mailto:hello@shiorra.com">hello@shiorra.com</a>.</p>
    `,
  },
  '/privacy': {
    title: 'Privacy Policy · Shiōrra',
    heading: 'Privacy Policy',
    sub: 'Last updated: November 2026',
    body: `
      <p>Your trust matters to us. Here's how we handle the data you share with us.</p>
      <h2>What we collect</h2>
      <p>When you create an account or place an order, we collect: name, email, phone number, shipping address, and order history. When you pay through Razorpay, payment details are handled directly by them — we never see your card.</p>
      <h2>How we use it</h2>
      <p>Account &amp; order data is used to process orders, send shipping updates, and answer your support questions. We do not sell your data to anyone. Period.</p>
      <h2>Cookies</h2>
      <p>We use cookies to keep you logged in, remember your cart, and prevent fraud. You can disable them in your browser settings, but parts of the site may not work.</p>
      <h2>Your rights</h2>
      <p>You can request a copy of your data, or ask us to delete your account, at any time. Email <a href="mailto:privacy@shiorra.com">privacy@shiorra.com</a> and we'll respond within 7 days.</p>
      <h2>Contact</h2>
      <p>Privacy questions? <a href="mailto:privacy@shiorra.com">privacy@shiorra.com</a>.</p>
    `,
  },
  '/forgot-password': {
    title: 'Reset your password · Shiōrra',
    heading: 'Reset your password',
    sub: "We'll get you back in",
    body: `
      <p>Self-serve password reset is coming soon. For now, email <a href="mailto:hello@shiorra.com">hello@shiorra.com</a> from the address on your account and we'll reset it within one business day.</p>
      <p><a href="/login" class="btn btn--ghost">← Back to log in</a></p>
    `,
  },
  '/journal': {
    title: 'Journal · Shiōrra',
    heading: 'The Journal',
    sub: 'Coming soon',
    body: `
      <p>We're working on a small library of articles about pregnancy nutrition, postpartum recovery, and gentle daily wellness. Until then, browse <a href="/shop">our range</a> or read more <a href="/about">about us</a>.</p>
    `,
  },
  '/sustainability': {
    title: 'Sustainability · Shiōrra',
    heading: 'Sustainability',
    sub: 'How we think about it',
    body: `
      <p>Shiōrra products are formulated in India, manufactured in GMP-certified facilities, and packaged in recyclable cartons. We're working toward fully compostable inner packaging by 2027.</p>
      <p>More detail coming soon. In the meantime, learn more <a href="/about">about us</a>.</p>
    `,
  },
  '/shipping': {
    title: 'Shipping · Shiōrra',
    heading: 'Shipping',
    sub: 'Getting Shiōrra to your door',
    body: `
      <p>We ship across India. Orders are dispatched within 1–2 business days and typically arrive in 3–7 business days depending on your location.</p>
      <h2>Shipping charges</h2>
      <p>Free shipping on all orders over ₹999. Orders below ₹999 carry a flat ₹49 shipping fee, shown at checkout.</p>
      <h2>Tracking</h2>
      <p>Once your order ships, we'll email a tracking link so you can follow it to your door.</p>
      <h2>Questions?</h2>
      <p>Email <a href="mailto:hello@shiorra.com">hello@shiorra.com</a> and we'll help.</p>
    `,
  },
  '/returns': {
    title: 'Returns &amp; Refunds · Shiōrra',
    heading: 'Returns & Refunds',
    sub: 'Our 30-day promise',
    body: `
      <p>We want you to feel good about your order. If something isn't right, we're here to help.</p>
      <h2>Returns</h2>
      <p>Unopened, sealed products may be returned within 30 days of delivery for a full refund. For hygiene and safety reasons, opened or used products cannot be returned.</p>
      <h2>How to start a return</h2>
      <p>Email <a href="mailto:hello@shiorra.com">hello@shiorra.com</a> with your order number and we'll guide you through it.</p>
      <h2>Refunds</h2>
      <p>Once we receive the returned item, refunds are processed to your original payment method within 5–7 business days.</p>
    `,
  },
};

Object.entries(staticPages).forEach(([routePath, page]) => {
  router.get(routePath, (req, res) => res.render('pages/static', page));
});

// Newsletter — gracefully accepts the footer signup. No email integration
// yet; flashes a friendly success message and redirects back.
router.post('/newsletter/subscribe', (req, res) => {
  req.flash('success', "Thanks — we'll send the good stuff only.");
  res.redirect(req.get('Referer') || '/');
});

module.exports = router;
