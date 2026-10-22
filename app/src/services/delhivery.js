// Delhivery pincode serviceability.
//
// Sits on the Magic Checkout path: Razorpay calls /checkout/shipping-info
// while the customer is typing their address, so this must be fast and must
// never be the reason a checkout stalls. Hence the cache and the timeout.
//
// Contract (verified against the live API):
//   serviceable      -> delivery_codes[0].postal_code with pre_paid === 'Y'
//   not serviceable  -> delivery_codes: []
const env = require('../config/env');

const BASE = 'https://track.delhivery.com/c/api/pin-codes/json/';
const TIMEOUT_MS = 4000;
const TTL_MS = 24 * 60 * 60 * 1000;   // pincode coverage barely moves day to day
const NEG_TTL_MS = 60 * 60 * 1000;    // re-check "no" sooner than "yes"

const cache = new Map(); // pin -> { at, ttl, value }

function cached(pin) {
  const hit = cache.get(pin);
  if (!hit) return null;
  if (Date.now() - hit.at > hit.ttl) {
    cache.delete(pin);
    return null;
  }
  return hit.value;
}

function remember(pin, value) {
  cache.set(pin, { at: Date.now(), ttl: value.serviceable ? TTL_MS : NEG_TTL_MS, value });
  return value;
}

function isConfigured() {
  return !!env.delhivery.apiToken;
}

// Returns { serviceable, cod, oda, district, state, source }.
//
// On any failure this FAILS OPEN — an unreachable Delhivery must not stop the
// whole shop from selling. The wrong call here costs one order that needs a
// manual follow-up; the other way costs every order while they are down.
// Each fallback is logged so the blast radius is visible.
async function checkPincode(rawPin) {
  const pin = String(rawPin || '').trim();
  if (!/^[1-9][0-9]{5}$/.test(pin)) {
    return { serviceable: false, cod: false, oda: false, source: 'invalid-pin' };
  }
  if (!isConfigured()) {
    // No token (local dev): assume serviceable so checkout stays testable.
    return { serviceable: true, cod: false, oda: false, source: 'unconfigured' };
  }

  const hit = cached(pin);
  if (hit) return { ...hit, source: 'cache' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}?filter_codes=${encodeURIComponent(pin)}`, {
      headers: { Authorization: `Token ${env.delhivery.apiToken}` },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error(`[delhivery] ${pin} -> HTTP ${res.status}; failing open`);
      return { serviceable: true, cod: false, oda: false, source: 'fallback-http' };
    }
    const data = await res.json();
    const pc = data?.delivery_codes?.[0]?.postal_code;
    if (!pc) {
      return remember(pin, { serviceable: false, cod: false, oda: false });
    }
    return remember(pin, {
      serviceable: pc.pre_paid === 'Y',
      cod: pc.cod === 'Y',
      oda: pc.is_oda === 'Y',          // reachable, but slower / surcharged
      district: pc.district,
      state: pc.state_code,
    });
  } catch (err) {
    const why = err?.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : err?.message;
    console.error(`[delhivery] ${pin} -> ${why}; failing open`);
    return { serviceable: true, cod: false, oda: false, source: 'fallback-error' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { checkPincode, isConfigured };
