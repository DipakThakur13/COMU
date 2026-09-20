import type { Zone } from "./consignment.ts";

export interface Band {
  upToGrams: number;
  minor: number;
}

export interface Tariff {
  name: string;
  surchargeMinor: number;
  bands: Record<Zone, Band[]>;
}

const STANDARD_2024: Tariff = {
  name: "standard-2024",
  surchargeMinor: 95,
  bands: {
    domestic: [
      { upToGrams: 1000, minor: 349 },
      { upToGrams: 5000, minor: 599 },
      { upToGrams: 20000, minor: 1199 }
    ],
    eu: [
      { upToGrams: 1000, minor: 899 },
      { upToGrams: 5000, minor: 1499 },
      { upToGrams: 20000, minor: 2999 }
    ],
    world: [
      { upToGrams: 1000, minor: 1599 },
      { upToGrams: 5000, minor: 2899 },
      { upToGrams: 20000, minor: 5499 }
    ]
  }
};

const ECONOMY_2023: Tariff = {
  name: "economy-2023",
  surchargeMinor: 0,
  bands: {
    domestic: [{ upToGrams: 2000, minor: 299 }, { upToGrams: 20000, minor: 899 }],
    eu: [{ upToGrams: 2000, minor: 799 }, { upToGrams: 20000, minor: 1999 }],
    world: [{ upToGrams: 2000, minor: 1499 }, { upToGrams: 20000, minor: 3999 }]
  }
};

export function tariffByName(name: string): Tariff {
  if (name === "economy-2023") return ECONOMY_2023;
  return STANDARD_2024;
}
