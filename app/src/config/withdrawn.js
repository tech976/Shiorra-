// Products withdrawn from sale, enforced in CODE rather than only by the
// database's `active` flag.
//
// Why both: `active: false` is the right switch, but it lives in each
// environment's database, so it only takes effect where somebody remembers to
// run it. deploy.sh does git reset + npm ci + migrate + pm2 reload and never
// touches product rows, so a deploy alone left production still selling a
// product the code had taken down. This list ships with the code, so
// withdrawing something is a deploy and nothing else.
//
// Admin is deliberately NOT filtered — the product stays visible there so it
// can be inspected and re-listed.
//
// To re-list: remove the slug here AND set `active: true` (admin panel, or
// `npm run seed`), then un-comment the matching view blocks —
// `grep -rn "TEMPORARILY DOWN" src prisma`.
const WITHDRAWN_SLUGS = ['advanced-ginger'];

// Prisma `where` fragment. Spread into a query alongside `active: true`.
const notWithdrawn = WITHDRAWN_SLUGS.length
  ? { slug: { notIn: WITHDRAWN_SLUGS } }
  : {};

// Guard for a product already loaded by id (cart add, buy now).
const isWithdrawn = (product) =>
  !!product && WITHDRAWN_SLUGS.includes(product.slug);

// Guard for a list of loaded products (cart contents).
const sellable = (product) =>
  !!product && product.active && !isWithdrawn(product);

module.exports = { WITHDRAWN_SLUGS, notWithdrawn, isWithdrawn, sellable };
