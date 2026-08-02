# OpenCode Provider Manager

[English](README_EN.md)

一个面向 OpenCode Desktop 的本地多供应商管理器。通过交互式命令行添加、编辑和删除供应商及多个 API Key，自动读取供应商的模型列表，并为已知模型生成适合 OpenCode 的推理档位与能力元数据。

## 功能

- 一个供应商保存多个 Key，每个 Key 生成独立的 OpenCode Provider。
- 交互式添加、编辑、停用和删除供应商或 Key。
- 自动尝试常见的模型列表地址，并兼容多种 JSON 返回结构。
- 支持 Bearer、`x-api-key`、`api-key`、自定义请求头和无鉴权接口。
- 自动过滤 Embedding、TTS、图片、视频等非聊天模型。
- 为 GPT/Codex、Claude、Grok、Gemini、Qwen、DeepSeek、GLM、Kimi、MiMo、MiniMax 等已知系列推断 reasoning effort。
- 陌生模型仍会加入模型列表；无法可靠判断时不生成虚假的 effort 档位。
- 可选读取 Models.dev 元数据，补充上下文、输出限制、多模态和工具调用信息。
- 更新 `opencode.json` 时保留主题、权限、MCP、Agent 等其他配置。
- 自动备份配置，并保留上一次成功同步的模型缓存。
- 无 npm 运行时依赖。

## 环境要求

- Node.js 20 或更新版本
- Windows：Git Bash
- macOS / Linux：Bash
- 已安装 OpenCode Desktop 或 OpenCode CLI

## 安装

```bash
git clone <repository-url>
cd opencode-provider-manager
bash install.sh
```

安装位置：

```text
~/.config/opencode/opencode-provider-manager
```

进入交互管理器：

```bash
cd ~/.config/opencode/opencode-provider-manager
./manage.sh
```

## 使用流程

运行：

```bash
./manage.sh
```

主菜单提供：

1. 同步全部供应商、模型和 effort
2. 添加供应商
3. 添加 Key
4. 编辑供应商
5. 编辑 Key
6. 删除 Key
7. 删除供应商
8. 查看供应商
9. 全局设置
10. 检查配置

添加供应商时，通常只需要填写：

```text
显示名称
Provider ID
Base URL
接口适配器
鉴权方式
API Key
```

常见 OpenAI-compatible 地址填写到 `/v1`：

```text
https://example.com/v1
```

模型列表会优先尝试：

```text
自定义 Models URL
Base URL + /models
站点根目录 + /api/models
站点根目录 + /api/openai/models
```

## 快速同步

同步所有供应商：

```bash
./sync-models.sh
```

查看每个模型的 effort 识别来源：

```bash
./sync-models.sh --verbose
```

只预览生成结果：

```bash
./sync-models.sh --dry-run
```

跳过 Models.dev：

```bash
./sync-models.sh --no-models-dev
```

只同步一个供应商：

```bash
./sync-models.sh --provider provider-id
```

## 文件结构

```text
~/.config/opencode/
├── opencode.json                       # OpenCode 最终配置
└── opencode-provider-manager/
    ├── providers.json                  # 本地供应商与 Key，已被 Git 忽略
    ├── providers.example.json          # 空白公开模板
    ├── manager.mjs                     # 命令入口
    ├── lib/                            # 配置、同步、effort 与交互模块
    ├── manage.sh                       # 交互入口
    ├── sync-models.sh                  # 快速同步入口
    ├── .models-cache.json              # 模型缓存
    ├── .model-details.json             # /models 能力元数据
    ├── .models-dev-cache.json          # Models.dev 缓存
    ├── .managed-provider-ids.json      # 管理器生成的 Provider ID
    ├── last-sync-report.json           # 最近同步报告
    └── backups/                        # 自动备份
```

## 模型与 effort 识别

识别优先级：

1. 供应商 `/models` 返回的能力字段
2. Models.dev 元数据
3. 内置保守规则
4. 用户手动覆盖

`/models` 经常只返回模型 ID，因此无法保证自动推断出所有新模型的真实档位。模型会照常加入；只有证据足够时才写入 variants。

在交互菜单中选择：

```text
编辑供应商 → 模型/effort 覆盖
```

可设置：

- 自动识别
- 固定推理，不显示档位
- 关闭推理标记
- 自定义 `none,minimal,low,medium,high,xhigh,max`

## 隐私与凭据

所有配置保存在本机。项目不包含遥测。

`providers.json`、生成的 `opencode.json`、缓存和备份可能包含凭据，已经由 `.gitignore` 排除。发布 Issue 或提交 PR 时不要上传这些文件。

## 开发

```bash
npm test
```

测试会在临时目录中生成模拟供应商配置，不访问真实 API。

## 许可证

MIT
