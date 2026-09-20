export type Zone = "domestic" | "eu" | "world";

export interface Parcel {
  weightGrams: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}

export interface Consignment {
  id: string;
  account: string;
  zone: Zone;
  parcels: Parcel[];
  reference?: string;
  acceptedAt: string;
}

export interface StoredConsignment extends Consignment {
  pricedMinor: number;
  dispatchedAt: string;
}

export function volumetricGrams(parcel: Parcel): number {
  return Math.round((parcel.lengthMm * parcel.widthMm * parcel.heightMm) / 5000);
}

export function billableGrams(consignment: Pick<Consignment, "parcels">): number {
  return consignment.parcels.reduce(
    (total, parcel) => total + Math.max(parcel.weightGrams, volumetricGrams(parcel)),
    0
  );
}
