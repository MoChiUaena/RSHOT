import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { inspectSecrets, inspectHistory, inspectRepository } from "../scripts/lib/secret-guard.ts";
import { readLocalModel, internalModelHost, workerLaunchArguments } from "../scripts/lib/local-model.ts";

test("local recovery keeps Qwen fast mode and starts other models without Qwen parameters", () => {
  assert.deepEqual(workerLaunchArguments("qwen3.8-27b"), ["scripts/start-updates.ts", "--live", "--fast"]);
  assert.deepEqual(workerLaunchArguments("deepseek-v4-flash-0731"), ["scripts/start-updates.ts", "--live"]);
});

function temporaryRoot() { return mkdtempSync(path.join(tmpdir(), "rshot-guard-")); }
function removeTemporary(root: string) {
  const parent = path.resolve(tmpdir()); const actual = path.resolve(root);
  if (!actual.startsWith(parent + path.sep) || !path.basename(actual).startsWith("rshot-guard-")) throw new Error("Unsafe test cleanup path");
  rmSync(actual, { recursive: true, force: true });
}
test("launcher arguments use the selected private profile without exposing its credentials", () => {
  const root = temporaryRoot();
  try {
    const file = path.join(root, "models.env");
    for (const model of ["qwen3.8-27b", "deepseek-v4-flash-0731"]) {
      writeFileSync(file, `LLM_BASE_URL=http://127.0.0.1:1/v1\nLLM_MODEL=${model}\nLLM_API_KEY=test-private-model-key\n`);
      const output = execFileSync(process.execPath, ["scripts/worker-launch-args.ts"], {
        cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, RSHOT_MODEL_FILE: file }, encoding: "utf8",
      });
      assert.deepEqual(JSON.parse(output), workerLaunchArguments(model));
      assert.ok(!output.includes("test-private-model-key"));
    }
  } finally { removeTemporary(root); }
});
test("Windows PowerShell binds the real recovery argument block to Start-Process", { skip: process.platform !== "win32" }, () => {
  const root = temporaryRoot();
  const repo = path.resolve(import.meta.dirname, "..");
  const file = path.join(root, "models.env");
  const capture = path.join(root, "arguments.json");
  const source = readFileSync(path.join(repo, "scripts/resume-local.ps1"), "utf8");
  const start = source.indexOf("$taskArgsJson =");
  const end = source.indexOf("$taskDeadline =", start);
  assert.ok(start >= 0 && end > start);
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  try {
    writeFileSync(file, "LLM_BASE_URL=http://127.0.0.1:1/v1\nLLM_MODEL=deepseek-v4-flash-0731\nLLM_API_KEY=test-private-model-key\n");
    const program = `
      $ErrorActionPreference = 'Stop'
      $env:RSHOT_MODEL_FILE = ${quote(file)}
      $taskNode = ${quote(process.execPath)}
      $taskRoot = ${quote(repo)}
      $taskLogDir = ${quote(root)}
      $taskCapture = ${quote(capture)}
      Set-Location -LiteralPath $taskRoot
      function Start-Process {
        param([string]$FilePath, [string[]]$ArgumentList, [string]$WorkingDirectory, [string]$WindowStyle,
          [switch]$PassThru, [string]$RedirectStandardOutput, [string]$RedirectStandardError)
        [System.IO.File]::WriteAllText($taskCapture, ($ArgumentList | ConvertTo-Json -Compress))
        [pscustomobject]@{Id=1}
      }
      ${source.slice(start, end)}
    `;
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(program, "utf16le").toString("base64")],
      { timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
    assert.deepEqual(JSON.parse(readFileSync(capture, "utf8")), workerLaunchArguments("deepseek-v4-flash-0731"));
  } finally { removeTemporary(root); }
});
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
