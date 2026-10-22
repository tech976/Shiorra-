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

// ---------------------------------------------------------------------------
// Fulfilment
// ---------------------------------------------------------------------------

const CMU_URL = 'https://track.delhivery.com/api/cmu/create.json';
const TRACK_URL = 'https://track.delhivery.com/api/v1/packages/json/';
const SHIP_TIMEOUT_MS = 15000; // admin-initiated, so it can wait longer than checkout

function pickupName() {
  return env.delhivery.pickupName;
}

async function postForm(url, params, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${env.delhivery.apiToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(params).toString(),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Push one order to Delhivery and come back with a waybill (AWB).
// Returns { ok, awb, raw } or { ok:false, error }.
//
// Unlike the checkout lookup this does NOT fail open: creating a shipment is a
// real-world commitment, and silently pretending it worked would leave a
// parcel nobody ships. Failures surface to the admin instead.
async function createShipment(order, address) {
  if (!isConfigured()) return { ok: false, error: 'DELHIVERY_API_TOKEN is not set.' };
  if (!pickupName()) {
    return { ok: false, error: 'DELHIVERY_PICKUP_NAME is not set — it must match the warehouse name registered in the Delhivery panel exactly.' };
  }
  if (!address) return { ok: false, error: 'Order has no shipping address yet.' };

  const payload = {
    shipments: [{
      name: address.fullName,
      add: [address.line1, address.line2].filter(Boolean).join(', '),
      pin: address.postcode,
      city: address.city,
      state: address.state,
      country: address.country || 'India',
      phone: address.phone,
      order: order.orderNumber,
      // Magic Checkout is prepaid-only, and COD orders are captured before
      // shipping too, so nothing here is collected on delivery.
      payment_mode: 'Prepaid',
      total_amount: Math.round((order.totalInPaise || 0) / 100),
      cod_amount: 0,
      products_desc: (order.items || []).map((i) => `${i.name} x${i.quantity}`).join(', ').slice(0, 250) || 'Health supplement',
      quantity: (order.items || []).reduce((n, i) => n + i.quantity, 0) || 1,
      waybill: '',
    }],
    pickup_location: { name: pickupName() },
  };

  try {
    const res = await postForm(CMU_URL, { format: 'json', data: JSON.stringify(payload) }, SHIP_TIMEOUT_MS);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) {
      return { ok: false, error: `Delhivery returned non-JSON (HTTP ${res.status}): ${text.slice(0, 160)}` };
    }
    const pkg = data?.packages?.[0];
    const awb = pkg?.waybill;
    if (!awb) {
      const why = pkg?.remarks?.join?.('; ') || data?.rmk || data?.error || JSON.stringify(data).slice(0, 220);
      return { ok: false, error: `Delhivery did not issue a waybill: ${why}` };
    }
    return { ok: true, awb, raw: data };
  } catch (err) {
    const why = err?.name === 'AbortError' ? `timeout after ${SHIP_TIMEOUT_MS}ms` : err?.message;
    return { ok: false, error: `Delhivery request failed: ${why}` };
  }
}

// Current scan status for a waybill. Returns { ok, status, statusType, raw }.
async function trackShipment(awb) {
  if (!isConfigured()) return { ok: false, error: 'DELHIVERY_API_TOKEN is not set.' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SHIP_TIMEOUT_MS);
  try {
    const res = await fetch(`${TRACK_URL}?waybill=${encodeURIComponent(awb)}`, {
      headers: { Authorization: `Token ${env.delhivery.apiToken}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    const data = await res.json();
    const shipment = data?.ShipmentData?.[0]?.Shipment;
    if (!shipment) return { ok: false, error: 'No shipment found for that waybill.' };
    return {
      ok: true,
      status: shipment.Status?.Status || null,
      statusType: shipment.Status?.StatusType || null,
      instructions: shipment.Status?.Instructions || null,
      raw: shipment,
    };
  } catch (err) {
    const why = err?.name === 'AbortError' ? 'timeout' : err?.message;
    return { ok: false, error: `Tracking failed: ${why}` };
  } finally {
    clearTimeout(timer);
  }
}

function trackingUrlFor(awb) {
  return `https://www.delhivery.com/track/package/${encodeURIComponent(awb)}`;
}

module.exports = { checkPincode, isConfigured, createShipment, trackShipment, trackingUrlFor, pickupName };
