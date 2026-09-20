export type FieldKind = "string" | "number" | "enum" | "array";

export interface Field {
  name: string;
  kind: FieldKind;
  required: boolean;
  min?: number;
  max?: number;
  values?: string[];
  of?: Field[];
}

export const PARCEL_FIELDS: Field[] = [
  { name: "weightGrams", kind: "number", required: true, min: 1, max: 30_000 },
  { name: "lengthMm", kind: "number", required: true, min: 1, max: 2000 },
  { name: "widthMm", kind: "number", required: true, min: 1, max: 2000 },
  { name: "heightMm", kind: "number", required: true, min: 1, max: 2000 }
];

export const CONSIGNMENT_FIELDS: Field[] = [
  { name: "account", kind: "string", required: true, min: 3, max: 40 },
  { name: "zone", kind: "enum", required: true, values: ["domestic", "eu", "world"] },
  { name: "parcels", kind: "array", required: true, min: 1, max: 50, of: PARCEL_FIELDS },
  { name: "reference", kind: "string", required: false, max: 64 }
];
