const prisma = require('../config/db');

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

function computeDiscount(coupon, subtotal) {
  if (!coupon || !coupon.active) return 0;
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) return 0;
  if (coupon.minSubtotal && subtotal < coupon.minSubtotal) return 0;
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) return 0;
  if (coupon.type === 'FIXED') return Math.min(subtotal, coupon.value);
  if (coupon.type === 'PERCENT') return Math.floor((subtotal * coupon.value) / 100);
  return 0;
}

async function resolveSessionCoupon(req) {
  const code = req.session?.couponCode;
  if (!code) return null;
  const coupon = await prisma.coupon.findUnique({ where: { code } });
  if (!coupon) {
    delete req.session.couponCode;
    return null;
  }
  return coupon;
}

// Multi-pack bundle pricing (buy-more-save-more). Keyed by product slug →
// { quantity: total price in paise for that many units }. The saving is applied
// as a real discount (shown as a line, flows to the order + payment total), so
// the displayed pack price always equals what the customer is actually charged.
const BUNDLE_PRICES = {
  'advanced-iron': { 2: 134900, 3: 189900 }, // ₹1,349 (60d) · ₹1,899 (90d)
};

// Total bundle saving across the cart = sum of (unit×qty − bundle price) for any
// line whose quantity matches a defined bundle tier for that product.
function computeBundleDiscount(items) {
  let d = 0;
  for (const it of items) {
    const tiers = it.product && BUNDLE_PRICES[it.product.slug];
    const target = tiers && tiers[it.quantity];
    if (target != null) {
      const gross = it.quantity * it.product.priceInPaise;
      if (gross > target) d += gross - target;
    }
  }
  return d;
}

function summarise(items, coupon) {
  const subtotal = items.reduce((n, it) => n + it.subtotalInPaise, 0);
  const shipping = subtotal >= 99900 ? 0 : 4900;
  const discount = computeDiscount(coupon, subtotal) + computeBundleDiscount(items);
  const total = Math.max(0, subtotal + shipping - discount);
  const itemCount = items.reduce((n, it) => n + it.quantity, 0);
  return {
    subtotalInPaise: subtotal,
    shippingInPaise: shipping,
    discountInPaise: discount,
    totalInPaise: total,
    itemCount,
  };
}

exports.loadCart = loadCart;
exports.summarise = summarise;
exports.resolveSessionCoupon = resolveSessionCoupon;
exports.computeDiscount = computeDiscount;

// ---- Mini-cart (slide-out drawer) JSON API ---------------------------------
const FREE_SHIP_THRESHOLD = 99900; // ₹999 — keep in sync with summarise()

// Everything the drawer needs to render itself, in one payload.
async function cartPayload(req) {
  const items = await loadCart(req);
  const coupon = await resolveSessionCoupon(req);
  const totals = summarise(items, coupon);
  return {
    ok: true,
    cartCount: totals.itemCount,
    items: items.map((it) => ({
      productId: it.productId,
      slug: it.product.slug,
      name: it.product.name,
      image: it.product.images && it.product.images[0] ? it.product.images[0].url : null,
      priceInPaise: it.product.priceInPaise,
      quantity: it.quantity,
      subtotalInPaise: it.subtotalInPaise,
    })),
    totals,
    freeShipThreshold: FREE_SHIP_THRESHOLD,
    freeShipRemaining: Math.max(0, FREE_SHIP_THRESHOLD - totals.subtotalInPaise),
  };
}

// The drawer sends X-Requested-With: XMLHttpRequest (→ req.xhr) + Accept JSON.
function wantsCartJson(req) {
  return req.xhr && !!req.accepts('json');
}

// GET /cart/data — current cart as JSON (used to hydrate the drawer on open).
exports.json = async (req, res, next) => {
  try {
    res.json(await cartPayload(req));
  } catch (err) {
    next(err);
  }
};

// Merge a guest's session cart into a freshly-logged-in user's database cart.
// Called from authController.login + authController.register so items added
// while logged-out aren't stranded after sign-in.
//
// IMPORTANT: passport 0.7's req.logIn regenerates the session, which wipes
// req.session.guestCart BEFORE this runs. So the caller must capture the cart
// array *before* req.logIn and pass it in here — we no longer read it back off
// the (now-empty) session.
async function mergeGuestCart(userId, guestCart) {
  const guest = Array.isArray(guestCart) ? guestCart : [];
  if (!guest.length) return;
  for (const g of guest) {
    try {
      await prisma.cartItem.upsert({
        where: { userId_productId: { userId, productId: g.productId } },
        update: { quantity: { increment: g.quantity } },
        create: { userId, productId: g.productId, quantity: g.quantity },
      });
    } catch (_) { /* product deleted while in session — skip silently */ }
  }
}
exports.mergeGuestCart = mergeGuestCart;

exports.view = async (req, res, next) => {
  try {
    const items = await loadCart(req);
    const coupon = await resolveSessionCoupon(req);
    const totals = summarise(items, coupon);
    res.render('pages/cart', { title: 'Your cart', items, totals, coupon });
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

    if (wantsCartJson(req)) {
      return res.json(await cartPayload(req));
    }
    req.flash('success', `${product.name} added to cart.`);
    const ref = req.get('Referer') || '';
    const host = req.get('Host') || '';
    const sameHost = ref && new URL(ref, `http://${host}`).host === host;
    res.redirect(sameHost ? ref : '/cart');
  } catch (err) {
    next(err);
  }
};

// "Buy now" shortcut: identical to .add but skips the cart page and goes
// straight to /checkout. For guests, sets returnTo so they land on
// /checkout after sign-in (cart preserved by mergeGuestCart).
exports.buyNow = async (req, res, next) => {
  try {
    const { productId, quantity = 1 } = req.body;
    const qty = Math.max(1, Math.min(99, parseInt(quantity, 10) || 1));
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product || !product.active) {
      req.flash('error', 'Product not found.');
      return res.redirect('/shop');
    }
    if (req.user) {
      await prisma.cartItem.upsert({
        where: { userId_productId: { userId: req.user.id, productId } },
        update: { quantity: { increment: qty } },
        create: { userId: req.user.id, productId, quantity: qty },
      });
      return res.redirect('/checkout');
    }
    // Guest: keep the item in the session cart and go straight to checkout.
    // Guest checkout is supported, so we no longer bounce them to /login.
    req.session.guestCart = req.session.guestCart || [];
    const existing = req.session.guestCart.find((g) => g.productId === productId);
    if (existing) existing.quantity = Math.min(99, existing.quantity + qty);
    else req.session.guestCart.push({ productId, quantity: qty });
    res.redirect('/checkout');
  } catch (err) { next(err); }
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
    if (wantsCartJson(req)) {
      return res.json(await cartPayload(req));
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
    if (wantsCartJson(req)) {
      return res.json(await cartPayload(req));
    }
    res.redirect('/cart');
  } catch (err) {
    next(err);
  }
};

exports.applyCoupon = async (req, res, next) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) {
      req.flash('error', 'Enter a coupon code.');
      return res.redirect('/cart');
    }
    const coupon = await prisma.coupon.findUnique({ where: { code } });
    if (!coupon || !coupon.active) {
      req.flash('error', `Coupon "${code}" is not valid.`);
      return res.redirect('/cart');
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
      req.flash('error', `Coupon "${code}" has expired.`);
      return res.redirect('/cart');
    }
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      req.flash('error', `Coupon "${code}" has reached its usage limit.`);
      return res.redirect('/cart');
    }
    // Validate min subtotal against current cart
    const items = await loadCart(req);
    const subtotal = items.reduce((n, it) => n + it.subtotalInPaise, 0);
    if (coupon.minSubtotal && subtotal < coupon.minSubtotal) {
      req.flash(
        'error',
        `Coupon "${code}" needs a minimum subtotal of ₹${(coupon.minSubtotal / 100).toFixed(0)}.`
      );
      return res.redirect('/cart');
    }
    req.session.couponCode = coupon.code;
    req.flash('success', `Coupon "${code}" applied.`);
    res.redirect('/cart');
  } catch (err) {
    next(err);
  }
};

exports.removeCoupon = (req, res) => {
  delete req.session.couponCode;
  req.flash('success', 'Coupon removed.');
  res.redirect('/cart');
};
