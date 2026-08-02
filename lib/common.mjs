import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

export const APP_VERSION = "1.0.0";
export const CONFIG_VERSION = 1;
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_FILE = path.join(ROOT_DIR, "providers.json");
export const TEMPLATE_FILE = path.join(ROOT_DIR, "providers.example.json");
export const CACHE_FILE = path.join(ROOT_DIR, ".models-cache.json");
export const DETAILS_FILE = path.join(ROOT_DIR, ".model-details.json");
export const MANAGED_FILE = path.join(ROOT_DIR, ".managed-provider-ids.json");
export const MODELS_DEV_CACHE_FILE = path.join(ROOT_DIR, ".models-dev-cache.json");
export const REPORT_FILE = path.join(ROOT_DIR, "last-sync-report.json");
export const BACKUP_DIR = path.join(ROOT_DIR, "backups");

export function expandHome(value) {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function stripJsonComments(input) {
  let out = "", inString = false, quote = "", escaped = false, line = false, block = false;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i], n = input[i + 1];
    if (line) {
      if (c === "\n" || c === "\r") { line = false; out += c; } else out += " ";
      continue;
    }
    if (block) {
      if (c === "*" && n === "/") { block = false; out += "  "; i += 1; }
      else out += c === "\n" || c === "\r" ? c : " ";
      continue;
    }
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'") { inString = true; quote = c; out += c; continue; }
    if (c === "/" && n === "/") { line = true; out += "  "; i += 1; continue; }
    if (c === "/" && n === "*") { block = true; out += "  "; i += 1; continue; }
    out += c;
  }
  return out;
}

function removeTrailingCommas(input) {
  let out = "", inString = false, quote = "", escaped = false;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'") { inString = true; quote = c; out += c; continue; }
    if (c === ",") {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j += 1;
      if (input[j] === "}" || input[j] === "]") continue;
    }
    out += c;
  }
  return out;
}

export function parseJsonOrJsonc(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  try { return JSON.parse(raw); }
  catch { return JSON.parse(removeTrailingCommas(stripJsonComments(raw))); }
}

export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}

export function backupFile(file, label = path.basename(file)) {
  if (!fs.existsSync(file)) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const target = path.join(BACKUP_DIR, `${label}.${timestamp()}.bak`);
  fs.copyFileSync(file, target);
  return target;
}

export function defaultSource() {
  return readJson(TEMPLATE_FILE, {
    version: CONFIG_VERSION,
    settings: {
      configFile: "~/.config/opencode/opencode.json",
      timeoutMs: 30000,
      useModelsDev: true,
      modelsDevCacheHours: 24,
      defaultContext: 128000,
      defaultOutput: 32768,
      filterNonChatModels: true,
      effortMode: "balanced",
      addReasoningVariants: true,
    },
    providers: [],
  });
}

export function migrateSource(source) {
  const value = source && typeof source === "object" ? source : defaultSource();
  value.version = CONFIG_VERSION;
  value.settings ||= {};
  const defaults = defaultSource().settings;
  value.settings = { ...defaults, ...value.settings };
  value.providers = Array.isArray(value.providers) ? value.providers : [];
  for (const provider of value.providers) {
    provider.id ||= slugify(provider.name || provider.baseURL);
    provider.name ||= provider.id;
    provider.baseURL = normalizeBaseURL(provider.baseURL);
    provider.npm ||= "@ai-sdk/openai-compatible";
    provider.auth ||= { type: "bearer" };
    provider.accounts = Array.isArray(provider.accounts) ? provider.accounts : [];
    provider.accounts.forEach((account, index) => {
      account.id ||= `k${index + 1}`;
      account.label ||= String(index + 1).padStart(2, "0");
      account.apiKey ||= "";
    });
  }
  return value;
}

export function loadSource() {
  if (!fs.existsSync(SOURCE_FILE)) writeJsonAtomic(SOURCE_FILE, defaultSource());
  const source = readJson(SOURCE_FILE);
  if (!source) throw new Error(`无法读取 ${SOURCE_FILE}`);
  return migrateSource(source);
}

export function saveSource(source) {
  backupFile(SOURCE_FILE, "providers.json");
  writeJsonAtomic(SOURCE_FILE, migrateSource(source));
}

export function slugify(value, fallback = "provider") {
  const result = String(value || "").trim().toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return result || fallback;
}

export function normalizeBaseURL(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function runtimeId(provider, account) {
  return `${provider.id}-${account.id}`;
}

export function displayName(provider, account) {
  return `${provider.name}｜${account.label || account.id}`;
}

export function maskKey(value) {
  const key = String(value || "");
  if (!key) return "(空)";
  if (key.length < 9) return `${key.slice(0, 2)}***`;
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function uniqueId(values, preferred, prefix) {
  const used = new Set(values);
  if (preferred && !used.has(preferred)) return preferred;
  for (let i = 1; i < 10000; i += 1) {
    const id = `${prefix}${i}`;
    if (!used.has(id)) return id;
  }
  throw new Error("无法生成唯一 ID");
}

export function createPrompt() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

export async function ask(rl, label, defaultValue = "") {
  const suffix = defaultValue !== "" ? ` [${defaultValue}]` : "";
  const value = (await rl.question(`${label}${suffix}: `)).trim();
  return value || String(defaultValue ?? "");
}

export async function confirm(rl, label, defaultValue = true) {
  const hint = defaultValue ? "Y/n" : "y/N";
  const value = (await rl.question(`${label} (${hint}): `)).trim().toLowerCase();
  if (!value) return defaultValue;
  return ["y", "yes", "1", "true", "是"].includes(value);
}

export async function select(rl, label, choices, { allowCancel = true } = {}) {
  if (!choices.length) return null;
  console.log(`\n${label}`);
  choices.forEach((item, index) => console.log(`  ${index + 1}. ${item.label}`));
  if (allowCancel) console.log("  0. 返回");
  while (true) {
    const raw = (await rl.question("选择: ")).trim();
    const index = Number(raw);
    if (allowCancel && index === 0) return null;
    if (Number.isInteger(index) && index >= 1 && index <= choices.length) return choices[index - 1].value;
    console.log("请输入有效编号。");
  }
}

export function parseHeaders(value) {
  const text = String(value || "").trim();
  if (!text) return {};
  if (text.startsWith("{")) {
    const parsed = JSON.parse(text);
    if (!isObject(parsed)) throw new Error("请求头必须是 JSON 对象");
    return parsed;
  }
  const result = {};
  for (const pair of text.split(",")) {
    const index = pair.indexOf(":");
    if (index < 1) throw new Error(`无法解析请求头：${pair}`);
    result[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return result;
}
