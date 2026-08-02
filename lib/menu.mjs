import fs from "node:fs";
import path from "node:path";
import {
  APP_VERSION, CACHE_FILE, SOURCE_FILE, ask, confirm, createPrompt, displayName, expandHome,
  loadSource, maskKey, normalizeBaseURL, parseHeaders, parseJsonOrJsonc, runtimeId, saveSource,
  select, slugify, uniqueId,
} from "./common.mjs";
import { normalizeEfforts } from "./effort.mjs";
import { syncProviders } from "./sync.mjs";

function providerChoices(source) {
  return source.providers.map((provider) => ({ label: `${provider.name} [${provider.id}]`, value: provider.id }));
}

function accountChoices(provider) {
  return provider.accounts.map((account) => ({
    label: `${account.label || account.id} [${account.id}] ${maskKey(account.apiKey)}`,
    value: account.id,
  }));
}

async function chooseProvider(rl, source, label = "选择供应商") {
  const id = await select(rl, label, providerChoices(source));
  return source.providers.find((item) => item.id === id) || null;
}

async function chooseAccount(rl, provider, label = "选择 Key") {
  const id = await select(rl, label, accountChoices(provider));
  return provider.accounts.find((item) => item.id === id) || null;
}

async function chooseAuth(rl, current = "bearer") {
  return select(rl, "鉴权方式", [
    { label: "Authorization: Bearer <key>", value: "bearer" },
    { label: "x-api-key: <key>", value: "x-api-key" },
    { label: "api-key: <key>", value: "api-key" },
    { label: "自定义请求头", value: "custom" },
    { label: "无需鉴权", value: "none" },
  ], { allowCancel: false }) || current;
}

async function addProvider(rl, source) {
  const name = await ask(rl, "显示名称");
  if (!name) return;
  const baseURL = normalizeBaseURL(await ask(rl, "Base URL，例如 https://example.com/v1"));
  if (!baseURL) throw new Error("Base URL 不能为空");
  const suggested = slugify(name || new URL(baseURL).hostname);
  const id = uniqueId(source.providers.map((item) => item.id), slugify(await ask(rl, "Provider ID", suggested)), "provider");
  const modelsURL = await ask(rl, "Models URL（留空自动尝试）", "");
  const npm = await select(rl, "接口适配器", [
    { label: "OpenAI Compatible", value: "@ai-sdk/openai-compatible" },
    { label: "Anthropic", value: "@ai-sdk/anthropic" },
    { label: "OpenAI", value: "@ai-sdk/openai" },
  ], { allowCancel: false });
  const authType = await chooseAuth(rl);
  const auth = { type: authType };
  if (authType === "custom") {
    auth.headerName = await ask(rl, "请求头名称", "Authorization");
    auth.prefix = await ask(rl, "Key 前缀，可留空", "");
  }
  const headersText = await ask(rl, "额外请求头 JSON 或 Name: Value，留空跳过", "");
  const apiKey = authType === "none" ? "" : await ask(rl, "API Key");
  const label = await ask(rl, "Key 显示标签", "01");
  source.providers.push({
    id, name, baseURL, ...(modelsURL ? { modelsURL } : {}), npm, auth,
    ...(headersText ? { headers: parseHeaders(headersText) } : {}),
    enabled: true, modelMode: "all-text", accounts: [{ id: "k1", label, apiKey }],
  });
  saveSource(source);
  console.log(`已添加：${name} [${id}]`);
  if (await confirm(rl, "立即测试模型列表", true)) await syncProviders({ providerFilter: id, noModelsDev: true, verbose: true });
}

async function addKey(rl, source) {
  const provider = await chooseProvider(rl, source);
  if (!provider) return;
  const id = uniqueId(provider.accounts.map((item) => item.id), "", "k");
  const label = await ask(rl, "显示标签", String(provider.accounts.length + 1).padStart(2, "0"));
  const apiKey = (provider.auth?.type || "bearer") === "none" ? "" : await ask(rl, "API Key");
  provider.accounts.push({ id, label, apiKey });
  saveSource(source);
  console.log(`已添加 Key：${provider.name}｜${label}`);
}

async function editProvider(rl, source) {
  const provider = await chooseProvider(rl, source);
  if (!provider) return;
  while (true) {
    const action = await select(rl, `编辑 ${provider.name}`, [
      { label: `名称：${provider.name}`, value: "name" },
      { label: `Base URL：${provider.baseURL}`, value: "base" },
      { label: `Models URL：${provider.modelsURL || "自动"}`, value: "models" },
      { label: `适配器：${provider.npm}`, value: "npm" },
      { label: `鉴权：${provider.auth?.type || "bearer"}`, value: "auth" },
      { label: `额外请求头：${JSON.stringify(provider.headers || {})}`, value: "headers" },
      { label: `手动模型：${(provider.manualModels || []).join(",") || "无"}`, value: "manual" },
      { label: `启用状态：${provider.enabled !== false ? "启用" : "停用"}`, value: "enabled" },
      { label: "模型 effort 覆盖", value: "effort" },
      { label: "测试模型列表", value: "test" },
    ]);
    if (!action) break;
    if (action === "name") provider.name = await ask(rl, "名称", provider.name);
    if (action === "base") provider.baseURL = normalizeBaseURL(await ask(rl, "Base URL", provider.baseURL));
    if (action === "models") {
      const value = await ask(rl, "Models URL，输入 - 清空", provider.modelsURL || "");
      if (value === "-") delete provider.modelsURL; else provider.modelsURL = value;
    }
    if (action === "npm") provider.npm = await ask(rl, "npm 适配器", provider.npm || "@ai-sdk/openai-compatible");
    if (action === "auth") provider.auth = { type: await chooseAuth(rl, provider.auth?.type) };
    if (action === "headers") provider.headers = parseHeaders(await ask(rl, "JSON 或 Name: Value，输入 {} 清空", JSON.stringify(provider.headers || {})));
    if (action === "manual") {
      const value = await ask(rl, "模型 ID，逗号分隔，输入 - 清空", (provider.manualModels || []).join(","));
      provider.manualModels = value === "-" ? [] : value.split(",").map((item) => item.trim()).filter(Boolean);
    }
    if (action === "enabled") provider.enabled = provider.enabled === false;
    if (action === "effort") await editEffort(rl, provider);
    if (action === "test") await syncProviders({ providerFilter: provider.id, noModelsDev: true, verbose: true, dryRun: true });
    saveSource(source);
  }
}

async function editEffort(rl, provider) {
  const modelId = await ask(rl, "模型 ID");
  if (!modelId) return;
  const mode = await select(rl, `设置 ${modelId}`, [
    { label: "自动识别", value: "auto" },
    { label: "固定推理，不显示档位", value: "fixed" },
    { label: "关闭推理标记", value: "off" },
    { label: "自定义档位", value: "custom" },
  ], { allowCancel: false });
  provider.effortOverrides ||= {};
  if (mode === "auto") delete provider.effortOverrides[modelId];
  if (mode === "fixed") provider.effortOverrides[modelId] = { reasoning: true, efforts: [] };
  if (mode === "off") provider.effortOverrides[modelId] = { reasoning: false, efforts: [] };
  if (mode === "custom") {
    const value = await ask(rl, "none,minimal,low,medium,high,xhigh,max", "low,medium,high");
    provider.effortOverrides[modelId] = { reasoning: true, efforts: normalizeEfforts(value) };
  }
}

async function editKey(rl, source) {
  const provider = await chooseProvider(rl, source);
  if (!provider) return;
  const account = await chooseAccount(rl, provider);
  if (!account) return;
  account.label = await ask(rl, "显示标签", account.label || account.id);
  if ((provider.auth?.type || "bearer") !== "none") {
    const key = await ask(rl, `新 Key，直接回车保留 ${maskKey(account.apiKey)}`, "");
    if (key) account.apiKey = key;
  }
  const headers = await ask(rl, "该 Key 专属请求头，直接回车保留，输入 {} 清空", "");
  if (headers) account.headers = parseHeaders(headers);
  saveSource(source);
}

async function removeKey(rl, source) {
  const provider = await chooseProvider(rl, source);
  if (!provider) return;
  const account = await chooseAccount(rl, provider);
  if (!account) return;
  if (!await confirm(rl, `确认删除 ${displayName(provider, account)}`, false)) return;
  provider.accounts = provider.accounts.filter((item) => item.id !== account.id);
  saveSource(source);
}

async function removeProvider(rl, source) {
  const provider = await chooseProvider(rl, source);
  if (!provider) return;
  if (!await confirm(rl, `确认删除供应商 ${provider.name}`, false)) return;
  source.providers = source.providers.filter((item) => item.id !== provider.id);
  saveSource(source);
}

export function printProviders(source = loadSource()) {
  if (!source.providers.length) return console.log("还没有供应商。");
  const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) : {};
  for (const provider of source.providers) {
    console.log(`\n${provider.name} [${provider.id}] ${provider.enabled === false ? "(已停用)" : ""}`);
    console.log(`  ${provider.baseURL}`);
    for (const account of provider.accounts) {
      console.log(`  - ${account.label || account.id} [${account.id}] ${maskKey(account.apiKey)} / 模型 ${(cache[runtimeId(provider, account)] || []).length}`);
    }
  }
}

async function settings(rl, source) {
  const s = source.settings;
  while (true) {
    const action = await select(rl, "全局设置", [
      { label: `OpenCode 配置：${s.configFile}`, value: "config" },
      { label: `Models.dev：${s.useModelsDev !== false ? "开启" : "关闭"}`, value: "modelsdev" },
      { label: `Effort 模式：${s.effortMode}`, value: "effort" },
      { label: `过滤非聊天模型：${s.filterNonChatModels !== false ? "开启" : "关闭"}`, value: "filter" },
      { label: `默认上下文：${s.defaultContext}`, value: "context" },
      { label: `默认输出：${s.defaultOutput}`, value: "output" },
      { label: `请求超时：${s.timeoutMs} ms`, value: "timeout" },
    ]);
    if (!action) break;
    if (action === "config") s.configFile = await ask(rl, "配置文件路径", s.configFile);
    if (action === "modelsdev") s.useModelsDev = s.useModelsDev === false;
    if (action === "effort") s.effortMode = await select(rl, "模式", [
      { label: "conservative", value: "conservative" },
      { label: "balanced", value: "balanced" },
      { label: "aggressive", value: "aggressive" },
    ], { allowCancel: false });
    if (action === "filter") s.filterNonChatModels = s.filterNonChatModels === false;
    if (action === "context") s.defaultContext = Number(await ask(rl, "默认上下文", s.defaultContext));
    if (action === "output") s.defaultOutput = Number(await ask(rl, "默认输出", s.defaultOutput));
    if (action === "timeout") s.timeoutMs = Number(await ask(rl, "超时毫秒", s.timeoutMs));
    saveSource(source);
  }
}

export async function doctor(source = loadSource()) {
  const errors = [], warnings = [], providerIds = new Set();
  for (const provider of source.providers) {
    if (providerIds.has(provider.id)) errors.push(`重复供应商 ID：${provider.id}`);
    providerIds.add(provider.id);
    if (!provider.baseURL) errors.push(`${provider.id} 缺少 baseURL`);
    if (!provider.accounts.length) warnings.push(`${provider.id} 没有 Key`);
    const accountIds = new Set();
    for (const account of provider.accounts) {
      if (accountIds.has(account.id)) errors.push(`${provider.id} 重复 Key ID：${account.id}`);
      accountIds.add(account.id);
      if ((provider.auth?.type || "bearer") !== "none" && !account.apiKey) warnings.push(`${provider.id}/${account.id} Key 为空`);
    }
  }
  const configPath = expandHome(source.settings.configFile || "~/.config/opencode/opencode.json");
  try { parseJsonOrJsonc(configPath); console.log(`OpenCode 配置可解析：${configPath}`); }
  catch (error) { errors.push(`OpenCode 配置无法解析：${error.message}`); }
  if (path.basename(configPath) === "opencode.json" && fs.existsSync(path.join(path.dirname(configPath), "opencode.jsonc"))) {
    warnings.push("同目录存在 opencode.jsonc，请避免在两份文件中重复维护 provider。");
  }
  warnings.forEach((item) => console.log(`警告：${item}`));
  errors.forEach((item) => console.log(`错误：${item}`));
  if (!errors.length) console.log("检查完成，没有发现阻止运行的问题。");
  return errors.length === 0;
}

export async function interactive() {
  const rl = createPrompt();
  try {
    while (true) {
      console.log("\n========================================");
      console.log(` OpenCode Provider Manager ${APP_VERSION}`);
      console.log("========================================");
      const action = await select(rl, "选择操作", [
        { label: "同步全部供应商、模型和 effort", value: "sync" },
        { label: "添加供应商", value: "add-provider" },
        { label: "添加 Key", value: "add-key" },
        { label: "编辑供应商", value: "edit-provider" },
        { label: "编辑 Key", value: "edit-key" },
        { label: "删除 Key", value: "remove-key" },
        { label: "删除供应商", value: "remove-provider" },
        { label: "查看供应商", value: "list" },
        { label: "全局设置", value: "settings" },
        { label: "检查配置", value: "doctor" },
      ]);
      if (!action) break;
      const source = loadSource();
      try {
        if (action === "sync") await syncProviders({ verbose: await confirm(rl, "显示 effort 识别结果", false) });
        if (action === "add-provider") await addProvider(rl, source);
        if (action === "add-key") await addKey(rl, source);
        if (action === "edit-provider") await editProvider(rl, source);
        if (action === "edit-key") await editKey(rl, source);
        if (action === "remove-key") await removeKey(rl, source);
        if (action === "remove-provider") await removeProvider(rl, source);
        if (action === "list") printProviders(source);
        if (action === "settings") await settings(rl, source);
        if (action === "doctor") await doctor(source);
      } catch (error) {
        console.log(`操作失败：${error.message}`);
      }
    }
  } finally {
    rl.close();
  }
}
