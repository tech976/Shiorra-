const bcrypt = require('bcryptjs');
const { z } = require('zod');
const passport = require('../config/passport');
const prisma = require('../config/db');
const { mergeGuestCart } = require('./cartController');
const customerAccount = require('../services/customerAccount');
const mailer = require('../utils/mailer');
const env = require('../config/env');
const prismaClient = require('../config/db');

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
    // Capture BEFORE req.logIn — passport 0.7 regenerates the session and
    // wipes guestCart/returnTo, so read them now while they still exist.
    const guestCart = req.session.guestCart || [];
    const returnTo = req.session.returnTo || '/account';
    req.logIn(user, async (loginErr) => {
      if (loginErr) return next(loginErr);
      await mergeGuestCart(user.id, guestCart);
      delete req.session.returnTo;
      req.flash('success', `Welcome back, ${user.name || user.email}.`);
      res.redirect(returnTo);
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
    // Capture BEFORE req.logIn (passport 0.7 regenerates the session).
    const guestCart = req.session.guestCart || [];
    const returnTo = req.session.returnTo || '/account';
    req.logIn(user, async (err) => {
      if (err) return next(err);
      // Same as login: merge guest cart + honour returnTo so a guest who
      // came in via "Buy now → Sign up" lands on /checkout with their cart.
      await mergeGuestCart(user.id, guestCart);
      delete req.session.returnTo;
      req.flash('success', 'Account created.');
      res.redirect(returnTo);
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


// GET /set-password?token=... — the link emailed to auto-created customers,
// and the same page a password reset lands on.
exports.showSetPassword = async (req, res) => {
  const user = await customerAccount.findByResetToken(req.query.token);
  if (!user) {
    req.flash('error', 'That link has expired or already been used. Request a new one below.');
    return res.redirect('/forgot-password');
  }
  res.render('pages/set-password', {
    title: 'Set your password',
    token: req.query.token,
    email: user.email,
  });
};

// POST /set-password — consume the token, set the password, log them straight
// in so they land on their orders rather than a second login form.
exports.setPassword = async (req, res, next) => {
  try {
    const { token, password, confirm } = req.body;
    const user = await customerAccount.findByResetToken(token);
    if (!user) {
      req.flash('error', 'That link has expired or already been used.');
      return res.redirect('/forgot-password');
    }
    if (!password || String(password).length < 8) {
      req.flash('error', 'Password must be at least 8 characters.');
      return res.redirect(`/set-password?token=${encodeURIComponent(token)}`);
    }
    if (password !== confirm) {
      req.flash('error', 'Those passwords do not match.');
      return res.redirect(`/set-password?token=${encodeURIComponent(token)}`);
    }
    await customerAccount.consumeResetToken(user.id, password);
    const fresh = await prismaClient.user.findUnique({ where: { id: user.id } });
    req.logIn(fresh, (err) => {
      if (err) return next(err);
      req.flash('success', 'Password set. Here are your orders.');
      res.redirect('/account/orders');
    });
  } catch (err) {
    next(err);
  }
};

// POST /forgot-password — always answers the same way, so the form cannot be
// used to discover which email addresses have accounts.
exports.forgotPassword = async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = email ? await prismaClient.user.findUnique({ where: { email } }) : null;
    if (user) {
      const token = await customerAccount.issueResetToken(user.id);
      const link = `${env.siteUrl}/set-password?token=${token}`;
      mailer.sendMail({
        to: user.email,
        subject: 'Reset your Shiorra password',
        text: `Reset your password: ${link}\n\nThe link works for 7 days. If you did not ask for this, ignore this email.`,
        html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#282828">
          <h2>Reset your password</h2>
          <p style="line-height:1.6;color:#4a4a4a">Click below to choose a new password.</p>
          <p style="margin:26px 0"><a href="${link}" style="background:#23867F;color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">Reset password</a></p>
          <p style="font-size:13px;color:#8a8a8a">The link works for 7 days. If you did not ask for this, ignore this email.</p>
        </div>`,
      }).catch((e) => console.error('[forgot-password] mail failed:', e?.message || e));
    }
    req.flash('success', 'If that email has an account, a reset link is on its way.');
    res.redirect('/login');
  } catch (err) {
    next(err);
  }
};
