// Thin JSON API for client-side use (cart count badge updates etc.)
const express = require('express');
const prisma = require('../config/db');
const cartCtrl = require('../controllers/cartController');

const router = express.Router();

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role } });
});

router.get('/cart', async (req, res, next) => {
  try {
    const items = await cartCtrl.loadCart(req);
    const coupon = await cartCtrl.resolveSessionCoupon(req);
    const totals = cartCtrl.summarise(items, coupon);
    res.json({
      items: items.map((it) => ({
        productId: it.productId,
        name: it.product.name,
        priceInPaise: it.product.priceInPaise,
        quantity: it.quantity,
        subtotalInPaise: it.subtotalInPaise,
        image: it.product.images?.[0]?.url || null,
      })),
      totals,
      coupon: coupon ? { code: coupon.code, type: coupon.type, value: coupon.value } : null,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/products', async (req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      where: { active: true },
      include: { images: { take: 1, orderBy: { sortOrder: 'asc' } } },
      orderBy: [{ featured: 'desc' }, { name: 'asc' }],
    });
    res.json({ products });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
