const path = require('path');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const expressLayouts = require('express-ejs-layouts');
const methodOverride = require('method-override');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');
const passport = require('./config/passport');
const flash = require('./middleware/flash');
const locals = require('./middleware/locals');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { formatINR } = require('./utils/money');

const app = express();

// Trust the reverse proxy on a VPS (Nginx) so req.ip / secure cookies work.
app.set('trust proxy', 1);

// View engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layouts/main');
app.locals.formatINR = formatINR;

// Security + logging
app.use(
  helmet({
    contentSecurityPolicy: env.isProd
      ? {
          useDefaults: true,
          directives: {
            'default-src': ["'self'"],
            'script-src': ["'self'", "'unsafe-inline'", 'https://checkout.razorpay.com', 'https://unpkg.com'],
            'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
            'img-src': ["'self'", 'data:', 'https:'],
            'frame-src': ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
            'connect-src': ["'self'", 'https://api.razorpay.com'],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(morgan(env.isProd ? 'combined' : 'dev'));

// Body parsing — note the Razorpay webhook needs RAW body, so its route uses express.raw() locally
app.use((req, res, next) => {
  if (req.originalUrl === '/checkout/webhook') return next();
  express.json({ limit: '1mb' })(req, res, next);
});
app.use((req, res, next) => {
  if (req.originalUrl === '/checkout/webhook') return next();
  express.urlencoded({ extended: true, limit: '1mb' })(req, res, next);
});
app.use(methodOverride('_method'));

// Static assets
app.use(express.static(path.join(__dirname, 'public'), { maxAge: env.isProd ? '7d' : 0 }));

// Sessions — Postgres-backed in production, memory in dev
const sessionStore =
  env.isProd && env.databaseUrl
    ? new PgSession({
        conString: env.databaseUrl,
        tableName: 'user_sessions',
        createTableIfMissing: true,
      })
    : undefined;

app.use(
  session({
    store: sessionStore,
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: env.isProd,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());
app.use(locals);

// Global rate limit — generous, just to slow obvious abuse
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Routes
app.use('/', require('./routes/storefront'));
app.use('/', require('./routes/auth'));
app.use('/account', require('./routes/account'));
app.use('/cart', require('./routes/cart'));
app.use('/checkout', require('./routes/checkout'));
app.use('/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));

// 404 + error handler
app.use(notFound);
app.use(errorHandler);

module.exports = app;
