import assert from "node:assert/strict";
import { after, test } from "node:test";
import { beijingDate, beijingTime } from "@aihot/contracts/time";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
after(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

let instance = 0;
async function reader(starred: unknown[] = []) {
  const values = new Map([["aihot-starred-items", JSON.stringify(starred)]]);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } },
  });
  // Reopening the page starts with an empty snapshot cache.
  const state: typeof import("../app/lib/local-state.ts") = await import(`../app/lib/local-state.ts?test=${instance++}`);
  return { state, values };
}

const displayDate = (value: string) => `${beijingDate(value)} ${beijingTime(value)}`;

test("import keeps bookmarks with invalid dates and persists displayable replacements", async () => {
  const invalid = ["broken", "", "999999-01-01", "+275760-09-13T00:00:00.000Z", null, 42, {}];
  const { state, values } = await reader();
  const before = Date.now();
  const report = await state.importBundle(JSON.stringify({ version: 1, starred: invalid.map((date, i) => ({
    id: `import-${i}`, title: `Bookmark ${i}`, savedAt: date, publishedAt: date,
  })) }));
  assert.equal(report.starredAdded, invalid.length);
  const saved = JSON.parse(values.get(state.KEYS.starred)!);
  assert.equal(saved.length, invalid.length);
  for (const item of saved) {
    assert.equal(item.publishedAt, null);
    assert.ok(Date.parse(item.savedAt) >= before && Date.parse(item.savedAt) <= Date.now());
    assert.doesNotThrow(() => displayDate(item.savedAt));
  }
});

test("stored bookmarks with damaged dates remain readable, exportable and removable", async () => {
  const { state } = await reader([{ id: "stored", title: "Keep me", savedAt: "broken", publishedAt: "broken" }]);
  const starred = state.getStarred();
  assert.equal(starred.length, 1);
  assert.equal(starred[0]!.title, "Keep me");
  assert.equal(starred[0]!.publishedAt, null);
  assert.doesNotThrow(() => displayDate(starred[0]!.savedAt));
  assert.strictEqual(state.getStarred(), starred, "React snapshots must stay stable between changes");
  assert.deepEqual(state.exportBundle().starred, starred);
  await state.removeStar("stored");
  assert.deepEqual(state.getStarred(), []);
});

test("valid dates are preserved and an import cannot replace an existing bookmark", async () => {
  const existing = { id: "valid", title: "Original", savedAt: "2026-09-29T08:30:00+08:00", publishedAt: "2026-09-28T23:00:00Z" };
  const { state } = await reader([existing]);
  const report = await state.importBundle(JSON.stringify({ version: 1, starred: [{ ...existing, title: "Replacement", savedAt: "broken" }] }));
  assert.equal(report.starredAdded, 0);
  const [saved] = state.getStarred();
  assert.equal(saved!.title, existing.title);
  assert.equal(saved!.savedAt, existing.savedAt);
  assert.equal(saved!.publishedAt, existing.publishedAt);
});

// Failure cases before changing storage: denied/quota-full IDs must stay stable in this document;
// expired or corrupt sessions must rotate; another tab's writes must survive a cached-tab edit;
// unreadable bookmarks must not be overwritten and failed writes must not report success.
test("a cached tab merges newer saved bookmarks and read marks before writing", async () => {
  const { state, values } = await reader([{ id: "old", title: "Old" }]);
  state.getStarred();
  state.getReadIds();
  values.set(state.KEYS.starred, JSON.stringify([{ id: "other-tab", title: "Other tab" }, { id: "old", title: "Old" }]));
  values.set(state.KEYS.read, JSON.stringify(["other-tab"]));
  await state.toggleStar({ id: "new", title: "New", summary: null, sourceName: "", publishedAt: null, score: null, aiSelected: false });
  await state.markRead("new");
  assert.deepEqual(state.getStarred().map((s) => s.id), ["new", "other-tab", "old"]);
  assert.deepEqual(state.getReadIds(), ["new", "other-tab"]);
});

test("failed bookmark writes and damaged existing data do not report a successful toggle", async () => {
  const { state, values } = await reader();
  const item = { id: "new", title: "New", summary: null, sourceName: "", publishedAt: null, score: null, aiSelected: false };
  values.set(state.KEYS.starred, "damaged original data");
  assert.equal(await state.toggleStar(item), false);
  assert.equal(values.get(state.KEYS.starred), "damaged original data");
  values.set(state.KEYS.starred, "[]");
  window.localStorage.setItem = () => { throw new Error("quota"); };
  assert.equal(await state.toggleStar(item), false);
  assert.deepEqual(state.getStarred(), []);
});

test("queued Web Locks serialize concurrent stars, removals, imports and read marks", async () => {
  const { state, values } = await reader([{ id: "old", title: "Old" }]);
  let tail = Promise.resolve(), requests = 0;
  Object.assign(window, { navigator: { locks: { request(name: string, action: () => unknown) {
    assert.equal(name, "aihot:local-data"); requests++;
    const next = tail.then(action); tail = next.then(() => {}, () => {}); return next;
  } } } });
  const bookmark = (id: string) => ({ id, title: id, summary: null, sourceName: "", publishedAt: null, score: null, aiSelected: false });
  state.getStarred(); state.getReadIds();
  await Promise.all([
    state.toggleStar(bookmark("A")), state.toggleStar(bookmark("B")),
    state.importBundle(JSON.stringify({ version: 1, starred: [bookmark("C")], read: ["C"] })),
    state.removeStar("old"), state.markRead("A"), state.markRead("B"),
  ]);
  assert.equal(requests, 6);
  assert.deepEqual(new Set(state.getStarred().map((item) => item.id)), new Set(["A", "B", "C"]));
  assert.deepEqual(state.getReadIds(), ["B", "A", "C"]);
  assert.equal(JSON.parse(values.get(state.KEYS.starred)!).length, 3);
});

test("broken local arrays remain recoverable on removal, read marking and import", async () => {
  for (const raw of ["broken", "", '{"old":true}']) {
    const { state, values } = await reader();
    values.set(state.KEYS.starred, raw); values.set(state.KEYS.read, raw);
    await state.removeStar("old"); await state.markRead("new");
    assert.equal(values.get(state.KEYS.starred), raw); assert.equal(values.get(state.KEYS.read), raw);
    await assert.rejects(state.importBundle(JSON.stringify({ version: 1, starred: [{ id: "new", title: "New" }] })), /无法读取/);
    assert.equal(values.get(state.KEYS.starred), raw);
    values.set(state.KEYS.starred, "[]");
    const report = await state.importBundle(JSON.stringify({ version: 1, starred: [{ id: "new", title: "New" }], read: ["new"] }));
    assert.equal(report.starredAdded, 1); assert.equal(report.readFailed, true); assert.equal(report.readAdded, 0);
    assert.equal(values.get(state.KEYS.read), raw);
  }
});

test("unavailable Web Locks fall back to fresh storage, including synchronous denial", async () => {
  for (const request of [() => Promise.reject(new Error("blocked")), () => { throw new Error("blocked"); }]) {
    const { state } = await reader(); Object.assign(window, { navigator: { locks: { request } } });
    assert.equal(await state.toggleStar({ id: "new", title: "New", summary: null, sourceName: "", publishedAt: null, score: null, aiSelected: false }), true);
    await state.markRead("new"); assert.deepEqual(state.getReadIds(), ["new"]);
  }
});

test("mixed malformed stored bookmark arrays stay untouched by toggle, removal and import", async () => {
  const old = { id: "old", title: "Legacy bookmark", savedAt: "broken", publishedAt: "broken" };
  for (const invalid of [42, null, {}, { id: "bad space", title: "Invalid identity" }, { id: "no-title" }]) {
    const { state, values } = await reader();
    const raw = JSON.stringify([old, invalid], null, 2);
    values.set(state.KEYS.starred, raw);
    assert.equal(state.getStarred()[0]!.title, old.title, "valid legacy entries remain readable");
    assert.equal(await state.toggleStar({ id: "new", title: "New", summary: null, sourceName: "", publishedAt: null, score: null, aiSelected: false }), false);
    assert.equal(values.get(state.KEYS.starred), raw);
    await state.removeStar("old"); assert.equal(values.get(state.KEYS.starred), raw);
    await assert.rejects(state.importBundle(JSON.stringify({ version: 1, starred: [{ id: "imported", title: "Imported" }] })), /无法读取/);
    assert.equal(values.get(state.KEYS.starred), raw);
  }
});

test("mixed malformed stored read arrays stay untouched by marking and partial import", async () => {
  for (const invalid of [42, null, {}, "bad space", ""]) {
    const { state, values } = await reader();
    const raw = JSON.stringify(["old", invalid], null, 2);
    values.set(state.KEYS.read, raw);
    assert.deepEqual(state.getReadIds(), ["old"]);
    await state.markRead("new"); assert.equal(values.get(state.KEYS.read), raw);
    const report = await state.importBundle(JSON.stringify({ version: 1, starred: [{ id: "imported", title: "Legacy import" }], read: ["imported"] }));
    assert.equal(report.starredAdded, 1); assert.equal(report.readFailed, true); assert.equal(report.readAdded, 0);
    assert.equal(values.get(state.KEYS.read), raw);
  }
});
