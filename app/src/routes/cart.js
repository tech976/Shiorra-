const express = require('express');
const ctrl = require('../controllers/cartController');

const router = express.Router();

router.get('/', ctrl.view);
router.post('/add', ctrl.add);
router.post('/coupon', ctrl.applyCoupon);
router.post('/coupon/remove', ctrl.removeCoupon);
router.post('/items/:productId', ctrl.update);
router.delete('/items/:productId', ctrl.remove);

module.exports = router;
