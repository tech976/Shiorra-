// One-off backfill: attach past guest orders to accounts by email.
//
// Checkout now links every placed order to an account keyed on the buyer's
// email (see services/customerAccount.js). Orders placed before that change
// are still ownerless, so their buyers log in and see nothing. This gives each
// such email an account (locked, like a checkout-created one — they get in via
// "Forgot password", which proves they own the address) and claims the orders.
//
// Sends NO email. Safe to re-run: already-linked orders are skipped.
//
//   node prisma/link-guest-orders.js            # apply
//   node prisma/link-guest-orders.js --dry-run  # just report
require('dotenv').config();
const prisma = require('../src/config/db');
const customerAccount = require('../src/services/customerAccount');

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const orders = await prisma.order.findMany({
    where: { userId: null, guestEmail: { not: null }, status: { not: 'PENDING' } },
    orderBy: { createdAt: 'desc' },
    select: { orderNumber: true, guestEmail: true, shippingAddress: { select: { fullName: true, phone: true } } },
  });

  // Newest order per email supplies the name/phone for a new account.
  const byEmail = new Map();
  for (const o of orders) {
    const email = o.guestEmail.trim().toLowerCase();
    if (!email.includes('@')) continue;
    if (!byEmail.has(email)) byEmail.set(email, { latest: o, count: 0 });
    byEmail.get(email).count += 1;
  }

  console.log(`${orders.length} unlinked placed order(s) across ${byEmail.size} email(s)${dryRun ? ' (dry run)' : ''}`);
  let created = 0;
  let linked = 0;
  for (const [email, { latest, count }] of byEmail) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (dryRun) {
      console.log(`  ${existing ? 'existing' : 'new     '}  ${count} order(s)`);
      continue;
    }
    const res = await customerAccount.ensureCustomer({
      email,
      name: latest.shippingAddress?.fullName,
      phone: latest.shippingAddress?.phone,
    });
    if (!res) continue;
    if (res.isNew) created += 1;
    linked += await customerAccount.claimGuestOrders(res.user);
  }
  if (!dryRun) console.log(`Linked ${linked} order(s); created ${created} account(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
