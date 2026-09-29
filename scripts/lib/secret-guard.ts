// A local publishing guard. Findings contain locations and rule names, never matched values.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export interface SecretFinding { file: string; line: number; rule: string; commit?: string }
const binary = /\.(?:png|jpe?g|gif|webp|ico|ttf|woff2?|pdf|mp4|mp3|zip|gz)$/i;
const placeholders = /^(?:test(?:[-_]|$)|ci(?:[-_]|$)|demo(?:[-_]|$)|example|placeholder|dummy|changeme|your[-_]|<|\$|\*{3}|x{3}$)|(?:local-dev-only|not-a-real-key)/i;
export function privatePath(file: string): boolean {
  const f = file.replaceAll("\\", "/");
  if (f === ".env.example") return false;
  return /(?:^|\/)(?:\.env(?:$|\.)|[^/]+\.env$|credentials(?:\/|$)|\.secrets(?:\/|$)|\.local(?:\/|$)|\.data(?:\/|$))|\.(?:key|pem|p12|pfx|jks|sql\.gz)$/i.test(f);
}
const patterns: Array<[string, RegExp]> = [
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{24,}\b/g],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g],
  ["model API key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b/g],
  ["Hugging Face token", /\bhf_[A-Za-z0-9]{24,}\b/g],
  ["Google API key", /\bAIza[A-Za-z0-9_-]{30,}\b/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
];
export function inspectSecrets(file: string, content: string, configuredSecrets: string[] = []): SecretFinding[] {
  const findings: SecretFinding[] = [];
  if (privatePath(file)) findings.push({ file, line: 1, rule: "private configuration or credential file" });
  const lines = content.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!;
    if (configuredSecrets.some((secret) => line.includes(secret))) findings.push({ file, line: n + 1, rule: "configured local secret" });
    for (const [rule, pattern] of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) findings.push({ file, line: n + 1, rule });
    }
    const assignments = /\b(?:[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)|api[_-]?key|access[_-]?token|client[_-]?secret|password|session[_-]?secret)["']?\s*[:=]\s*["']([^"'\r\n]{12,})["']/gi;
    for (const m of line.matchAll(assignments)) {
      const value = m[1]!;
      if (!placeholders.test(value) && !value.includes("${") && !value.includes("process.env")) findings.push({ file, line: n + 1, rule: "literal credential assignment" });
    }
    const urls = /\b(?:postgres(?:ql)?|mysql|redis(?:s)?):\/\/[^\s:@/]+:([^@\s]+)@/gi;
    for (const m of line.matchAll(urls)) if (m[1]!.length >= 12 && !placeholders.test(m[1]!)) findings.push({ file, line: n + 1, rule: "credential in database URL" });
  }
  return findings;
}
const git = (root: string, args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
export function inspectRepository(root: string, mode: "tracked" | "staged", configuredSecrets: string[] = []): SecretFinding[] {
  const files = git(root, mode === "staged" ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"] : ["ls-files", "-z"]).split("\0").filter(Boolean);
  return files.flatMap((file) => {
    if (binary.test(file)) return privatePath(file) ? [{ file, line: 1, rule: "private binary file" }] : [];
    const content = mode === "staged" ? git(root, ["show", `:${file}`]) : readFileSync(path.join(root, file), "utf8");
    return inspectSecrets(file, content, configuredSecrets);
  });
}
export function inspectHistory(root: string, ref: string, configuredSecrets: string[] = []): SecretFinding[] {
  if (!/^[A-Za-z0-9_./~^:-]+$/.test(ref) || ref.startsWith("-")) throw new Error("Invalid history reference");
  const findings: SecretFinding[] = [];
  // Tree paths are checked per commit too: an empty .env can share a blob with an allowed file.
  for (const commit of git(root, ["rev-list", ref]).trim().split("\n").filter(Boolean)) {
    for (const file of git(root, ["ls-tree", "-r", "--name-only", "-z", commit]).split("\0").filter(Boolean)) {
      if (privatePath(file)) findings.push({ file, line: 1, rule: "private file in history", commit });
    }
  }
  const objects = git(root, ["rev-list", "--objects", ref]).trim().split("\n").filter(Boolean).map((line) => {
    const space = line.indexOf(" "); return { sha: space < 0 ? line : line.slice(0, space), file: space < 0 ? "" : line.slice(space + 1) };
  }).filter((o) => o.file && !binary.test(o.file));
  if (!objects.length) return findings;
  const batch = spawnSync("git", ["-C", root, "cat-file", "--batch"], { input: objects.map((o) => o.sha).join("\n") + "\n", maxBuffer: 64 * 1024 * 1024 });
  if (batch.status !== 0) throw new Error("Cannot inspect Git object history");
  let offset = 0;
  for (const object of objects) {
    const end = batch.stdout.indexOf(10, offset);
    const header = batch.stdout.subarray(offset, end).toString("utf8").split(" ");
    const size = Number(header[2]); offset = end + 1;
    if (header[1] === "blob") findings.push(...inspectSecrets(object.file, batch.stdout.subarray(offset, offset + size).toString("utf8"), configuredSecrets));
    offset += size + 1;
  }
  return findings;
}
