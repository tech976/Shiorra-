function isAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  if (req.accepts('html')) {
    req.session.returnTo = req.originalUrl;
    req.flash && req.flash('error', 'Please log in to continue.');
    return res.redirect('/login');
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

function isAdmin(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user?.role === 'ADMIN') return next();
  if (req.accepts('html')) {
    return res.status(403).render('pages/error', {
      title: 'Forbidden',
      status: 403,
      message: 'You do not have access to that page.',
    });
  }
  return res.status(403).json({ error: 'Forbidden' });
}

function isGuest(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return res.redirect('/account');
  next();
}

module.exports = { isAuthenticated, isAdmin, isGuest };
