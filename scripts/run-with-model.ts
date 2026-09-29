// Pass private model settings to one backend process, never into source files or command arguments.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";
import { projectRoot, readLocalModel } from "./lib/local-model.ts";

const [target, ...args] = process.argv.slice(2);
const targets = new Set(["scripts/probe-model.ts", "scripts/eval-selection.ts", "scripts/pilot.ts", "scripts/process-review-batch.ts", "scripts/preview-report.ts", "apps/api/src/main.ts", "apps/worker/src/main.ts"]);
if (!target || !targets.has(target.replaceAll("\\", "/"))) throw new Error("指定允许的后端脚本，例如 scripts/probe-model.ts");
const model = readLocalModel();
if (!model.ready) {
  console.error(JSON.stringify({ status: "needs_configuration", file: model.file, missing: model.missing, problems: model.problems }));
  process.exit(1);
}
const site = parseEnv(readFileSync(path.join(projectRoot, ".env"), "utf8"));
const child = spawn(process.execPath, [target, ...args], { cwd: projectRoot, env: { ...process.env, ...site, ...model.env }, stdio: "inherit" });
child.on("error", () => { console.error("后端进程未能启动"); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
