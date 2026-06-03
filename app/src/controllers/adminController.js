const path = require('path');
const fs = require('fs/promises');
const { z } = require('zod');
const prisma = require('../config/db');
const env = require('../config/env');
const { toPaise } = require('../utils/money');

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

exports.dashboard = async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [productCount, userCount, orderCount, revenueAgg, latestOrders, lowStock, todaysOrders, paidOrders, pendingOrders] =
      await Promise.all([
        prisma.product.count(),
        prisma.user.count(),
        prisma.order.count(),
        prisma.order.aggregate({
          where: { status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] } },
          _sum: { totalInPaise: true },
        }),
        prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 8, include: { user: true } }),
        prisma.product.findMany({ where: { stock: { lt: 10 }, active: true }, orderBy: { stock: 'asc' }, take: 8 }),
        prisma.order.count({ where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
        prisma.order.count({ where: { status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] } } }),
        prisma.order.count({ where: { status: 'PENDING' } }),
      ]);

    // Last 14 days revenue + orders for a small spark line in the view
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
    // Build a dense 14-day series
    const dayMap = new Map();
    for (const row of dailyRows) {
      const key = new Date(row.day).toISOString().slice(0, 10);
      dayMap.set(key, { orders: Number(row.orders), revenue: Number(row.revenue) });
    }
    const series = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const row = dayMap.get(key) || { orders: 0, revenue: 0 };
      series.push({ day: key, orders: row.orders, revenueInPaise: row.revenue });
    }
    const maxRev = Math.max(1, ...series.map((s) => s.revenueInPaise));

    res.render('admin/dashboard', {
      title: 'Admin · Dashboard',
      productCount,
      userCount,
      orderCount,
      revenueInPaise: revenueAgg._sum.totalInPaise || 0,
      latestOrders,
      lowStock,
      todaysOrders,
      paidOrders,
      pendingOrders,
      series,
      maxRev,
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
      include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } },
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
  // multer-disk-storage already wrote files to upload dir; we save the URLs
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
    // Best-effort: remove uploaded files
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

// ---------- Orders ----------
const statusSchema = z.enum(['PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED']);
const ORDER_STATUSES = ['PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'];

exports.orderList = async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const status = (req.query.status || '').toUpperCase();
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
    const orders = await prisma.order.findMany({
      where: where.AND.length ? where : undefined,
      orderBy: { createdAt: 'desc' },
      include: { user: true, items: true },
      take: 200,
    });
    res.render('admin/orders', {
      title: 'Admin · Orders',
      orders,
      q,
      activeStatus: status,
      statuses: ORDER_STATUSES,
    });
  } catch (err) {
    next(err);
  }
};

exports.orderDetail = async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { user: true, items: true, shippingAddress: true },
    });
    if (!order) return res.status(404).render('pages/error', { title: 'Not found', status: 404, message: 'Order not found.' });
    res.render('admin/order-detail', { title: `Order ${order.orderNumber}`, order });
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
      select: { id: true, email: true, name: true, role: true, phone: true, createdAt: true, _count: { select: { orders: true } } },
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
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { items: true },
        },
      },
    });
    if (!u) return res.status(404).render('pages/error', { title: 'Not found', status: 404, message: 'User not found.' });
    const spendAgg = await prisma.order.aggregate({
      where: { userId: u.id, status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] } },
      _sum: { totalInPaise: true },
    });
    res.render('admin/user-detail', {
      title: `User · ${u.email}`,
      u,
      lifetimeInPaise: spendAgg._sum.totalInPaise || 0,
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

// ---------- Quick actions ----------
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
