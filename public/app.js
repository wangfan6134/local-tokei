const $ = (id) => document.getElementById(id);

const i18n = {
  zh: {
    reading: "正在读取本地数据",
    updated: "更新于",
    refresh: "刷新",
    totalTokens: "Token 总量",
    codexSessions: "本机会话",
    today: "今天",
    sevenDays: "7 天",
    thirtyDays: "30 天",
    estimatedCost: "预估成本",
    costNote: "本地估算，不代表官方账单。",
    costDetails: "统计口径",
    costDetailsText: "非缓存输入、缓存读、输出按模型价格分别估算；推理 token 计入总量展示，成本仍以可解析价格表为准。价格表可在 server.js 中调整。",
    sessions: "会话数",
    filesScanned: "已解析记录",
    tokenMix: "Token 构成",
    input: "非缓存输入",
    cached: "缓存读",
    cacheHitRate: "缓存命中率",
    cacheHitShort: "命中",
    output: "输出",
    reasoning: "推理",
    lastThirty: "最近 30 天",
    dailyUsage: "每日用量",
    dailyDetail: "每日明细",
    agents: "工具 / Agent",
    toolDistribution: "工具分布",
    models: "模型",
    modelDistribution: "模型分布",
    distribution: "分布",
    projects: "项目",
    topWorkspaces: "高频工作区",
    recent: "最近",
    sessionTitle: "会话",
    noData: "还没有数据",
    noSessions: "没有在本机会话中找到 token_count 事件。",
    unknown: "未知",
    untitled: "未命名",
    switchLabel: "Switch to English",
    lightModeLabel: "切换到白天模式",
    darkModeLabel: "切换到夜间模式",
    filters: "筛选",
    filterUsage: "用量范围",
    range: "时间",
    allTime: "全部",
    loadFailed: "读取失败",
    details: "详情",
    costLabel: "成本",
    turns: "轮次",
    firstSeen: "开始",
    lastSeen: "最近",
  },
  en: {
    reading: "Reading local data",
    updated: "Updated",
    refresh: "Refresh",
    totalTokens: "Total tokens",
    codexSessions: "Local sessions",
    today: "Today",
    sevenDays: "7 days",
    thirtyDays: "30 days",
    estimatedCost: "Estimated cost",
    costNote: "Local estimate, not an official bill.",
    costDetails: "Counting rules",
    costDetailsText: "Net input, cache read, and output tokens are estimated with model-specific prices. Reasoning tokens are shown in totals; cost follows the editable pricing table in server.js.",
    sessions: "Sessions",
    filesScanned: "Records parsed",
    tokenMix: "Token mix",
    input: "Input (net)",
    cached: "Cache read",
    cacheHitRate: "Cache hit rate",
    cacheHitShort: "Hit",
    output: "Output",
    reasoning: "Reasoning",
    lastThirty: "Last 30 days",
    dailyUsage: "Daily usage",
    dailyDetail: "Daily detail",
    agents: "Tools / Agents",
    toolDistribution: "Tool distribution",
    models: "Models",
    modelDistribution: "Model distribution",
    distribution: "Distribution",
    projects: "Projects",
    topWorkspaces: "Top workspaces",
    recent: "Recent",
    sessionTitle: "Sessions",
    noData: "No data yet",
    noSessions: "No token_count events were found in local sessions.",
    unknown: "Unknown",
    untitled: "Untitled",
    switchLabel: "切换到中文",
    lightModeLabel: "Switch to light mode",
    darkModeLabel: "Switch to dark mode",
    filters: "Filters",
    filterUsage: "Usage scope",
    range: "Range",
    allTime: "All time",
    loadFailed: "Load failed",
    details: "Details",
    costLabel: "Cost",
    turns: "Turns",
    firstSeen: "First",
    lastSeen: "Last",
  },
};

const params = new URLSearchParams(window.location.search);
const requestedLang = params.get("lang");
const requestedTheme = params.get("theme");
const savedLang = localStorage.getItem("local-tokei-lang");
let lang = requestedLang === "en" || requestedLang === "zh" ? requestedLang : savedLang || "zh";
let theme = requestedTheme === "light" || requestedTheme === "dark"
  ? requestedTheme
  : localStorage.getItem("local-tokei-theme") || "dark";
let currentData = null;
let allData = null;
const filters = { range: "all", project: "all", model: "all" };

function t(key) {
  return (i18n[lang] && i18n[lang][key]) || i18n.en[key] || key;
}

function compact(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function cacheHitRate(usage = {}) {
  const input = Number(usage.input || 0);
  const cached = Number(usage.cached || 0);
  const denominator = input + cached;
  if (!denominator) return 0;
  return (cached / denominator) * 100;
}

function percent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function dateShort(iso) {
  if (!iso) return t("unknown");
  const locale = lang === "zh" ? "zh-CN" : "en";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value;
}

function renderDonut(usage) {
  const total = Math.max(usage.input + usage.cached + usage.output + usage.reasoning, 1);
  const input = (usage.input / total) * 100;
  const cached = input + (usage.cached / total) * 100;
  const output = cached + (usage.output / total) * 100;
  $("donut").style.background = `conic-gradient(var(--accent) 0 ${input}%, var(--accent-2) ${input}% ${cached}%, var(--warn) ${cached}% ${output}%, var(--rose) ${output}% 100%)`;
}

function renderBars(days) {
  const root = $("bars");
  root.innerHTML = "";
  const max = Math.max(...days.map((d) => d.total), 1);
  for (const day of days) {
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = `${Math.max(2, (day.total / max) * 100)}%`;
    bar.dataset.label = `${day.day}: ${compact(day.total)}`;
    root.appendChild(bar);
  }
}

function renderDailyDetails(days) {
  const root = $("dailyDetails");
  if (!root) return;
  root.innerHTML = "";
  const recent = days.slice().reverse();
  if (!recent.length) {
    root.innerHTML = `<div class="empty">${t("noData")}</div>`;
    return;
  }
  for (const day of recent) {
    const item = document.createElement("div");
    item.className = "daily-row";
    item.innerHTML = `
      <div>
        <div class="daily-day">${escapeHtml(day.day)}</div>
        <div class="daily-mix">${t("cacheHitShort")} ${percent(cacheHitRate(day))} · ${t("input")} ${compact(day.input)} · ${t("cached")} ${compact(day.cached)} · ${t("output")} ${compact(day.output)} · ${t("reasoning")} ${compact(day.reasoning)}</div>
      </div>
      <strong>${compact(day.total)}</strong>
    `;
    root.appendChild(item);
  }
}

function renderStack(id, rows, nameKey) {
  const root = $(id);
  root.innerHTML = "";
  if (!rows.length) {
    root.innerHTML = `<div class="empty">${t("noData")}</div>`;
    return;
  }
  const max = Math.max(...rows.map((row) => row.total), 1);
  for (const row of rows.slice(0, 8)) {
    const item = document.createElement("div");
    item.className = "stack-item";
    const meta = nameKey === "project"
      ? `<div class="stack-meta">${t("costLabel")} ${money(row.cost)} · ${t("sessions")} ${compact(row.sessions)} · ${t("lastSeen")} ${dateShort(row.lastAt)}</div>`
      : "";
    const sourceMeta = nameKey === "model" && Array.isArray(row.sources) && row.sources.length
      ? `<div class="stack-meta">${row.sources.map((source) => `${escapeHtml(source.source || "Unknown")} ${compact(source.total)}`).join(" · ")}</div>`
      : "";
    item.innerHTML = `
      <div class="stack-top">
        <div class="stack-name">${escapeHtml(row[nameKey] || "Unknown")}</div>
        <div class="stack-value">${compact(row.total)}</div>
      </div>
      ${meta}
      ${sourceMeta}
      <div class="track"><div class="fill" style="width:${Math.max(3, (row.total / max) * 100)}%"></div></div>
    `;
    root.appendChild(item);
  }
}

function renderSessions(sessions) {
  const root = $("sessions");
  root.innerHTML = "";
  if (!sessions.length) {
    root.innerHTML = `<div class="empty">${t("noSessions")}</div>`;
    return;
  }
  for (const row of sessions.slice(0, 24)) {
    const item = document.createElement("details");
    item.className = "session-row";
    item.innerHTML = `
      <summary>
        <div class="session-main">
          <div class="session-title">${escapeHtml(row.title || t("untitled"))}</div>
          <div class="session-meta">${escapeHtml(row.source || t("unknown"))} · ${escapeHtml(row.project || t("unknown"))} · ${escapeHtml(row.model || "codex")} · ${dateShort(row.lastAt)}</div>
        </div>
        <div class="session-tokens">${compact(row.usage.total)}</div>
      </summary>
      <div class="session-detail">
        <span>${t("input")}: ${compact(row.usage.input)}</span>
        <span>${t("cached")}: ${compact(row.usage.cached)}</span>
        <span>${t("output")}: ${compact(row.usage.output)}</span>
        <span>${t("reasoning")}: ${compact(row.usage.reasoning)}</span>
        <span>${t("costLabel")}: ${money(row.cost)}</span>
        <span>${t("turns")}: ${compact(row.turns)}</span>
        <span>${t("firstSeen")}: ${dateShort(row.firstAt)}</span>
        <span>${t("lastSeen")}: ${dateShort(row.lastAt)}</span>
        <span class="session-cwd">${escapeHtml(row.cwd || "")}</span>
      </div>
    `;
    root.appendChild(item);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function applyLanguage() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  const toggle = $("langToggle");
  if (toggle) {
    toggle.textContent = lang === "zh" ? "EN" : "中";
    toggle.setAttribute("aria-label", t("switchLabel"));
    toggle.title = t("switchLabel");
  }
  applyTheme();
  setText("costDetailsText", t("costDetailsText"));
  if (allData) populateFilters(allData);
}

function setOptions(id, values, selected) {
  const root = $(id);
  if (!root) return;
  const current = selected || root.value || "all";
  root.innerHTML = "";
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = t("allTime");
  root.appendChild(all);
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    root.appendChild(option);
  }
  root.value = values.includes(current) ? current : "all";
}

function populateFilters(data) {
  const projects = [...new Set((data.sessions || []).map((row) => row.project).filter(Boolean))].sort();
  const models = [...new Set((data.sessions || []).map((row) => row.model).filter(Boolean))].sort();
  setOptions("projectFilter", projects, filters.project);
  setOptions("modelFilter", models, filters.model);
  const range = $("rangeFilter");
  if (range) range.value = filters.range;
}

function showError(message) {
  const panel = $("errorPanel");
  if (panel) panel.hidden = false;
  setText("errorText", message);
}

function hideError() {
  const panel = $("errorPanel");
  if (panel) panel.hidden = true;
}

function applyTheme() {
  document.body.dataset.theme = theme;
  const toggle = $("themeToggle");
  if (!toggle) return;
  const isLight = theme === "light";
  toggle.textContent = isLight ? (lang === "zh" ? "夜" : "D") : (lang === "zh" ? "日" : "L");
  toggle.setAttribute("aria-label", isLight ? t("darkModeLabel") : t("lightModeLabel"));
  toggle.title = isLight ? t("darkModeLabel") : t("lightModeLabel");
}

function render(data) {
  const usage = data.totals || {};
  applyLanguage();
  setText("updated", `${t("updated")} ${new Date(data.generatedAt).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en")}`);
  setText("totalTokens", compact(usage.total));
  setText("todayTokens", compact(data.ranges?.today?.total));
  setText("weekTokens", compact(data.ranges?.week?.total));
  setText("monthTokens", compact(data.ranges?.month?.total));
  setText("cost", money(data.cost));
  setText("sessionCount", compact((data.sessions || []).length));
  setText("filesScanned", compact(data.filesScanned));
  setText("inputTokens", compact(usage.input));
  setText("cachedTokens", compact(usage.cached));
  setText("outputTokens", compact(usage.output));
  setText("reasoningTokens", compact(usage.reasoning));
  setText("cacheHitRate", percent(cacheHitRate(usage)));
  renderDonut(usage);
  renderBars(data.byDay || []);
  renderDailyDetails(data.byDay || []);
  renderStack("tools", data.byTool || [], "tool");
  renderStack("models", data.byModel || [], "model");
  renderStack("projects", data.byProject || [], "project");
  renderSessions(data.sessions || []);
}

async function load() {
  applyLanguage();
  hideError();
  setText("updated", t("reading"));
  const query = new URLSearchParams(filters);
  const res = await fetch(`/api/usage?${query.toString()}`);
  if (!res.ok) throw new Error(`${t("loadFailed")}: HTTP ${res.status}`);
  currentData = await res.json();
  if (!allData && filters.range === "all" && filters.project === "all" && filters.model === "all") {
    allData = currentData;
    populateFilters(allData);
  }
  render(currentData);
}

function bindLanguageToggle() {
  const toggle = $("langToggle");
  if (!toggle) return;
  toggle.addEventListener("click", () => {
    lang = lang === "zh" ? "en" : "zh";
    localStorage.setItem("local-tokei-lang", lang);
    if (currentData) render(currentData);
    else applyLanguage();
  });
}

function bindThemeToggle() {
  const toggle = $("themeToggle");
  if (!toggle) return;
  toggle.addEventListener("click", () => {
    theme = theme === "light" ? "dark" : "light";
    localStorage.setItem("local-tokei-theme", theme);
    applyTheme();
  });
}

function bindRefresh() {
  const button = $("refreshButton");
  if (!button) return;
  button.addEventListener("click", () => {
    allData = null;
    load().catch((error) => showError(error.message));
  });
}

function bindFilters() {
  const pairs = [
    ["rangeFilter", "range"],
    ["projectFilter", "project"],
    ["modelFilter", "model"],
  ];
  for (const [id, key] of pairs) {
    const node = $(id);
    if (!node) continue;
    node.addEventListener("change", () => {
      filters[key] = node.value || "all";
      load().catch((error) => showError(error.message));
    });
  }
}

bindLanguageToggle();
bindThemeToggle();
bindRefresh();
bindFilters();
load().catch((error) => {
  showError(error.message);
});
