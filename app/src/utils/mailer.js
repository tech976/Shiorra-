// Transactional email — provider-agnostic SMTP (Resend / Brevo / SES / Gmail).
//
// Design goals:
//   1. Never break the order flow. Every public function catches its own
//      errors; a mail failure is logged, never thrown to the request.
//   2. Dormant until configured. With no MAIL_HOST / MAIL_PASS in the env the
//      transport is never created — we just log "[mailer] skipped" and return.
//   3. Idempotent-friendly. sendOrderConfirmation is safe to call more than
//      once for an order; the caller decides when (we don't dedupe here).
const nodemailer = require('nodemailer');
const env = require('../config/env');
const prisma = require('../config/db');
const { formatINR } = require('./money');

let transportPromise = null;

function isEnabled() {
  return !!(env.mail.resendApiKey || (env.mail.host && env.mail.pass));
}

// Resend's HTTP API. Preferred over SMTP because VPS providers commonly block
// outbound mail ports, which fails silently in production; 443 always works.
// Throws on a non-2xx so sendMail's existing catch reports the real reason.
async function sendViaResend({ to, subject, html, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.mail.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.mail.from,
      reply_to: env.mail.replyTo || undefined,
      to: [to],
      subject,
      html,
      text: text || undefined,
    }),
    // Never let a hanging request pin an order request open.
    signal: AbortSignal.timeout(10_000),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Resend puts the actionable detail (e.g. unverified domain) in `message`.
    throw new Error(body.message || `Resend responded ${res.status}`);
  }
  return body.id;
}

// Lazily build (and cache) the transport. Returns null when not configured.
function getTransport() {
  if (!isEnabled()) return null;
  if (!transportPromise) {
    transportPromise = Promise.resolve(
      nodemailer.createTransport({
        host: env.mail.host,
        port: env.mail.port,
        secure: env.mail.secure,
        auth: { user: env.mail.user, pass: env.mail.pass },
      })
    );
  }
  return transportPromise;
}

// Low-level send. Resolves { skipped } when disabled, { sent, id } on success,
// { error } on failure — but never rejects, so callers can fire-and-forget.
async function sendMail({ to, subject, html, text }) {
  if (!to) return { error: 'no recipient' };
  if (!isEnabled()) {
    console.log(`[mailer] skipped (not configured) → would send "${subject}" to ${to}`);
    return { skipped: true };
  }
  try {
    let id;
    if (env.mail.resendApiKey) {
      id = await sendViaResend({ to, subject, html, text });
    } else {
      const t = await getTransport();
      const info = await t.sendMail({
        from: env.mail.from,
        replyTo: env.mail.replyTo || undefined,
        to,
        subject,
        text: text || undefined,
        html,
      });
      id = info.messageId;
    }
    console.log(`[mailer] sent "${subject}" to ${to} (${id})`);
    return { sent: true, id };
  } catch (err) {
    console.error(`[mailer] FAILED "${subject}" to ${to}:`, err.message);
    return { error: err.message };
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Recipient for an order: the account email, else the guest email.
function orderEmail(order) {
  return (order.user && order.user.email) || order.guestEmail || null;
}

function paymentLabel(order) {
  if (order.paymentStatus === 'CAPTURED') return 'Paid online';
  if ((order.notes || '').toLowerCase().includes('cash on delivery')) return 'Cash on Delivery';
  return 'Pending';
}

function renderOrderConfirmationHtml(order) {
  const brandGreen = '#23867F';
  const ink = '#15171A';
  const muted = '#6A6F75';
  const line = '#ECECEC';
  const trackUrl = `${env.appUrl}/track`;

  const rows = order.items
    .map(
      (it) => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid ${line};color:${ink};font-size:14px;">
            ${escapeHtml(it.name)}
            <span style="color:${muted};font-size:12px;"> &times; ${it.quantity}</span>
          </td>
          <td style="padding:12px 0;border-bottom:1px solid ${line};color:${ink};font-size:14px;text-align:right;white-space:nowrap;">
            ${formatINR(it.totalInPaise)}
          </td>
        </tr>`
    )
    .join('');

  const addr = order.shippingAddress;
  const addressBlock = addr
    ? `
      <p style="margin:0;color:${ink};font-size:14px;line-height:1.7;">
        <strong>${escapeHtml(addr.fullName)}</strong><br>
        ${escapeHtml(addr.line1)}<br>
        ${addr.line2 ? escapeHtml(addr.line2) + '<br>' : ''}
        ${escapeHtml(addr.city)}, ${escapeHtml(addr.state)} ${escapeHtml(addr.postcode)}<br>
        ${escapeHtml(addr.country)}<br>
        <span style="color:${muted};">${escapeHtml(addr.phone)}</span>
      </p>`
    : '';

  const summaryRow = (label, value, opts = {}) => `
    <tr>
      <td style="padding:4px 0;color:${opts.bold ? ink : muted};font-size:${opts.bold ? '16px' : '14px'};${opts.bold ? 'font-weight:600;' : ''}">${label}</td>
      <td style="padding:4px 0;text-align:right;color:${opts.bold ? ink : muted};font-size:${opts.bold ? '16px' : '14px'};${opts.bold ? 'font-weight:600;' : ''}">${value}</td>
    </tr>`;

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#F4F5F6;">
    <div style="display:none;max-height:0;overflow:hidden;">Your Shiōrra order ${escapeHtml(order.orderNumber)} is confirmed.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F6;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid ${line};border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 8px;text-align:center;">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;letter-spacing:0.04em;color:${brandGreen};font-weight:600;">Shiōrra</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 0;text-align:center;">
              <h1 style="margin:12px 0 6px;font-family:Helvetica,Arial,sans-serif;font-size:22px;color:${ink};font-weight:600;">Thank you for your order</h1>
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${muted};line-height:1.6;">
                We've received your order and are getting it ready. We'll email you again the moment it ships.
              </p>
              <p style="margin:16px 0 0;font-family:ui-monospace,Menlo,monospace;font-size:13px;color:${ink};background:#F4F5F6;border:1px solid ${line};border-radius:8px;display:inline-block;padding:6px 12px;">
                Order #${escapeHtml(order.orderNumber)}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Helvetica,Arial,sans-serif;">
                ${rows}
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Helvetica,Arial,sans-serif;margin-top:14px;">
                ${summaryRow('Subtotal', formatINR(order.subtotalInPaise))}
                ${order.discountInPaise ? summaryRow('Discount', '−' + formatINR(order.discountInPaise)) : ''}
                ${summaryRow('Shipping', order.shippingInPaise ? formatINR(order.shippingInPaise) : 'Free')}
                ${summaryRow('Total', formatINR(order.totalInPaise), { bold: true })}
              </table>
              <p style="margin:12px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12.5px;color:${muted};">
                Payment: ${paymentLabel(order)}
              </p>
            </td>
          </tr>
          ${
            addressBlock
              ? `<tr><td style="padding:20px 32px 0;">
                   <p style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${muted};font-weight:600;">Shipping to</p>
                   ${addressBlock}
                 </td></tr>`
              : ''
          }
          <tr>
            <td style="padding:28px 32px 32px;text-align:center;">
              <a href="${trackUrl}" style="display:inline-block;background:${brandGreen};color:#FFFFFF;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;padding:13px 28px;border-radius:10px;">Track your order</a>
              <p style="margin:20px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${muted};line-height:1.6;">
                Questions? Just reply to this email or write to
                <a href="mailto:${escapeHtml(env.mail.replyTo)}" style="color:${brandGreen};text-decoration:none;">${escapeHtml(env.mail.replyTo)}</a>.
              </p>
            </td>
          </tr>
        </table>
        <p style="max-width:560px;margin:20px auto 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#9AA0A6;text-align:center;line-height:1.6;">
          Shiōrra — a trademark of K.C. Laboratories. Made in India.<br>
          You're receiving this because you placed an order at shiorra.com.
        </p>
      </td></tr>
    </table>
  </body>
  </html>`;
}

function renderOrderConfirmationText(order) {
  const lines = [
    `Thank you for your order`,
    ``,
    `Order #${order.orderNumber}`,
    ``,
    ...order.items.map((it) => `  ${it.name} x${it.quantity}   ${formatINR(it.totalInPaise)}`),
    ``,
    `Subtotal: ${formatINR(order.subtotalInPaise)}`,
    order.discountInPaise ? `Discount: -${formatINR(order.discountInPaise)}` : null,
    `Shipping: ${order.shippingInPaise ? formatINR(order.shippingInPaise) : 'Free'}`,
    `Total: ${formatINR(order.totalInPaise)}`,
    `Payment: ${paymentLabel(order)}`,
    ``,
    `Track your order: ${env.appUrl}/track`,
    ``,
    `Questions? Reply to this email or write to ${env.mail.replyTo}.`,
    `Shiōrra — a trademark of K.C. Laboratories.`,
  ].filter(Boolean);
  return lines.join('\n');
}

// Send the order-confirmation email. Accepts an order id, order number, or a
// loaded order object; re-fetches everything it needs so callers stay lean.
// Fire-and-forget safe: always resolves, never throws.
async function sendOrderConfirmation(orderRef) {
  try {
    let order = orderRef;
    if (typeof orderRef === 'string') {
      order = await prisma.order.findFirst({
        where: orderRef.startsWith('SH-') ? { orderNumber: orderRef } : { id: orderRef },
        include: { items: true, shippingAddress: true, user: { select: { email: true } } },
      });
    } else if (orderRef && (!orderRef.items || !orderRef.shippingAddress || orderRef.user === undefined)) {
      order = await prisma.order.findUnique({
        where: { id: orderRef.id },
        include: { items: true, shippingAddress: true, user: { select: { email: true } } },
      });
    }
    if (!order) return { error: 'order not found' };

    const to = orderEmail(order);
    if (!to) {
      console.warn(`[mailer] order ${order.orderNumber} has no email — skipping confirmation`);
      return { skipped: true };
    }
    return sendMail({
      to,
      subject: `Your Shiōrra order ${order.orderNumber} is confirmed`,
      html: renderOrderConfirmationHtml(order),
      text: renderOrderConfirmationText(order),
    });
  } catch (err) {
    console.error('[mailer] sendOrderConfirmation error:', err.message);
    return { error: err.message };
  }
}

module.exports = { isEnabled, sendMail, sendOrderConfirmation };
