import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, copyFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PublicationCommandError, retryStatus, runPublicationCommand } from "../scripts/lib/publication-process.ts";

function temporary() { return mkdtempSync(path.join(tmpdir(), "rshot-publication-")); }
function clean(root: string) {
  assert.equal(path.dirname(root), path.resolve(tmpdir()));
  assert.ok(path.basename(root).startsWith("rshot-publication-"));
  rmSync(root, { recursive: true, force: true });
}

test("transient status subprocess failure is retried and recovers", async () => {
  const root = temporary();
  const counter = path.join(root, "attempts.txt");
  const program = "const fs=require('node:fs');const p=process.argv[1];const n=fs.existsSync(p)?Number(fs.readFileSync(p,'utf8')):0;fs.writeFileSync(p,String(n+1));if(n===0){process.stderr.write('temporary connection error');process.exit(1);}console.log('recovered');";
  const failures: unknown[] = [];
  try {
    const result = await retryStatus(() => runPublicationCommand(process.execPath, ["-e", program, counter], "update-status-unavailable", { cwd: root }),
      (failure: unknown) => failures.push(failure), [0, 0]);
    assert.equal(result, "recovered");
    assert.equal(readFileSync(counter, "utf8"), "2");
    assert.equal(failures.length, 1);
  } finally { clean(root); }
});

test("exhausted status retries stop with safe exit metadata", async () => {
  const root = temporary();
  const failures: unknown[] = [];
  try {
    await assert.rejects(retryStatus(() => runPublicationCommand(process.execPath, ["-e", "process.stderr.write('synthetic-private-token');process.exit(7)"],
      "update-status-unavailable", { cwd: root }), (failure: unknown) => failures.push(failure), [0, 0]),
    (error: unknown) => {
      assert.ok(error instanceof PublicationCommandError);
      assert.equal(error.details.exitCode, 7);
      assert.ok(error.details.stderrBytes > 0);
      assert.ok(!JSON.stringify(error.details).includes("synthetic-private-token"));
      assert.equal(error.message, "update-status-unavailable");
      return true;
    });
    assert.equal(failures.length, 3);
    assert.ok(!JSON.stringify(failures).includes("synthetic-private-token"));
  } finally { clean(root); }
});

test("timed out subprocess records timeout separately from an exit failure", async () => {
  assert.throws(() => runPublicationCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], "update-status-unavailable",
    { cwd: process.cwd(), timeoutMs: 300 }), (error: unknown) => {
      assert.ok(error instanceof PublicationCommandError);
      assert.equal(error.details.code, "ETIMEDOUT");
      assert.equal(error.details.timeoutMs, 300);
      assert.equal(error.details.exitCode, null);
      return true;
    });
});

test("Windows task wrapper retains publisher stderr and its exit code", { skip: process.platform !== "win32" }, () => {
  const root = temporary();
  mkdirSync(path.join(root, "scripts"));
  copyFileSync(new URL("../scripts/run-preview-task.ps1", import.meta.url), path.join(root, "scripts/run-preview-task.ps1"));
  writeFileSync(path.join(root, "scripts/publish-preview.ts"), "console.error(JSON.stringify({status:'failed',reason:'synthetic-test-failure',secretsPrinted:false}));process.exitCode=7;\n");
  try {
    let status = 0;
    try { execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "RemoteSigned", "-File", path.join(root, "scripts/run-preview-task.ps1")],
      { timeout: 30000, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (error) { status = (error as { status: number }).status; }
    assert.equal(status, 7);
    const log = readFileSync(path.join(root, ".data/logs/preview-publication.log"), "utf8");
    assert.ok(log.includes('"reason":"synthetic-test-failure"'));
    assert.ok(!log.includes("task-wrapper-failed"));
  } finally { clean(root); }
});

test("installer applies 10:30 schedule and bounded failure retries to an existing owned task", { skip: process.platform !== "win32" }, () => {
  const root = temporary();
  const capture = path.join(root, "settings.json");
  const installer = path.resolve("scripts/install-preview-task.ps1");
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  const program = `
    $ErrorActionPreference='Stop'
    Import-Module ScheduledTasks
    $taskCapture=${quote(capture)}
    function Get-ScheduledTask {
      $taskRepo=${quote(process.cwd())}
      $taskArgs='-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "'+(Join-Path $taskRepo 'scripts/run-preview-task.ps1')+'"'
      [pscustomobject]@{Actions=@([pscustomobject]@{Execute=(Get-Command powershell.exe).Source;Arguments=$taskArgs;WorkingDirectory=$taskRepo});
        Triggers=@([pscustomobject]@{StartBoundary='2026-10-02T08:30:00';DaysInterval=1});Principal=[pscustomobject]@{UserId=[Environment]::UserName};Settings=[pscustomobject]@{RestartCount=0;RestartInterval=$null;Priority=7}}
    }
    function Set-ScheduledTask {
      param($TaskName,$Action,$Settings,$Trigger)
      [pscustomobject]@{RestartCount=$Settings.RestartCount;RestartInterval=$Settings.RestartInterval;Priority=$Settings.Priority;Triggers=@($Trigger | Select-Object StartBoundary,DaysInterval)} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $taskCapture -Encoding utf8
    }
    function Get-ScheduledTaskInfo { [pscustomobject]@{NextRunTime=[datetime]'2026-10-02T08:30:00'} }
    & ${quote(installer)} -Apply
  `;
  try {
    execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(program, "utf16le").toString("base64")],
      { timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
    assert.ok(existsSync(capture), "existing task must receive its retry settings");
    const settings = JSON.parse(readFileSync(capture, "utf8").replace(/^\uFEFF/, ""));
    assert.equal(settings.RestartCount, 3);
    assert.equal(settings.RestartInterval, "PT15M");
    assert.equal(settings.Priority, 7);
    assert.deepEqual(settings.Triggers.map((trigger: {StartBoundary: string}) => new Date(trigger.StartBoundary).toLocaleTimeString("en-GB", {timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit"})), ['10:30']);
    assert.ok(settings.Triggers.every((trigger: {DaysInterval: number}) => trigger.DaysInterval === 1));
  } finally { clean(root); }
});
