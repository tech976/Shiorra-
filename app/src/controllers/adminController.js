const path = require('path');
const fs = require('fs/promises');
const { z } = require('zod');
const prisma = require('../config/db');
const env = require('../config/env');
const { toPaise, formatINR } = require('../utils/money');

const productSchema = z.object({
  name: z.string().min(2).max(160),
  slug: z
    .string()
    .min(2)
    .max(160)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens.'),
  tagline: z.string().max(200).optional().or(z.literal('')),
  description: z.string().min(1).max(20000),
  price: z.coerce.number().nonnegative(),
  mrp: z.coerce.number().nonnegative().optional().or(z.literal('').transform(() => undefined)),
  stock: z.coerce.number().int().nonnegative().default(0),
  active: z.coerce.boolean().optional().default(true),
  featured: z.coerce.boolean().optional().default(false),
  badge: z.string().max(40).optional().or(z.literal('')),
  ingredients: z.string().max(8000).optional().or(z.literal('')),
  servingInfo: z.string().max(400).optional().or(z.literal('')),
  metaTitle: z.string().max(120).optional().or(z.literal('')),
  metaDesc: z.string().max(220).optional().or(z.literal('')),
});

const PAID_STATUSES = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'];
const ORDER_STATUSES = ['PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'];

function dayRange(daysAgo) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setDate(start.getDate() - daysAgo);
  start.setHours(0, 0, 0, 0);
  return { gte: start, lte: end };
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfYesterday() {
  const d = startOfToday();
  d.setDate(d.getDate() - 1);
  return d;
}

function startOfThisMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ---------- Dashboard ----------
exports.dashboard = async (req, res, next) => {
  try {
    const now = new Date();
    const today = startOfToday();
    const yesterday = startOfYesterday();
    const monthStart = startOfThisMonth();

    const PAID_FILTER = { status: { in: PAID_STATUSES } };

    const [
      productCount,
      userCount,
      orderCount,
      lifetimeRevAgg,
      revToday,
      revYesterday,
      revThisMonth,
      ordersToday,
      ordersYesterday,
      newUsersToday,
      pendingCount,
      processingCount,
      shippedCount,
      deliveredCount,
      cancelledCount,
      latestOrders,
      lowStock,
      topProductsRaw,
      topCustomers,
      recentUsers,
      cartAbandonedCount,
    ] = await Promise.all([
      prisma.product.count(),
      prisma.user.count(),
      prisma.order.count(),
      prisma.order.aggregate({ where: PAID_FILTER, _sum: { totalInPaise: true } }),
      prisma.order.aggregate({ where: { ...PAID_FILTER, createdAt: { gte: today } }, _sum: { totalInPaise: true } }),
      prisma.order.aggregate({
        where: { ...PAID_FILTER, createdAt: { gte: yesterday, lt: today } },
        _sum: { totalInPaise: true },
      }),
      prisma.order.aggregate({ where: { ...PAID_FILTER, createdAt: { gte: monthStart } }, _sum: { totalInPaise: true } }),
      prisma.order.count({ where: { createdAt: { gte: today } } }),
      prisma.order.count({ where: { createdAt: { gte: yesterday, lt: today } } }),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.order.count({ where: { status: 'PENDING' } }),
      prisma.order.count({ where: { status: 'PROCESSING' } }),
      prisma.order.count({ where: { status: 'SHIPPED' } }),
      prisma.order.count({ where: { status: 'DELIVERED' } }),
      prisma.order.count({ where: { status: 'CANCELLED' } }),
      prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: { user: true } }),
      prisma.product.findMany({
        where: { stock: { lt: 10 }, active: true },
        orderBy: { stock: 'asc' },
        take: 8,
      }),
      // Top products in the last 30 days by revenue
      prisma.orderItem.groupBy({
        by: ['productId', 'name'],
        where: {
          order: { ...PAID_FILTER, createdAt: dayRange(30) },
        },
        _sum: { totalInPaise: true, quantity: true },
        orderBy: { _sum: { totalInPaise: 'desc' } },
        take: 6,
      }),
      // Top customers by lifetime paid revenue
      prisma.order.groupBy({
        by: ['userId'],
        where: PAID_FILTER,
        _sum: { totalInPaise: true },
        _count: { _all: true },
        orderBy: { _sum: { totalInPaise: 'desc' } },
        take: 6,
      }),
      // Newest users
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, email: true, name: true, createdAt: true, role: true },
      }),
      // "Abandoned" carts: any user with items in cart whose last activity was > 1 day ago
      prisma.cartItem.groupBy({
        by: ['userId'],
        where: { updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
    ]);

    // 30-day daily series — both revenue and order count
    const dailyRows = await prisma.$queryRaw`
      SELECT
        DATE_TRUNC('day', "createdAt")::date AS day,
        COUNT(*)::int AS orders,
        COALESCE(SUM("totalInPaise") FILTER (WHERE "status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED')), 0)::bigint AS revenue
      FROM "Order"
      WHERE "createdAt" >= ${dayRange(29).gte}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    const dayMap = new Map();
    for (const row of dailyRows) {
      const key = new Date(row.day).toISOString().slice(0, 10);
      dayMap.set(key, { orders: Number(row.orders), revenue: Number(row.revenue) });
    }
    const series = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const row = dayMap.get(key) || { orders: 0, revenue: 0 };
      series.push({ day: key, orders: row.orders, revenueInPaise: row.revenue });
    }

    // Resolve names for top customers
    const customerIds = topCustomers.map((c) => c.userId);
    const topCustomerUsers = customerIds.length
      ? await prisma.user.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, email: true } })
      : [];
    const userMap = Object.fromEntries(topCustomerUsers.map((u) => [u.id, u]));
    const topCustomersResolved = topCustomers.map((c) => ({
      ...c,
      user: userMap[c.userId] || null,
      lifetimeInPaise: c._sum.totalInPaise || 0,
      orderCount: c._count._all,
    }));

    // KPIs
    const totalRev = lifetimeRevAgg._sum.totalInPaise || 0;
    const totalPaidOrders = await prisma.order.count({ where: PAID_FILTER });
    const aovInPaise = totalPaidOrders ? Math.round(totalRev / totalPaidOrders) : 0;
    const revTodayInPaise = revToday._sum.totalInPaise || 0;
    const revYesterdayInPaise = revYesterday._sum.totalInPaise || 0;
    const revMonthInPaise = revThisMonth._sum.totalInPaise || 0;
    const revDeltaPct =
      revYesterdayInPaise > 0
        ? Math.round(((revTodayInPaise - revYesterdayInPaise) / revYesterdayInPaise) * 100)
        : revTodayInPaise > 0
        ? 100
        : 0;

    res.render('admin/dashboard', {
      title: 'Admin · Dashboard',
      kpis: {
        revTodayInPaise,
        revYesterdayInPaise,
        revMonthInPaise,
        totalRevInPaise: totalRev,
        ordersToday,
        ordersYesterday,
        orderCount,
        productCount,
        userCount,
        newUsersToday,
        aovInPaise,
        cartAbandonedCount: cartAbandonedCount.length,
        revDeltaPct,
      },
      statusBreakdown: {
        pending: pendingCount,
        processing: processingCount,
        shipped: shippedCount,
        delivered: deliveredCount,
        cancelled: cancelledCount,
      },
      series,
      latestOrders,
      lowStock,
      topProducts: topProductsRaw.map((p) => ({
        productId: p.productId,
        name: p.name,
        revenueInPaise: p._sum.totalInPaise || 0,
        unitsSold: p._sum.quantity || 0,
      })),
      topCustomers: topCustomersResolved,
      recentUsers,
    });
  } catch (err) {
    next(err);
  }
};

// ---------- Products ----------
exports.productList = async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};
    const products = await prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 }, _count: { select: { orderItems: true } } },
    });
    res.render('admin/products', { title: 'Admin · Products', products, q });
  } catch (err) {
    next(err);
  }
};

exports.productNew = (req, res) => {
  res.render('admin/product-form', { title: 'New product', product: null, values: {}, errors: null });
};

exports.productEdit = async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!product) return res.status(404).render('pages/error', { title: 'Not found', status: 404, message: 'Product not found.' });
    res.render('admin/product-form', {
      title: `Edit · ${product.name}`,
      product,
      values: {
        name: product.name,
        slug: product.slug,
        tagline: product.tagline,
        description: product.description,
        price: (product.priceInPaise / 100).toFixed(2),
        mrp: product.mrpInPaise ? (product.mrpInPaise / 100).toFixed(2) : '',
        stock: product.stock,
        active: product.active,
        featured: product.featured,
        badge: product.badge,
        ingredients: product.ingredients,
        servingInfo: product.servingInfo,
        metaTitle: product.metaTitle,
        metaDesc: product.metaDesc,
      },
      errors: null,
    });
  } catch (err) {
    next(err);
  }
};

async function persistUploadedImages(files, productId) {
  if (!files || !files.length) return;
  const rows = files.map((f, i) => ({
    productId,
    url: `/uploads/${path.basename(f.path)}`,
    alt: null,
    sortOrder: i + 1,
  }));
  await prisma.productImage.createMany({ data: rows });
}

exports.productCreate = async (req, res, next) => {
  try {
    const parsed = productSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.render('admin/product-form', {
        title: 'New product',
        product: null,
        values: req.body,
        errors: parsed.error.issues,
      });
    }
    const data = parsed.data;
    const product = await prisma.product.create({
      data: {
        name: data.name,
        slug: data.slug.toLowerCase(),
        tagline: data.tagline || null,
        description: data.description,
        priceInPaise: toPaise(data.price),
        mrpInPaise: data.mrp ? toPaise(data.mrp) : null,
        stock: data.stock,
        active: !!data.active,
        featured: !!data.featured,
        badge: data.badge || null,
        ingredients: data.ingredients || null,
        servingInfo: data.servingInfo || null,
        metaTitle: data.metaTitle || null,
        metaDesc: data.metaDesc || null,
      },
    });
    await persistUploadedImages(req.files, product.id);
    req.flash('success', `Product "${product.name}" created.`);
    res.redirect('/admin/products');
  } catch (err) {
    if (err.code === 'P2002') {
      req.flash('error', 'A product with that slug already exists.');
      return res.redirect('/admin/products/new');
    }
    next(err);
  }
};

exports.productUpdate = async (req, res, next) => {
  try {
    const parsed = productSchema.safeParse(req.body);
    if (!parsed.success) {
      const existing = await prisma.product.findUnique({ where: { id: req.params.id }, include: { images: true } });
      return res.render('admin/product-form', {
        title: `Edit · ${existing?.name || 'Product'}`,
        product: existing,
        values: req.body,
        errors: parsed.error.issues,
      });
    }
    const data = parsed.data;
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        name: data.name,
        slug: data.slug.toLowerCase(),
        tagline: data.tagline || null,
        description: data.description,
        priceInPaise: toPaise(data.price),
        mrpInPaise: data.mrp ? toPaise(data.mrp) : null,
        stock: data.stock,
        active: !!data.active,
        featured: !!data.featured,
        badge: data.badge || null,
        ingredients: data.ingredients || null,
        servingInfo: data.servingInfo || null,
        metaTitle: data.metaTitle || null,
        metaDesc: data.metaDesc || null,
      },
    });
    await persistUploadedImages(req.files, product.id);
    req.flash('success', `Product "${product.name}" updated.`);
    res.redirect(`/admin/products/${product.id}/edit`);
  } catch (err) {
    if (err.code === 'P2002') {
      req.flash('error', 'A product with that slug already exists.');
      return res.redirect(`/admin/products/${req.params.id}/edit`);
    }
    next(err);
  }
};

exports.productDelete = async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id }, include: { images: true } });
    if (!product) {
      req.flash('error', 'Product not found.');
      return res.redirect('/admin/products');
    }
    await prisma.product.delete({ where: { id: product.id } });
    for (const img of product.images) {
      if (img.url.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, '..', 'public', img.url);
        try { await fs.unlink(filePath); } catch {}
      }
    }
    req.flash('success', `Deleted "${product.name}".`);
    res.redirect('/admin/products');
  } catch (err) {
    next(err);
  }
};

exports.imageDelete = async (req, res, next) => {
  try {
    const image = await prisma.productImage.findUnique({ where: { id: req.params.imageId } });
    if (!image) {
      req.flash('error', 'Image not found.');
      return res.redirect('back');
    }
    await prisma.productImage.delete({ where: { id: image.id } });
    if (image.url.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, '..', 'public', image.url);
      try { await fs.unlink(filePath); } catch {}
    }
    res.redirect('back');
  } catch (err) {
    next(err);
  }
};

exports.productQuickStock = async (req, res, next) => {
  try {
    const stock = Math.max(0, parseInt(req.body.stock, 10) || 0);
    await prisma.product.update({ where: { id: req.params.id }, data: { stock } });
    req.flash('success', 'Stock updated.');
    res.redirect(req.body.returnTo || '/admin/products');
  } catch (err) {
    next(err);
  }
};

exports.productToggleActive = async (req, res, next) => {
  try {
    const p = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!p) {
      req.flash('error', 'Product not found.');
      return res.redirect('/admin/products');
    }
    await prisma.product.update({ where: { id: p.id }, data: { active: !p.active } });
    req.flash('success', `${p.name} is now ${!p.active ? 'Active' : 'Hidden'}.`);
    res.redirect(req.body.returnTo || '/admin/products');
  } catch (err) {
    next(err);
  }
};

// ---------- Orders ----------
const statusSchema = z.enum(ORDER_STATUSES);

function buildOrderWhere(q, status, from, to) {
  const where = { AND: [] };
  if (status && ORDER_STATUSES.includes(status)) where.AND.push({ status });
  if (q) {
    where.AND.push({
      OR: [
        { orderNumber: { contains: q, mode: 'insensitive' } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
        { user: { name: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }
  if (from || to) {
    const range = {};
    if (from) range.gte = new Date(from);
    if (to) {
      const d = new Date(to);
      d.setHours(23, 59, 59, 999);
      range.lte = d;
    }
    where.AND.push({ createdAt: range });
  }
  return where.AND.length ? where : undefined;
}

exports.orderList = async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const status = (req.query.status || '').toUpperCase();
    const from = req.query.from || '';
    const to = req.query.to || '';
    const where = buildOrderWhere(q, status, from, to);

    const [orders, agg] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { user: true, items: true },
        take: 300,
      }),
      prisma.order.aggregate({
        where: { ...(where || {}), status: { in: PAID_STATUSES } },
        _sum: { totalInPaise: true },
        _count: { _all: true },
      }),
    ]);
    res.render('admin/orders', {
      title: 'Admin · Orders',
      orders,
      q,
      activeStatus: status,
      from,
      to,
      statuses: ORDER_STATUSES,
      matchPaidRevInPaise: agg._sum.totalInPaise || 0,
      matchPaidCount: agg._count._all || 0,
    });
  } catch (err) {
    next(err);
  }
};

exports.orderExportCsv = async (req, res, next) => {
  try {
    const where = buildOrderWhere(
      (req.query.q || '').trim(),
      (req.query.status || '').toUpperCase(),
      req.query.from || '',
      req.query.to || ''
    );
    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { user: true, items: true, shippingAddress: true },
    });
    const headers = [
      'Order',
      'Date',
      'Customer',
      'Email',
      'Phone',
      'Items',
      'Subtotal',
      'Shipping',
      'Discount',
      'Total',
      'Status',
      'Payment',
      'Coupon',
      'ShipCity',
      'ShipState',
    ];
    const rows = orders.map((o) => [
      o.orderNumber,
      o.createdAt.toISOString(),
      o.user?.name || '',
      o.user?.email || '',
      o.shippingAddress?.phone || o.user?.phone || '',
      o.items.length,
      (o.subtotalInPaise / 100).toFixed(2),
      (o.shippingInPaise / 100).toFixed(2),
      (o.discountInPaise / 100).toFixed(2),
      (o.totalInPaise / 100).toFixed(2),
      o.status,
      o.paymentStatus,
      o.couponCode || '',
      o.shippingAddress?.city || '',
      o.shippingAddress?.state || '',
    ]);
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');

    const fname = `shiorra-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
};

exports.orderDetail = async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { user: true, items: true, shippingAddress: true, coupon: true },
    });
    if (!order) return res.status(404).render('pages/error', { title: 'Not found', status: 404, message: 'Order not found.' });
    res.render('admin/order-detail', { title: `Order ${order.orderNumber}`, order });
  } catch (err) {
    next(err);
  }
};

exports.orderInvoice = async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { user: true, items: true, shippingAddress: true, coupon: true },
    });
    if (!order) return res.status(404).render('pages/error', { title: 'Not found', status: 404, message: 'Order not found.' });
    res.render('admin/order-invoice', {
      title: `Invoice · ${order.orderNumber}`,
      order,
      layout: false,
    });
  } catch (err) {
    next(err);
  }
};

exports.orderUpdateStatus = async (req, res, next) => {
  try {
    const parsed = statusSchema.safeParse(req.body.status);
    if (!parsed.success) {
      req.flash('error', 'Invalid status.');
      return res.redirect('back');
    }
    await prisma.order.update({ where: { id: req.params.id }, data: { status: parsed.data } });
    req.flash('success', `Order marked ${parsed.data}.`);
    res.redirect(`/admin/orders/${req.params.id}`);
  } catch (err) {
    next(err);
  }
};

exports.orderUpdateNotes = async (req, res, next) => {
  try {
    const adminNotes = String(req.body.adminNotes || '').slice(0, 4000);
    await prisma.order.update({ where: { id: req.params.id }, data: { adminNotes: adminNotes || null } });
    req.flash('success', 'Notes saved.');
    res.redirect(`/admin/orders/${req.params.id}`);
  } catch (err) {
    next(err);
  }
};

exports.orderBulk = async (req, res, next) => {
  try {
    const ids = []
      .concat(req.body.ids || [])
      .filter(Boolean);
    const action = String(req.body.action || '');
    if (!ids.length) {
      req.flash('error', 'No orders selected.');
      return res.redirect('/admin/orders');
    }
    if (action.startsWith('status:')) {
      const next = action.slice('status:'.length).toUpperCase();
      if (!ORDER_STATUSES.includes(next)) {
        req.flash('error', 'Invalid status.');
        return res.redirect('/admin/orders');
      }
      const n = await prisma.order.updateMany({ where: { id: { in: ids } }, data: { status: next } });
      req.flash('success', `Updated ${n.count} order(s) → ${next}.`);
    } else {
      req.flash('error', 'Unknown bulk action.');
    }
    res.redirect('/admin/orders');
  } catch (err) {
    next(err);
  }
};

// ---------- Users ----------
exports.userList = async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const where = q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
          ],
        }
      : undefined;
    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, email: true, name: true, role: true, phone: true, createdAt: true,
        tags: true,
        _count: { select: { orders: true } },
      },
    });
    res.render('admin/users', { title: 'Admin · Users', users, q });
  } catch (err) {
    next(err);
  }
};

exports.userDetail = async (req, res, next) => {
  try {
    const u = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] },
        orders: { orderBy: { createdAt: 'desc' }, take: 50, include: { items: true } },
      },
    });
    if (!u) return res.status(404).render('pages/error', { title: 'Not found', status: 404, message: 'User not found.' });
    const paidAgg = await prisma.order.aggregate({
      where: { userId: u.id, status: { in: PAID_STATUSES } },
      _sum: { totalInPaise: true },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    const lifetimeInPaise = paidAgg._sum.totalInPaise || 0;
    const paidOrders = paidAgg._count._all || 0;
    const aovInPaise = paidOrders ? Math.round(lifetimeInPaise / paidOrders) : 0;
    const lastOrderAt = paidAgg._max.createdAt || null;
    res.render('admin/user-detail', {
      title: `User · ${u.email}`,
      u,
      lifetimeInPaise,
      paidOrders,
      aovInPaise,
      lastOrderAt,
    });
  } catch (err) {
    next(err);
  }
};

exports.userToggleRole = async (req, res, next) => {
  try {
    const u = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!u) {
      req.flash('error', 'User not found.');
      return res.redirect('/admin/users');
    }
    if (u.id === req.user.id) {
      req.flash('error', 'You cannot change your own role.');
      return res.redirect('/admin/users');
    }
    const newRole = u.role === 'ADMIN' ? 'USER' : 'ADMIN';
    await prisma.user.update({ where: { id: u.id }, data: { role: newRole } });
    req.flash('success', `${u.email} is now ${newRole}.`);
    res.redirect(req.body.returnTo || '/admin/users');
  } catch (err) {
    next(err);
  }
};

exports.userUpdate = async (req, res, next) => {
  try {
    const adminNotes = String(req.body.adminNotes || '').slice(0, 4000);
    const tags = String(req.body.tags || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 12);
    await prisma.user.update({
      where: { id: req.params.id },
      data: { adminNotes: adminNotes || null, tags },
    });
    req.flash('success', 'Customer info saved.');
    res.redirect(`/admin/users/${req.params.id}`);
  } catch (err) {
    next(err);
  }
};

// ---------- Coupons ----------
const couponSchema = z.object({
  code: z.string().min(2).max(40).regex(/^[A-Z0-9-]+$/i, 'A-Z, 0-9 and hyphens only.'),
  type: z.enum(['FIXED', 'PERCENT']),
  value: z.coerce.number().int().positive(),
  minSubtotal: z.coerce.number().nonnegative().optional().or(z.literal('').transform(() => 0)),
  usageLimit: z.coerce.number().int().positive().optional().or(z.literal('').transform(() => undefined)),
  active: z.coerce.boolean().optional().default(true),
  expiresAt: z.string().optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

exports.couponList = async (req, res, next) => {
  try {
    const coupons = await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
    res.render('admin/coupons', { title: 'Admin · Coupons', coupons });
  } catch (err) {
    next(err);
  }
};

exports.couponNew = (req, res) => {
  res.render('admin/coupon-form', { title: 'New coupon', coupon: null, values: {}, errors: null });
};

exports.couponEdit = async (req, res, next) => {
  try {
    const coupon = await prisma.coupon.findUnique({ where: { id: req.params.id } });
    if (!coupon) {
      req.flash('error', 'Coupon not found.');
      return res.redirect('/admin/coupons');
    }
    res.render('admin/coupon-form', {
      title: `Edit · ${coupon.code}`,
      coupon,
      values: {
        code: coupon.code,
        type: coupon.type,
        value: coupon.type === 'FIXED' ? (coupon.value / 100).toFixed(2) : coupon.value,
        minSubtotal: coupon.minSubtotal ? (coupon.minSubtotal / 100).toFixed(2) : '',
        usageLimit: coupon.usageLimit || '',
        active: coupon.active,
        expiresAt: coupon.expiresAt ? coupon.expiresAt.toISOString().slice(0, 10) : '',
        notes: coupon.notes || '',
      },
      errors: null,
    });
  } catch (err) {
    next(err);
  }
};

function buildCouponData(parsed) {
  const data = parsed.data;
  const valueInt = data.type === 'FIXED' ? toPaise(data.value) : Math.min(100, Math.max(1, parseInt(data.value, 10)));
  const minSubtotalInPaise = data.minSubtotal ? toPaise(data.minSubtotal) : 0;
  return {
    code: data.code.toUpperCase(),
    type: data.type,
    value: valueInt,
    minSubtotal: minSubtotalInPaise,
    usageLimit: data.usageLimit ? Number(data.usageLimit) : null,
    active: !!data.active,
    expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    notes: data.notes || null,
  };
}

exports.couponCreate = async (req, res, next) => {
  try {
    const parsed = couponSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.render('admin/coupon-form', {
        title: 'New coupon',
        coupon: null,
        values: req.body,
        errors: parsed.error.issues,
      });
    }
    await prisma.coupon.create({ data: buildCouponData(parsed) });
    req.flash('success', 'Coupon created.');
    res.redirect('/admin/coupons');
  } catch (err) {
    if (err.code === 'P2002') {
      req.flash('error', 'A coupon with that code already exists.');
      return res.redirect('/admin/coupons/new');
    }
    next(err);
  }
};

exports.couponUpdate = async (req, res, next) => {
  try {
    const parsed = couponSchema.safeParse(req.body);
    if (!parsed.success) {
      const existing = await prisma.coupon.findUnique({ where: { id: req.params.id } });
      return res.render('admin/coupon-form', {
        title: `Edit · ${existing?.code || 'Coupon'}`,
        coupon: existing,
        values: req.body,
        errors: parsed.error.issues,
      });
    }
    await prisma.coupon.update({ where: { id: req.params.id }, data: buildCouponData(parsed) });
    req.flash('success', 'Coupon saved.');
    res.redirect('/admin/coupons');
  } catch (err) {
    if (err.code === 'P2002') {
      req.flash('error', 'A coupon with that code already exists.');
      return res.redirect(`/admin/coupons/${req.params.id}/edit`);
    }
    next(err);
  }
};

exports.couponDelete = async (req, res, next) => {
  try {
    await prisma.coupon.delete({ where: { id: req.params.id } });
    req.flash('success', 'Coupon removed.');
    res.redirect('/admin/coupons');
  } catch (err) {
    next(err);
  }
};

// ---------- Reports ----------
exports.reports = async (req, res, next) => {
  try {
    const days = Math.min(365, Math.max(7, parseInt(req.query.days, 10) || 30));
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const dailyRows = await prisma.$queryRaw`
      SELECT
        DATE_TRUNC('day', "createdAt")::date AS day,
        COUNT(*)::int AS orders,
        COALESCE(SUM("totalInPaise") FILTER (WHERE "status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED')), 0)::bigint AS revenue
      FROM "Order"
      WHERE "createdAt" >= ${since}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    const series = dailyRows.map((r) => ({
      day: new Date(r.day).toISOString().slice(0, 10),
      orders: Number(r.orders),
      revenueInPaise: Number(r.revenue),
    }));

    const byProduct = await prisma.orderItem.groupBy({
      by: ['productId', 'name'],
      where: { order: { status: { in: PAID_STATUSES }, createdAt: { gte: since } } },
      _sum: { totalInPaise: true, quantity: true },
      orderBy: { _sum: { totalInPaise: 'desc' } },
      take: 15,
    });

    const aggAll = await prisma.order.aggregate({
      where: { status: { in: PAID_STATUSES }, createdAt: { gte: since } },
      _sum: { totalInPaise: true, shippingInPaise: true, discountInPaise: true },
      _count: { _all: true },
    });

    res.render('admin/reports', {
      title: 'Admin · Reports',
      days,
      series,
      byProduct: byProduct.map((p) => ({
        productId: p.productId,
        name: p.name,
        revenueInPaise: p._sum.totalInPaise || 0,
        units: p._sum.quantity || 0,
      })),
      paidRevInPaise: aggAll._sum.totalInPaise || 0,
      shippingInPaise: aggAll._sum.shippingInPaise || 0,
      discountInPaise: aggAll._sum.discountInPaise || 0,
      paidOrderCount: aggAll._count._all || 0,
    });
  } catch (err) {
    next(err);
  }
};

exports.reportsCsv = async (req, res, next) => {
  try {
    const days = Math.min(365, Math.max(7, parseInt(req.query.days, 10) || 30));
    const since = new Date();
    since.setDate(since.getDate() - days);
    const dailyRows = await prisma.$queryRaw`
      SELECT
        DATE_TRUNC('day', "createdAt")::date AS day,
        COUNT(*)::int AS orders,
        COALESCE(SUM("totalInPaise") FILTER (WHERE "status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED')), 0)::bigint AS revenue
      FROM "Order"
      WHERE "createdAt" >= ${since}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    const csv = ['Day,Orders,Revenue (INR)']
      .concat(
        dailyRows.map(
          (r) => `${new Date(r.day).toISOString().slice(0, 10)},${Number(r.orders)},${(Number(r.revenue) / 100).toFixed(2)}`
        )
      )
      .join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="shiorra-report-${days}d.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
};
