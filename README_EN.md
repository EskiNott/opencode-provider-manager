# OpenCode Provider Manager

[简体中文](README.md)

A local multi-provider manager for OpenCode Desktop. It provides an interactive command-line interface for adding, editing, and removing providers and API keys, discovers provider model lists, and generates conservative reasoning-effort metadata for OpenCode.

## Features

- Multiple API keys per provider, exposed as separate OpenCode providers.
- Interactive provider and credential management.
- Automatic model discovery across common `/models` response shapes and endpoint layouts.
- Bearer, `x-api-key`, `api-key`, custom-header, and unauthenticated endpoints.
- Filtering for embedding, speech, image, video, and other non-chat models.
- Conservative effort inference for GPT/Codex, Claude, Grok, Gemini, Qwen, DeepSeek, GLM, Kimi, MiMo, MiniMax, and other known families.
- Unknown text models remain usable without fabricated effort variants.
- Optional Models.dev enrichment for context limits, output limits, modalities, and tool support.
- Preserves unrelated OpenCode settings such as permissions, MCP, agents, and themes.
- Automatic backups and last-known-good model caches.
- No runtime npm dependencies.

## Requirements

- Node.js 20 or newer
- Git Bash on Windows, or Bash on macOS/Linux
- OpenCode Desktop or OpenCode CLI

## Installation

```bash
git clone <repository-url>
cd opencode-provider-manager
./install.sh
```

Then run:

```bash
cd ~/.config/opencode/opencode-provider-manager
./manage.sh
```

## Common commands

```bash
./manage.sh                         # Interactive menu
./sync-models.sh                    # Synchronize all providers
./sync-models.sh --verbose          # Show effort-detection details
./sync-models.sh --dry-run          # Generate a preview only
./sync-models.sh --no-models-dev    # Skip Models.dev enrichment
./sync-models.sh --provider my-id   # Synchronize one provider
```

## Capability detection

Metadata priority:

1. Capability fields returned by the provider's model-list endpoint
2. Models.dev metadata
3. Conservative built-in rules
4. User overrides

Many model-list endpoints return only model IDs. The manager therefore keeps unknown text models available while omitting effort variants it cannot support with reasonable confidence.

## Local credentials

Credentials are stored locally in `providers.json` and may also appear in the generated OpenCode configuration. The repository's `.gitignore` excludes credentials, generated configuration, caches, reports, and backups.

## Development

```bash
npm test
```

The smoke test uses a temporary directory and does not contact real providers.

## License

MIT
