const REASONING_WORDS = /(reason|reasoner|reasoning|thinking|think|cot|qwq|rl(?:[-_.:/]|$))/i;
const KNOWN = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

function versionOf(id, family) {
  const match = id.match(new RegExp(`${family}[-_.:/]?(\\d+)(?:[.-](\\d+))?`, "i"));
  if (!match) return null;
  return Number(match[1]) + Number(match[2] || 0) / 10;
}

export function normalizeEfforts(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(list.map((item) => String(item).trim().toLowerCase()).filter((item) => KNOWN.has(item)))];
}

export function inferEffort(modelId, settings = {}, provider = {}, details = {}) {
  const id = String(modelId).toLowerCase();
  const override = provider.effortOverrides?.[modelId] || provider.effortOverrides?.[id];
  if (override) {
    return {
      reasoning: override.reasoning !== false,
      efforts: normalizeEfforts(override.efforts),
      source: "override",
      confidence: "explicit",
    };
  }

  const advertised = normalizeEfforts(
    details.efforts || details.reasoning_efforts || details.supported_reasoning_efforts || details.supportedEfforts,
  );
  if (advertised.length) return { reasoning: true, efforts: advertised, source: "provider", confidence: "explicit" };
  if (details.reasoning === false) return { reasoning: false, efforts: [], source: "provider", confidence: "explicit" };

  if (/deepseek[-_.:/]?(r1|reasoner)|qwq|qwen[^/]*(thinking|reasoning)|kimi[^/]*(thinking|reasoner)/i.test(id)) {
    return { reasoning: true, efforts: [], source: "rule:fixed-thinking", confidence: "high" };
  }

  if (/(^|[/_.:-])o[1-9](?:[/_.:-]|$)/i.test(id)) {
    return { reasoning: true, efforts: ["low", "medium", "high"], source: "rule:openai-o", confidence: "high" };
  }

  if (/gpt|codex/i.test(id)) {
    const version = versionOf(id, "gpt");
    const efforts = version && version >= 5.2
      ? ["none", "minimal", "low", "medium", "high", "xhigh"]
      : ["none", "low", "medium", "high"];
    return { reasoning: true, efforts, source: "rule:gpt", confidence: "high" };
  }

  if (/claude|opus|sonnet|haiku/i.test(id)) {
    const efforts = /(?:4[._-]?[7-9]|[5-9][._-]?\d?)/i.test(id)
      ? ["low", "medium", "high", "xhigh", "max"]
      : ["low", "medium", "high", "max"];
    return { reasoning: true, efforts, source: "rule:claude", confidence: "high" };
  }

  if (/grok/i.test(id)) {
    const efforts = /mini/i.test(id) ? ["low", "high"] : ["low", "medium", "high"];
    return { reasoning: true, efforts, source: "rule:grok", confidence: "medium" };
  }

  if (/gemini/i.test(id)) {
    const efforts = /2[._-]?5/i.test(id) ? ["high", "max"] : ["low", "high"];
    return { reasoning: true, efforts, source: "rule:gemini", confidence: "medium" };
  }

  if (/deepseek/i.test(id)) {
    const efforts = /v?4|ds4/i.test(id) ? ["low", "medium", "high", "max"] : ["low", "medium", "high"];
    return { reasoning: true, efforts, source: "rule:deepseek", confidence: "medium" };
  }

  if (/qwen|qwen3|qwen4/i.test(id)) {
    const efforts = /(coder|max|plus|instruct)/i.test(id) ? ["low", "medium", "high"] : [];
    return { reasoning: Boolean(efforts.length || REASONING_WORDS.test(id)), efforts, source: "rule:qwen", confidence: "medium" };
  }

  if (/glm[-_.:/]?5|glm[-_.:/]?6/i.test(id)) {
    return { reasoning: true, efforts: ["low", "medium", "high", "max"], source: "rule:glm", confidence: "medium" };
  }

  if (/kimi|moonshot/i.test(id)) {
    return { reasoning: true, efforts: ["low", "medium", "high"], source: "rule:kimi", confidence: "medium" };
  }

  if (/xiaomi|mimo/i.test(id)) {
    return { reasoning: true, efforts: ["low", "medium", "high"], source: "rule:mimo", confidence: "medium" };
  }

  if (/minimax/i.test(id)) {
    return { reasoning: true, efforts: ["low", "medium", "high"], source: "rule:minimax", confidence: "medium" };
  }

  if (REASONING_WORDS.test(id) || details.reasoning === true) {
    if (settings.effortMode === "aggressive") {
      return { reasoning: true, efforts: ["low", "medium", "high"], source: "rule:generic", confidence: "low" };
    }
    return { reasoning: true, efforts: [], source: "rule:generic-fixed", confidence: "low" };
  }

  return { reasoning: false, efforts: [], source: "unknown", confidence: "low" };
}

function variant(effort) {
  if (effort === "max") return { reasoningEffort: "max" };
  return { reasoningEffort: effort };
}

export function buildModelConfig(modelId, metadata, details, settings, provider) {
  const info = inferEffort(modelId, settings, provider, details || {});
  const model = {
    name: metadata?.name || details?.name || modelId,
    reasoning: info.reasoning,
    tool_call: metadata?.tool_call ?? details?.tool_call ?? details?.toolCall ?? true,
    limit: {
      context: metadata?.limit?.context || details?.context || details?.context_length || provider.defaultContext || settings.defaultContext || 128000,
      output: metadata?.limit?.output || details?.output || details?.max_output_tokens || provider.defaultOutput || settings.defaultOutput || 32768,
    },
  };
  for (const key of ["attachment", "structured_output", "temperature", "interleaved", "modalities"]) {
    if (metadata?.[key] !== undefined) model[key] = metadata[key];
    else if (details?.[key] !== undefined) model[key] = details[key];
  }
  if (settings.addReasoningVariants !== false && info.efforts.length) {
    model.variants = Object.fromEntries(info.efforts.map((effort) => [effort, variant(effort)]));
  }
  if (provider.modelOverrides?.[modelId]) Object.assign(model, provider.modelOverrides[modelId]);
  return { model, effort: info };
}
