import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import {
  APP_VERSION, CACHE_FILE, DETAILS_FILE, MANAGED_FILE, MODELS_DEV_CACHE_FILE, REPORT_FILE, ROOT_DIR,
  backupFile, displayName, expandHome, loadSource, parseJsonOrJsonc, readJson, runtimeId,
  writeJsonAtomic,
} from "./common.mjs";
import { buildModelConfig } from "./effort.mjs";

const NON_CHAT_PATTERN = /(embedding|embed[-_.:/]|rerank|re-rank|text[-_.]?to[-_.]?speech|tts(?:[-_.:/]|$)|speech[-_.:/]|whisper|transcri|moderation|dall[-_.]?e|image[-_.]?(?:gen|generation)|stable[-_.]?diffusion|flux(?:[-_.:/]|$)|sora(?:[-_.:/]|$)|video[-_.]?(?:gen|generation)|music(?:[-_.:/]|$)|audio[-_.]?preview|ocr(?:[-_.:/]|$)|vlm[-_.]?embedding)/i;

function authHeaders(provider, account) {
  const auth = account.auth || provider.auth || { type: "bearer" };
  const key = account.apiKey || "";
  const headers = {
    Accept: "application/json",
    "User-Agent": provider.userAgent || `opencode-provider-manager/${APP_VERSION}`,
    ...(provider.headers || {}),
    ...(account.headers || {}),
  };
  const type = auth.type || "bearer";
  if (type === "bearer" && key) headers.Authorization = `${auth.prefix || "Bearer"} ${key}`.trim();
  else if (type === "x-api-key" && key) headers[auth.headerName || "x-api-key"] = key;
  else if (type === "api-key" && key) headers[auth.headerName || "api-key"] = key;
  else if (type === "custom" && key) headers[auth.headerName || "Authorization"] = `${auth.prefix || ""}${key}`;
  return headers;
}

function runtimeOptions(provider, account) {
  const auth = account.auth || provider.auth || { type: "bearer" };
  const options = {
    baseURL: provider.baseURL,
    timeout: provider.requestTimeoutMs || 600000,
    ...(provider.options || {}),
    ...(account.options || {}),
  };
  const headers = { ...(provider.runtimeHeaders || {}), ...(account.runtimeHeaders || {}) };
  if ((auth.type || "bearer") === "bearer") options.apiKey = account.apiKey;
  else if ((auth.type || "bearer") !== "none") {
    const generated = authHeaders({ ...provider, headers: {}, userAgent: undefined }, { ...account, headers: {} });
    delete generated.Accept;
    delete generated["User-Agent"];
    Object.assign(headers, generated);
  }
  if (Object.keys(headers).length) options.headers = headers;
  return options;
}

function parseBody(text, status) {
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`HTTP ${status}: 返回内容不是 JSON：${text.slice(0, 180).replace(/\s+/g, " ")}`); }
  if (status < 200 || status >= 300) {
    const message = json?.error?.message || json?.message || json?.msg || JSON.stringify(json).slice(0, 180);
    throw new Error(`HTTP ${status}: ${message}`);
  }
  return json;
}

function curlJson(url, options, timeoutMs) {
  const curl = process.platform === "win32" ? "curl.exe" : "curl";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-provider-manager-"));
  const bodyFile = path.join(dir, "body.json");
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const args = [
    "--silent", "--show-error", "--location", "--http1.1",
    "--connect-timeout", String(Math.min(seconds, 20)), "--max-time", String(seconds),
    "--output", bodyFile, "--write-out", "%{http_code}", "--request", options.method || "GET",
  ];
  for (const [name, value] of Object.entries(options.headers || {})) args.push("--header", `${name}: ${value}`);
  args.push(url);
  try {
    const result = spawnSync(curl, args, { encoding: "utf8", windowsHide: true, timeout: timeoutMs + 5000, maxBuffer: 32 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error((result.stderr || `curl 退出码 ${result.status}`).trim());
    return parseBody(fs.readFileSync(bodyFile, "utf8"), Number.parseInt(result.stdout || "0", 10));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function requestJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return parseBody(await response.text(), response.status);
  } catch (fetchError) {
    try { return curlJson(url, options, timeoutMs); }
    catch (curlError) { throw new Error(`Node fetch 失败：${fetchError.message}；curl 回退也失败：${curlError.message}`); }
  } finally {
    clearTimeout(timer);
  }
}

function detailFromItem(item) {
  if (!item || typeof item !== "object") return {};
  const id = item.id || item.name || item.model || item.model_id || item.slug;
  if (!id || typeof id !== "string") return {};
  return { [id]: item };
}

function extractModels(payload) {
  const ids = [];
  const details = {};
  const visit = (value, depth = 0) => {
    if (depth > 5 || value == null) return;
    if (typeof value === "string") { ids.push(value); return; }
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return; }
    if (typeof value !== "object") return;
    const direct = value.id || value.model || value.model_id || value.slug;
    if (typeof direct === "string") {
      ids.push(direct);
      Object.assign(details, detailFromItem(value));
      return;
    }
    for (const key of ["data", "models", "items", "result", "results", "list"]) {
      if (value[key] !== undefined) visit(value[key], depth + 1);
    }
  };
  visit(payload);
  return { ids: [...new Set(ids.map((id) => id.trim()).filter(Boolean))], details };
}

function endpointCandidates(provider) {
  const base = String(provider.baseURL || "").replace(/\/+$/, "");
  const values = [];
  if (provider.modelsURL) values.push(provider.modelsURL);
  if (base) values.push(`${base}/models`);
  try {
    const url = new URL(base);
    values.push(`${url.origin}/api/models`, `${url.origin}/api/openai/models`);
  } catch {}
  return [...new Set(values.filter(Boolean))];
}

async function fetchModels(provider, account, settings) {
  if (provider.skipModelFetch) {
    return {
      ids: [...new Set([...(provider.fallbackModels || []), ...(provider.manualModels || [])])],
      details: {}, endpoint: null,
    };
  }
  const failures = [];
  for (const endpoint of endpointCandidates(provider)) {
    try {
      const payload = await requestJson(endpoint, { method: "GET", headers: authHeaders(provider, account) }, provider.timeoutMs || settings.timeoutMs || 30000);
      const result = extractModels(payload);
      if (!result.ids.length) throw new Error("响应中没有识别到模型 ID");
      return { ...result, endpoint };
    } catch (error) {
      failures.push(`${endpoint}: ${error.message}`);
    }
  }
  throw new Error(failures.join(" | ") || "没有可用的模型列表地址");
}

function normalizeModelKey(value) {
  return String(value || "").toLowerCase().replace(/^models\//, "");
}

function buildModelsIndex(payload) {
  const exact = new Map(), suffix = new Map();
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    if (typeof value.id === "string") {
      const key = normalizeModelKey(value.id);
      exact.set(key, value);
      suffix.set(key.split("/").at(-1), value);
    }
    Object.values(value).forEach(visit);
  };
  visit(payload);
  return { exact, suffix };
}

async function modelsDev(settings, disabled) {
  if (disabled || settings.useModelsDev === false) return null;
  const cache = readJson(MODELS_DEV_CACHE_FILE, null);
  const age = cache?.fetchedAt ? Date.now() - Date.parse(cache.fetchedAt) : Infinity;
  if (cache?.payload && age < (settings.modelsDevCacheHours || 24) * 3600000) return buildModelsIndex(cache.payload);
  try {
    const payload = await requestJson("https://models.dev/models.json", { method: "GET", headers: { Accept: "application/json" } }, 20000);
    writeJsonAtomic(MODELS_DEV_CACHE_FILE, { fetchedAt: new Date().toISOString(), payload });
    return buildModelsIndex(payload);
  } catch (error) {
    console.log(`Models.dev 跳过：${error.message}`);
    return cache?.payload ? buildModelsIndex(cache.payload) : null;
  }
}

function metadataFor(id, index) {
  if (!index) return null;
  const key = normalizeModelKey(id);
  return index.exact.get(key) || index.suffix.get(key.split("/").at(-1)) || null;
}

function modelAllowed(id, provider, settings) {
  if (provider.alwaysInclude?.includes(id)) return true;
  if (provider.excludeModels?.some((pattern) => new RegExp(pattern, "i").test(id))) return false;
  if (settings.filterNonChatModels === false || provider.filterNonChatModels === false) return true;
  return !NON_CHAT_PATTERN.test(id);
}

export async function syncProviders({ dryRun = false, listOnly = false, noModelsDev = false, verbose = false, providerFilter = null } = {}) {
  const source = loadSource();
  const settings = source.settings;
  const configFile = expandHome(settings.configFile || "~/.config/opencode/opencode.json");
  const existing = parseJsonOrJsonc(configFile);
  existing.provider ||= {};
  const previousManaged = new Set(readJson(MANAGED_FILE, []));
  const oldCache = readJson(CACHE_FILE, {});
  const oldDetails = readJson(DETAILS_FILE, {});
  const nextCache = { ...oldCache }, nextDetails = { ...oldDetails };
  const generated = {}, currentIds = new Set(), report = [];
  const index = await modelsDev(settings, noModelsDev);

  for (const provider of source.providers.filter((item) => item.enabled !== false && (!providerFilter || item.id === providerFilter))) {
    for (const account of provider.accounts.filter((item) => item.enabled !== false)) {
      const id = runtimeId(provider, account);
      currentIds.add(id);
      process.stdout.write(`同步 ${displayName(provider, account)}... `);
      let result, fetched = false;
      try {
        result = await fetchModels(provider, account, settings);
        fetched = true;
      } catch (error) {
        const previous = Object.keys(existing.provider?.[id]?.models || {});
        const fallback = previous.length ? previous : (oldCache[id] || provider.fallbackModels || provider.manualModels || []);
        if (!fallback.length) { console.log(`失败：${error.message}\n  没有可保留的模型，本次暂不写入该线路`); continue; }
        console.log(`失败：${error.message}\n  保留已有/缓存模型 ${fallback.length} 个`);
        result = { ids: fallback, details: oldDetails[id] || {}, endpoint: null };
      }

      const ids = [...new Set(result.ids.filter((modelId) => modelAllowed(modelId, provider, settings)).concat(provider.manualModels || []))]
        .sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));
      if (!ids.length) { console.log("没有符合条件的模型，跳过"); continue; }
      const models = {}, effortReport = {};
      for (const modelId of ids) {
        const built = buildModelConfig(modelId, metadataFor(modelId, index), result.details[modelId], settings, provider);
        models[modelId] = built.model;
        effortReport[modelId] = built.effort;
        if (verbose) console.log(`\n  ${modelId}: ${built.effort.efforts.join(",") || (built.effort.reasoning ? "fixed" : "none")} (${built.effort.source})`);
      }
      generated[id] = {
        npm: provider.npm || "@ai-sdk/openai-compatible",
        name: displayName(provider, account),
        options: runtimeOptions(provider, account),
        models,
      };
      nextCache[id] = ids;
      nextDetails[id] = result.details;
      report.push({ provider: id, name: displayName(provider, account), endpoint: result.endpoint, fetched, models: effortReport });
      if (fetched) console.log(`${result.ids.length} 个可用，写入 ${ids.length} 个`);
    }
  }

  if (listOnly) {
    for (const [id, provider] of Object.entries(generated)) console.log(`\n[${id}] ${provider.name}\n${Object.keys(provider.models).join("\n")}`);
    return generated;
  }

  const output = { ...existing, $schema: existing.$schema || "https://opencode.ai/config.json", provider: { ...(existing.provider || {}) } };
  for (const id of previousManaged) if (!currentIds.has(id)) delete output.provider[id];
  Object.assign(output.provider, generated);
  if (!output.model) {
    const first = Object.entries(generated)[0];
    const model = first && Object.keys(first[1].models)[0];
    if (model) output.model = `${first[0]}/${model}`;
  }

  const target = dryRun ? path.join(ROOT_DIR, "opencode.preview.json") : configFile;
  if (!dryRun) {
    const backup = backupFile(configFile, "opencode.json");
    if (backup) console.log(`\n原配置已备份：${backup}`);
  }
  writeJsonAtomic(target, output);
  if (!dryRun) {
    writeJsonAtomic(MANAGED_FILE, [...currentIds]);
    writeJsonAtomic(CACHE_FILE, nextCache);
    writeJsonAtomic(DETAILS_FILE, nextDetails);
    writeJsonAtomic(REPORT_FILE, { generatedAt: new Date().toISOString(), providers: report });
  }
  console.log(`\n${dryRun ? "预览" : "配置"}已写入：${target}`);
  console.log(`写入 ${Object.keys(generated).length} 条线路，共 ${Object.values(generated).reduce((sum, p) => sum + Object.keys(p.models).length, 0)} 个模型入口。`);
  return generated;
}
