const prisma = require('../config/db');

exports.home = async (req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      where: { active: true },
      include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } },
      orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
      take: 8,
    });
    res.render('pages/home', { title: 'Shiorra — wellness, gently formulated', products });
  } catch (err) {
    next(err);
  }
};

exports.shop = async (req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      where: { active: true },
      include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } },
      orderBy: [{ featured: 'desc' }, { name: 'asc' }],
    });
    res.render('pages/shop', { title: 'Shop · Shiorra', products });
  } catch (err) {
    next(err);
  }
};

exports.product = async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({
      where: { slug: req.params.slug },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!product || !product.active) {
      return res.status(404).render('pages/error', {
        title: 'Not found',
        status: 404,
        message: "We couldn't find that product.",
      });
    }
    res.render('pages/product', { title: `${product.name} · Shiorra`, product });
  } catch (err) {
    next(err);
  }
};

exports.about = (req, res) => res.render('pages/about', { title: 'About · Shiorra' });
exports.faq = (req, res) => res.render('pages/faq', { title: 'FAQ · Shiorra' });
exports.contact = (req, res) => res.render('pages/contact', { title: 'Contact · Shiorra' });
