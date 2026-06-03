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

module.exports = router;
