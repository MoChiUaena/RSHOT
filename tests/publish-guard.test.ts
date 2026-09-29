import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { inspectSecrets, inspectHistory, inspectRepository } from "../scripts/lib/secret-guard.ts";
import { readLocalModel, internalModelHost } from "../scripts/lib/local-model.ts";

function temporaryRoot() { return mkdtempSync(path.join(tmpdir(), "rshot-guard-")); }
function removeTemporary(root: string) {
  const parent = path.resolve(tmpdir()); const actual = path.resolve(root);
  if (!actual.startsWith(parent + path.sep) || !path.basename(actual).startsWith("rshot-guard-")) throw new Error("Unsafe test cleanup path");
  rmSync(actual, { recursive: true, force: true });
}
test("publishing guard blocks credential files and tokens without printing matched values", () => {
  const token = ["gh", "p_", "Z".repeat(36)].join("");
  const found = inspectSecrets("src/config.ts", `const key = '${token}';`);
  assert.ok(found.length > 0);
  assert.ok(!JSON.stringify(found).includes(token));
  assert.ok(inspectSecrets(".env", "LLM_API_KEY=\n").length > 0);
  assert.equal(inspectSecrets(".env.example", "LLM_API_KEY=\n").length, 0);
  const opaque = "opaque-private-value-0123456789";
  assert.ok(inspectSecrets("README.md", opaque, [opaque]).some((r) => r.rule === "configured local secret"));
});
test("staging and pushed history catch a secret even if a later commit removes it", () => {
  const root = temporaryRoot();
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  try {
    git("init"); git("config", "user.name", "Local guard test"); git("config", "user.email", "test@example.invalid");
    git("config", "core.hooksPath", path.join(root, "no-hooks"));
    const token = ["sk", "-", "Y".repeat(40)].join("");
    writeFileSync(path.join(root, "config.txt"), `key=${token}\n`); git("add", "config.txt");
    assert.ok(inspectRepository(root, "staged").length > 0);
    git("commit", "-m", "synthetic secret for guard test");
    writeFileSync(path.join(root, "config.txt"), "removed\n"); git("add", "config.txt"); git("commit", "-m", "remove test value");
    assert.equal(inspectRepository(root, "tracked").length, 0);
    const history = inspectHistory(root, "HEAD");
    assert.ok(history.length > 0);
    assert.ok(!JSON.stringify(history).includes(token));
  } finally { removeTemporary(root); }
});
test("private model files must stay outside the checkout and accept only scoped endpoint forms", () => {
  const root = temporaryRoot();
  try {
    const repo = path.join(root, "repo"); mkdirSync(repo);
    const file = path.join(root, "models.env");
    writeFileSync(file, "LLM_BASE_URL=http://10.0.0.2:8787/v1\nLLM_MODEL=gpt-6-sol\nLLM_API_KEY=test-key\n");
    assert.equal(readLocalModel(file, repo).ready, true);
    writeFileSync(path.join(repo, "models.env"), "LLM_API_KEY=test-key\n");
    assert.throws(() => readLocalModel(path.join(repo, "models.env"), repo), /仓库外/);
    writeFileSync(file, "LLM_BASE_URL=http://public.example.org/v1\nLLM_MODEL=gpt-6-sol\nLLM_API_KEY=test-key\n");
    assert.equal(readLocalModel(file, repo).ready, false);
    assert.equal(internalModelHost("169.254.169.254"), false);
    assert.equal(internalModelHost("172.16.0.1"), true);
    assert.equal(internalModelHost("172.32.0.1"), false);
  } finally { removeTemporary(root); }
});
