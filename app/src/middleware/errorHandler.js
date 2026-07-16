const env = require('../config/env');

// A browser fetch() with no Accept header sends `Accept: */*`, which
// req.accepts('html') happily matches — so API callers were being handed a
// rendered HTML error page and choked on `await res.json()`. Treat a request
// as an API call when it POSTs JSON, is an XHR, or explicitly prefers JSON.
function wantsJson(req) {
  if (req.xhr) return true;
  if (req.is('json')) return true;
  const accept = req.headers.accept || '';
  return accept.includes('application/json') && !accept.includes('text/html');
}

function notFound(req, res, next) {
  res.status(404);
  if (wantsJson(req)) {
    return res.json({ error: 'Not found' });
  }
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
  if (wantsJson(req)) {
    return res.json({ error: env.isProd ? 'Something went wrong on our end.' : (err.message || 'Internal server error') });
  }
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
