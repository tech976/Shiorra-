# Certification marks

Drop the logo files here using these exact filenames. The product page
(`views/pages/product-iron.ejs`, `_certs` array) already points at them.

| File               | Mark            |
|--------------------|-----------------|
| `fssai.png`        | FSSAI           |
| `gmp.png`          | GMP Quality     |
| `iso.png`          | ISO 9001:2015   |
| `vegetarian.png`   | 100% Vegetarian |
| `gmo-free.png`     | GMO Free        |
| `gluten-free.png`  | Gluten Free     |
| `no-additives.png` | No Additives    |

Any file that is missing falls back to a line icon automatically — the band
never shows a broken image.

Notes:
- PNG (or SVG) at roughly 400–600 px on the long edge is plenty.
- A white background is fine: the band applies `mix-blend-mode: multiply`,
  which drops white out against the near-white strip. Real transparency is
  still cleaner if you have it.
- If a mark lands optically smaller or larger than the others, tune its
  `scale` value in the `_certs` array rather than re-cutting the file.
