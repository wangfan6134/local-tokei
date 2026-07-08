# Local Tokei

A local-first AI usage dashboard inspired by Tokei. It reads usage data from local Codex and OpenCode files, then shows daily usage, token mix, cache hit rate, model distribution, tool distribution, project usage, and recent sessions in a browser.

## Run

```bash
npm start
```

Open:

```text
http://127.0.0.1:4242
```

## Data Sources

- Codex session JSONL files under `~/.codex/sessions`
- Codex runtime traces from `~/.codex/logs_2.sqlite` for model name hints
- OpenCode sqlite data from `~/.local/share/opencode/opencode.db`

All parsing happens locally. The app listens on `127.0.0.1` and does not upload logs.

## Notes

- Costs are local estimates, not official billing statements.
- Cached input is tracked separately from non-cached input.
- OpenCode support depends on the local sqlite schema available on the machine.

## Scripts

```bash
npm run check
npm test
```
