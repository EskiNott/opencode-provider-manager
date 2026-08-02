import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-provider-manager-test-"));
const appDir = path.join(tempRoot, "app");
fs.mkdirSync(appDir, { recursive: true });

for (const file of ["manager.mjs", "providers.example.json"]) {
  fs.copyFileSync(path.join(projectDir, file), path.join(appDir, file));
}

const configFile = path.join(tempRoot, "opencode.json");
const source = {
  version: 1,
  settings: {
    configFile,
    timeoutMs: 1000,
    useModelsDev: false,
    defaultContext: 128000,
    defaultOutput: 32768,
    filterNonChatModels: true,
    effortMode: "balanced",
    addReasoningVariants: true,
  },
  providers: [
    {
      id: "demo",
      name: "Demo Provider",
      baseURL: "https://example.invalid/v1",
      npm: "@ai-sdk/openai-compatible",
      enabled: true,
      skipModelFetch: true,
      modelMode: "all-text",
      auth: { type: "none" },
      fallbackModels: [
        "gpt-5.7-codex",
        "claude-opus-4.7",
        "qwen3-thinking",
        "xiaomi-mimo-v2",
        "new-chat-model",
        "text-embedding-3-large"
      ],
      accounts: [{ id: "k1", label: "01", apiKey: "" }]
    }
  ]
};
fs.writeFileSync(path.join(appDir, "providers.json"), `${JSON.stringify(source, null, 2)}\n`);

const result = spawnSync(process.execPath, ["manager.mjs", "sync", "--dry-run", "--no-models-dev"], {
  cwd: appDir,
  encoding: "utf8",
  env: { ...process.env, HOME: tempRoot, USERPROFILE: tempRoot },
});

if (result.status !== 0) {
  process.stderr.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
}
assert.equal(result.status, 0, "dry-run sync should succeed");

const preview = JSON.parse(fs.readFileSync(path.join(appDir, "opencode.preview.json"), "utf8"));
const provider = preview.provider["demo-k1"];
assert.ok(provider, "generated provider should exist");
assert.ok(provider.models["gpt-5.7-codex"].variants.xhigh, "GPT 5.7 should expose xhigh");
assert.ok(provider.models["claude-opus-4.7"].variants.max, "Claude should expose max");
assert.equal(provider.models["qwen3-thinking"].reasoning, true, "Qwen thinking should be marked as reasoning");
assert.equal(provider.models["qwen3-thinking"].variants, undefined, "fixed-thinking Qwen should not get fabricated variants");
assert.ok(provider.models["xiaomi-mimo-v2"].variants.high, "MiMo v2 should expose a high variant");
assert.equal(provider.models["new-chat-model"].reasoning, false, "unknown model should stay conservative");
assert.equal(provider.models["text-embedding-3-large"], undefined, "embedding model should be filtered");

const repositoryFiles = [
  "manager.mjs",
  "providers.example.json",
  "README.md",
  "README_EN.md",
  "install.sh",
  "manage.sh",
  "sync-models.sh",
];
const liveKeyPattern = /sk-[A-Za-z0-9_-]{24,}/g;
for (const file of repositoryFiles) {
  const content = fs.readFileSync(path.join(projectDir, file), "utf8");
  assert.equal(liveKeyPattern.test(content), false, `${file} must not contain a live-key-shaped value`);
  liveKeyPattern.lastIndex = 0;
}

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("Smoke test passed.");
