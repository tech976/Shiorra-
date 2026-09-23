// Shared FAQ answers — the ones that are the same wherever they are asked.
//
// Delivery and Service appear on every product page AND on /faq. They were
// duplicated markup before, which is how two pages end up quoting different
// shipping terms. They live here once and are injected into every view by
// middleware/locals.js as `faqShared`.
//
// Product-specific questions are NOT here: they stay in their own page
// template, next to the rest of that product's copy.
module.exports = {
  delivery: [
    { q: "How long does delivery take?",
      a: "2-5 business days for most Indian addresses. Metros usually 2-3 days, remote pincodes can take up to 7. You'll get a tracking link by email and SMS." },
    { q: "Is shipping really free?",
      a: "Free on orders over <strong>\u20b9999</strong>. Below that, a flat \u20b949 shipping fee applies. You'll see the total before checkout." },
    { q: "Do you offer Cash on Delivery?",
      a: "Yes \u2014 COD is available across India. You can also pay online via UPI, cards, wallets and netbanking." },
    { q: "What is your return policy?",
      a: "Unopened packs can be returned within <strong>30 days</strong> for a full refund. If your pack arrives damaged, write to us within 7 days and we'll replace it." },
    { q: "Do you ship outside India?",
      a: "Not yet. We're focused on India for now \u2014 international shipping is on the roadmap. Drop us a note at hello@shiorra.com to be notified." }
  ],
  service: [
    { q: "Who makes Shi\u014drra products?",
      a: "Shi\u014drra is a trademark of <strong>K.C. Laboratories</strong> \u2014 a 30-year clinical formulation house in India. Every formula is developed in-house and manufactured at our FSSAI &amp; GMP-certified facility." },
    { q: "Are your products tested?",
      a: "Yes. Every batch is lab-tested for potency, purity and heavy-metal limits. We don't ship a batch until it clears." },
    { q: "What does \"Shiori\" mean?",
      a: "\"Shiori\" (\u681e) is the Japanese word for a bookmark \u2014 a gentle guide that holds your place. We picked the name because that's the kind of brand we wanted to build: quiet, reliable, with you for the long story." },
    { q: "Who do I write to with questions?",
      a: "Email <a href=\"mailto:hello@shiorra.com\" style=\"color:var(--honey-deep);text-decoration:underline\">hello@shiorra.com</a>. A real human (often pharmacology-trained) replies within 24 hours, Mon-Sat." }
  ],
};
