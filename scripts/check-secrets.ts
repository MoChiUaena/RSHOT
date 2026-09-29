import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inspectHistory, inspectRepository, type SecretFinding } from "./lib/secret-guard.ts";
import { localSecretValues } from "./lib/local-secrets.ts";
const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const configuredSecrets = localSecretValues(root);
let findings: SecretFinding[];
if (args.includes("--pre-push")) {
  findings = [];
  const lines = readFileSync(0, "utf8").trim().split("\n").filter(Boolean);
  for (const line of lines) {
    const [, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localSha || /^0+$/.test(localSha)) continue;
    if (!/^[a-f0-9]{40,64}$/.test(localSha)) throw new Error("Invalid pushed commit");
    let previousExists = false;
    if (remoteSha && !/^0+$/.test(remoteSha)) {
      try { execFileSync("git", ["cat-file", "-e", `${remoteSha}^{commit}`], { cwd: root, stdio: "ignore" }); previousExists = true; } catch { }
    }
    findings.push(...inspectHistory(root, previousExists ? `${remoteSha}..${localSha}` : localSha, configuredSecrets));
  }
} else if (args.includes("--history")) {
  findings = inspectHistory(root, args[args.indexOf("--history") + 1] || "HEAD", configuredSecrets);
} else findings = inspectRepository(root, args.includes("--staged") ? "staged" : "tracked", configuredSecrets);
const unique = [...new Map(findings.map((f) => [`${f.file}:${f.line}:${f.rule}`, f])).values()];
for (const finding of unique) console.error(JSON.stringify(finding));
console.log(JSON.stringify({ status: unique.length ? "blocked" : "passed", findings: unique.length, matchedValuesPrinted: false }));
process.exitCode = unique.length ? 1 : 0;
