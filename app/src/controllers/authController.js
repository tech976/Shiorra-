const bcrypt = require('bcryptjs');
const { z } = require('zod');
const passport = require('../config/passport');
const prisma = require('../config/db');
const { mergeGuestCart } = require('./cartController');

const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().max(160),
  phone: z.string().min(7).max(20).optional().or(z.literal('')),
  password: z.string().min(8).max(120),
});

exports.showLogin = (req, res) => {
  res.render('auth/login', { title: 'Log in' });
};

exports.showRegister = (req, res) => {
  res.render('auth/register', { title: 'Create account', values: {} });
};

exports.login = (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      req.flash('error', info?.message || 'Login failed.');
      return res.redirect('/login');
    }
    req.logIn(user, async (loginErr) => {
      if (loginErr) return next(loginErr);
      await mergeGuestCart(req, user.id);
      const dest = req.session.returnTo || '/account';
      delete req.session.returnTo;
      req.flash('success', `Welcome back, ${user.name || user.email}.`);
      res.redirect(dest);
    });
  })(req, res, next);
};

exports.register = async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      req.flash('error', parsed.error.issues.map((i) => i.message).join(' · '));
      return res.render('auth/register', { title: 'Create account', values: req.body });
    }
    const { name, email, phone, password } = parsed.data;
    const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (exists) {
      req.flash('error', 'An account with that email already exists.');
      return res.render('auth/register', { title: 'Create account', values: req.body });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        phone: phone || null,
        passwordHash,
      },
    });
    req.logIn(user, async (err) => {
      if (err) return next(err);
      // Same as login: merge guest cart + honour returnTo so a guest who
      // came in via "Buy now → Sign up" lands on /checkout with their cart.
      await mergeGuestCart(req, user.id);
      const dest = req.session.returnTo || '/account';
      delete req.session.returnTo;
      req.flash('success', 'Account created.');
      res.redirect(dest);
    });
  } catch (err) {
    next(err);
  }
};

exports.logout = (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash('success', 'You have been logged out.');
    res.redirect('/');
  });
};
