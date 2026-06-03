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

exports.showCheckout = async (req, res, next) => {
  try {
    const items = await cartController.loadCart(req);
    if (!items.length) {
      req.flash('info', 'Your cart is empty.');
      return res.redirect('/cart');
    }
    const totals = cartController.summarise(items);
    let addresses = [];
    if (req.user) {
      addresses = await prisma.address.findMany({ where: { userId: req.user.id }, orderBy: { isDefault: 'desc' } });
    }
    res.render('pages/checkout', {
      title: 'Checkout',
      items,
      totals,
      addresses,
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
    if (!req.user) return res.redirect('/login');
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
    const addr = parsed.data;
    const totals = cartController.summarise(items);

    const address = await prisma.address.create({
      data: { ...addr, line2: addr.line2 || null, userId: req.user.id },
    });

    const orderNumber = generateOrderNumber();
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          orderNumber,
          userId: req.user.id,
          shippingAddressId: address.id,
          subtotalInPaise: totals.subtotalInPaise,
          shippingInPaise: totals.shippingInPaise,
          taxInPaise: 0,
          discountInPaise: 0,
          totalInPaise: totals.totalInPaise,
          status: 'PROCESSING',
          paymentStatus: 'CREATED',
          notes: 'Cash on Delivery',
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
      return created;
    });

    await prisma.cartItem.deleteMany({ where: { userId: req.user.id } });

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
    if (!req.user) {
      return res.status(401).json({ error: 'Please log in to place an order.' });
    }
    const items = await cartController.loadCart(req);
    if (!items.length) return res.status(400).json({ error: 'Cart is empty.' });

    const parsed = addressSchema.safeParse(req.body.address || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid shipping address.', issues: parsed.error.issues });
    }
    const addr = parsed.data;

    const totals = cartController.summarise(items);

    const rzp = getRazorpay();
    if (!rzp) {
      return res.status(500).json({ error: 'Payment gateway not configured. Add Razorpay keys to .env.' });
    }

    // Save the address
    const address = await prisma.address.create({
      data: { ...addr, line2: addr.line2 || null, userId: req.user.id },
    });

    // Create Razorpay order
    const orderNumber = generateOrderNumber();
    const rzpOrder = await rzp.orders.create({
      amount: totals.totalInPaise,
      currency: 'INR',
      receipt: orderNumber,
      notes: { orderNumber, userId: req.user.id },
    });

    // Persist local order in a transaction so items + order are atomic
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          orderNumber,
          userId: req.user.id,
          shippingAddressId: address.id,
          subtotalInPaise: totals.subtotalInPaise,
          shippingInPaise: totals.shippingInPaise,
          taxInPaise: 0,
          discountInPaise: 0,
          totalInPaise: totals.totalInPaise,
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
      });
      return created;
    });

    res.json({
      ok: true,
      key: env.razorpay.keyId,
      amount: totals.totalInPaise,
      currency: 'INR',
      orderId: rzpOrder.id,
      orderNumber: order.orderNumber,
      name: 'Shiorra',
      description: `Order ${order.orderNumber}`,
      prefill: { name: req.user.name, email: req.user.email, contact: addr.phone },
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

    // Empty the cart
    await prisma.cartItem.deleteMany({ where: { userId: order.userId } });

    res.json({ ok: true, redirect: `/checkout/success/${order.orderNumber}` });
  } catch (err) {
    next(err);
  }
};

exports.success = async (req, res, next) => {
  try {
    if (!req.user) return res.redirect('/login');
    const order = await prisma.order.findFirst({
      where: { orderNumber: req.params.orderNumber, userId: req.user.id },
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
