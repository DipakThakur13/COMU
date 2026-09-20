import type { Profile } from "../config/profiles.ts";
import type { Stage } from "../pipeline/stage.ts";

/**
 * Renames the vendor's columns to the canonical names in the profile.
 *
 * Unknown columns are kept, prefixed with `x_`, rather than dropped, so that a vendor adding a
 * field never loses data silently. Nothing downstream reads them.
 */
export function fieldMapStage(profile: Profile): Stage {
  return {
    name: "fieldMap",
    async apply(record, context) {
      const mapped: Record<string, unknown> = {};
      for (const [from, value] of Object.entries(record)) {
        const to = profile.columns[from];
        if (to) mapped[to] = value;
        else if (!from.startsWith("x_")) mapped["x_" + from] = value;
        else mapped[from] = value;
      }
      context.bump("fieldMap.mapped");
      return mapped as typeof record;
    }
  };
}
