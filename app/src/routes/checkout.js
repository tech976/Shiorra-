const express = require('express');
const ctrl = require('../controllers/checkoutController');

const rateLimit = require('express-rate-limit');

const router = express.Router();

// Razorpay does not sign its Magic Checkout platform callbacks, so these
// routes lean on the order-existence check plus this limit rather than an
// HMAC. Generous enough for a real checkout (Razorpay re-asks as the customer
// edits their address), tight enough that nobody can grind order numbers.
const magicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

// Guest checkout: none of these require an account. Logged-in users still get
// their saved addresses + order history; guests are identified by their
// session (see req.session.guestOrders for success-page access).
router.get('/', ctrl.showCheckout);
router.post('/create-order', ctrl.createOrder);
// Magic Checkout (1CC): no address collected here — Razorpay gathers it.
router.post('/create-magic-order', ctrl.createMagicOrder);
router.post('/cod', ctrl.placeCod);
router.post('/verify', ctrl.verifyPayment);
// Razorpay redirects the browser here (POST, form-encoded) after payment —
// see callback_url in the checkout page. Works even when the JS handler can't.
router.post('/callback', ctrl.paymentCallback);
router.get('/success/:orderNumber', ctrl.success);

// Razorpay webhook expects raw body — register before json/urlencoded for this path
router.post('/webhook', express.raw({ type: '*/*' }), ctrl.webhook);

// Magic Checkout serviceability API — Razorpay POSTs the customer's address
// mid-checkout and we answer: do we ship there, what does shipping cost, is
// COD available. Raw body for the same HMAC reason as the webhook.
router.get('/shipping-info', ctrl.shippingInfoHealth);
router.post('/shipping-info', magicLimiter, express.raw({ type: '*/*' }), ctrl.shippingInfo);

// Magic Checkout coupon APIs. Razorpay asks which coupons to show, then asks
// us to validate the one the customer picked. Raw body for the HMAC.
router.get('/promotions', ctrl.promotionsHealth);
router.post('/promotions', magicLimiter, express.raw({ type: '*/*' }), ctrl.getPromotions);
router.post('/promotions/apply', magicLimiter, express.raw({ type: '*/*' }), ctrl.applyPromotion);

// Magic Checkout abandoned-cart webhook (same secret as shipping-info).
router.get('/abandoned', ctrl.abandonedHealth);
router.post('/abandoned', magicLimiter, express.raw({ type: '*/*' }), ctrl.abandonedCheckout);

module.exports = router;
