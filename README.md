# Local Tokei

[English](#english) | [中文](#中文)

## English

A local-first AI usage dashboard inspired by Tokei. It reads usage data from local Codex and OpenCode files, then shows daily usage, token mix, cache hit rate, model distribution, tool distribution, project usage, and recent sessions in a browser.

### Run

```bash
npm start
```

Open:

```text
http://127.0.0.1:4242
```

### Data Sources

- Codex session JSONL files under `~/.codex/sessions`
- Codex runtime traces from `~/.codex/logs_2.sqlite` for model name hints
- OpenCode sqlite data from `~/.local/share/opencode/opencode.db`

All parsing happens locally. The app listens on `127.0.0.1` and does not upload logs.

### Notes

- Costs are local estimates, not official billing statements.
- Cached input is tracked separately from non-cached input.
- OpenCode support depends on the local sqlite schema available on the machine.

### Development Commands

You only need `npm start` for normal use. The commands below are for checking changes while developing or maintaining the project.

```bash
npm run check
npm test
```

## 中文

Local Tokei 是一个参考 Tokei 风格的本地优先 AI 用量看板。它会读取本机 Codex 和 OpenCode 的本地数据，并在浏览器里展示每日用量、Token 构成、缓存命中率、模型分布、工具分布、项目用量和最近会话。

### 运行

```bash
npm start
```

打开：

```text
http://127.0.0.1:4242
```

### 数据来源

- `~/.codex/sessions` 下的 Codex 会话 JSONL 文件
- `~/.codex/logs_2.sqlite` 中的 Codex 运行痕迹，用于辅助识别模型名称
- `~/.local/share/opencode/opencode.db` 中的 OpenCode sqlite 数据

所有解析都在本机完成。应用只监听 `127.0.0.1`，不会上传日志。

### 说明

- 费用是本地估算值，不等同于官方账单。
- 命中缓存的输入会和普通输入分开统计。
- OpenCode 支持取决于本机可用的 sqlite 数据结构。

### 开发命令

普通使用只需要执行 `npm start`。下面两个命令主要用于开发或维护时检查改动。

```bash
npm run check
npm test
```
