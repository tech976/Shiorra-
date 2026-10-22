const express = require('express');
const ctrl = require('../controllers/checkoutController');

const router = express.Router();

// Guest checkout: none of these require an account. Logged-in users still get
// their saved addresses + order history; guests are identified by their
// session (see req.session.guestOrders for success-page access).
router.get('/', ctrl.showCheckout);
router.post('/create-order', ctrl.createOrder);
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
router.post('/shipping-info', express.raw({ type: '*/*' }), ctrl.shippingInfo);

module.exports = router;
