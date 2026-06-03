const env = require('../config/env');

function notFound(req, res, next) {
  res.status(404);
  if (req.accepts('html')) {
    return res.render('pages/error', {
      title: 'Not found',
      status: 404,
      message: "We couldn't find that page.",
    });
  }
  return res.json({ error: 'Not found' });
}

function errorHandler(err, req, res, next) {
  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status);
  if (req.accepts('html')) {
    return res.render('pages/error', {
      title: 'Something went wrong',
      status,
      message: env.isProd ? 'Something went wrong on our end.' : err.message,
    });
  }
  return res.json({ error: err.message || 'Internal server error' });
}

module.exports = { notFound, errorHandler };
