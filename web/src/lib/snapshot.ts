import snapshotData from "../snapshotData.json";

/**
 * Static preview mode.
 *
 * When VITE_STATIC_SNAPSHOT is set, the app is built as a self-contained,
 * read-only demo: instead of calling the API it serves recorded responses
 * captured from a real running server (server/scripts/exportSnapshot.ts).
 *
 * The figures are genuine engine output, frozen at export time. Nothing here
 * recomputes anything — that would violate the rule that the UI performs no
 * financial calculation. Mutating requests are refused outright rather than
 * faked, so the preview cannot imply a write succeeded when none did.
 */
export const IS_SNAPSHOT: boolean = __STATIC_SNAPSHOT__;

const responses = snapshotData as Record<string, unknown>;

export const SNAPSHOT_EXPORTED_AT = (
  responses["__meta"] as { exportedAt?: string } | undefined
)?.exportedAt;

export class SnapshotUnavailableError extends Error {
  readonly code = "SNAPSHOT_READ_ONLY";
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.details = details;
  }
}

/** Sorts query params so lookups do not depend on parameter order. */
function normalise(path: string): string {
  const url = new URL(path, "http://snapshot.local");
  const params = [...url.searchParams.entries()]
    .filter(([, value]) => value !== "" && value !== "undefined")
    .sort(([a], [b]) => a.localeCompare(b));
  const search = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
  return `${url.pathname}${search}`;
}

export function lookup(method: string, path: string): unknown {
  if (method !== "GET") {
    throw new SnapshotUnavailableError(
      "這是唯讀展示版本，無法執行新增或修改。完整可操作版本請在本機執行。"
    );
  }

  const target = normalise(path);
  const direct = responses[`GET ${target}`];
  if (direct !== undefined) return direct;

  // Fall back to a captured variant of the same resource with different
  // paging, rather than showing an empty screen.
  const pathname = target.split("?")[0]!;
  for (const key of Object.keys(responses)) {
    if (key.startsWith(`GET ${pathname}?`) || key === `GET ${pathname}`) {
      return responses[key];
    }
  }

  throw new SnapshotUnavailableError("此畫面的資料未包含在展示快照中。", { path: target });
}
