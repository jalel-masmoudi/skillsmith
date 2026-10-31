// Africa/Tunis has been UTC+1 all year since 2009 (no daylight-saving shift).

export const TUNIS_OFFSET_MS = 60 * 60 * 1000;

/** UTC instant of local midnight at the start of a calendar day in Africa/Tunis. */
export function tunisStart(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) - TUNIS_OFFSET_MS;
}

export function inInstantRange(iso: string, startMs: number, endMs: number): boolean {
  const t = Date.parse(iso);
  return t >= startMs && t < endMs;
}

/** HH:MM on the Africa/Tunis clock. Independent of the host timezone. */
export function tunisHHMM(iso: string): string {
  const d = new Date(Date.parse(iso) + TUNIS_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Parse an ISO-8601 timestamp. A value with no offset is read as UTC so results
 * do not change when the host zone changes.
 */
export function parseInstant(value: string): number {
  const v = value.trim();
  const naive = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(v) ? `${v}Z` : v;
  const t = Date.parse(naive);
  if (Number.isNaN(t)) throw new Error("bad timestamp");
  return t;
}
