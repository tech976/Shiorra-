const crypto = require('crypto');
const { z } = require('zod');
const prisma = require('../config/db');
const env = require('../config/env');
const { getRazorpay } = require('../config/razorpay');
const cartController = require('./cartController');
const { generateOrderNumber } = require('../utils/orderNumber');
const mailer = require('../utils/mailer');

const addressSchema = z.object({
  fullName: z.string().min(2).max(80),
  phone: z.string().min(7).max(20),
  line1: z.string().min(2).max(160),
  line2: z.string().max(160).optional().or(z.literal('')),
  city: z.string().min(2).max(80),
  state: z.string().min(2).max(80),
  postcode: z.string().min(4).max(12),
  country: z.string().min(2).max(60).default('India'),
});

const guestEmailSchema = z.string().email().max(160);

// Constant-time hex-signature compare. Returns false on any length/format
// mismatch instead of throwing (timingSafeEqual requires equal-length buffers).
function signaturesMatch(expectedHex, actualHex) {
  if (typeof expectedHex !== 'string' || typeof actualHex !== 'string') return false;
  const a = Buffer.from(expectedHex, 'utf8');
  const b = Buffer.from(actualHex, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Guests have no account, so we need an email to send the receipt to and to
// prefill Razorpay. Logged-in users already have one on their account.
// Returns { email } or { error }.
function resolveContactEmail(req) {
  if (req.user) return { email: req.user.email };
  const raw = (req.body.guestEmail || req.body.email || '').trim();
  const parsed = guestEmailSchema.safeParse(raw);
  if (!parsed.success) return { error: 'Please enter a valid email address.' };
  return { email: parsed.data };
}

// A guest can't be looked up by userId, so remember which orders belong to
// this session — that's what gates access to the success page.
function rememberGuestOrder(req, orderNumber) {
  if (req.user) return;
  req.session.guestOrders = req.session.guestOrders || [];
  if (!req.session.guestOrders.includes(orderNumber)) {
    req.session.guestOrders.push(orderNumber);
  }
}

// Mark a Razorpay order captured EXACTLY ONCE, decrementing stock in the same
// transaction. callback and webhook may both fire for one payment, so the
// paymentStatus check inside the transaction makes this idempotent — stock is
// decremented on the first capture only, never twice.
// Returns { notFound } | { alreadyCaptured, order } | { captured, order }.
async function captureOrder({ razorpayOrderId, paymentId, signature }) {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { razorpayOrderId },
      include: { items: true },
    });
    if (!order) return { notFound: true };
    if (order.paymentStatus === 'CAPTURED') return { alreadyCaptured: true, order };

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        paymentStatus: 'CAPTURED',
        razorpayPaymentId: paymentId,
        ...(signature ? { razorpaySignature: signature } : {}),
      },
    });
    // Decrement stock now — the paid path previously never did this, so online
    // orders oversold indefinitely. COD still decrements at order creation.
    for (const it of order.items) {
      if (!it.productId) continue;
      await tx.product.update({
        where: { id: it.productId },
        data: { stock: { decrement: it.quantity } },
      });
    }
    return { captured: true, order };
  });

  // Send the confirmation exactly once — only on the first capture. Callback
  // and webhook both funnel through here, but alreadyCaptured returns above,
  // so this never double-sends. Fire-and-forget: mail must not fail payment.
  if (result.captured) {
    // A Magic Checkout order has no address until Razorpay hands one back.
    // Fill it in first so the confirmation shows where the parcel is going.
    if (!result.order.shippingAddressId) {
      await syncMagicAddress(result.order);
    }
    mailer.sendOrderConfirmation(result.order.id).catch(() => {});
  }
  return result;
}

// Logged-in carts live in the DB; guest carts live in the session.
async function clearCart(req) {
  if (req.user) {
    await prisma.cartItem.deleteMany({ where: { userId: req.user.id } });
  } else {
    delete req.session.guestCart;
  }
}

exports.showCheckout = async (req, res, next) => {
  try {
    const items = await cartController.loadCart(req);
    if (!items.length) {
      req.flash('info', 'Your cart is empty.');
      return res.redirect('/cart');
    }
    const coupon = await cartController.resolveSessionCoupon(req);
    const totals = cartController.summarise(items, coupon);
    let addresses = [];
    if (req.user) {
      addresses = await prisma.address.findMany({ where: { userId: req.user.id }, orderBy: { isDefault: 'desc' } });
    }
    res.render('pages/checkout', {
      title: 'Checkout',
      items,
      totals,
      addresses,
      coupon,
      isGuest: !req.user,
      razorpayKeyId: env.razorpay.keyId || '',
      razorpayEnabled: !!(env.razorpay.keyId && env.razorpay.keySecret),
      magicCheckout: env.razorpay.magicCheckout,
    });
  } catch (err) {
    next(err);
  }
};

// POST /checkout/cod — Cash on Delivery checkout (used when Razorpay is not
// configured, OR when the user explicitly picks COD).
exports.placeCod = async (req, res, next) => {
  try {
    const items = await cartController.loadCart(req);
    if (!items.length) {
      req.flash('error', 'Your cart is empty.');
      return res.redirect('/cart');
    }
    const parsed = addressSchema.safeParse(req.body.address || req.body);
    if (!parsed.success) {
      req.flash('error', 'Please complete the shipping address.');
      return res.redirect('/checkout');
    }
    const contact = resolveContactEmail(req);
    if (contact.error) {
      req.flash('error', contact.error);
      return res.redirect('/checkout');
    }
    const addr = parsed.data;
    const coupon = await cartController.resolveSessionCoupon(req);
    const totals = cartController.summarise(items, coupon);

    const address = await prisma.address.create({
      data: { ...addr, line2: addr.line2 || null, userId: req.user?.id || null },
    });

    const orderNumber = generateOrderNumber();
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          orderNumber,
          userId: req.user?.id || null,
          guestEmail: req.user ? null : contact.email,
          shippingAddressId: address.id,
          subtotalInPaise: totals.subtotalInPaise,
          shippingInPaise: totals.shippingInPaise,
          taxInPaise: 0,
          discountInPaise: totals.discountInPaise,
          totalInPaise: totals.totalInPaise,
          status: 'PROCESSING',
          paymentStatus: 'CREATED',
          notes: 'Cash on Delivery',
          couponCode: coupon?.code || null,
          couponId: coupon?.id || null,
          items: {
            create: items.map((it) => ({
              productId: it.productId,
              name: it.product.name,
              priceInPaise: it.product.priceInPaise,
              quantity: it.quantity,
              totalInPaise: it.subtotalInPaise,
            })),
          },
        },
      });
      // Decrement stock atomically
      for (const it of items) {
        await tx.product.update({
          where: { id: it.productId },
          data: { stock: { decrement: it.quantity } },
        });
      }
      if (coupon) {
        await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
      }
      return created;
    });

    await clearCart(req);
    delete req.session.couponCode;
    rememberGuestOrder(req, order.orderNumber);

    // Fire-and-forget: a mail hiccup must never fail a placed order.
    mailer.sendOrderConfirmation(order.id).catch(() => {});

    req.flash('success', `Order ${order.orderNumber} placed — pay on delivery.`);
    res.redirect(`/checkout/success/${order.orderNumber}`);
  } catch (err) {
    next(err);
  }
};

// POST /checkout/create-order
// Creates the local Order (PENDING) + an associated Razorpay order, returns
// the data the Razorpay Checkout JS modal needs to open.
exports.createOrder = async (req, res, next) => {
  try {
    const items = await cartController.loadCart(req);
    if (!items.length) return res.status(400).json({ error: 'Cart is empty.' });

    const parsed = addressSchema.safeParse(req.body.address || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid shipping address.', issues: parsed.error.issues });
    }
    const contact = resolveContactEmail(req);
    if (contact.error) return res.status(400).json({ error: contact.error });
    const addr = parsed.data;
    const coupon = await cartController.resolveSessionCoupon(req);
    const totals = cartController.summarise(items, coupon);

    const rzp = getRazorpay();
    if (!rzp) {
      return res.status(500).json({ error: 'Payment gateway not configured. Add Razorpay keys to .env.' });
    }
    // Razorpay rejects anything under 100 paise (₹1) — fail fast with a clear message.
    if (totals.totalInPaise < 100) {
      return res.status(400).json({ error: 'Order total must be at least ₹1.' });
    }

    // Save the address (userId null for guests — not added to any address book)
    const address = await prisma.address.create({
      data: { ...addr, line2: addr.line2 || null, userId: req.user?.id || null },
    });

    // Create Razorpay order
    const orderNumber = generateOrderNumber();
    const rzpOrder = await rzp.orders.create({
      amount: totals.totalInPaise,
      currency: 'INR',
      receipt: orderNumber,
      notes: { orderNumber, userId: req.user?.id || 'guest', email: contact.email },
    });

    // Persist local order in a transaction so items + order are atomic
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          orderNumber,
          userId: req.user?.id || null,
          guestEmail: req.user ? null : contact.email,
          shippingAddressId: address.id,
          subtotalInPaise: totals.subtotalInPaise,
          shippingInPaise: totals.shippingInPaise,
          taxInPaise: 0,
          discountInPaise: totals.discountInPaise,
          totalInPaise: totals.totalInPaise,
          razorpayOrderId: rzpOrder.id,
          couponCode: coupon?.code || null,
          couponId: coupon?.id || null,
          items: {
            create: items.map((it) => ({
              productId: it.productId,
              name: it.product.name,
              priceInPaise: it.product.priceInPaise,
              quantity: it.quantity,
              totalInPaise: it.subtotalInPaise,
            })),
          },
        },
      });
      if (coupon) {
        await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
      }
      return created;
    });
    if (coupon) delete req.session.couponCode;
    rememberGuestOrder(req, order.orderNumber);

    res.json({
      ok: true,
      key: env.razorpay.keyId,
      amount: totals.totalInPaise,
      currency: 'INR',
      orderId: rzpOrder.id,
      orderNumber: order.orderNumber,
      name: 'Shiorra',
      description: `Order ${order.orderNumber}`,
      prefill: {
        name: req.user?.name || addr.fullName,
        email: contact.email,
        contact: addr.phone,
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /checkout/create-magic-order
//
// Magic Checkout (1CC) inverts the normal flow: we do NOT collect an address
// here — Razorpay gathers it (prefilled from their network, which is the whole
// speed benefit) and hands it back after payment, where syncMagicAddress
// persists it. So the order is created address-less and its shipping is
// settled on capture.
//
// The order amount is the GOODS total only. Razorpay adds shipping itself from
// whatever /checkout/shipping-info quotes, and applies coupons through the
// promotions APIs — so pre-applying a session coupon here would double-count.
exports.createMagicOrder = async (req, res, next) => {
  try {
    if (!env.razorpay.magicCheckout) {
      return res.status(400).json({ error: 'Magic Checkout is not enabled.' });
    }
    const items = await cartController.loadCart(req);
    if (!items.length) return res.status(400).json({ error: 'Cart is empty.' });

    const rzp = getRazorpay();
    if (!rzp) return res.status(500).json({ error: 'Payment gateway not configured.' });

    const goodsTotal = items.reduce((n, it) => n + it.subtotalInPaise, 0);
    if (goodsTotal < 100) return res.status(400).json({ error: 'Order total must be at least Rs1.' });

    const origin = `${req.protocol}://${req.get('host')}`;
    const lineItems = items.map((it) => ({
      type: 'e-commerce',
      sku: it.product.slug,
      variant_id: it.product.id,
      price: it.product.priceInPaise,
      offer_price: it.product.priceInPaise,
      tax_amount: 0,
      quantity: it.quantity,
      name: it.product.name,
      description: it.product.tagline || it.product.name,
      image_url: it.product.images?.[0]?.url ? `${origin}${it.product.images[0].url}` : undefined,
    }));

    const orderNumber = generateOrderNumber();
    const rzpOrder = await rzp.orders.create({
      amount: goodsTotal,
      currency: 'INR',
      receipt: orderNumber,
      line_items_total: goodsTotal,
      line_items: lineItems,
      // NOTE: no one_click_checkout flag — Razorpay rejects it with
      // "not required and should not be sent" on this account, because Magic
      // Checkout is switched on account-side. Sending line_items is what
      // makes this a 1CC order.
      notes: { orderNumber, userId: req.user?.id || 'guest', magic: 'true' },
    });

    // Address and final shipping are unknown until Razorpay returns them, so
    // the row starts address-less with shipping 0 and is reconciled on capture.
    const order = await prisma.$transaction(async (tx) => tx.order.create({
      data: {
        orderNumber,
        userId: req.user?.id || null,
        guestEmail: null,
        subtotalInPaise: goodsTotal,
        shippingInPaise: 0,
        taxInPaise: 0,
        discountInPaise: 0,
        totalInPaise: goodsTotal,
        razorpayOrderId: rzpOrder.id,
        items: {
          create: items.map((it) => ({
            productId: it.productId,
            name: it.product.name,
            priceInPaise: it.product.priceInPaise,
            quantity: it.quantity,
            totalInPaise: it.subtotalInPaise,
          })),
        },
      },
    }));
    rememberGuestOrder(req, order.orderNumber);

    return res.json({
      ok: true,
      magic: true,
      key: env.razorpay.keyId,
      amount: goodsTotal,
      currency: 'INR',
      orderId: rzpOrder.id,
      orderNumber: order.orderNumber,
      name: 'Shiorra',
      description: `Order ${order.orderNumber}`,
    });
  } catch (err) {
    console.error('[magic-order] failed:', err?.error?.description || err?.message || err);
    return next(err);
  }
};

// After a Magic Checkout payment, Razorpay holds the address the customer
// entered. Persist it and settle the money fields, which were provisional at
// order creation (goods only, no shipping). Never throws into the payment
// path: a failure here must not turn a captured payment into an error.
async function syncMagicAddress(order) {
  try {
    if (!order?.razorpayOrderId || order.shippingAddressId) return;
    const rzp = getRazorpay();
    if (!rzp) return;
    const remote = await rzp.orders.fetch(order.razorpayOrderId);
    const c = remote?.customer_details;
    const s = c?.shipping_address || c?.billing_address;
    if (!s) return;

    const address = await prisma.address.create({
      data: {
        userId: order.userId || null,
        fullName: c.name || s.name || 'Customer',
        phone: c.contact || s.contact || '',
        line1: s.line1 || s.address || '',
        line2: s.line2 || null,
        city: s.city || '',
        state: s.state || '',
        postcode: s.zipcode || s.postal_code || '',
        country: s.country || 'India',
      },
    });

    // Razorpay's amount is what was actually charged (goods + shipping, less
    // any promotion). Trust it over our provisional figure.
    const paid = typeof remote.amount === 'number' ? remote.amount : order.totalInPaise;
    const shipping = Math.max(0, paid - order.subtotalInPaise + (order.discountInPaise || 0));

    await prisma.order.update({
      where: { id: order.id },
      data: {
        shippingAddressId: address.id,
        guestEmail: order.userId ? null : (c.email || order.guestEmail),
        shippingInPaise: shipping,
        totalInPaise: paid,
      },
    });
    console.log(`[magic-order] address synced for ${order.orderNumber} (paid ${paid})`);
  } catch (err) {
    console.error('[magic-order] address sync failed:', err?.error?.description || err?.message || err);
  }
}

// POST /checkout/verify
// Called by the client after Razorpay Checkout returns. Verifies the
// signature and marks the order PAID. Webhook is the source of truth — this
// is just the optimistic update for the success page.
exports.verifyPayment = async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment fields.' });
    }
    const expected = crypto
      .createHmac('sha256', env.razorpay.keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (!signaturesMatch(expected, razorpay_signature)) {
      return res.status(400).json({ error: 'Invalid signature.' });
    }

    // Route through captureOrder so this path also decrements stock, sends the
    // confirmation email, and stays idempotent vs the callback/webhook.
    const result = await captureOrder({
      razorpayOrderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });
    if (result.notFound) return res.status(404).json({ error: 'Order not found.' });
    const order = result.order;

    // Empty the cart (DB cart for users, session cart for guests)
    await clearCart(req);
    rememberGuestOrder(req, order.orderNumber);

    res.json({ ok: true, redirect: `/checkout/success/${order.orderNumber}` });
  } catch (err) {
    next(err);
  }
};

// POST /checkout/callback
// Razorpay posts here after payment because we set callback_url. This is far
// more reliable than the JS handler alone: the handler needs to message the
// parent window, which silently fails when 3-D Secure opens in a separate tab
// (and on some mobile / UPI-intent flows). Symptom was a "payment succeeded"
// screen on Razorpay's side while our order stayed PENDING forever.
exports.paymentCallback = async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Razorpay posts error[...] fields here when the payment fails.
    if (req.body.error || req.body['error[code]']) {
      const desc = req.body['error[description]'] || 'Payment failed.';
      req.flash('error', `${desc} If any money was debited it will be refunded automatically.`);
      return res.redirect('/checkout');
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      req.flash('error', 'Payment could not be confirmed. Please try again.');
      return res.redirect('/checkout');
    }

    const expected = crypto
      .createHmac('sha256', env.razorpay.keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (!signaturesMatch(expected, razorpay_signature)) {
      req.flash('error', 'Payment verification failed. Please contact support if money was debited.');
      return res.redirect('/checkout');
    }

    // Marks PAID + decrements stock exactly once (idempotent vs the webhook).
    const result = await captureOrder({
      razorpayOrderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });
    if (result.notFound) {
      req.flash('error', 'Order not found.');
      return res.redirect('/cart');
    }
    const order = result.order;

    await clearCart(req);
    delete req.session.couponCode;
    rememberGuestOrder(req, order.orderNumber);

    res.redirect(`/checkout/success/${order.orderNumber}`);
  } catch (err) {
    next(err);
  }
};

exports.success = async (req, res, next) => {
  try {
    const { orderNumber } = req.params;
    // Logged-in users can only see their own orders. Guests can only see
    // orders created in this session — never someone else's by URL guessing.
    const where = req.user
      ? { orderNumber, userId: req.user.id }
      : { orderNumber, userId: null };

    const isOwnGuestOrder = !req.user && (req.session.guestOrders || []).includes(orderNumber);
    if (!req.user && !isOwnGuestOrder) {
      return res.status(404).render('pages/error', { title: 'Not found', status: 404, message: 'Order not found.' });
    }

    const order = await prisma.order.findFirst({
      where,
      include: { items: true, shippingAddress: true },
    });
    if (!order) return res.status(404).render('pages/error', { title: 'Not found', status: 404, message: 'Order not found.' });
    res.render('pages/order-success', { title: `Order ${order.orderNumber}`, order });
  } catch (err) {
    next(err);
  }
};

// Resolve the goods subtotal for a Razorpay order so shipping can be quoted
// on the same rule the cart uses. Our own row is authoritative; Magic Checkout
// can create the Razorpay order before we persist ours, so fall back to the
// amount Razorpay itself holds.
async function subtotalForRazorpayOrder(rzpOrderId) {
  if (!rzpOrderId) return null;
  const local = await prisma.order.findFirst({
    where: { razorpayOrderId: rzpOrderId },
    select: { subtotalInPaise: true },
  });
  if (local) return local.subtotalInPaise;
  // The client is built per-call (see getRazorpay) — there is no module-level
  // instance to borrow here.
  const rzp = getRazorpay();
  if (!rzp) return null;
  const remote = await rzp.orders.fetch(rzpOrderId);
  return typeof remote?.amount === 'number' ? remote.amount : null;
}

// Shared guard for the Magic Checkout APIs. Razorpay signs each call with
// HMAC-SHA256 over the raw body; these endpoints decide what a customer is
// charged, so an unverifiable request is never honoured. Returns the parsed
// body, or null after it has already answered the response.
function verifiedBody(req, res, secret, label) {
  if (!secret) {
    console.error(`[${label}] secret is not set - rejecting.`);
    res.status(503).json({ error: 'Not configured.' });
    return null;
  }
  const signature = req.headers['x-razorpay-signature'];
  if (!signature) {
    res.status(400).json({ error: 'Missing signature' });
    return null;
  }
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''));
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  if (!signaturesMatch(expected, signature)) {
    res.status(400).json({ error: 'Invalid signature' });
    return null;
  }
  try {
    const body = JSON.parse(raw.toString('utf8') || '{}');
    // Keep the first live payloads visible so the real contract can be
    // checked against what Razorpay actually sends.
    console.log(`[${label}] payload:`, raw.toString('utf8').slice(0, 600));
    return body;
  } catch (_) {
    res.status(400).json({ error: 'Malformed JSON' });
    return null;
  }
}

// Is this coupon usable right now, for this cart value?
function couponUsable(c, subtotal) {
  if (!c.active) return false;
  if (c.expiresAt && new Date(c.expiresAt) < new Date()) return false;
  if (c.usageLimit && c.usedCount >= c.usageLimit) return false;
  if (c.minSubtotal && subtotal < c.minSubtotal) return false;
  return true;
}

// Describe a coupon in the shape Magic Checkout renders.
function promotionPayload(c, subtotal) {
  const value = cartController.computeDiscount(c, subtotal);
  return {
    reference_id: c.id,
    code: c.code,
    summary: c.type === 'PERCENT' ? `${c.value}% off` : `Flat off`,
    description: c.notes || (c.type === 'PERCENT' ? `${c.value}% off your order` : 'Discount applied'),
    value,                       // always paise, already resolved for this cart
    value_type: 'fixed_amount',
    tags: [],
  };
}

// GET /checkout/promotions — health only (the real APIs are POST).
exports.promotionsHealth = (req, res) =>
  res.json({ ok: true, endpoint: 'promotions', method: 'POST' });

// POST /checkout/promotions
// Razorpay asks which coupons to offer this customer. With no usable coupon
// it must still answer 200 with an empty list — an error here stalls checkout.
exports.getPromotions = async (req, res) => {
  const body = verifiedBody(req, res, env.razorpay.promoSecret, 'promotions');
  if (!body) return;
  try {
    let subtotal = 0;
    try { subtotal = (await subtotalForRazorpayOrder(body.order_id)) || 0; } catch (_) {}
    const coupons = await prisma.coupon.findMany({ where: { active: true } });
    const promotions = coupons
      .filter((c) => couponUsable(c, subtotal))
      .map((c) => promotionPayload(c, subtotal))
      // Never offer a coupon that takes nothing off — a "10% off" chip that
      // applies Rs0 reads as broken. Happens when the cart value is unknown.
      .filter((p) => p.value > 0);
    return res.json({ promotions });
  } catch (err) {
    console.error('[promotions] failed:', err?.message || err);
    return res.json({ promotions: [] });
  }
};

// POST /checkout/promotions/apply
// Razorpay asks us to validate the code the customer entered. A rejection is
// a normal 200 carrying failure_reason — not an HTTP error.
exports.applyPromotion = async (req, res) => {
  const body = verifiedBody(req, res, env.razorpay.promoSecret, 'promotions/apply');
  if (!body) return;
  const code = String(body.code || body.promotion?.code || '').trim().toUpperCase();
  try {
    if (!code) return res.json({ failure_reason: 'Enter a coupon code.' });

    let subtotal = 0;
    try { subtotal = (await subtotalForRazorpayOrder(body.order_id)) || 0; } catch (_) {}

    const coupon = await prisma.coupon.findUnique({ where: { code } });
    if (!coupon || !coupon.active) {
      return res.json({ failure_reason: `Coupon "${code}" is not valid.` });
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
      return res.json({ failure_reason: `Coupon "${code}" has expired.` });
    }
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      return res.json({ failure_reason: `Coupon "${code}" has reached its usage limit.` });
    }
    if (coupon.minSubtotal && subtotal < coupon.minSubtotal) {
      return res.json({
        failure_reason: `Spend at least Rs${Math.round(coupon.minSubtotal / 100)} to use "${code}".`,
      });
    }
    return res.json({ promotion: promotionPayload(coupon, subtotal) });
  } catch (err) {
    console.error('[promotions/apply] failed:', err?.message || err);
    return res.json({ failure_reason: 'Could not apply that code right now.' });
  }
};

// GET /checkout/shipping-info
//
// Not part of the Razorpay contract — the real work is POST-only. This exists
// so a browser visit, an uptime probe, or a dashboard "is this URL alive?"
// check sees a healthy endpoint instead of a 404 that reads like a dead link.
// Deliberately says nothing about carts, orders or configuration.
exports.shippingInfoHealth = (req, res) =>
  res.json({ ok: true, endpoint: 'shipping-info', method: 'POST' });

// POST /checkout/shipping-info  (raw body)
//
// Razorpay Magic Checkout calls this mid-checkout with the customer's
// address(es) and asks, per address: do you ship there, what does shipping
// cost, and is COD available. Configured in the Razorpay dashboard under
// Magic Checkout -> Platform Settings -> "URL for shipping info".
//
// Signed exactly like the payment webhook: HMAC-SHA256 of the raw body in
// X-Razorpay-Signature, keyed with the "Enable Secret Key" value.
//
// SERVICEABILITY is currently "any valid Indian PIN code". When the Delhivery
// account is live, that single check is the only thing to swap for a real
// pincode lookup — the request/response contract is unchanged, so nothing
// needs re-editing in the Razorpay dashboard.
exports.shippingInfo = async (req, res) => {
  // FAIL CLOSED. Without the secret the HMAC key would be "" and anyone could
  // forge a request — and this endpoint sets what the customer is charged.
  if (!env.razorpay.shippingSecret) {
    console.error('[shipping-info] RAZORPAY_SHIPPING_SECRET is not set - rejecting.');
    return res.status(503).json({ error: 'Shipping info not configured.' });
  }
  const signature = req.headers['x-razorpay-signature'];
  if (!signature) return res.status(400).json({ error: 'Missing signature' });

  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''));
  const expected = crypto
    .createHmac('sha256', env.razorpay.shippingSecret)
    .update(raw)
    .digest('hex');
  if (!signaturesMatch(expected, signature)) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let body;
  try {
    body = JSON.parse(raw.toString('utf8') || '{}');
  } catch (_) {
    return res.status(400).json({ error: 'Malformed JSON' });
  }

  // Keep the first live payloads visible so the real contract can be checked
  // against what Razorpay actually sends, then this line can go.
  console.log('[shipping-info] payload:', raw.toString('utf8').slice(0, 800));

  // A lookup failure must not block checkout — fall back to the flat rate
  // rather than refusing to quote.
  let subtotal = null;
  try {
    subtotal = await subtotalForRazorpayOrder(body.order_id);
  } catch (err) {
    console.error('[shipping-info] subtotal lookup failed:',
      err?.message || err?.error?.description || JSON.stringify(err)?.slice(0, 200) || err);
  }
  const fee = subtotal == null
    ? cartController.shippingFor(0)            // unknown cart -> charge the flat rate
    : cartController.shippingFor(subtotal);

  const addresses = Array.isArray(body.addresses) ? body.addresses : [];
  const out = addresses.map((a) => {
    const zip = String(a.zipcode || a.postal_code || a.pincode || '').trim();
    const country = String(a.country || 'in').toLowerCase();
    // International shipping is off in the dashboard and we hold no overseas
    // rates, so: India only, and a real 6-digit PIN (never starts with 0).
    const serviceable = (country === 'in' || country === 'india') && /^[1-9][0-9]{5}$/.test(zip);
    return {
      id: a.id,
      zipcode: zip,
      serviceable,
      shipping_fee: serviceable ? fee : 0,
      cod: serviceable,
      cod_fee: 0,
    };
  });

  return res.json({ addresses: out });
};

// POST /checkout/webhook  (raw body)
// Razorpay calls this. Verifies HMAC with the webhook secret. Used as source
// of truth for payment status. We store the event id so retries are idempotent.
exports.webhook = async (req, res, next) => {
  try {
    // FAIL CLOSED. With no webhook secret configured, the HMAC key would be ""
    // and any attacker could forge a valid signature — a verified free-order
    // exploit. Never accept a webhook we cannot cryptographically verify.
    if (!env.razorpay.webhookSecret) {
      console.error('[webhook] RAZORPAY_WEBHOOK_SECRET is not set — rejecting webhook.');
      return res.status(503).json({ error: 'Webhook not configured.' });
    }
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) return res.status(400).json({ error: 'Missing signature' });
    const raw = req.body;
    const expected = crypto
      .createHmac('sha256', env.razorpay.webhookSecret)
      .update(raw)
      .digest('hex');
    if (!signaturesMatch(expected, signature)) return res.status(400).json({ error: 'Invalid signature' });

    const event = JSON.parse(raw.toString('utf8'));
    const eventId = event.id || `${event.event}-${event.created_at}-${event.payload?.payment?.entity?.id || 'na'}`;

    // Idempotency
    const existing = await prisma.paymentEvent.findUnique({ where: { eventId } });
    if (existing && existing.processedAt) return res.json({ ok: true, deduped: true });

    await prisma.paymentEvent.upsert({
      where: { eventId },
      update: { payload: raw.toString('utf8') },
      create: { eventId, payload: raw.toString('utf8') },
    });

    const payment = event.payload?.payment?.entity;
    if (payment) {
      if (event.event === 'payment.captured') {
        // Shared path: marks PAID + decrements stock once (idempotent vs callback).
        await captureOrder({ razorpayOrderId: payment.order_id, paymentId: payment.id });
      } else {
        const order = await prisma.order.findFirst({ where: { razorpayOrderId: payment.order_id } });
        if (order && order.paymentStatus !== 'CAPTURED') {
          const map = {
            'payment.authorized': { paymentStatus: 'AUTHORIZED' },
            'payment.failed': { paymentStatus: 'FAILED', status: 'CANCELLED' },
          };
          const update = map[event.event];
          if (update) {
            await prisma.order.update({
              where: { id: order.id },
              data: { ...update, razorpayPaymentId: payment.id },
            });
          }
        }
      }
    }

    await prisma.paymentEvent.update({ where: { eventId }, data: { processedAt: new Date() } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};
