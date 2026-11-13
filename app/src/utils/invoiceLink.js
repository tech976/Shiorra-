// Signed invoice links.
//
// Magic Checkout buyers are guests at the moment they pay: the account is
// created from Razorpay's details seconds later, and they have not set a
// password yet. The existing invoice routes sit behind a login, so the person
// who just paid is the one person who cannot open their own invoice.
//
// A link carrying an HMAC of the order number fixes that without an account.
// It is unguessable, scoped to a single order, and reveals nothing but that
// order — the same pattern as an emailed receipt link anywhere else.
const crypto = require('crypto');
const env = require('../config/env');

// Keyed on the session secret so it rotates with the app's other secrets and
// needs no extra configuration.
function secret() {
  return env.sessionSecret || env.razorpay.keySecret || 'shiorra-invoice';
}

function tokenFor(orderNumber) {
  return crypto
    .createHmac('sha256', secret())
    .update(`invoice:${orderNumber}`)
    .digest('hex')
    .slice(0, 32);
}

function isValid(orderNumber, token) {
  if (!orderNumber || !token) return false;
  const expected = tokenFor(orderNumber);
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  // Constant-time compare, and length-check first since timingSafeEqual throws
  // on a mismatch.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function urlFor(orderNumber) {
  const base = (env.siteUrl || 'https://shiorra.com').replace(/\/$/, '');
  return `${base}/invoice/${encodeURIComponent(orderNumber)}?t=${tokenFor(orderNumber)}`;
}

module.exports = { tokenFor, isValid, urlFor };
