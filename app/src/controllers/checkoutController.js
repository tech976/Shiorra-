const crypto = require('crypto');
const { z } = require('zod');
const prisma = require('../config/db');
const env = require('../config/env');
const { getRazorpay } = require('../config/razorpay');
const cartController = require('./cartController');
const { generateOrderNumber } = require('../utils/orderNumber');

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

    if (expected !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid signature.' });
    }

    const order = await prisma.order.findFirst({ where: { razorpayOrderId: razorpay_order_id } });
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    await prisma.order.update({
      where: { id: order.id },
      data: {
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
        status: 'PAID',
        paymentStatus: 'CAPTURED',
      },
    });

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

    if (expected !== razorpay_signature) {
      req.flash('error', 'Payment verification failed. Please contact support if money was debited.');
      return res.redirect('/checkout');
    }

    const order = await prisma.order.findFirst({ where: { razorpayOrderId: razorpay_order_id } });
    if (!order) {
      req.flash('error', 'Order not found.');
      return res.redirect('/cart');
    }

    // Idempotent: the webhook may have marked this PAID already.
    if (order.paymentStatus !== 'CAPTURED') {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
          status: 'PAID',
          paymentStatus: 'CAPTURED',
        },
      });
    }

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

// POST /checkout/webhook  (raw body)
// Razorpay calls this. Verifies HMAC with the webhook secret. Used as source
// of truth for payment status. We store the event id so retries are idempotent.
exports.webhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) return res.status(400).json({ error: 'Missing signature' });
    const raw = req.body;
    const expected = crypto
      .createHmac('sha256', env.razorpay.webhookSecret || '')
      .update(raw)
      .digest('hex');
    if (expected !== signature) return res.status(400).json({ error: 'Invalid signature' });

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
      const order = await prisma.order.findFirst({ where: { razorpayOrderId: payment.order_id } });
      if (order) {
        const map = {
          'payment.captured': { paymentStatus: 'CAPTURED', status: 'PAID' },
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

    await prisma.paymentEvent.update({ where: { eventId }, data: { processedAt: new Date() } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};
