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
  const authed = req.isAuthenticated && req.isAuthenticated();
  // Not logged in at all → send them to /login with a returnTo so they land
  // back on the admin page after sign-in. This is the most common cause of
  // the previous "403 Forbidden" on /admin: the visitor just hadn't logged in.
  if (!authed) {
    if (req.accepts('html')) {
      req.session.returnTo = req.originalUrl;
      req.flash && req.flash('error', 'Please log in as an admin to continue.');
      return res.redirect('/login');
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // Logged in but not an admin → real 403.
  if (req.user?.role !== 'ADMIN') {
    if (req.accepts('html')) {
      return res.status(403).render('pages/error', {
        title: 'Forbidden',
        status: 403,
        message: 'You are signed in, but this page is for admins only.',
      });
    }
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
}

function isGuest(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return res.redirect('/account');
  next();
}

module.exports = { isAuthenticated, isAdmin, isGuest };
