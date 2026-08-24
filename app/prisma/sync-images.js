// Sync ONLY the product gallery images to what the code says they should be.
// Run with: `npm run sync:images`
//
// Why this exists instead of `npm run seed`: the seed upserts every product
// field, including `stock` — which real orders decrement. Running it against a
// live shop silently resets inventory to the catalogue defaults. This script
// touches the ProductImage table and nothing else, so it is safe to run on
// production whenever the artwork changes.
//
// Idempotent: run it as often as you like.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const IMAGES = require('./product-images');

const prisma = new PrismaClient();
const PUBLIC_DIR = path.join(__dirname, '..', 'src', 'public');

(async () => {
  let changed = 0, skipped = 0, failed = false;
  try {
    for (const [slug, urls] of Object.entries(IMAGES)) {
      // Never point the catalogue at a file that is not deployed — a missing
      // image renders as a broken tile on every card across the site.
      const missing = urls.filter((u) => !fs.existsSync(path.join(PUBLIC_DIR, u)));
      if (missing.length) {
        console.error(`SKIPPED ${slug} — file(s) not on disk:\n  ${missing.join('\n  ')}`);
        skipped++; failed = true;
        continue;
      }

      const product = await prisma.product.findUnique({ where: { slug } });
      if (!product) { console.error(`SKIPPED ${slug} — no such product`); skipped++; continue; }

      const current = await prisma.productImage.findMany({
        where: { productId: product.id },
        orderBy: { sortOrder: 'asc' },
        select: { url: true },
      });
      if (current.length === urls.length && current.every((c, i) => c.url === urls[i])) {
        console.log(`unchanged ${slug}  [0]=${urls[0]}`);
        continue;
      }

      await prisma.productImage.deleteMany({ where: { productId: product.id } });
      await prisma.productImage.createMany({
        data: urls.map((url, i) => ({ productId: product.id, url, sortOrder: i, alt: product.name })),
      });
      console.log(`updated   ${slug}  ${current.length} -> ${urls.length} images, [0]=${urls[0]}`);
      changed++;
    }
    console.log(`\nDone. ${changed} updated, ${skipped} skipped.`);
    if (failed) process.exit(1);
  } catch (err) {
    console.error('sync-images failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
