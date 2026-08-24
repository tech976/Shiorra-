// Single source of truth for product gallery images.
//
// This lives apart from seed.js because two things need it and they must never
// drift: the full seed (fresh environments) and sync-images.js (existing ones).
// That drift is precisely what went wrong before — the database had the current
// art while seed.js still described the retired sku-* placeholders, so the code
// on disk disagreed with what every environment actually rendered.
//
// Order matters: index 0 is the card image. It is what the "Pair it with"
// tiles, shop and home cards, cart, checkout and admin list all read.
module.exports = {
  'advanced-iron': [
    '/img/products/iron-g1.png',
    '/img/products/iron-g2.png',
    '/img/products/iron-g3.png',
    '/img/products/iron-g4.png',
    '/img/products/iron-g5.png',
    '/img/products/iron-g6.png',
    '/img/products/iron-g7.png',
    '/img/products/iron-g8.png',
  ],
  // g4, g5 and g7 have no PNG on disk — the .jpg originals were dropped in the
  // format swap and never replaced. Add them here once the files exist.
  'advanced-ginger': [
    '/img/products/ginger-g1.png',
    '/img/products/ginger-g2.png',
    '/img/products/ginger-g3.png',
    '/img/products/ginger-g6.png',
    '/img/products/ginger-g8.png',
  ],
  'advanced-energyone': [
    '/img/products/energy-g1.png',
    '/img/products/energy-g2.png',
    '/img/products/energy-g3.png',
    '/img/products/energy-g4.png',
    '/img/products/energy-g5.png',
    '/img/products/energy-g6.png',
    '/img/products/energy-g7.png',
    '/img/products/energy-g8.png',
  ],
};
