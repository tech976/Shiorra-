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

// Same person, same street — compare loosely so "Flat 4, MG Rd" typed twice
// with different spacing/case doesn't fill the address book with copies.
const addrKey = (a) =>
  [a.line1, a.postcode, a.phone].map((v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '')).join('|');

// Attach every order placed under this email to the account, so whoever logs
// in with that email sees their history and profile, however they checked out
// (guest card payment, COD, Magic Checkout, or before the account existed).
//
// Only PLACED orders are claimed — a PENDING row is a checkout someone opened
// and walked away from, and must not show up as an order in their account.
// The shipping addresses come along into the address book (minus duplicates),
// and the newest becomes the default if they have none yet.
// Returns the number of orders claimed.
async function claimGuestOrders(user) {
  if (!user?.id || !user.email) return 0;
  const orders = await prisma.order.findMany({
    where: {
      userId: null,
      guestEmail: { equals: user.email, mode: 'insensitive' },
      status: { not: 'PENDING' },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, shippingAddress: true },
  });
  if (orders.length) {
    await prisma.order.updateMany({
      where: { id: { in: orders.map((o) => o.id) } },
      data: { userId: user.id },
    });
  }

  // Bring the shipping addresses of ALL their placed orders into the book —
  // including ones already linked (Magic Checkout attaches the order but its
  // address arrives separately), skipping duplicates of what's there.
  const linked = await prisma.order.findMany({
    where: { userId: user.id, status: { not: 'PENDING' }, shippingAddress: { userId: null } },
    orderBy: { createdAt: 'desc' },
    select: { shippingAddress: true },
  });
  const book = await prisma.address.findMany({ where: { userId: user.id } });
  const seen = new Set(book.map(addrKey));
  const adopt = [];
  for (const { shippingAddress: a } of linked) {
    if (!a) continue;
    const key = addrKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    adopt.push(a.id);
  }
  if (adopt.length) {
    await prisma.address.updateMany({ where: { id: { in: adopt }, userId: null }, data: { userId: user.id } });
  }
  await ensureDefaultAddress(user.id);
  return orders.length;
}

// Give the account a default address if it has addresses but none is default.
async function ensureDefaultAddress(userId) {
  const hasDefault = await prisma.address.count({ where: { userId, isDefault: true } });
  if (hasDefault) return;
  const newest = await prisma.address.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
  if (newest) await prisma.address.update({ where: { id: newest.id }, data: { isDefault: true } });
}

module.exports = {
  ensureCustomer,
  claimGuestOrders,
  ensureDefaultAddress,
  issueResetToken,
  findByResetToken,
  consumeResetToken,
};
