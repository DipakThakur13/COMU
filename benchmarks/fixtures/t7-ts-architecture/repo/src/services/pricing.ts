import { billableGrams, type Zone } from "../domain/consignment.ts";
import { tariffByName } from "../domain/tariff.ts";

export interface Quotable {
  zone: Zone | string;
  weightGrams?: number;
  parcels?: Array<{ weightGrams: number; lengthMm: number; widthMm: number; heightMm: number }>;
}

export interface Quote {
  tariff: string;
  billableGrams: number;
  minor: number;
}

/** Pure arithmetic over the tariff tables. No I/O, no clock, no storage. */
export class PricingService {
  constructor(private readonly tariffName: string) {}

  quote(input: Quotable): Quote {
    const tariff = tariffByName(this.tariffName);
    const zone = (["domestic", "eu", "world"].includes(String(input.zone))
      ? input.zone
      : "domestic") as Zone;

    const grams = input.parcels?.length
      ? billableGrams({ parcels: input.parcels })
      : Math.max(0, input.weightGrams ?? 0);

    const bands = tariff.bands[zone];
    const band = bands.find(candidate => grams <= candidate.upToGrams) ?? bands[bands.length - 1];
    const base = band?.minor ?? 0;

    return { tariff: tariff.name, billableGrams: grams, minor: base + tariff.surchargeMinor };
  }
}
