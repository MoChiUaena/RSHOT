import assert from "node:assert/strict";
import { test } from "node:test";
import { chronological } from "../app/lib/chronology.ts";

test("reader chronology sorts either direction, keeps equal dates stable and leaves loader rows untouched", () => {
  const rows = Object.freeze([
    { id: "old", at: "2026-10-01T01:00:00Z" },
    { id: "equal-a", at: "2026-10-02T01:00:00Z" },
    { id: "new", at: "2026-10-03T01:00:00Z" },
    { id: "equal-b", at: "2026-10-02T01:00:00Z" },
  ]);
  assert.deepEqual(chronological(rows, r => r.at, "desc").map(r => r.id), ["new", "equal-a", "equal-b", "old"]);
  assert.deepEqual(chronological(rows, r => r.at, "asc").map(r => r.id), ["old", "equal-a", "equal-b", "new"]);
  assert.deepEqual(rows.map(r => r.id), ["old", "equal-a", "new", "equal-b"]);
});
