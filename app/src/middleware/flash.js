// Minimal flash helper — replacement for connect-flash, avoids the extra dep.
// Reads/writes req.session.flash. Survives one request.

module.exports = function flash() {
  return function (req, res, next) {
    if (!req.session) return next();

    req.flash = function (type, msg) {
      if (!req.session.flash) req.session.flash = {};
      if (msg === undefined) {
        const all = req.session.flash[type] || [];
        delete req.session.flash[type];
        return all;
      }
      if (!req.session.flash[type]) req.session.flash[type] = [];
      req.session.flash[type].push(msg);
    };

    // Expose to views on each render
    const origRender = res.render.bind(res);
    res.render = function (view, locals = {}, cb) {
      const messages = {
        error: req.flash('error'),
        success: req.flash('success'),
        info: req.flash('info'),
      };
      return origRender(view, { ...locals, flash: messages }, cb);
    };

    next();
  };
};
