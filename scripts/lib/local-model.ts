// Model secrets are read from a user-owned file outside the Git checkout.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { isIP } from "node:net";
import { parseEnv } from "node:util";

export const projectRoot = path.resolve(import.meta.dirname, "../..");
export function defaultModelFile(): string {
  return path.join(process.env.LOCALAPPDATA || process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "RSHOT", "models.env");
}
const allowed = ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY", "LLM_EXTRA_JSON", "LLM_JSON_MODE", "LLM_VISION"];
export function internalModelHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  if (isIP(host) === 6) return /^f[cd][0-9a-f]{2}:/i.test(host);
  if (isIP(host) !== 4) return false;
  const [a, b] = host.split(".").map(Number);
  return a === 127 || a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168);
}
export function readLocalModel(file = process.env.RSHOT_MODEL_FILE || defaultModelFile(), root = projectRoot) {
  const resolved = path.resolve(file);
  const actual = existsSync(resolved) ? realpathSync(resolved) : resolved;
  const relative = path.relative(realpathSync(root), actual);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("模型配置必须放在 Git 仓库外");
  const raw = existsSync(resolved) ? parseEnv(readFileSync(resolved, "utf8")) : {};
  const env: Record<string, string> = {};
  for (const key of allowed) if (raw[key] !== undefined) env[key] = raw[key]!;
  const missing = ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY"].filter((key) => !env[key]?.trim());
  const problems: string[] = [];
  if (env.LLM_BASE_URL?.trim()) {
    try {
      const url = new URL(env.LLM_BASE_URL);
      const permitted = url.protocol === "https:" || (url.protocol === "http:" && internalModelHost(url.hostname));
      if (!permitted || url.username || url.password || url.search || url.hash) problems.push("基础地址需使用 HTTPS，或明确配置的内网 HTTP 网关；不能包含凭据和查询参数");
      if (/\.example\.com$|^example\.com$|\.invalid$/.test(url.hostname)) problems.push("LLM_BASE_URL 仍是示例地址");
      if (url.pathname.endsWith("/chat/completions")) problems.push("LLM_BASE_URL 不应包含 /chat/completions 后缀");
    } catch { problems.push("LLM_BASE_URL 格式无效"); }
  }
  if (env.LLM_API_KEY && /^(?:<|在这里|在此|your[-_]|\*+$|x+$)/i.test(env.LLM_API_KEY)) problems.push("LLM_API_KEY 仍是示例占位符");
  if (env.LLM_EXTRA_JSON?.trim()) {
    try { const extra = JSON.parse(env.LLM_EXTRA_JSON); if (!extra || typeof extra !== "object" || Array.isArray(extra)) throw new Error(); }
    catch { problems.push("LLM_EXTRA_JSON 必须是 JSON 对象"); }
  }
  return { file: resolved, exists: existsSync(resolved), env, missing, problems, ready: missing.length === 0 && problems.length === 0 };
}
