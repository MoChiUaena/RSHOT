// Exact local secret values augment pattern checks, including keys without a provider prefix.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { defaultModelFile } from "./local-model.ts";
const sample = /^(?:test(?:[-_]|$)|ci(?:[-_]|$)|demo(?:[-_]|$)|example|placeholder|dummy|changeme|your[-_]|<|\$|\*{3}|x{3}$)|(?:local-dev-only|not-a-real-key)/i;
export function localSecretValues(root: string): string[] {
  const values: string[] = [];
  for (const file of [path.join(root, ".env"), process.env.RSHOT_MODEL_FILE || defaultModelFile()]) {
    if (!existsSync(file)) continue;
    const data = parseEnv(readFileSync(file, "utf8"));
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string" && /(?:KEY|SECRET|TOKEN|PASSWORD)$/.test(key) && value.trim().length >= 8 && !sample.test(value)) values.push(value);
    }
  }
  return [...new Set(values)];
}
