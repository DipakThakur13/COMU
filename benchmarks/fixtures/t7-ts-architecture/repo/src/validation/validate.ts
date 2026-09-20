import type { Consignment } from "../domain/consignment.ts";
import { CONSIGNMENT_FIELDS, PARCEL_FIELDS, type Field } from "./schema.ts";

export type Result =
  | { ok: true; value: Omit<Consignment, "id" | "acceptedAt"> }
  | { ok: false; problems: string[] };

function checkField(field: Field, value: unknown, path: string, problems: string[]): void {
  if (value === undefined || value === null) {
    if (field.required) problems.push(path + " is required");
    return;
  }

  if (field.kind === "string") {
    if (typeof value !== "string") {
      problems.push(path + " must be a string");
      return;
    }
    if (field.min !== undefined && value.length < field.min) problems.push(path + " is too short");
    if (field.max !== undefined && value.length > field.max) problems.push(path + " is too long");
    return;
  }

  if (field.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      problems.push(path + " must be a number");
      return;
    }
    if (field.min !== undefined && value < field.min) problems.push(path + " is below " + field.min);
    if (field.max !== undefined && value > field.max) problems.push(path + " is above " + field.max);
    return;
  }

  if (field.kind === "enum") {
    if (!field.values?.includes(String(value))) problems.push(path + " is not a known value");
    return;
  }

  if (field.kind === "array") {
    if (!Array.isArray(value)) {
      problems.push(path + " must be an array");
      return;
    }
    if (field.min !== undefined && value.length < field.min) problems.push(path + " is empty");
    if (field.max !== undefined && value.length > field.max) {
      problems.push(path + " has too many entries");
    }
    value.forEach((item, index) => {
      for (const inner of field.of ?? PARCEL_FIELDS) {
        const at = path + "[" + index + "]." + inner.name;
        checkField(inner, (item as Record<string, unknown>)?.[inner.name], at, problems);
      }
    });
  }
}

/**
 * The only validator in the repository. It is called from exactly one place, and that place is
 * not the HTTP layer.
 */
export function validateConsignment(payload: unknown): Result {
  const problems: string[] = [];
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, problems: ["body must be an object"] };
  }

  const record = payload as Record<string, unknown>;
  for (const field of CONSIGNMENT_FIELDS) {
    checkField(field, record[field.name], field.name, problems);
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: record as unknown as Omit<Consignment, "id" | "acceptedAt"> };
}
