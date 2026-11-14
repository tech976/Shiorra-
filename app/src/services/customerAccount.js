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
  const byEmail = await prisma.order.findMany({
    where: {
      userId: null,
      guestEmail: { equals: user.email, mode: 'insensitive' },
      status: { not: 'PENDING' },
    },
    select: { id: true },
  });
  const ids = new Set(byEmail.map((o) => o.id));
  for (const id of await phoneOnlyOrderIds(user)) ids.add(id);
  if (ids.size) {
    await prisma.order.updateMany({
      where: { id: { in: [...ids] }, userId: null },
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
  return ids.size;
}

// Indian mobile numbers arrive as "+91 76664 47338", "917666447338",
// "07666447338" or "7666447338" depending on who typed them (Razorpay always
// sends +91). Compare on the last 10 digits. null when it isn't a real number.
function phoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

// Same normalisation, done in SQL so it works on whatever format is stored.
const SQL_PHONE_KEY = (col) => `right(regexp_replace(coalesce(${col}, ''), '[^0-9]', '', 'g'), 10)`;

// Accounts whose phone matches. Phone numbers aren't unique, so callers
// that need one person must check there is exactly one.
async function usersByPhone(phone) {
  const key = phoneKey(phone);
  if (!key) return [];
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id FROM "User" WHERE ${SQL_PHONE_KEY('phone')} = $1`,
    key,
  );
  if (!rows.length) return [];
  return prisma.user.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
}

// The single account with this phone, or null if none / ambiguous.
async function findUserByPhone(phone) {
  const users = await usersByPhone(phone);
  return users.length === 1 ? users[0] : null;
}

// Magic Checkout lets a buyer pay with just their phone: Razorpay sends no
// email, so such an order has nothing to match on except the delivery phone.
// Those orders go to the account with that phone, as long as exactly one
// account has it. Orders that DO carry an email stay keyed on that email, so
// a phone number can never pull in someone else's emailed order.
async function phoneOnlyOrderIds(user) {
  const key = phoneKey(user.phone);
  if (!key) return [];
  const owners = await usersByPhone(key);
  if (owners.length !== 1 || owners[0].id !== user.id) return [];
  const rows = await prisma.$queryRawUnsafe(
    `SELECT o.id FROM "Order" o
       JOIN "Address" a ON a.id = o."shippingAddressId"
      WHERE o."userId" IS NULL
        AND o.status <> 'PENDING'
        AND coalesce(o."guestEmail", '') = ''
        AND ${SQL_PHONE_KEY('a.phone')} = $1`,
    key,
  );
  return rows.map((r) => r.id);
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
  findUserByPhone,
  phoneKey,
  issueResetToken,
  findByResetToken,
  consumeResetToken,
};
