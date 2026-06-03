// All money is stored as integer paise (1 INR = 100 paise) so we never see float drift.

function toPaise(rupees) {
  return Math.round(Number(rupees) * 100);
}

function fromPaise(paise) {
  return (paise / 100).toFixed(2);
}

function formatINR(paise) {
  const n = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

module.exports = { toPaise, fromPaise, formatINR };
