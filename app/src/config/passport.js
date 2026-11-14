const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const prisma = require('./db');
const { findUserByPhone } = require('../services/customerAccount');

const BAD_LOGIN = 'Invalid email/phone or password.';

// The login box takes either an email or a mobile number. A phone only works
// when exactly one account has it — otherwise we can't tell who is logging in.
async function findLoginUser(identifier) {
  const id = String(identifier || '').trim();
  if (!id) return null;
  if (id.includes('@')) return prisma.user.findUnique({ where: { email: id.toLowerCase() } });
  return findUserByPhone(id);
}

passport.use(
  new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
      const user = await findLoginUser(email);
      if (!user) return done(null, false, { message: BAD_LOGIN });
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return done(null, false, { message: BAD_LOGIN });
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, role: true, phone: true, createdAt: true },
    });
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
