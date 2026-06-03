const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const env = require('../config/env');
const ctrl = require('../controllers/adminController');
const { isAdmin } = require('../middleware/auth');

const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: env.upload.maxMb * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpe?g|png|webp|gif|avif)$/i.test(file.mimetype)) {
      return cb(new Error('Only image uploads are allowed.'));
    }
    cb(null, true);
  },
});

const router = express.Router();

router.use(isAdmin);

router.get('/', ctrl.dashboard);

// Products
router.get('/products', ctrl.productList);
router.get('/products/new', ctrl.productNew);
router.post('/products', upload.array('images', 8), ctrl.productCreate);
router.get('/products/:id/edit', ctrl.productEdit);
router.post('/products/:id', upload.array('images', 8), ctrl.productUpdate);
router.post('/products/:id/stock', ctrl.productQuickStock);
router.post('/products/:id/toggle-active', ctrl.productToggleActive);
router.delete('/products/:id', ctrl.productDelete);
router.delete('/products/:productId/images/:imageId', ctrl.imageDelete);

// Orders
router.get('/orders', ctrl.orderList);
router.get('/orders.csv', ctrl.orderExportCsv);
router.post('/orders/bulk', ctrl.orderBulk);
router.get('/orders/:id', ctrl.orderDetail);
router.get('/orders/:id/invoice', ctrl.orderInvoice);
router.post('/orders/:id/status', ctrl.orderUpdateStatus);
router.post('/orders/:id/notes', ctrl.orderUpdateNotes);

// Users
router.get('/users', ctrl.userList);
router.get('/users/:id', ctrl.userDetail);
router.post('/users/:id', ctrl.userUpdate);
router.post('/users/:id/toggle-role', ctrl.userToggleRole);

// Coupons
router.get('/coupons', ctrl.couponList);
router.get('/coupons/new', ctrl.couponNew);
router.post('/coupons', ctrl.couponCreate);
router.get('/coupons/:id/edit', ctrl.couponEdit);
router.post('/coupons/:id', ctrl.couponUpdate);
router.delete('/coupons/:id', ctrl.couponDelete);

// Reports
router.get('/reports', ctrl.reports);
router.get('/reports.csv', ctrl.reportsCsv);

module.exports = router;
