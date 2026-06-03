const prisma = require('../config/db');

// Inject globals every view needs: current user, cart count, current path,
// and the small set of categories/links the header renders.
module.exports = async function locals(req, res, next) {
  res.locals.currentUser = req.user || null;
  res.locals.currentPath = req.path;
  res.locals.appName = 'Shiorra';
  res.locals.year = new Date().getFullYear();

  try {
    if (req.user) {
      const count = await prisma.cartItem.aggregate({
        where: { userId: req.user.id },
        _sum: { quantity: true },
      });
      res.locals.cartCount = count._sum.quantity || 0;
    } else {
      const guestCart = req.session?.guestCart || [];
      res.locals.cartCount = guestCart.reduce((n, it) => n + it.quantity, 0);
    }
  } catch (err) {
    res.locals.cartCount = 0;
  }
  next();
};
