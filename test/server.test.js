const test = require("node:test");
const assert = require("node:assert/strict");

process.env.PORT = "0";

const {
  completeLast30Days,
  filterUsageData,
  applyUsageRequestFilters,
  summarizeRows,
  sanitizeUsageData,
} = require("../server");

test("completeLast30Days returns 30 local calendar days and fills missing days with zero usage", () => {
  const days = completeLast30Days([
    { day: "2026-06-27", input: 1, cached: 2, output: 3, reasoning: 4, total: 10 },
    { day: "2026-06-29", input: 5, cached: 6, output: 7, reasoning: 8, total: 26 },
  ], new Date("2026-06-29T12:00:00+08:00"));

  assert.equal(days.length, 30);
  assert.equal(days[0].day, "2026-05-31");
  assert.deepEqual(days[27], { day: "2026-06-27", input: 1, cached: 2, output: 3, reasoning: 4, total: 10 });
  assert.deepEqual(days[28], { day: "2026-06-28", input: 0, cached: 0, output: 0, reasoning: 0, total: 0 });
  assert.deepEqual(days[29], { day: "2026-06-29", input: 5, cached: 6, output: 7, reasoning: 8, total: 26 });
});

test("summarizeRows includes unknown codex models and project cost metadata", () => {
  const rows = [
    {
      project: "alpha",
      model: "codex",
      cost: 2,
      lastAt: "2026-06-29T10:00:00.000Z",
      input: 10,
      cached: 0,
      output: 5,
      reasoning: 1,
      total: 16,
    },
    {
      project: "alpha",
      model: "gpt-5.5",
      cost: 3,
      lastAt: "2026-06-28T10:00:00.000Z",
      input: 20,
      cached: 1,
      output: 7,
      reasoning: 2,
      total: 30,
    },
  ];

  assert.deepEqual(summarizeRows(rows, "model").map((row) => row.model), ["gpt-5.5", "codex"]);

  const project = summarizeRows(rows, "project")[0];
  assert.equal(project.project, "alpha");
  assert.equal(project.cost, 5);
  assert.equal(project.sessions, 2);
  assert.equal(project.lastAt, "2026-06-29T10:00:00.000Z");
});

test("filterUsageData rebuilds totals, ranges, sessions, and distributions from selected sessions", () => {
  const data = {
    generatedAt: "2026-06-29T12:00:00.000Z",
    sessions: [
      {
        title: "A",
        project: "alpha",
        model: "codex",
        source: "Codex",
        lastAt: "2026-06-29T10:00:00.000Z",
        usage: { input: 10, cached: 5, output: 2, reasoning: 1, total: 18 },
        cost: 1,
      },
      {
        title: "B",
        project: "beta",
        model: "gpt-5.5",
        source: "OpenCode",
        lastAt: "2026-06-20T10:00:00.000Z",
        usage: { input: 20, cached: 0, output: 4, reasoning: 2, total: 26 },
        cost: 2,
      },
    ],
  };

  const filtered = filterUsageData(data, { range: "7d", project: "alpha", model: "codex" }, new Date("2026-06-29T12:00:00.000Z"));

  assert.equal(filtered.sessions.length, 1);
  assert.deepEqual(filtered.totals, { input: 10, cached: 5, output: 2, reasoning: 1, total: 18 });
  assert.equal(filtered.cost, 1);
  assert.equal(filtered.byModel[0].model, "codex");
  assert.equal(filtered.byProject[0].project, "alpha");
  assert.equal(filtered.byDay.length, 30);
});

test("applyUsageRequestFilters preserves event-based ranges when no filters are selected", () => {
  const data = {
    generatedAt: "2026-06-29T12:00:00.000Z",
    totals: { input: 100, cached: 0, output: 0, reasoning: 0, total: 100 },
    ranges: {
      today: { input: 1, cached: 0, output: 0, reasoning: 0, total: 1 },
      week: { input: 2, cached: 0, output: 0, reasoning: 0, total: 2 },
      month: { input: 3, cached: 0, output: 0, reasoning: 0, total: 3 },
    },
    byDay: [{ day: "2026-06-29", input: 1, cached: 0, output: 0, reasoning: 0, total: 1 }],
    sessions: [
      {
        title: "cross-day session",
        project: "alpha",
        model: "codex",
        source: "Codex",
        lastAt: "2026-06-29T10:00:00.000Z",
        usage: { input: 100, cached: 0, output: 0, reasoning: 0, total: 100 },
        cost: 1,
      },
    ],
  };

  const result = applyUsageRequestFilters(data, { range: "all", project: "all", model: "all" }, new Date("2026-06-29T12:00:00.000Z"));

  assert.deepEqual(result.ranges, data.ranges);
  assert.deepEqual(result.byDay, data.byDay);
  assert.deepEqual(result.totals, data.totals);
});

test("sanitizeUsageData hides local absolute paths by default", () => {
  const sanitized = sanitizeUsageData({
    codexHome: "/Users/wangfan/.codex",
    opencodeHome: "/Users/wangfan/.local/share/opencode",
    sqlite: { path: "/Users/wangfan/.codex/logs_2.sqlite", rows: 12 },
    opencode: { path: "/Users/wangfan/.local/share/opencode/opencode.db", sessions: 3 },
    sessions: [{ cwd: "/Users/wangfan/Documents/project-a", project: "project-a" }],
  });

  assert.equal(sanitized.codexHome, "~/.codex");
  assert.equal(sanitized.sqlite.path, "~/.codex/logs_2.sqlite");
  assert.equal(sanitized.sessions[0].cwd, "~/Documents/project-a");
});
