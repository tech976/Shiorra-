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

module.exports = router;
