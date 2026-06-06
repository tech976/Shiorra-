const express = require('express');
const ctrl = require('../controllers/accountController');
const { isAuthenticated } = require('../middleware/auth');

const router = express.Router();

router.use(isAuthenticated);

router.get('/', ctrl.dashboard);
router.post('/profile', ctrl.updateProfile);
router.post('/password', ctrl.changePassword);
router.get('/orders', ctrl.orders);
router.get('/orders/:orderNumber', ctrl.orderDetail);
router.get('/orders/:orderNumber/invoice', ctrl.orderInvoice);

router.get('/addresses', ctrl.addresses);
router.get('/addresses/new', ctrl.addressNew);
router.post('/addresses', ctrl.addressCreate);
router.get('/addresses/:id/edit', ctrl.addressEdit);
router.post('/addresses/:id', ctrl.addressUpdate);
router.post('/addresses/:id/default', ctrl.addressSetDefault);
router.delete('/addresses/:id', ctrl.addressDelete);

module.exports = router;
