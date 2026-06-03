const prisma = require('../config/db');

// Each product slug → the specific styled EJS template that mirrors the
// static marketing site. Unknown slugs fall back to the generic page.
const PRODUCT_TEMPLATES = {
  'advanced-iron': 'pages/product-iron',
  'advanced-ginger': 'pages/product-ginger',
  'advanced-energyone': 'pages/product-energyone',
};

// The home page references the three Shiōrra SKUs by slug — load them all
// in one query so each product card can submit a real /cart/add form.
async function loadShowcaseProducts() {
  const products = await prisma.product.findMany({
    where: { slug: { in: Object.keys(PRODUCT_TEMPLATES) }, active: true },
    include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } },
  });
  return Object.fromEntries(products.map((p) => [p.slug, p]));
}

exports.home = async (req, res, next) => {
  try {
    const bySlug = await loadShowcaseProducts();
    res.render('pages/home', {
      title: 'Shiōrra — wellness, gently formulated',
      ironProduct: bySlug['advanced-iron'] || null,
      gingerProduct: bySlug['advanced-ginger'] || null,
      energyProduct: bySlug['advanced-energyone'] || null,
      layout: false,
    });
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
    res.render('pages/shop', { title: 'Shop · Shiōrra', products });
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
    const template = PRODUCT_TEMPLATES[product.slug] || 'pages/product';
    const opts = { title: `${product.name} · Shiōrra`, product };
    // Marketing templates are self-contained <html> docs; skip the layout.
    if (PRODUCT_TEMPLATES[product.slug]) opts.layout = false;
    res.render(template, opts);
  } catch (err) {
    next(err);
  }
};

exports.about = (req, res) =>
  res.render('pages/about', { title: 'About · Shiōrra', layout: false });

exports.faq = (req, res) =>
  res.render('pages/faq', { title: 'FAQ · Shiōrra', layout: false });

exports.reviews = (req, res) =>
  res.render('pages/reviews', { title: 'Reviews · Shiōrra', layout: false });

exports.contact = (req, res) =>
  res.render('pages/contact', { title: 'Contact · Shiōrra' });
