const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/db');

exports.dashboard = async (req, res, next) => {
  try {
    const [orderCount, latestOrders, addressCount] = await Promise.all([
      prisma.order.count({ where: { userId: req.user.id } }),
      prisma.order.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { items: true },
      }),
      prisma.address.count({ where: { userId: req.user.id } }),
    ]);
    res.render('pages/account', { title: 'Your account', orderCount, addressCount, latestOrders });
  } catch (err) {
    next(err);
  }
};

exports.orders = async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
    res.render('pages/orders', { title: 'Your orders', orders });
  } catch (err) {
    next(err);
  }
};

exports.orderDetail = async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { orderNumber: req.params.orderNumber, userId: req.user.id },
      include: { items: true, shippingAddress: true },
    });
    if (!order)
      return res.status(404).render('pages/error', { title: 'Not found', status: 404, message: 'Order not found.' });
    res.render('pages/order-detail', { title: `Order ${order.orderNumber}`, order });
  } catch (err) {
    next(err);
  }
};

// Customer-facing invoice — reuses the polished admin/order-invoice template
// (it's just a printable document; no admin chrome in the view). Scoped to
// the current user so people can't view each other's invoices by guessing
// order numbers.
exports.orderInvoice = async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { orderNumber: req.params.orderNumber, userId: req.user.id },
      include: { user: true, items: true, shippingAddress: true, coupon: true },
    });
    if (!order)
      return res.status(404).render('pages/error', { title: 'Not found', status: 404, message: 'Order not found.' });
    res.render('admin/order-invoice', {
      title: `Invoice · ${order.orderNumber}`,
      order,
      layout: false,
    });
  } catch (err) {
    next(err);
  }
};

exports.addresses = async (req, res, next) => {
  try {
    const addresses = await prisma.address.findMany({
      where: { userId: req.user.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    res.render('pages/addresses', { title: 'Saved addresses', addresses, editing: null });
  } catch (err) {
    next(err);
  }
};

exports.addressNew = (req, res) => {
  res.render('pages/address-form', { title: 'Add address', address: null, values: {} });
};

exports.addressEdit = async (req, res, next) => {
  try {
    const address = await prisma.address.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!address) {
      req.flash('error', 'Address not found.');
      return res.redirect('/account/addresses');
    }
    res.render('pages/address-form', { title: 'Edit address', address, values: address });
  } catch (err) {
    next(err);
  }
};

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

exports.addressCreate = async (req, res, next) => {
  try {
    const parsed = addressSchema.safeParse(req.body);
    if (!parsed.success) {
      req.flash('error', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '));
      return res.render('pages/address-form', { title: 'Add address', address: null, values: req.body });
    }
    const data = parsed.data;
    const existingCount = await prisma.address.count({ where: { userId: req.user.id } });
    await prisma.address.create({
      data: {
        userId: req.user.id,
        fullName: data.fullName,
        phone: data.phone,
        line1: data.line1,
        line2: data.line2 || null,
        city: data.city,
        state: data.state,
        postcode: data.postcode,
        country: data.country,
        isDefault: existingCount === 0, // first address auto-default
      },
    });
    req.flash('success', 'Address saved.');
    res.redirect('/account/addresses');
  } catch (err) {
    next(err);
  }
};

exports.addressUpdate = async (req, res, next) => {
  try {
    const owned = await prisma.address.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!owned) {
      req.flash('error', 'Address not found.');
      return res.redirect('/account/addresses');
    }
    const parsed = addressSchema.safeParse(req.body);
    if (!parsed.success) {
      req.flash('error', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '));
      return res.render('pages/address-form', { title: 'Edit address', address: owned, values: req.body });
    }
    const data = parsed.data;
    await prisma.address.update({
      where: { id: owned.id },
      data: {
        fullName: data.fullName,
        phone: data.phone,
        line1: data.line1,
        line2: data.line2 || null,
        city: data.city,
        state: data.state,
        postcode: data.postcode,
        country: data.country,
      },
    });
    req.flash('success', 'Address updated.');
    res.redirect('/account/addresses');
  } catch (err) {
    next(err);
  }
};

exports.addressDelete = async (req, res, next) => {
  try {
    const owned = await prisma.address.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!owned) {
      req.flash('error', 'Address not found.');
      return res.redirect('/account/addresses');
    }
    await prisma.address.delete({ where: { id: owned.id } });
    // If we deleted the default, promote the next-most-recent address
    if (owned.isDefault) {
      const next = await prisma.address.findFirst({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
      });
      if (next) await prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    req.flash('success', 'Address removed.');
    res.redirect('/account/addresses');
  } catch (err) {
    next(err);
  }
};

exports.addressSetDefault = async (req, res, next) => {
  try {
    const owned = await prisma.address.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!owned) {
      req.flash('error', 'Address not found.');
      return res.redirect('/account/addresses');
    }
    await prisma.$transaction([
      prisma.address.updateMany({ where: { userId: req.user.id }, data: { isDefault: false } }),
      prisma.address.update({ where: { id: owned.id }, data: { isDefault: true } }),
    ]);
    req.flash('success', 'Default address updated.');
    res.redirect('/account/addresses');
  } catch (err) {
    next(err);
  }
};

const profileSchema = z.object({
  name: z.string().min(2).max(80),
  phone: z.string().min(7).max(20).optional().or(z.literal('')),
});

exports.updateProfile = async (req, res, next) => {
  try {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      req.flash('error', 'Please check the form.');
      return res.redirect('/account');
    }
    await prisma.user.update({
      where: { id: req.user.id },
      data: { name: parsed.data.name, phone: parsed.data.phone || null },
    });
    req.flash('success', 'Profile updated.');
    res.redirect('/account');
  } catch (err) {
    next(err);
  }
};

const passwordSchema = z
  .object({
    current: z.string().min(1),
    next: z.string().min(8).max(120),
    confirm: z.string().min(8).max(120),
  })
  .refine((d) => d.next === d.confirm, { message: 'New passwords do not match.' });

exports.changePassword = async (req, res, next) => {
  try {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) {
      req.flash('error', parsed.error.issues.map((i) => i.message).join(' · '));
      return res.redirect('/account');
    }
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const ok = await bcrypt.compare(parsed.data.current, user.passwordHash);
    if (!ok) {
      req.flash('error', 'Current password is wrong.');
      return res.redirect('/account');
    }
    const passwordHash = await bcrypt.hash(parsed.data.next, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    req.flash('success', 'Password changed.');
    res.redirect('/account');
  } catch (err) {
    next(err);
  }
};
