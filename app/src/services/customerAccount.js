// Turning a Magic Checkout buyer into an account holder.
//
// Magic Checkout is deliberately frictionless — nobody signs up, they just
// pay. But the details Razorpay hands back (email, name, phone) are enough to
// give them a real account so they can log in and see their orders.
//
// The account is created WITHOUT a usable password: a random hash nobody can
// produce. The only way in is the set-password link we email, which proves
// they own the address. That way an auto-created account is never a login
// someone else could guess into.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../config/db');

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // a week — these arrive by email

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Issue a single-use set/reset token. Returns the RAW token for the email;
// only its hash is stored, so a database leak cannot be replayed into a login.
async function issueResetToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.user.update({
    where: { id: userId },
    data: {
      resetTokenHash: hashToken(token),
      resetTokenExpiry: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });
  return token;
}

async function findByResetToken(token) {
  if (!token) return null;
  const user = await prisma.user.findUnique({ where: { resetTokenHash: hashToken(token) } });
  if (!user) return null;
  if (!user.resetTokenExpiry || user.resetTokenExpiry < new Date()) return null;
  return user;
}

async function consumeResetToken(userId, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, resetTokenHash: null, resetTokenExpiry: null, emailVerified: true },
  });
}

// Find or create the account behind a checkout. Returns { user, isNew } —
// null when there is no email to key on, since email IS the identity here.
async function ensureCustomer({ email, name, phone }) {
  const addr = String(email || '').trim().toLowerCase();
  if (!addr || !addr.includes('@')) return null;

  const existing = await prisma.user.findUnique({ where: { email: addr } });
  if (existing) {
    // Fill blanks from the checkout, but never overwrite what they set
    // themselves, and never touch their password or role.
    const patch = {};
    if (!existing.name && name) patch.name = name;
    if (!existing.phone && phone) patch.phone = phone;
    const user = Object.keys(patch).length
      ? await prisma.user.update({ where: { id: existing.id }, data: patch })
      : existing;
    return { user, isNew: false };
  }

  // Unusable password — login is only possible via the emailed link.
  const unusable = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  const user = await prisma.user.create({
    data: {
      email: addr,
      passwordHash: unusable,
      name: name || null,
      phone: phone || null,
      emailVerified: false,
    },
  });
  return { user, isNew: true };
}

module.exports = { ensureCustomer, issueResetToken, findByResetToken, consumeResetToken };
