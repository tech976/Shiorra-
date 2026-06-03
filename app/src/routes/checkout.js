const express = require('express');
const ctrl = require('../controllers/checkoutController');
const { isAuthenticated } = require('../middleware/auth');

const router = express.Router();

router.get('/', isAuthenticated, ctrl.showCheckout);
router.post('/create-order', isAuthenticated, ctrl.createOrder);
router.post('/cod', isAuthenticated, ctrl.placeCod);
router.post('/verify', isAuthenticated, ctrl.verifyPayment);
router.get('/success/:orderNumber', isAuthenticated, ctrl.success);

// Razorpay webhook expects raw body — register before json/urlencoded for this path
router.post('/webhook', express.raw({ type: '*/*' }), ctrl.webhook);

module.exports = router;
