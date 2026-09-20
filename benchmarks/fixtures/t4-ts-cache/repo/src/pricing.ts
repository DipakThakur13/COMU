import { memoize } from "./memo.ts";

/** Catalogue price in cents, by sku and region. */
const UNIT_PRICES: Record<string, Record<string, number>> = {
  widget: { US: 1200, EU: 1450, JP: 1600 },
  gizmo: { US: 900, EU: 1100, JP: 1250 }
};

/** Tax percentage, by region and product category. */
const TAX_RATES: Record<string, Record<string, number>> = {
  US: { standard: 7, reduced: 3 },
  EU: { standard: 20, reduced: 6 },
  JP: { standard: 10, reduced: 8 }
};

/** Shipping base charge in cents, by region. */
const SHIPPING_BASE: Record<string, number> = { US: 500, EU: 700, JP: 900 };

function lookup(table: Record<string, Record<string, number>>, outer: string, inner: string): number {
  const row = table[outer];
  if (row === undefined || row[inner] === undefined) {
    throw new Error(`no entry for ${outer}/${inner}`);
  }
  return row[inner];
}

/** The catalogue price of a sku in a region, in cents. */
export const unitPrice = memoize((sku: string, region: string): number =>
  lookup(UNIT_PRICES, sku, region)
);

/** The tax percentage that applies to a category in a region. */
export const taxRate = memoize((region: string, category: string): number =>
  lookup(TAX_RATES, region, category)
);

/** What it costs to ship a parcel of the given weight to a region, in cents. */
export const shippingCost = memoize((region: string, weightKg: number): number => {
  const base = SHIPPING_BASE[region];
  if (base === undefined) {
    throw new Error(`no shipping for ${region}`);
  }
  return base + Math.ceil(weightKg) * 150;
});
