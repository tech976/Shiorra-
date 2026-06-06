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
      <p>Unopened, sealed products may be returned within 14 days of delivery for a refund. Opened or used products cannot be returned for hygiene reasons.</p>
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
