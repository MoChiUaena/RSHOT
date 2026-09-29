import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
let current = "";
try { current = execFileSync("git", ["config", "--get", "core.hooksPath"], { cwd: root, encoding: "utf8" }).trim(); } catch { }
if (current && current !== ".githooks") throw new Error("已有其他 Git hooks 配置；保留它并手动串联密钥检查");
for (const hook of ["pre-commit", "pre-push"]) {
  const file = path.join(root, ".githooks", hook);
  writeFileSync(file, readFileSync(file, "utf8").replaceAll("\r\n", "\n"));
  chmodSync(file, 0o755);
}
execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"], { cwd: root });
console.log("本仓库已启用提交前和推送前密钥检查");
