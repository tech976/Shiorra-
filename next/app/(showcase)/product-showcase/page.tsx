import { ProductShowcase } from '@/components/showcase/ProductShowcase';
import { PRODUCTS } from '@/lib/showcase/products';

export const metadata = {
  title: 'The Range · Shiōrra',
  description:
    'Three precision-formulated supplements — Iron+, Ginger+, Energy+. Wellness, gently formulated.',
};

export default function Page() {
  // Inject Product JSON-LD for each SKU so the static SSR pass is search-engine-friendly
  const ld = PRODUCTS.map((p) => ({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: p.beats.map((b) => b.body).join(' '),
    image: `${p.sequence.dir}/poster.jpg`,
    brand: { '@type': 'Brand', name: 'Shiōrra' },
  }));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
      />
      <ProductShowcase />
    </>
  );
}
