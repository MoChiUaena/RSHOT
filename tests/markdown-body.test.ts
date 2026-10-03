import assert from "node:assert/strict";
import { test } from "node:test";
import * as cheerio from "cheerio";
import "./setup.ts";
import { markdownBody } from "@aihot/backend/content/markdown";

test("reader Markdown preserves block structure and still passes through the HTML whitelist", () => {
  const html = markdownBody(`Page title
# Article

_An italic note_ and **evidence**.

* First
  * Nested
* Second

| Dataset | Score |
| --- | --- |
| A | 10 |

\`\`\`python
first()

second()
\`\`\`

[source](/source) ![chart](/chart.png)
<script>alert(1)</script><img src="https://example.org/safe.png" onerror="alert(1)">
[unsafe](javascript:alert(1))`, "https://example.org/post");
  const $ = cheerio.load(html);
  assert.equal($("h2").text(), "Article", "a heading does not require a preceding blank line");
  assert.equal($("ul > li > ul > li").text(), "Nested");
  assert.equal($("table tbody td").last().text(), "10");
  assert.equal($("pre code").text(), "first()\n\nsecond()\n");
  assert.equal($("em").text(), "An italic note");
  assert.ok($('a[href="https://example.org/source"]').length);
  assert.ok($('img[src="https://example.org/chart.png"]').length);
  assert.doesNotMatch(html, /<script|onerror|javascript:/);
});

test("OpenAI Reader pages drop responsive navigation and recommendations, retaining captions and notes", () => {
  const url = "https://openai.com/index/example/";
  const input = `* [Products](https://openai.com/products/)

Introducing Example | OpenAI
# Example

Capabilities

* [Capabilities](${url}#capabilities)
  * [Coding](${url}#coding)

* [Capabilities](${url}#capabilities)

## Capabilities

The actual article.

_In_[_Benchmark⁠_⁠(opens in a new window)](https://example.org/benchmark)_, agents solve tasks._

## Author

OpenAI

_Evaluations may differ in production._

## Keep reading

[View all](https://openai.com/news/)

[Another article](https://openai.com/index/another/)

Footer navigation`;
  const html = markdownBody(input, url);
  const $ = cheerio.load(html);
  assert.deepEqual($("h2").map((_, e) => $(e).text()).get(), ["Example", "Capabilities", "Author"]);
  assert.equal($("ul").length, 0);
  assert.ok(html.includes("The actual article."));
  assert.ok(html.includes("Evaluations may differ in production."));
  assert.equal($('a[href="https://example.org/benchmark"]').text(), "Benchmark⁠⁠(opens in a new window)");
  assert.doesNotMatch($("body").text(), /Products|Introducing Example|Keep reading|Another article|Footer|_/);
  assert.ok(markdownBody(input, "https://example.org/index/example/").includes("Footer navigation"), "publisher-specific boundaries must not trim unrelated publishers");
});


test("existing URL extraction preserves sanitized GFM structures from its local Reader fallback", async (t) => {
  const { createServer } = await import("node:http");
  const { config } = await import("@aihot/backend/config");
  const { closeDb, sql } = await import("@aihot/backend/db");
  const { extractFromUrl } = await import("@aihot/backend/content/extract");
  const markdown = `# Research dataset

An _italic_ note. ${"A substantive local dataset description. ".repeat(12)}

* First
  * Nested
* Second

| Dataset | Score |
| --- | --- |
| A | 10 |

\`\`\`python
first()

second()
\`\`\`

[source](/source) ![chart](/chart.png)
<script>alert(1)</script><img src="/safe.png" onerror="alert(1)">
[unsafe](javascript:alert(1))`;
  const server = createServer((req, res) => {
    if (req.url === "/article") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<html><body>Empty</body></html>"); }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`Title: Research dataset\n\nMarkdown Content:\n${markdown}`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const oldPrivate = config.allowPrivateNetworkFetch;
  const oldModel = config.modelCallsEnabled;
  config.allowPrivateNetworkFetch = true;
  config.modelCallsEnabled = true; // Only this isolated local Reader fixture uses the receipt valve.
  process.env.JINA_API_KEY = "test-reader-key";
  process.env.JINA_BASE_URL = base;
  const budgets = await sql`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='jina'`;
  try {
    await sql`UPDATE budgets SET per_minute=1000,per_hour=1000,per_day=1000 WHERE service='jina'`;
    const got = await extractFromUrl(`${base}/article`, { allowJina: true, subject: "local-markdown-regression" });
    assert.equal(got?.via, "jina");
    const $ = cheerio.load(got!.html);
    await t.test("headings use the body whitelist", () => assert.equal($("h2").text(), "Research dataset"));
    await t.test("nested lists retain hierarchy", () => assert.equal($("ul > li > ul > li").text(), "Nested"));
    await t.test("GFM tables remain tables", () => assert.equal($("table tbody td").last().text(), "10"));
    await t.test("code fences preserve blank lines", () => assert.equal($("pre code").text(), "first()\n\nsecond()\n"));
    await t.test("italic emphasis remains semantic", () => assert.equal($("em").text(), "italic"));
    await t.test("relative links resolve to the article", () => assert.ok($(`a[href="${base}/source"]`).length));
    await t.test("relative images resolve to the article", () => assert.ok($(`img[src="${base}/chart.png"]`).length));
    await t.test("raw HTML and unsafe links pass through sanitization", () => assert.doesNotMatch(got!.html, /<script|onerror|javascript:/));
  } finally {
    for (const b of budgets) await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service='jina'`;
    config.allowPrivateNetworkFetch = oldPrivate;
    config.modelCallsEnabled = oldModel;
    delete process.env.JINA_API_KEY;
    delete process.env.JINA_BASE_URL;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await closeDb();
  }
});
