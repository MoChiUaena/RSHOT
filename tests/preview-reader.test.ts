import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { SIDEBAR_DATA, TABBAR_DATA } from "../apps/web/app/components/shell/nav-data.ts";

const app = readFileSync(new URL("../apps/preview/app.js", import.meta.url), "utf8");
const starKey = "rshot-preview-starred", themeKey = "rshot-preview-theme";
function sharedStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  let denied = false, unreadable = false, tail = Promise.resolve();
  return {
    values,
    deny: (value = true) => { denied = value; },
    unreadable: (value = true) => { unreadable = value; },
    storage: {
      getItem(key: string) { if (unreadable) throw new Error("denied"); return values.get(key) ?? null; },
      setItem(key: string, value: string) { if (denied) throw new Error("quota"); values.set(key, value); },
    },
    locks: { request(_name: string, action: () => unknown) { const result = tail.then(action); tail = result.then(() => {}, () => {}); return result; } },
  };
}
const fixture = () => ({
  generatedAt: "2026-10-03T02:30:00Z", categories: [{ key: "research", label: "科研" }],
  items: Array.from({ length: 30 }, (_, i) => ({ id: i === 0 ? "old" : i === 1 ? "A" : i === 2 ? "B" : `item-${i}`,
    title: `研究成果 ${i}`, summary: "公开摘要", source: { name: "Synthetic", firstParty: true }, category: "research", tags: ["卫星"],
    selected: true, score: 80, timelineAt: "2026-10-03T02:30:00Z", publishedAt: "2026-10-03T02:30:00Z", originalUrl: "https://example.test/original" })),
  sources: [{ name: "Synthetic", kind: "rss" }], topics: [{ slug: "satellite", group: "field", name: "卫星", definition: "观测", itemIds: ["A"] }],
  hot: { windowHours: 48, entries: [] }, reports: [{ kind: "daily", key: "2026-10-03", title: "日报", editorialMode: "manual", sections: [{ label: "科研", items: [{ itemId: "A", title: "报告条目", summary: "摘要", sourceName: "Synthetic", originalUrl: "https://example.test/original" }] }] }],
});
async function reader(shared = sharedStorage(), data = fixture(), withLocks = true) {
  const nodes = new Map<string, any>();
  function node(id: string) {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: "", textContent: "", hidden: false, value: "", dataset: {}, attributes: {}, handlers: new Map(),
      setAttribute(key: string, value: string) { this.attributes[key] = value; }, removeAttribute(key: string) { delete this.attributes[key]; },
      addEventListener(key: string, handler: Function) { this.handlers.set(key, handler); }, focus() {}, closest() { return null; } });
    return nodes.get(id);
  }
  const viewOf = (to: string) => to === "/" ? "selected" : to === "/daily" ? "reports" : to.slice(1);
  const nav = SIDEBAR_DATA.flatMap((section) => section.items).map((item) => { const view = viewOf(item.to); return { ...node(`nav-${view}`), dataset: { nav: view }, outerHTML: `<a href="#${view}">${item.label}</a>` }; });
  const mobile = TABBAR_DATA.map((item) => { const view = viewOf(item.to); return { ...node(`mobile-${view}`), dataset: { nav: view }, closest: () => ({}) }; });
  const themes = ["system", "light", "dark"].map((choice) => ({ ...node(choice), dataset: { themeChoice: choice } }));
  const docEvents = new Map(), winEvents = new Map();
  const media = { matches: false, addEventListener(_name: string, handler: () => void) { this.change = handler; }, change: () => {} };
  const document = { getElementById: node, documentElement: { dataset: {} as any }, addEventListener: (key: string, fn: Function) => docEvents.set(key, fn),
    querySelector: () => ({ outerHTML: '<div class="theme-switch"></div>' }),
    querySelectorAll: (selector: string) => selector === "[data-nav]" ? [...nav, ...mobile] : selector === ".site-nav a" ? nav : themes };
  const location = { hash: "#selected", href: "https://example.test/preview/" };
  const window = { navigator: { locks: withLocks ? shared.locks : undefined }, addEventListener: (key: string, fn: Function) => winEvents.set(key, fn), scrollTo() {} };
  const context = vm.createContext({ document, window, navigator: window.navigator, location, localStorage: shared.storage, matchMedia: () => media, URL,
    fetch: async (url: string) => ({ ok: true, json: async () => url.includes("changelog") ? { releases: [{ date: "2026-10-03", title: "更新", body: ["说明"] }] } : data }) });
  vm.runInContext(app, context);
  await new Promise(setImmediate);
  return {
    nodes, context, nav, mobile, document, media, shared,
    async clickStar(id: string) { return docEvents.get("click")({ target: { closest: (selector: string) => selector === "button[data-star]" ? { dataset: { star: id } } : null } }); },
    async route(hash: string) { location.hash = `#${hash}`; winEvents.get("hashchange")(); await new Promise(setImmediate); },
    storageEvent(key: string | null) { winEvents.get("storage")({ key, storageArea: shared.storage }); },
    event(id: string, type: string, event: any = {}) { return node(id).handlers.get(type)(event); },
  };
}

test("Pages cached tabs merge fresh writes and stale removals under queued Web Locks", async () => {
  const shared = sharedStorage({ [starKey]: '["old"]' });
  const tabA = await reader(shared), tabB = await reader(shared);
  const before = shared.storage.getItem(starKey);
  await tabB.clickStar("B"); await tabA.clickStar("A");
  assert.deepEqual(new Set(JSON.parse(shared.storage.getItem(starKey)!)), new Set(["old", "B", "A"]));
  assert.notEqual(shared.storage.getItem(starKey), before);
  await tabA.clickStar("B");
  assert.deepEqual(new Set(JSON.parse(shared.storage.getItem(starKey)!)), new Set(["old", "A"]));
  await Promise.all([tabA.clickStar("B"), tabB.clickStar("item-3")]);
  assert.deepEqual(new Set(JSON.parse(shared.storage.getItem(starKey)!)), new Set(["old", "A", "B", "item-3"]));
});
test("Pages without locks reads fresh storage before each edit", async () => {
  const shared = sharedStorage({ [starKey]: '["old"]' });
  const tabA = await reader(shared, fixture(), false), tabB = await reader(shared, fixture(), false);
  await tabB.clickStar("B"); await tabA.clickStar("A");
  assert.deepEqual(new Set(JSON.parse(shared.storage.getItem(starKey)!)), new Set(["old", "B", "A"]));
});
test("Pages quota failures keep successive session edits and never clobber another tab", async () => {
  const shared = sharedStorage({ [starKey]: '["old"]' }); const tab = await reader(shared);
  shared.deny(); await tab.clickStar("A"); await tab.clickStar("B");
  assert.equal(shared.storage.getItem(starKey), '["old"]');
  assert.match(tab.nodes.get("reader-status").textContent, /未允许持久保存/);
  await tab.route("starred"); assert.match(tab.nodes.get("result-count").textContent, /3 条/);
  shared.deny(false); shared.values.set(starKey, '["old","item-3"]'); await tab.clickStar("item-4");
  assert.deepEqual(new Set(JSON.parse(shared.storage.getItem(starKey)!)), new Set(["old", "item-3", "item-4"]));
});
test("Pages unavailable storage retains session edits", async () => {
  const shared = sharedStorage(); shared.unreadable(); shared.deny(); const tab = await reader(shared);
  await tab.clickStar("A"); await tab.clickStar("B"); await tab.clickStar("A");
  await tab.route("starred"); assert.match(tab.nodes.get("result-count").textContent, /1 条/);
});
test("Pages corrupt stored raw strings remain recoverable with a persistence notice", async () => {
  for (const raw of ["broken original", '{"ids":["old"]}', '["old",42]', ""]) {
    const shared = sharedStorage({ [starKey]: raw }); const tab = await reader(shared);
    await tab.clickStar("A"); assert.equal(shared.values.get(starKey), raw);
    assert.match(tab.nodes.get("reader-status").textContent, /无法读取|未允许持久保存/);
  }
});
test("Pages storage events refresh matching keys and clear refreshes stars and system theme", async () => {
  const shared = sharedStorage({ [starKey]: '["old"]', [themeKey]: '"light"' }); const tab = await reader(shared);
  shared.values.set(starKey, '["A"]'); shared.values.set(themeKey, '"dark"');
  tab.storageEvent("unrelated"); assert.equal(tab.document.documentElement.dataset.theme, "light");
  tab.storageEvent(themeKey); assert.equal(tab.document.documentElement.dataset.theme, "dark");
  tab.storageEvent(starKey); await tab.route("starred"); assert.match(tab.nodes.get("feed").innerHTML, /研究成果 1</);
  shared.values.clear(); tab.media.matches = true; tab.storageEvent(null);
  assert.equal(tab.document.documentElement.dataset.theme, "dark"); assert.match(tab.nodes.get("result-count").textContent, /0 条/);
  tab.media.matches = false; tab.media.change(); assert.equal(tab.document.documentElement.dataset.theme, "light");
});
test("Pages invalid/missing/display-zone-overflow dates remain readable across routes", async () => {
  for (const bad of ["broken", "", null, undefined, "+275760-09-13T00:00:00.000Z"]) {
    const data = fixture(); data.generatedAt = bad as any; data.items[1]!.timelineAt = bad as any; data.items[1]!.publishedAt = bad as any;
    const tab = await reader(sharedStorage(), data);
    assert.match(tab.nodes.get("updated").textContent, /未知/);
    assert.match(tab.nodes.get("feed").innerHTML, /日期未知/);
    for (const route of ["all", "hot", "topic/satellite", "item/A", "reports/daily/2026-10-03", "sources"]) await tab.route(route);
    await tab.route("item/A"); assert.match(tab.nodes.get("feed").innerHTML, /日期未知/);
  }
  const tab = await reader(); assert.match(tab.nodes.get("updated").textContent, /10:30/);
  assert.equal(vm.runInContext('dayOf("2026-10-02T18:30:00Z")', tab.context), "2026-10-03");
  assert.equal(vm.runInContext('timeOf("2026-10-03T02:30:00Z")', tab.context), "10:30");
});
test("Pages every sidebar/mobile destination, filters, pagination, report/topic/source and original links work", async () => {
  const tab = await reader(); assert.equal(tab.nodes.get("load-more").hidden, false);
  tab.event("load-more", "click"); assert.equal(tab.nodes.get("load-more").hidden, true);
  tab.event("search", "input", { target: { value: "研究成果 29" } }); assert.equal(tab.nodes.get("result-count").textContent, "1 条");
  await tab.route("selected"); tab.event("categories", "click", { target: { closest: () => ({ dataset: { category: "firstParty" } }) } });
  assert.equal(tab.nodes.get("result-count").textContent, "30 条");
  for (const route of tab.nav.map((link) => link.dataset.nav)) { await tab.route(route); assert.doesNotMatch(tab.nodes.get("feed").innerHTML, /页面不存在/); }
  for (const route of tab.mobile.map((link) => link.dataset.nav)) { await tab.route(route); assert.equal(tab.mobile.find((link) => link.dataset.nav === route)?.attributes["aria-current"], "page"); }
  await tab.route("reports/daily/2026-10-03"); assert.match(tab.nodes.get("feed").innerHTML, /编辑整理/);
  tab.event("report-kind", "change", { target: { value: "daily" } }); tab.event("report-issue", "change", { target: { value: "2026-10-03" } });
  await tab.route("topic/satellite"); assert.equal(tab.nodes.get("result-count").textContent, "1 条");
  await tab.route("sources"); assert.match(tab.nodes.get("feed").innerHTML, /Synthetic/);
  await tab.route("item/A"); assert.match(tab.nodes.get("feed").innerHTML, /https:\/\/example.test\/original/);
});
