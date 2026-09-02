// Single source of truth for product gallery images.
//
// This lives apart from seed.js because two things need it and they must never
// drift: the full seed (fresh environments) and sync-images.js (existing ones).
// That drift is precisely what went wrong before — the database had the current
// art while seed.js still described the retired sku-* placeholders, so the code
// on disk disagreed with what every environment actually rendered.
//
// Order matters: index 0 is the card image. It is what the "Pair it with"
// tiles, shop and home cards, cart, checkout and admin list all read. Indexes
// 1+ are the gallery, read by the admin product form and the generic product
// template. The three styled PDPs build their own galleries from the same
// files, so keep these lists matching what those pages show.
//
// No query strings: sync-images.js checks each path against the filesystem
// before writing it, and a "?v=" suffix would fail that check.
//
// Generations of art, newest first — only the current one should be pointed at:
//   -n*   Aug 31 gallery set. Current, and what the Iron+ / EnergyOne+ PDPs use.
//   -home Aug 21 card art, shared with the home page product cards.
//   -g*   Aug 20 gallery set. Superseded by -n* for Iron+ and EnergyOne+;
//         still current for Ginger+, which never got an -n* export.
//   sku-* Aug 19 placeholders from the retired four-SKU lineup. Dead — the
//         files remain in the repo but nothing points at them.
module.exports = {
  'advanced-iron': [
    '/img/products/iron-home.png',
    '/img/products/iron-n1.png',
    '/img/products/iron-n2.png',
    '/img/products/iron-n3.png',
    '/img/products/iron-n4.png',
    '/img/products/iron-n5.png',
    '/img/products/iron-n6.png',
    '/img/products/iron-n7.png',
  ],
  // No -n* export exists for Ginger+, so the -g* set is still its current art.
  // g4, g5 and g7 have no PNG on disk — the .jpg originals were dropped in the
  // format swap and never replaced. Add them here once the files exist.
  'advanced-ginger': [
    '/img/products/ginger-home.png',
    '/img/products/ginger-g1.png',
    '/img/products/ginger-g2.png',
    '/img/products/ginger-g3.png',
    '/img/products/ginger-g6.png',
    '/img/products/ginger-g8.png',
  ],
  'advanced-energyone': [
    '/img/products/energy-home.png',
    '/img/products/energy-n1.png',
    '/img/products/energy-n2.png',
    '/img/products/energy-n3.png',
    '/img/products/energy-n4.png',
    '/img/products/energy-n5.png',
    '/img/products/energy-n6.png',
  ],
};
