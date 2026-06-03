const prisma = require('../config/db');

// Returns a list of { product, quantity, subtotalInPaise } for either an
// authenticated user (DB-backed cart) or a guest (session-backed cart).
async function loadCart(req) {
  if (req.user) {
    const items = await prisma.cartItem.findMany({
      where: { userId: req.user.id },
      include: { product: { include: { images: { take: 1, orderBy: { sortOrder: 'asc' } } } } },
      orderBy: { createdAt: 'asc' },
    });
    return items
      .filter((i) => i.product && i.product.active)
      .map((i) => ({
        productId: i.productId,
        product: i.product,
        quantity: i.quantity,
        subtotalInPaise: i.quantity * i.product.priceInPaise,
      }));
  }
  const guest = req.session.guestCart || [];
  if (!guest.length) return [];
  const products = await prisma.product.findMany({
    where: { id: { in: guest.map((g) => g.productId) }, active: true },
    include: { images: { take: 1, orderBy: { sortOrder: 'asc' } } },
  });
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  return guest
    .filter((g) => byId[g.productId])
    .map((g) => ({
      productId: g.productId,
      product: byId[g.productId],
      quantity: g.quantity,
      subtotalInPaise: g.quantity * byId[g.productId].priceInPaise,
    }));
}

function summarise(items) {
  const subtotal = items.reduce((n, it) => n + it.subtotalInPaise, 0);
  const shipping = subtotal >= 99900 ? 0 : 4900; // free shipping over ₹999, otherwise ₹49
  const total = subtotal + shipping;
  const itemCount = items.reduce((n, it) => n + it.quantity, 0);
  return { subtotalInPaise: subtotal, shippingInPaise: shipping, totalInPaise: total, itemCount };
}

exports.loadCart = loadCart;
exports.summarise = summarise;

exports.view = async (req, res, next) => {
  try {
    const items = await loadCart(req);
    const totals = summarise(items);
    res.render('pages/cart', { title: 'Your cart', items, totals });
  } catch (err) {
    next(err);
  }
};

exports.add = async (req, res, next) => {
  try {
    const { productId, quantity = 1 } = req.body;
    const qty = Math.max(1, Math.min(99, parseInt(quantity, 10) || 1));
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product || !product.active) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (req.user) {
      await prisma.cartItem.upsert({
        where: { userId_productId: { userId: req.user.id, productId } },
        update: { quantity: { increment: qty } },
        create: { userId: req.user.id, productId, quantity: qty },
      });
    } else {
      req.session.guestCart = req.session.guestCart || [];
      const existing = req.session.guestCart.find((g) => g.productId === productId);
      if (existing) existing.quantity = Math.min(99, existing.quantity + qty);
      else req.session.guestCart.push({ productId, quantity: qty });
    }

    if (req.accepts('json') && req.xhr) {
      const items = await loadCart(req);
      return res.json({ ok: true, cartCount: summarise(items).itemCount });
    }
    req.flash('success', `${product.name} added to cart.`);
    // Prefer the Referer (origin-checked) so the user lands back on the page
    // they were browsing; otherwise send them to the cart.
    const ref = req.get('Referer') || '';
    const host = req.get('Host') || '';
    const sameHost = ref && new URL(ref, `http://${host}`).host === host;
    res.redirect(sameHost ? ref : '/cart');
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const qty = Math.max(0, Math.min(99, parseInt(req.body.quantity, 10) || 0));
    if (req.user) {
      if (qty === 0) {
        await prisma.cartItem.deleteMany({ where: { userId: req.user.id, productId } });
      } else {
        await prisma.cartItem.upsert({
          where: { userId_productId: { userId: req.user.id, productId } },
          update: { quantity: qty },
          create: { userId: req.user.id, productId, quantity: qty },
        });
      }
    } else {
      req.session.guestCart = (req.session.guestCart || []).filter((g) => g.productId !== productId);
      if (qty > 0) req.session.guestCart.push({ productId, quantity: qty });
    }
    res.redirect('/cart');
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const { productId } = req.params;
    if (req.user) {
      await prisma.cartItem.deleteMany({ where: { userId: req.user.id, productId } });
    } else {
      req.session.guestCart = (req.session.guestCart || []).filter((g) => g.productId !== productId);
    }
    res.redirect('/cart');
  } catch (err) {
    next(err);
  }
};
