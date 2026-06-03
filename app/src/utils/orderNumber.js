const crypto = require('crypto');

// Human-readable order number: SH-YYYYMMDD-XXXXXX
function generateOrderNumber() {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const rnd = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `SH-${ymd}-${rnd}`;
}

module.exports = { generateOrderNumber };
