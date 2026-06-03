// Seed the database with the Shiorra catalogue and bootstrap an admin user.
// Run with: `npm run seed`

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { toPaise } = require('../src/utils/money');

const prisma = new PrismaClient();

const products = [
  {
    slug: 'advanced-iron',
    name: 'Advanced Iron+',
    tagline: 'For a healthier pregnancy & postpartum.',
    description: `An innovative blend to support healthy iron levels and the co-factors of pregnancy — designed to improve hemoglobin and your baby's development.\n\nFerrous Bisglycinate 27 mg with active Folate, B12, B6, Zinc, Copper & Selenium — gentle on the stomach, no metallic aftertaste.`,
    price: 749,
    mrp: 899,
    stock: 200,
    featured: true,
    badge: 'Best Seller',
    ingredients: `Ferrous Bisglycinate (27 mg) · L-methylfolate (570 mcg) · Methylcobalamin / B12 (2.45 mcg) · Pyridoxal-5-Phosphate / B6 (2.3 mg) · Niacinamide / B3 (16 mg) · Riboflavin / B2 (2.7 mg) · Zinc Sulphate (14.5 mg) · Cupric Sulphate (1.7 mg) · Selenomethionine (40 mcg)`,
    servingInfo: '1 vegecap daily after a meal. 30 capsules per pack.',
    images: ['/img/products/sku-iron.png', '/img/products/box-studio.png', '/img/products/capsules.png'],
  },
  {
    slug: 'advanced-ginger',
    name: 'Advanced Ginger+',
    tagline: 'Gentle daily support for pregnancy wellness.',
    description: `Standardized ginger extract paired with active vitamin B6 (P5P) for natural nausea relief and digestive comfort. Warming, gentle, and pregnancy-friendly.`,
    price: 599,
    mrp: 699,
    stock: 150,
    featured: true,
    badge: 'New Launch',
    ingredients: `Standardized Ginger Extract (250 mg) · Pyridoxal-5-Phosphate / B6 (2.3 mg) · Vitamin B1 · Magnesium Bisglycinate`,
    servingInfo: '1 vegecap daily with water. 30 capsules per pack.',
    images: ['/img/products/sku-ginger.png', '/img/products/ginger-box-1.png', '/img/products/ginger-box-2.png'],
  },
  {
    slug: 'advanced-energyone',
    name: 'Advanced EnergyOne+',
    tagline: 'Daily energy, focus & vitality — caffeine-free.',
    description: `Daily nutritional support for energy, focus and vitality — thoughtfully formulated with Taurine, Ginseng Extract, B-Complex vitamins, essential minerals and amino acids.\n\nNot a temporary stimulation, not a caffeine spike. EnergyOne+ supports your body's natural energy systems for sustained daily wellness.`,
    price: 699,
    mrp: 849,
    stock: 150,
    featured: true,
    badge: 'New Launch',
    ingredients: `Taurine · Ginseng Extract · B1 (Thiamine) · B2 (Riboflavin) · B3 (Niacin) · B6 · B12 (Methylcobalamin) · Folic Acid · Biotin · Zinc · Magnesium · Iron · Selenium · Copper · Chromium · Iodine · Amino Acids (Leucine, Lysine, Arginine, Valine, Isoleucine, Threonine, Histidine, Methionine, Tryptophan)`,
    servingInfo: '1 vegecap daily, anytime — with or without food. 30 capsules per pack.',
    images: ['/img/products/sku-multivitamin.png'],
  },
];

// Products that used to exist but are no longer part of the lineup — removed during seed.
const retiredSlugs = ['advanced-calcium', 'advanced-multivitamin'];

async function ensureAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@shiorra.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'ChangeMeNow!2026';
  const name = process.env.ADMIN_NAME || 'Shiorra Admin';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin user already exists: ${email}`);
    return existing;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.create({
    data: { email, name, role: 'ADMIN', passwordHash, emailVerified: true },
  });
  console.log(`Created admin user: ${email} / ${password}  ← change this password immediately`);
  return admin;
}

async function upsertProducts() {
  for (const p of products) {
    const created = await prisma.product.upsert({
      where: { slug: p.slug },
      update: {
        name: p.name,
        tagline: p.tagline,
        description: p.description,
        priceInPaise: toPaise(p.price),
        mrpInPaise: toPaise(p.mrp),
        stock: p.stock,
        featured: !!p.featured,
        badge: p.badge,
        ingredients: p.ingredients,
        servingInfo: p.servingInfo,
        active: true,
      },
      create: {
        slug: p.slug,
        name: p.name,
        tagline: p.tagline,
        description: p.description,
        priceInPaise: toPaise(p.price),
        mrpInPaise: toPaise(p.mrp),
        stock: p.stock,
        featured: !!p.featured,
        badge: p.badge,
        ingredients: p.ingredients,
        servingInfo: p.servingInfo,
      },
    });

    // Replace images
    await prisma.productImage.deleteMany({ where: { productId: created.id } });
    await prisma.productImage.createMany({
      data: p.images.map((url, i) => ({ productId: created.id, url, sortOrder: i, alt: p.name })),
    });

    console.log(`Upserted product: ${p.slug}`);
  }
}

async function removeRetiredProducts() {
  for (const slug of retiredSlugs) {
    const p = await prisma.product.findUnique({ where: { slug } });
    if (!p) continue;
    await prisma.product.delete({ where: { id: p.id } });
    console.log(`Removed retired product: ${slug}`);
  }
}

(async () => {
  try {
    await ensureAdmin();
    await removeRetiredProducts();
    await upsertProducts();
    console.log('Seed complete.');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
