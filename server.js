const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const PORT = Number(process.env.PORT || 4242);
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const OPENCODE_HOME = process.env.OPENCODE_HOME || path.join(os.homedir(), ".local", "share", "opencode");
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const PRICE_PER_MILLION = {
  default: { input: 1.25, cacheRead: 0.125, output: 10 },
  "gpt-5.5": { input: 5, cacheRead: 0.5, output: 30 },
  "gpt-5.4": { input: 1.25, cacheRead: 0.125, output: 10 },
  "gpt-5": { input: 1.25, cacheRead: 0.125, output: 10 },
  "gpt-4.1": { input: 2, cacheRead: 0.5, output: 8 },
};

function readJsonl(file) {
  try {
    return fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function walk(dir, predicate, limit = 2000) {
  const out = [];
  const stack = [dir];
  while (stack.length && out.length < limit) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (predicate(full)) out.push(full);
    }
  }
  return out;
}

function dateKey(iso) {
  if (!iso) return "unknown";
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, offsetDays) {
  const d = new Date(date);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

function completeLast30Days(days = [], now = new Date()) {
  const byDay = new Map(days.map((day) => [day.day, day]));
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  const out = [];
  for (let i = 29; i >= 0; i -= 1) {
    const day = dateKey(addDays(end, -i).toISOString());
    out.push({ day, ...emptyUsage(), ...(byDay.get(day) || {}) });
  }
  return out;
}

function startOfLocalDay(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

function extractText(value, maxDepth = 4) {
  if (!value || maxDepth <= 0) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => extractText(item, maxDepth - 1)).join(" ");
  if (typeof value === "object") return Object.values(value).map((item) => extractText(item, maxDepth - 1)).join(" ");
  return "";
}

function normalizeUsage(usage = {}) {
  const rawInput = Number(usage.input_tokens || usage.prompt_tokens || 0);
  const cached = Number(usage.cached_input_tokens || usage.cached_tokens || 0);
  const input = Math.max(rawInput - cached, 0);
  const output = Number(usage.output_tokens || usage.completion_tokens || 0);
  const reasoning = Number(usage.reasoning_output_tokens || usage.reasoning_tokens || 0);
  const total = input + cached + output + reasoning;
  return { input, cached, output, reasoning, total };
}

function isLikelyModelName(value) {
  return /^(codex|o\d|gpt-|claude|gemini)/i.test(value || "");
}

function addUsage(a, b) {
  a.input += b.input || 0;
  a.cached += b.cached || 0;
  a.output += b.output || 0;
  a.reasoning += b.reasoning || 0;
  a.total += b.total || 0;
}

function emptyUsage() {
  return { input: 0, cached: 0, output: 0, reasoning: 0, total: 0 };
}

function estimateCost(usage, model) {
  const key = Object.keys(PRICE_PER_MILLION).find((name) => model && model.includes(name));
  const price = PRICE_PER_MILLION[key] || PRICE_PER_MILLION.default;
  return (usage.input * price.input + usage.cached * price.cacheRead + usage.output * price.output) / 1_000_000;
}

function sqliteJson(db, sql) {
  if (!fs.existsSync(db)) return [];
  const result = spawnSync("sqlite3", ["-json", db, sql], { encoding: "utf8", timeout: 3000 });
  if (result.status !== 0 || !result.stdout.trim()) return [];
  try {
    return JSON.parse(result.stdout);
  } catch {
    return [];
  }
}

function toIsoTime(value) {
  if (!value) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return new Date(n < 10_000_000_000 ? n * 1000 : n).toISOString();
}

function parseModelName(value, fallback = "unknown") {
  if (!value) return fallback;
  if (typeof value !== "string") return String(value);
  try {
    const parsed = JSON.parse(value);
    return parsed.id || parsed.model || parsed.name || fallback;
  } catch {
    return value;
  }
}

function readThreadNames() {
  const names = new Map();
  for (const row of readJsonl(path.join(CODEX_HOME, "session_index.jsonl"))) {
    if (row.id) names.set(row.id, row.thread_name || "Untitled");
  }
  return names;
}

function readCodexModelMap() {
  const db = path.join(CODEX_HOME, "logs_2.sqlite");
  const rows = sqliteJson(db, `
    select
      thread_id,
      substr(feedback_log_body, 1, 1200) as body
    from logs
    where thread_id is not null
      and feedback_log_body like '%model=%'
    order by ts asc, ts_nanos asc, id asc;
  `);
  const models = new Map();
  for (const row of rows) {
    const match = String(row.body || "").match(/\bmodel=([a-zA-Z0-9_.:-]+)/);
    if (row.thread_id && match && isLikelyModelName(match[1])) {
      models.set(row.thread_id, match[1]);
    }
  }
  return models;
}

function readCodexDefaultModel() {
  try {
    const config = fs.readFileSync(path.join(CODEX_HOME, "config.toml"), "utf8");
    const match = config.match(/^model\s*=\s*"([^"]+)"/m);
    if (match && isLikelyModelName(match[1])) return match[1];
  } catch {
    return "";
  }
  return "";
}

function parseCodexSessions() {
  const sessionDir = path.join(CODEX_HOME, "sessions");
  const files = walk(sessionDir, (file) => file.endsWith(".jsonl"));
  const threadNames = readThreadNames();
  const sqliteModels = readCodexModelMap();
  const defaultModel = readCodexDefaultModel();
  const sessions = [];
  const totals = emptyUsage();
  const byDay = new Map();
  const byTool = new Map();
  const byModel = new Map();
  const byProject = new Map();
  const today = startOfLocalDay();
  const week = startOfLocalDay(-6);
  const month = startOfLocalDay(-29);
  const ranges = { today: emptyUsage(), week: emptyUsage(), month: emptyUsage() };

  for (const file of files) {
    const rows = readJsonl(file);
    if (!rows.length) continue;

    let id = "";
    let cwd = "";
    let title = "";
    let model = "codex";
    let firstAt = "";
    let lastAt = "";
    const usage = emptyUsage();
    let turns = 0;

    for (const row of rows) {
      const ts = row.timestamp || row.payload?.timestamp;
      if (ts) {
        firstAt = firstAt || ts;
        lastAt = ts;
      }
      if (row.type === "session_meta") {
        id = row.payload?.id || row.payload?.session_id || id;
        cwd = row.payload?.cwd || cwd;
        model = row.payload?.model || row.payload?.model_slug || model;
      }

      const tokenInfo = row.type === "event_msg" && row.payload?.type === "token_count"
        ? row.payload.info
        : null;
      if (tokenInfo?.last_token_usage) {
        const last = normalizeUsage(tokenInfo.last_token_usage);
        addUsage(usage, last);
        turns += 1;

        const eventDate = new Date(ts || lastAt || firstAt);
        const day = dateKey(ts || lastAt || firstAt);
        const dayUsage = byDay.get(day) || emptyUsage();
        addUsage(dayUsage, last);
        byDay.set(day, dayUsage);
        if (eventDate >= today) addUsage(ranges.today, last);
        if (eventDate >= week) addUsage(ranges.week, last);
        if (eventDate >= month) addUsage(ranges.month, last);
      }
    }

    if (!usage.total) continue;

    if (sqliteModels.has(id)) {
      model = sqliteModels.get(id);
    } else if ((!model || model.toLowerCase() === "codex") && defaultModel) {
      model = defaultModel;
    }

    title = threadNames.get(id) || path.basename(file).replace(/^rollout-/, "").replace(/\.jsonl$/, "");
    addUsage(totals, usage);

    const tool = "Codex";
    const toolUsage = byTool.get(tool) || emptyUsage();
    addUsage(toolUsage, usage);
    byTool.set(tool, toolUsage);

    if (model && model.toLowerCase() !== "codex") {
      const modelUsage = byModel.get(model) || emptyUsage();
      addUsage(modelUsage, usage);
      byModel.set(model, modelUsage);
    }

    const project = cwd ? path.basename(cwd) : "Unknown";
    const projectUsage = byProject.get(project) || emptyUsage();
    addUsage(projectUsage, usage);
    byProject.set(project, projectUsage);

    sessions.push({
      id,
      title,
      cwd,
      project,
      model,
      source: "Codex",
      firstAt,
      lastAt,
      turns,
      usage,
      cost: estimateCost(usage, model),
    });
  }

  sessions.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

  return {
    source: "Codex",
    codexHome: CODEX_HOME,
    generatedAt: new Date().toISOString(),
    totals,
    cost: sessions.reduce((sum, row) => sum + row.cost, 0),
    ranges,
    sessions,
    byDay: completeLast30Days([...byDay.entries()].map(([day, usage]) => ({ day, ...usage }))),
    byTool: [...byTool.entries()].map(([tool, usage]) => ({ tool, ...usage })).sort((a, b) => b.total - a.total),
    byModel: summarizeModelsWithSources(sessions),
    byProject: summarizeRows(sessions, "project").slice(0, 12),
    filesScanned: files.length,
  };
}

function parseOpenCodeSessions() {
  const db = path.join(OPENCODE_HOME, "opencode.db");
  const rows = sqliteJson(db, `
    select
      id,
      title,
      directory,
      agent,
      model,
      cost,
      tokens_input,
      tokens_output,
      tokens_reasoning,
      tokens_cache_read,
      tokens_cache_write,
      time_created,
      time_updated
    from session
    where tokens_input > 0
       or tokens_output > 0
       or tokens_reasoning > 0
       or tokens_cache_read > 0
       or tokens_cache_write > 0
    order by time_updated desc;
  `);

  const sessions = [];
  const totals = emptyUsage();
  const byDay = new Map();
  const byTool = new Map();
  const byModel = new Map();
  const byProject = new Map();
  const today = startOfLocalDay();
  const week = startOfLocalDay(-6);
  const month = startOfLocalDay(-29);
  const ranges = { today: emptyUsage(), week: emptyUsage(), month: emptyUsage() };

  for (const row of rows) {
    const usage = {
      input: Number(row.tokens_input || 0) + Number(row.tokens_cache_write || 0),
      cached: Number(row.tokens_cache_read || 0),
      output: Number(row.tokens_output || 0),
      reasoning: Number(row.tokens_reasoning || 0),
      total: 0,
    };
    usage.total = usage.input + usage.cached + usage.output + usage.reasoning;
    if (!usage.total) continue;

    const model = parseModelName(row.model, "unknown");
    const firstAt = toIsoTime(row.time_created);
    const lastAt = toIsoTime(row.time_updated || row.time_created);
    const eventDate = new Date(lastAt || firstAt);
    const day = dateKey(lastAt || firstAt);
    const project = row.directory ? path.basename(row.directory) : "Unknown";
    const title = row.title || row.id || "Untitled";

    addUsage(totals, usage);

    const dayUsage = byDay.get(day) || emptyUsage();
    addUsage(dayUsage, usage);
    byDay.set(day, dayUsage);
    if (eventDate >= today) addUsage(ranges.today, usage);
    if (eventDate >= week) addUsage(ranges.week, usage);
    if (eventDate >= month) addUsage(ranges.month, usage);

    const tool = "OpenCode";
    const toolUsage = byTool.get(tool) || emptyUsage();
    addUsage(toolUsage, usage);
    byTool.set(tool, toolUsage);

    if (model && model !== "unknown") {
      const modelUsage = byModel.get(model) || emptyUsage();
      addUsage(modelUsage, usage);
      byModel.set(model, modelUsage);
    }

    const projectUsage = byProject.get(project) || emptyUsage();
    addUsage(projectUsage, usage);
    byProject.set(project, projectUsage);

    sessions.push({
      id: row.id || "",
      title,
      cwd: row.directory || "",
      project,
      model,
      agent: row.agent || "",
      source: "OpenCode",
      firstAt,
      lastAt,
      turns: 1,
      usage,
      cost: Number(row.cost || 0) || estimateCost(usage, model),
    });
  }

  sessions.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

  return {
    source: "OpenCode",
    opencodeHome: OPENCODE_HOME,
    generatedAt: new Date().toISOString(),
    totals,
    cost: sessions.reduce((sum, row) => sum + row.cost, 0),
    ranges,
    sessions,
    byDay: completeLast30Days([...byDay.entries()].map(([day, usage]) => ({ day, ...usage }))),
    byTool: [...byTool.entries()].map(([tool, usage]) => ({ tool, ...usage })).sort((a, b) => b.total - a.total),
    byModel: summarizeModelsWithSources(sessions),
    byProject: summarizeRows(sessions, "project").slice(0, 12),
    filesScanned: rows.length,
  };
}

function mergeUsageRows(rows, key) {
  return summarizeRows(rows, key);
}

function rowUsage(row) {
  return row.usage || row;
}

function summarizeRows(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const name = row[key] || "Unknown";
    const current = map.get(name) || { [key]: name, ...emptyUsage(), cost: 0, sessions: 0, lastAt: "" };
    addUsage(current, rowUsage(row));
    current.cost += Number(row.cost || 0);
    current.sessions += Number(row.sessions || 1);
    if (row.lastAt && (!current.lastAt || new Date(row.lastAt) > new Date(current.lastAt))) current.lastAt = row.lastAt;
    map.set(name, current);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function summarizeModelsWithSources(sessions) {
  const byModel = new Map();
  for (const session of sessions) {
    const model = session.model || "Unknown";
    const source = session.source || "Unknown";
    const usage = rowUsage(session);
    const current = byModel.get(model) || { model, ...emptyUsage(), cost: 0, sessions: 0, lastAt: "", sources: new Map() };
    addUsage(current, usage);
    current.cost += Number(session.cost || 0);
    current.sessions += 1;
    if (session.lastAt && (!current.lastAt || new Date(session.lastAt) > new Date(current.lastAt))) current.lastAt = session.lastAt;

    const sourceUsage = current.sources.get(source) || { source, ...emptyUsage(), cost: 0, sessions: 0 };
    addUsage(sourceUsage, usage);
    sourceUsage.cost += Number(session.cost || 0);
    sourceUsage.sessions += 1;
    current.sources.set(source, sourceUsage);
    byModel.set(model, current);
  }

  return [...byModel.values()]
    .map((row) => ({ ...row, sources: [...row.sources.values()].sort((a, b) => b.total - a.total) }))
    .sort((a, b) => b.total - a.total);
}

function usageFromSessions(sessions, now = new Date()) {
  const totals = emptyUsage();
  const ranges = { today: emptyUsage(), week: emptyUsage(), month: emptyUsage() };
  const byDay = new Map();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const week = addDays(today, -6);
  const month = addDays(today, -29);
  let cost = 0;

  for (const session of sessions) {
    const usage = rowUsage(session);
    addUsage(totals, usage);
    cost += Number(session.cost || 0);
    const eventDate = new Date(session.lastAt || session.firstAt || now);
    const day = dateKey(eventDate.toISOString());
    const dayUsage = byDay.get(day) || emptyUsage();
    addUsage(dayUsage, usage);
    byDay.set(day, dayUsage);
    if (eventDate >= today) addUsage(ranges.today, usage);
    if (eventDate >= week) addUsage(ranges.week, usage);
    if (eventDate >= month) addUsage(ranges.month, usage);
  }

  return {
    totals,
    cost,
    ranges,
    byDay: completeLast30Days([...byDay.entries()].map(([day, usage]) => ({ day, ...usage })), now),
    byTool: summarizeRows(sessions, "source").map(({ source, ...row }) => ({ tool: source, ...row })),
    byModel: summarizeModelsWithSources(sessions),
    byProject: summarizeRows(sessions, "project").slice(0, 12),
  };
}

function filterUsageData(data, filters = {}, now = new Date()) {
  const selectedRange = filters.range || "all";
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const cutoff = selectedRange === "today" ? start
    : selectedRange === "7d" ? addDays(start, -6)
      : selectedRange === "30d" ? addDays(start, -29)
        : null;
  const sessions = (data.sessions || []).filter((session) => {
    const lastAt = new Date(session.lastAt || session.firstAt || now);
    if (cutoff && lastAt < cutoff) return false;
    if (filters.project && filters.project !== "all" && session.project !== filters.project) return false;
    if (filters.model && filters.model !== "all" && session.model !== filters.model) return false;
    return true;
  });
  return { ...data, ...usageFromSessions(sessions, now), sessions };
}

function applyUsageRequestFilters(data, filters = {}, now = new Date()) {
  const range = filters.range || "all";
  const project = filters.project || "all";
  const model = filters.model || "all";
  if (range === "all" && project === "all" && model === "all") return data;
  return filterUsageData(data, { range, project, model }, now);
}

function hideHomePath(value) {
  if (typeof value !== "string") return value;
  const home = os.homedir();
  return value.startsWith(home) ? `~${value.slice(home.length)}` : value;
}

function sanitizeUsageData(data) {
  const clone = JSON.parse(JSON.stringify(data));
  clone.codexHome = hideHomePath(clone.codexHome);
  clone.opencodeHome = hideHomePath(clone.opencodeHome);
  if (clone.sqlite?.path) clone.sqlite.path = hideHomePath(clone.sqlite.path);
  if (clone.opencode?.path) clone.opencode.path = hideHomePath(clone.opencode.path);
  clone.sessions = (clone.sessions || []).map((session) => ({ ...session, cwd: hideHomePath(session.cwd) }));
  return clone;
}

function mergeUsageData(parts) {
  const totals = emptyUsage();
  const ranges = { today: emptyUsage(), week: emptyUsage(), month: emptyUsage() };
  const byDay = new Map();
  const sessions = [];
  let cost = 0;
  let filesScanned = 0;

  for (const part of parts) {
    addUsage(totals, part.totals || emptyUsage());
    addUsage(ranges.today, part.ranges?.today || emptyUsage());
    addUsage(ranges.week, part.ranges?.week || emptyUsage());
    addUsage(ranges.month, part.ranges?.month || emptyUsage());
    cost += Number(part.cost || 0);
    filesScanned += Number(part.filesScanned || 0);
    sessions.push(...(part.sessions || []));

    for (const day of part.byDay || []) {
      const usage = byDay.get(day.day) || emptyUsage();
      addUsage(usage, day);
      byDay.set(day.day, usage);
    }
  }

  sessions.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  const allTools = parts.flatMap((part) => part.byTool || []);
  const allProjects = parts.flatMap((part) => part.byProject || []);

  return {
    source: "Local",
    codexHome: CODEX_HOME,
    opencodeHome: OPENCODE_HOME,
    generatedAt: new Date().toISOString(),
    totals,
    cost,
    ranges,
    sessions: sessions.slice(0, 80),
    byDay: completeLast30Days([...byDay.entries()].map(([day, usage]) => ({ day, ...usage }))),
    byTool: mergeUsageRows(allTools, "tool"),
    byModel: summarizeModelsWithSources(sessions),
    byProject: mergeUsageRows(allProjects, "project").slice(0, 12),
    filesScanned,
    sources: parts.map((part) => ({
      source: part.source,
      sessions: part.sessions?.length || 0,
      records: part.filesScanned || 0,
      total: part.totals?.total || 0,
    })),
  };
}

function readSqliteHint() {
  const db = path.join(CODEX_HOME, "logs_2.sqlite");
  if (!fs.existsSync(db)) return null;
  const result = spawnSync("sqlite3", [db, "select count(*) from logs;"], { encoding: "utf8", timeout: 1500 });
  if (result.status !== 0) return null;
  return { path: db, rows: Number(result.stdout.trim() || 0) };
}

function getUsage() {
  const data = mergeUsageData([parseCodexSessions(), parseOpenCodeSessions()]);
  data.sqlite = readSqliteHint();
  data.opencode = {
    path: path.join(OPENCODE_HOME, "opencode.db"),
    sessions: data.sources.find((source) => source.source === "OpenCode")?.sessions || 0,
  };
  data.notes = [
    "Token data is derived from local Codex JSONL token_count events and OpenCode sqlite session totals, following Tokei's local-first approach.",
    "Input excludes cached reads; cached input is tracked and priced separately. OpenCode cache writes are included in non-cached input.",
    "Cost is an editable rough estimate, not a billing statement.",
  ];
  return sanitizeUsageData(data);
}

function sendJson(res, value) {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const target = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(target, (err, body) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    res.end(body);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.url.startsWith("/api/usage")) {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const filters = {
          range: url.searchParams.get("range") || "all",
          project: url.searchParams.get("project") || "all",
          model: url.searchParams.get("model") || "all",
        };
        sendJson(res, applyUsageRequestFilters(getUsage(), filters));
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }
    serveStatic(req, res);
  });
}

if (require.main === module) {
  if (process.argv.includes("--check")) {
    const data = getUsage();
    console.log(JSON.stringify({
      sessions: data.sessions.length,
      filesScanned: data.filesScanned,
      totalTokens: data.totals.total,
      sqliteRows: data.sqlite?.rows || 0,
    }, null, 2));
    process.exit(0);
  }

  const server = createServer();
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Local Tokei is running at http://127.0.0.1:${PORT}`);
  });
}

module.exports = {
  completeLast30Days,
  filterUsageData,
  applyUsageRequestFilters,
  summarizeRows,
  summarizeModelsWithSources,
  sanitizeUsageData,
  createServer,
};
