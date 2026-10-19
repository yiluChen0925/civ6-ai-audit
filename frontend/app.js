/**
 * app.js — 渲染层
 *
 * 职责：取数、状态、URL 同步、视图渲染、图表。
 * 评分口径不在这里，统一走 metrics.js（Civ6Metrics）。
 */
(() => {
  "use strict";

  // 跟随页面自己的主机名：用 127.0.0.1 打开就调 127.0.0.1，用局域网 IP 打开也能用。
  // 写死 localhost 在部分环境会解析到 ::1，而后端只监听 IPv4，表现为「API 连不上」。
  const API_BASE = window.CIV6_API_BASE || `${location.protocol}//${location.hostname || "127.0.0.1"}:8080`;
  const M = window.Civ6Metrics;

  const state = {
    turns: {},          // { 39: {...} }
    turnNums: [],       // [39..140]
    view: "detail",     // detail | overview | metrics
    current: null,
    search: "",
    scores: {},         // 逐回合评分
    rows: null,         // 预计算的逐回合对比结果（总览/图表共用）
    filter: "all",      // all | strictFail | emptyPlan | low
    sort: { key: "turn", dir: 1 },
    rates: null,        // 逐项通过率
    strictAgg: null,    // 严格口径聚合
    charts: {},
    ready: false,
  };

  const TONE_THRESHOLD = { good: 60, warn: 30 };

  const FILTERS = [
    { key: "all", label: "全部" },
    { key: "strictFail", label: "严格口径失败" },
    { key: "unverifiable", label: "无可核对对象" },
    { key: "low", label: "兑现率 < 30%" },
  ];

  // ——————————————————————————————— 小工具

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, html) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  };
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (v) => (v == null ? "–" : `${v}%`);
  const toneOf = (score) => (score == null ? "neutral" : score >= TONE_THRESHOLD.good ? "good" : score >= TONE_THRESHOLD.warn ? "warn" : "bad");
  const toneColor = (tone) => ({ good: "var(--good)", warn: "var(--warn)", bad: "var(--bad)", accent: "var(--accent)" }[tone] || "var(--text-3)");
  const fmtNum = (v, digits = 0) => (v == null ? "–" : Number(v).toFixed(digits).replace(/\.0+$/, ""));
  const fmtSigned = (v) => (v > 0 ? `+${v}` : `${v}`);
  const unitName = (type) => M.UNIT_LABEL[type] || String(type).replace(/^UNIT_/, "").toLowerCase();
  const eraName = (era) => M.ERA_LABEL[era] || String(era || "").replace(/^ERA_/, "");
  const nextTurnOf = (t) => (state.turns[t + 1] ? t + 1 : null);

  function clampTurn(t) {
    const nums = state.turnNums;
    if (!nums.length) return null;
    if (nums.includes(t)) return t;
    return nums.reduce((best, n) => (Math.abs(n - t) < Math.abs(best - t) ? n : best), nums[0]);
  }

  /** Chart.js 不认 CSS 变量，画图前必须解析成真实色值 */
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  const chartColors = () => ({
    good: cssVar("--good", "#15803d"),
    warn: cssVar("--warn", "#b45309"),
    bad: cssVar("--bad", "#b91c1c"),
    accent: cssVar("--accent", "#2563eb"),
    text3: cssVar("--text-3", "#94a3b8"),
  });

  // ——————————————————————————————— 取数

  async function loadData() {
    const res = await fetch(`${API_BASE}/api/all`, { cache: "no-store" });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    Object.keys(data).forEach((k) => {
      state.turns[Number(k)] = data[k];
    });
    state.turnNums = Object.keys(state.turns).map(Number).sort((a, b) => a - b);
    if (!state.turnNums.length) throw new Error("接口返回空数据");

    state.scores = M.scoreAll(state.turns, state.turnNums);
    state.rows = buildRows();
    state.ready = true;
    setConn("ok", `已连上 · ${state.turnNums.length} 回合`);
  }

  /**
   * 逐回合对比结果只算一次：总览、图表 tooltip、洞察都用它。
   * 之前总览每次输入都会把 102 个回合重新算一遍（每回合两次全量对比）。
   */
  function buildRows() {
    return state.turnNums.map((t) => {
      const nextT = nextTurnOf(t);
      const next = nextT ? state.turns[nextT] : null;
      const loose = next ? M.checkLoose(state.turns[t], next) : null;
      const strict = next ? M.checkStrict(state.turns[t], next) : null;
      const plan = (state.turns[t].reflections && state.turns[t].reflections.planning) || "";
      const fails = loose ? loose.checks.filter((c) => c.available && !c.passed).map((c) => c.label) : [];
      return {
        t,
        nextT,
        loose,
        strict,
        plan,
        planLen: plan.trim().length,
        verifiable: M.hasVerifiableTarget(plan),
        fails,
        strictFailed: !!(strict && strict.total && strict.passed < strict.total),
      };
    });
  }

  function rowOf(t) {
    return state.rows ? state.rows.find((r) => r.t === t) : null;
  }

  function setConn(status, text) {
    const node = $("#connState");
    node.dataset.state = status;
    node.textContent = text;
  }

  // ——————————————————————————————— 聚合（懒算 + 缓存）

  function getRates() {
    if (!state.rates) state.rates = M.checkRates(state.turns, state.turnNums);
    return state.rates;
  }

  function getStrictAgg() {
    if (state.strictAgg) return state.strictAgg;
    const perType = {};
    const overall = { passed: 0, total: 0, turnsWithNamed: 0, turnsTotal: 0 };
    const phase = { early: { passed: 0, total: 0 }, late: { passed: 0, total: 0 } };
    for (let i = 0; i < state.turnNums.length - 1; i++) {
      const a = state.turnNums[i];
      const r = M.checkStrict(state.turns[a], state.turns[a + 1]);
      overall.turnsTotal += 1;
      if (r.total) overall.turnsWithNamed += 1;
      overall.passed += r.passed;
      overall.total += r.total;
      const bucket = a < 60 ? phase.early : phase.late;
      bucket.passed += r.passed;
      bucket.total += r.total;
      r.items.forEach((item) => {
        const label = M.UNIT_LABEL[item.type] || item.type;
        perType[label] = perType[label] || { passed: 0, total: 0 };
        perType[label].total += 1;
        if (item.passed) perType[label].passed += 1;
      });
    }
    state.strictAgg = { overall, perType, phase };
    return state.strictAgg;
  }

  function avgScore() {
    const vals = Object.values(state.scores).map((s) => s.score);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }

  // ——————————————————————————————— URL 状态

  function readHash() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    const view = ["detail", "overview", "metrics"].includes(params.get("view")) ? params.get("view") : "detail";
    const turn = Number(params.get("turn"));
    const filter = FILTERS.some((f) => f.key === params.get("f")) ? params.get("f") : "all";
    const sortKey = ["turn", "score", "strict"].includes(params.get("sort")) ? params.get("sort") : "turn";
    const dir = params.get("dir") === "desc" ? -1 : 1;
    return { view, turn: Number.isFinite(turn) && turn > 0 ? turn : null, filter, sort: { key: sortKey, dir } };
  }

  function writeHash() {
    const params = new URLSearchParams();
    params.set("view", state.view);
    if (state.current != null) params.set("turn", String(state.current));
    if (state.view === "overview") {
      if (state.filter !== "all") params.set("f", state.filter);
      if (state.sort.key !== "turn") {
        params.set("sort", state.sort.key);
        params.set("dir", state.sort.dir === -1 ? "desc" : "asc");
      }
    }
    history.replaceState(null, "", `#${params.toString()}`);
  }

  // ——————————————————————————————— 渲染入口

  function render() {
    if (!state.ready) return;
    renderKpis();
    renderStrip();
    renderView();
    writeHash();
    syncStepper();
  }

  function renderView() {
    const main = $("#content");
    main.innerHTML = "";
    if (state.view === "overview") return renderOverview(main);
    if (state.view === "metrics") return renderMetrics(main);
    return renderDetail(main);
  }

  // ——————————————————————————————— KPI

  function renderKpis() {
    const avg = avgScore();
    const strict = getStrictAgg().overall;
    const gaps = M.playerGaps(state.turns, state.turnNums);
    const gapTurns = state.turnNums.filter((t) => !M.myPlayer(state.turns[t])).length;
    const aiGapTurns = new Set(Object.values(gaps).flat()).size;
    const gapDetail = Object.entries(gaps)
      .map(([pid, list]) => `pid=${pid} 缺 ${list.length} 回合`)
      .join("、");

    const items = [
      { label: "平均兑现率", value: pct(avg), note: "逐回合评分再平均", tone: toneOf(avg) },
      {
        label: "严格口径",
        value: strict.total ? `${Math.round((strict.passed / strict.total) * 100)}%` : "–",
        note: `${strict.passed}/${strict.total} 项点名兵种真有动作`,
        tone: strict.total ? toneOf(Math.round((strict.passed / strict.total) * 100)) : "neutral",
      },
      {
        label: "回合数",
        value: `${state.turnNums.length}`,
        note: `T${state.turnNums[0]}–T${state.turnNums[state.turnNums.length - 1]} · ${Object.keys(state.scores).length} 段可比`,
        tone: "accent",
      },
      {
        label: "计划点兵率",
        value: strict.turnsTotal ? `${Math.round((strict.turnsWithNamed / strict.turnsTotal) * 100)}%` : "–",
        note: `${strict.turnsWithNamed}/${strict.turnsTotal} 个回合点了具体兵种`,
        tone: "neutral",
      },
      {
        label: "对手记录缺口",
        value: `${aiGapTurns}`,
        note: gapDetail ? `${gapDetail}${gapTurns ? ` · 我方另缺 ${gapTurns} 回合` : ""}` : "六家记录完整",
        tone: aiGapTurns || gapTurns ? "warn" : "good",
      },
    ];

    $("#kpis").innerHTML = items
      .map(
        (i) => `<div class="kpi" data-tone="${i.tone}">
        <div class="kpi-label">${esc(i.label)}</div>
        <div class="kpi-value">${esc(i.value)}</div>
        <div class="kpi-note">${esc(i.note)}</div>
      </div>`
      )
      .join("");
  }

  // ——————————————————————————————— 回合条

  function renderStrip() {
    $("#turnStrip").innerHTML = state.turnNums
      .map((t) => {
        const s = state.scores[t];
        const tone = s ? toneOf(s.score) : "neutral";
        const active = t === state.current;
        return `<button type="button" class="turncell${active ? " is-active" : ""}${s ? "" : " is-empty"}"
                  data-turn="${t}" data-tone="${tone}" title="T${t}${s ? ` · ${s.score}%` : " · 无下一回合可比"}"
                  aria-label="第 ${t} 回合">${t}</button>`;
      })
      .join("");
  }

  function scrollStripTo(t) {
    const cell = document.querySelector(`.turncell[data-turn="${t}"]`);
    if (cell) cell.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }

  // ——————————————————————————————— 单回合详情

  function renderDetail(main) {
    const t = state.current;
    const cur = state.turns[t];
    const nextT = nextTurnOf(t);
    const next = nextT ? state.turns[nextT] : null;
    const loose = next ? M.checkLoose(cur, next) : null;

    let html = detailHero(t, cur, nextT, loose);
    if (next) {
      html += detailChecks(loose);
      html += detailStrict(cur, next);
      html += detailState(cur);
    } else {
      html += `<div class="card"><div class="empty"><strong>这是最后一个回合</strong>T${t} 没有下一回合快照可以对比，只显示当前状态。</div></div>`;
      html += detailState(cur);
    }
    main.innerHTML = html;
  }

  function detailHero(t, cur, nextT, loose) {
    const r = cur.reflections || {};
    const planning = r.planning || "";
    const hypothesis = r.hypothesis || "";
    const reflection = r.tactical || r.strategic || "";

    const scoreTone = loose ? toneOf(loose.score) : "neutral";
    const scoreBlock = loose
      ? `<div class="score-row">
            <div>
              <div class="score-big" data-tone="${scoreTone}">${loose.score}%</div>
              <div class="score-meta">7 项中通过 ${loose.passed}/${loose.total}${loose.unavailable.length ? ` · ${loose.unavailable.length} 项数据缺失` : ""}</div>
            </div>
            <div style="flex:1">
              <div class="bar"><i data-tone="${scoreTone}" style="width:${loose.score}%"></i></div>
            </div>
          </div>`
      : `<div class="badge badge-neutral">无下一回合，不评分</div>`;

    return `
      <div class="grid grid-2">
        <div class="card promise">
          <div class="card-head">
            <div class="card-title"><span class="dot" style="background:var(--warn)"></span>T${t} · AI 写了什么</div>
            <span class="card-note">${esc(cur.timestamp ? cur.timestamp.slice(0, 10) : "")}</span>
          </div>
          <div class="quote${planning ? "" : " quote-muted"}">${planning ? esc(planning) : "（这回合没写 planning）"}</div>
          ${hypothesis ? `<div class="card-note" style="margin-top:10px">预测：${esc(hypothesis)}</div>` : ""}
          ${reflection ? `<div class="card-note" style="margin-top:6px">复盘：${esc(reflection)}</div>` : ""}
        </div>
        <div class="card fact${loose && loose.score < 30 ? " is-bad" : ""}">
          <div class="card-head">
            <div class="card-title"><span class="dot" style="background:var(--good)"></span>${nextT ? `T${nextT} · 实际发生了什么` : "实际发生了什么"}</div>
            <div class="head-actions">
              ${loose ? `<span class="badge ${loose.score >= 60 ? "badge-good" : loose.score >= 30 ? "badge-warn" : "badge-bad"}">${loose.score}%</span>` : ""}
              <button type="button" class="btn btn-ghost copy-btn" data-copy="summary" title="复制这一回合的摘要（Markdown）">复制摘要</button>
            </div>
          </div>
          ${scoreBlock}
        </div>
      </div>`;
  }

  function detailChecks(loose) {
    const items = loose.checks
      .map((c) => {
        const cls = !c.available ? "is-na" : c.passed ? "is-pass" : "is-fail";
        const mark = !c.available ? "–" : c.passed ? "✓" : "✕";
        const title = !c.available ? "数据缺失，未计入" : c.hint;
        return `<div class="check ${cls}" title="${esc(title)}">
          <span class="mark">${mark}</span>
          <span><span class="check-name">${esc(c.label)}</span><span class="check-hint">${esc(c.hint)}</span></span>
        </div>`;
      })
      .join("");

    return `
      <div class="card">
        <div class="card-head">
          <div class="card-title">7 项通用检查</div>
          <span class="card-note">跟模型写的那句话没有直接关系，测的是「这回合有没有动静」</span>
        </div>
        <div class="checklist">${items}</div>
      </div>`;
  }

  function detailStrict(cur, next) {
    const r = M.checkStrict(cur, next);
    const head = r.total
      ? `<span class="strict-num">${r.passed}/${r.total}</span><span class="card-note">计划点名的兵种里，下一回合真有动作的</span>`
      : `<span class="badge badge-neutral">这份计划没点任何兵种</span><span class="card-note">严格口径不评这个回合</span>`;

    const rows = r.items
      .map((item) => {
        const label = M.UNIT_LABEL[item.type] || item.type;
        // 三种状态要分开：快照里根本没有这个兵种，和「有兵但没动」不是一回事
        const absent = !item.units.length;
        const badge = absent
          ? `<span class="badge badge-warn">不在快照里</span>`
          : item.passed
          ? `<span class="badge badge-good">有动作</span>`
          : `<span class="badge badge-bad">没动作</span>`;
        const unitText = item.units.length
          ? item.units
              .map((u) => {
                const bits = [];
                if (u.gone) bits.push("从快照消失");
                if (u.moved) bits.push(`移动 (${u.from.x},${u.from.y})→(${u.to.x},${u.to.y})`);
                if (u.dealt) bits.push(`造成伤害 ${u.from.damage}→${u.to.damage}`);
                if (!u.gone && u.took && !u.dealt) bits.push(`只是被打 ${u.from.damage}→${u.to.damage}`);
                const did = u.gone || u.moved || u.dealt;
                if (!bits.length) bits.push("原地未动");
                return `<span style="color:${did ? "var(--text)" : "var(--text-3)"}">id=${u.id} ${bits.join("，")}</span>`;
              })
              .join("；")
          : item.reason || "";
        const ruleHint = !absent && item.units.length > 1 && item.passed
          ? ` <span class="card-note">（同类里只要有一个动了就算通过）</span>`
          : "";

        return `<div class="strict-item">
          <span class="type">${esc(label)}</span>
          ${badge}
          <span class="detail">${unitText}${ruleHint}</span>
        </div>`;
      })
      .join("");

    return `
      <div class="card">
        <div class="card-head">
          <div class="card-title">严格口径 · 点名兵种对账</div>
          <span class="card-note">移动 / 造成伤害 / 从快照消失才算，只是被打掉血不算</span>
        </div>
        <div class="strict-head">${head}</div>
        ${r.planning ? `<div class="strict-plan">计划原文：${esc(r.planning)}</div>` : ""}
        ${rows || `<div class="card-note">没有可对账的兵种。</div>`}
      </div>`;
  }

  function detailState(cur) {
    const cities = M.myCities(cur);
    const p = M.myPlayer(cur);
    const units = cur.units || [];

    const cityRows = cities.length
      ? cities
          .map(
            (c) => `<div class="unitrow">
              <span class="name">${esc(c.city || "未命名")}</span>
              <span class="id">生产 ${esc(String(c.producing || "空").replace(/^UNIT_|^BUILDING_/, ""))}</span>
              <span class="delta">人口 ${c.pop}</span>
            </div>`
          )
          .join("")
      : `<div class="card-note">这回合快照里没有我方城市。</div>`;

    const unitRows = units.length
      ? units
          .map(
            (u) => `<div class="unitrow" data-state="still">
              <span class="name">${esc(unitName(u.type))}</span>
              <span class="id">id=${u.id}</span>
              <span class="delta">(${u.x},${u.y}) · HP ${100 - (u.damage || 0)} · 移动力 ${u.moves == null ? "–" : u.moves}</span>
            </div>`
          )
          .join("")
      : `<div class="card-note">这回合快照里没有我方单位。</div>`;

    const kv = p
      ? `<dl class="kv">
          <dt>文明</dt><dd>${esc(p.civ || "–")}</dd>
          <dt>领袖</dt><dd>${esc(p.leader || "–")}</dd>
          <dt>时代</dt><dd>${esc(eraName(p.era))}</dd>
          <dt>金币</dt><dd>${fmtNum(p.gold, 1)}（每回合 ${fmtSigned(p.gold_per_turn || 0)}）</dd>
          <dt>科技 / 市政</dt><dd>${p.techs_completed == null ? "–" : p.techs_completed} / ${p.civics_completed == null ? "–" : p.civics_completed}</dd>
          <dt>城市 / 人口</dt><dd>${p.cities == null ? "–" : p.cities} / ${p.pop == null ? "–" : p.pop}</dd>
          <dt>总兵力</dt><dd>${p.units_total == null ? "–" : p.units_total}</dd>
          <dt>分数</dt><dd>${p.score == null ? "–" : p.score}</dd>
        </dl>`
      : `<div class="card-note">这回合没有我方玩家记录（数据缺口）。</div>`;

    return `
      <div class="grid grid-3">
        <div class="card">
          <div class="card-head"><div class="card-title">当前资产</div></div>
          ${kv}
        </div>
        <div class="card">
          <div class="card-head"><div class="card-title">城市</div><span class="card-note">${cities.length} 座</span></div>
          <div class="unitlist">${cityRows}</div>
        </div>
        <div class="card">
          <div class="card-head"><div class="card-title">单位</div><span class="card-note">${units.length} 个</span></div>
          <div class="unitlist">${unitRows}</div>
        </div>
      </div>`;
  }

  // ——————————————————————————————— 总览

  function renderOverview(main) {
    const q = state.search.trim().toLowerCase();

    let rows = state.rows.filter((r) => {
      if (state.filter === "strictFail" && !r.strictFailed) return false;
      if (state.filter === "unverifiable" && r.verifiable) return false;
      if (state.filter === "low" && !(r.loose && r.loose.score < 30)) return false;
      if (!q) return true;
      if (String(r.t).includes(q)) return true;
      if (r.plan.toLowerCase().includes(q)) return true;
      if (r.fails.some((label) => label.toLowerCase().includes(q))) return true;
      if (r.strict && r.strict.items.some((i) => (M.UNIT_LABEL[i.type] || "").includes(q))) return true;
      return false;
    });

    const valOf = (r) => {
      if (state.sort.key === "score") return r.loose ? r.loose.score : null;
      if (state.sort.key === "strict") return r.strict && r.strict.total ? r.strict.passed / r.strict.total : null;
      return r.t;
    };
    rows = rows.slice().sort((a, b) => {
      const va = valOf(a);
      const vb = valOf(b);
      if (va == null && vb == null) return a.t - b.t;
      if (va == null) return 1;          // 无数据的行永远排最后
      if (vb == null) return -1;
      const d = (va - vb) * state.sort.dir;
      return d !== 0 ? d : a.t - b.t;
    });

    const ariaSort = (key) => {
      if (state.sort.key !== key) return "none";
      return state.sort.dir === 1 ? "ascending" : "descending";
    };
    const th = (key, label, width, extra = "") =>
      `<th style="width:${width}" aria-sort="${ariaSort(key)}">
        <button type="button" class="th-sort${state.sort.key === key ? " is-sorted" : ""}" data-sort-key="${key}">
          ${label}<span class="th-arrow">${state.sort.key === key ? (state.sort.dir === 1 ? "↑" : "↓") : "↕"}</span>
        </button>
      </th>`;

    const body = rows
      .map((r) => {
        const s = r.loose;
        const tone = s ? toneOf(s.score) : "neutral";
        const failText = r.fails.length ? r.fails.join("、") : s ? "—" : "无下一回合";
        const strictText = r.strict && r.strict.total ? `${r.strict.passed}/${r.strict.total}` : "–";
        const bar = s ? `<span class="mini"><i style="width:${s.score}%;background:${toneColor(tone)}"></i></span>` : "";
        const active = r.t === state.current ? " is-active" : "";
        return `<tr data-turn="${r.t}" class="${active}">
          <td class="tnum">T${r.t}</td>
          <td class="num">${s ? `${s.score}%` : "–"} ${bar}</td>
          <td class="tnum">${strictText}</td>
          <td class="${r.fails.length ? "" : "muted"}">${esc(failText)}</td>
          <td class="plan" title="${esc(r.plan)}">${r.plan ? esc(r.plan) : '<span class="muted">（没写）</span>'}</td>
        </tr>`;
      })
      .join("");

    const chips = FILTERS.map(
      (f) => `<button type="button" class="chip${state.filter === f.key ? " is-on" : ""}"
        data-filter="${f.key}" aria-pressed="${state.filter === f.key}">${esc(f.label)}</button>`
    ).join("");

    main.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div class="card-title">全部回合</div>
          <span class="card-note">${rows.length} / ${state.turnNums.length} 条 · 点表头排序，点行跳到该回合</span>
        </div>
        <div class="chips">${chips}</div>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                ${th("turn", "回合", "78px")}
                ${th("score", "兑现率", "150px")}
                ${th("strict", "严格口径", "102px")}
                <th style="width:230px">未通过项</th>
                <th>AI 计划</th>
              </tr>
            </thead>
            <tbody>${body || `<tr><td colspan="5" class="muted" style="text-align:center;padding:32px">没有匹配的回合</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;

    main.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.filter = chip.dataset.filter;
        render();
      });
    });

    main.querySelectorAll(".th-sort").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.sortKey;
        if (state.sort.key === key) state.sort.dir = -state.sort.dir;
        else state.sort = { key, dir: key === "turn" ? 1 : -1 };
        render();
      });
    });

    main.querySelectorAll("tbody tr[data-turn]").forEach((tr) => {
      tr.addEventListener("click", () => selectTurn(Number(tr.dataset.turn), { keepView: true }));
    });
  }

  // ——————————————————————————————— 指标

  /** 跨口径交叉：找出「说了 vs 做了」最不一致的回合 */
  function computeInsights() {
    const rows = state.rows.filter((r) => r.nextT);
    const scoreOf = (r) => (r.loose ? r.loose.score : 99);
    const missed = (r) => r.strict.total - r.strict.passed;
    const strictMiss = rows
      .filter((r) => r.strictFailed)
      .sort((a, b) => missed(b) - missed(a) || scoreOf(a) - scoreOf(b));
    const unverifiable = rows.filter((r) => !r.verifiable).sort((a, b) => a.t - b.t);
    const loudMiss = rows
      .filter((r) => r.strictFailed && r.loose && r.loose.score >= 50)
      .sort((a, b) => b.loose.score - a.loose.score);
    return { strictMiss, unverifiable, loudMiss, total: rows.length };
  }

  function insightGroup(title, desc, rows, tone, limit = 6) {
    const items = rows.slice(0, limit)
      .map((r) => {
        const loose = r.loose ? `${r.loose.score}%` : "–";
        const strict = r.strict && r.strict.total ? `${r.strict.passed}/${r.strict.total}` : "–";
        return `<button type="button" class="insight-item" data-jump="${r.t}" data-tone="${tone}">
          <span class="insight-turn">T${r.t}</span>
          <span class="insight-meta">宽松 ${loose} · 严格 ${strict}</span>
        </button>`;
      })
      .join("");
    const more = rows.length > limit ? `<span class="card-note">另有 ${rows.length - limit} 个</span>` : "";
    return `<div class="insight-group">
      <div class="insight-head"><b>${esc(title)}</b><span class="card-note">${esc(desc)}</span></div>
      <div class="insight-items">${items || '<span class="card-note">无</span>'}${more}</div>
    </div>`;
  }

  function renderMetrics(main) {
    const rates = getRates();
    const strict = getStrictAgg();
    const phase = M.phaseCompare(state.scores);
    const ins = computeInsights();

    const rateRows = rates
      .map((r) => {
        const rate = r.rate == null ? 0 : Math.round(r.rate * 100);
        const tone = rate >= 60 ? "good" : rate >= 25 ? "warn" : "bad";
        return `<div class="rate-row" data-tone="${tone}">
          <span class="rate-label">${esc(r.label)}</span>
          <span class="rate-bar"><i style="width:${rate}%"></i></span>
          <span class="rate-val">${r.total ? `${r.passed}/${r.total}` : "–"}${r.total ? ` · ${rate}%` : ""}</span>
        </div>`;
      })
      .join("");

    const strictRows = Object.entries(strict.perType)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([label, v]) => {
        const rate = Math.round((v.passed / v.total) * 100);
        const tone = rate >= 60 ? "good" : rate >= 25 ? "warn" : "bad";
        return `<div class="rate-row" data-tone="${tone}">
          <span class="rate-label">${esc(label)}</span>
          <span class="rate-bar"><i style="width:${rate}%"></i></span>
          <span class="rate-val">${v.passed}/${v.total} · ${rate}%</span>
        </div>`;
      })
      .join("");

    const strictRate = strict.overall.total ? Math.round((strict.overall.passed / strict.overall.total) * 100) : null;
    const phaseDiff = phase.early.avg != null && phase.late.avg != null ? phase.late.avg - phase.early.avg : null;

    main.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div class="card-title">兑现率时间线</div>
          <span class="card-note">柱=逐回合，线=10 回合滑动平均，竖线=当前回合</span>
        </div>
        <div class="chart-box"><canvas id="timelineChart"></canvas></div>
        <div class="legend">
          <span><i style="background:var(--good)"></i>≥60%</span>
          <span><i style="background:var(--warn)"></i>30–59%</span>
          <span><i style="background:var(--bad)"></i>&lt;30%</span>
          <span><i style="background:#f59e0b"></i>10 回合滑动平均</span>
          <span><i style="background:var(--text-3)"></i>当前回合</span>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top:12px">
        <div class="card">
          <div class="card-head"><div class="card-title">7 项检查通过率</div><span class="card-note">宽松口径</span></div>
          ${rateRows}
          <div class="card-note" style="margin-top:8px">「金币增长」几乎恒真，去掉后整体会明显下降，别拿它当主要证据。</div>
        </div>
        <div class="card">
          <div class="card-head"><div class="card-title">点名兵种通过率</div><span class="card-note">严格口径 · ${strictRate == null ? "–" : strictRate + "%"}</span></div>
          ${strictRows || `<div class="card-note">没有可统计的兵种。</div>`}
          <div class="card-note" style="margin-top:8px">
            ${strict.overall.total} 项里通过 ${strict.overall.passed} 项；${strict.overall.turnsTotal - strict.overall.turnsWithNamed} 个回合的计划没点任何兵种，不进分母。
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:12px">
        <div class="card-head">
          <div class="card-title">说了 vs 做了 · 交叉验证</div>
          <span class="card-note">从两种口径的交集里挑出最值得看的回合</span>
        </div>
        <p class="card-note" style="margin-bottom:10px">
          ${ins.total} 个可比回合里，<b>${ins.strictMiss.length}</b> 个「计划点了兵但没全兑现」；
          <b>${ins.unverifiable.length}</b> 个「没有可核对对象」（既没点名兵种也没写坐标），本来就不该进分母；
          其中 <b>${ins.loudMiss.length}</b> 个是「宽松分还挺高、严格口径却没兑现」——这类最值得点开看。
        </p>
        ${insightGroup("宽松 ≥50% 但严格口径失败", "同一回合里，7 项通用检查说有动静，但计划点名的兵没动。", ins.loudMiss, "bad")}
        ${insightGroup("点名了却没兑现", "按未兑现项数排序。", ins.strictMiss, "warn")}
        ${insightGroup("没有可核对对象", "计划里既没点名兵种，也没写坐标——无法判断兑现与否，严格口径不把它们计入分母。", ins.unverifiable, "neutral")}
      </div>

      <div class="card" style="margin-top:12px">
        <div class="card-head">
          <div class="card-title">前后期对比</div>
          <span class="card-note">以 T60 为界，逐回合评分再平均</span>
        </div>
        <div class="phase">
          <div class="phase-cell">
            <div class="v">${pct(phase.early.avg)}</div>
            <div class="l">T39–59 · ${phase.early.n} 个回合</div>
          </div>
          <div class="phase-arrow">→</div>
          <div class="phase-cell">
            <div class="v" style="color:${phaseDiff != null && phaseDiff < 0 ? "var(--bad)" : "var(--good)"}">${pct(phase.late.avg)}</div>
            <div class="l">T60+ · ${phase.late.n} 个回合</div>
          </div>
        </div>
        <p class="card-note" style="margin-top:10px">
          ${phaseDiff == null ? "" : `两段均值差 ${Math.abs(phaseDiff)} 个百分点。`}
          单局样本，后期同时叠加了地图变大和战争，这个差值不能单独归因给上下文长度。
        </p>
      </div>

      <div class="card" style="margin-top:12px">
        <div class="card-head"><div class="card-title">数据质量</div><span class="card-note">用这份快照做分析前该知道的</span></div>
        <div class="card-note" style="line-height:1.9">
          · <code>units</code> 只存我方；<code>cities</code> 和 <code>players</code> 是全部六家，做城市统计必须先按 <code>pid === 0</code> 过滤。<br>
          · <code>is_agent</code> 字段 102 个回合、6 个玩家全是 false，不能用来认我方。<br>
          · pid=4 在 91–140 回合缺席，pid=1 在 123–140 缺席；跨文明对比要自己处理分母。<br>
          · 「每回合 2MB」「平均 37 个字符」这类旧说法都不准，实测量级见 README。
        </div>
      </div>`;

    drawTimeline();

    main.querySelectorAll("[data-jump]").forEach((btn) => {
      btn.addEventListener("click", () => selectTurn(Number(btn.dataset.jump)));
    });
  }

  function drawTimeline() {
    const canvas = document.getElementById("timelineChart");
    if (!canvas || typeof Chart === "undefined") return;

    const C = chartColors();
    const toneHex = { good: C.good, warn: C.warn, bad: C.bad, neutral: C.text3 };
    const turns = Object.keys(state.scores).map(Number).sort((a, b) => a - b);
    const values = turns.map((t) => state.scores[t].score);

    const windowSize = 10;
    const ma = values.map((_, i) => {
      const from = Math.max(0, i - windowSize + 1);
      const slice = values.slice(from, i + 1);
      return Math.round(slice.reduce((a, b) => a + b, 0) / slice.length);
    });

    const currentIdx = turns.indexOf(state.current);
    const currentLine = {
      id: "currentLine",
      afterDraw(chart) {
        if (currentIdx < 0) return;
        const x = chart.scales.x.getPixelForValue(currentIdx);
        const { ctx, chartArea } = chart;
        if (x < chartArea.left || x > chartArea.right) return;
        ctx.save();
        ctx.strokeStyle = C.text3;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.restore();
      },
    };

    if (state.charts.timeline) state.charts.timeline.destroy();
    state.charts.timeline = new Chart(canvas, {
      data: {
        labels: turns.map((t) => `T${t}`),
        datasets: [
          {
            type: "bar",
            label: "逐回合",
            data: values,
            backgroundColor: values.map((v) => toneHex[toneOf(v)]),
            borderRadius: 3,
            barPercentage: 0.9,
            categoryPercentage: 0.95,
            order: 2,
          },
          {
            type: "line",
            label: "10 回合滑动平均",
            data: ma,
            borderColor: "#f59e0b",
            backgroundColor: "#f59e0b",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.35,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        onClick(evt, items) {
          if (!items.length) return;
          const t = turns[items[0].index];
          if (t != null && t !== state.current) selectTurn(t, { keepView: true });
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => items[0].label,
              label: (item) => `${item.dataset.label}：${item.parsed.y}%`,
              afterBody: (items) => {
                const t = turns[items[0].dataIndex];
                const r = rowOf(t);
                if (!r || !r.loose) return [];
                const lines = [r.fails.length ? `未通过：${r.fails.join("、")}` : "7 项全部通过"];
                if (r.strict && r.strict.total) {
                  lines.push(`严格口径：${r.strict.passed}/${r.strict.total}${r.strictFailed ? "（点了兵没兑现）" : ""}`);
                }
                return lines;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxTicksLimit: 14, color: C.text3, font: { size: 10 } },
          },
          y: {
            beginAtZero: true,
            max: 100,
            grid: { color: "rgba(148,163,184,.18)" },
            ticks: { callback: (v) => `${v}%`, color: C.text3, font: { size: 10 } },
          },
        },
      },
      plugins: [currentLine],
    });
  }

  // ——————————————————————————————— 交互

  function selectTurn(turn, { keepView = false } = {}) {
    const t = clampTurn(turn);
    if (t == null) return;
    state.current = t;
    if (!keepView) state.view = "detail";
    render();
    scrollStripTo(t);
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll(".tab").forEach((b) => {
      const active = b.dataset.view === view;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", String(active));
    });
    render();
  }

  function syncStepper() {
    $("#turnLabel").textContent = state.current == null ? "T–" : `T${state.current}`;
    const idx = state.turnNums.indexOf(state.current);
    $("#prevTurn").disabled = idx <= 0;
    $("#nextTurn").disabled = idx < 0 || idx >= state.turnNums.length - 1;
  }

  function step(delta) {
    const idx = state.turnNums.indexOf(state.current);
    if (idx < 0) return;
    const next = state.turnNums[idx + delta];
    if (next != null) selectTurn(next);
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("civ6-theme", theme);
    if (state.charts.timeline) drawTimeline();
  }

  // ——————————————————————————————— 复制摘要 / 轻提示

  function summaryText(t) {
    const r = rowOf(t);
    if (!r) return "";
    const head = r.loose
      ? `兑现率 ${r.loose.score}%（${r.loose.passed}/${r.loose.total}）`
      : "无下一回合可比";
    const lines = [`T${t}${r.nextT ? ` → T${r.nextT}` : ""}｜${head}`];
    if (r.plan) lines.push(`计划：${r.plan}`);
    lines.push(`未通过：${r.fails.length ? r.fails.join("、") : "无"}`);
    if (r.strict && r.strict.total) {
      const items = r.strict.items.map((i) => `${M.UNIT_LABEL[i.type] || i.type}${i.passed ? "✓" : "✗"}`).join("、");
      lines.push(`严格口径：${r.strict.passed}/${r.strict.total}（${items}）`);
    } else if (!r.verifiable) {
      lines.push("严格口径：计划里没点名兵种也没写坐标，无法核对");
    } else {
      lines.push("严格口径：计划未点名兵种，不评");
    }
    lines.push(`数据：data/collected/turn_${String(t).padStart(3, "0")}.json`);
    return lines.join("\n");
  }

  async function copySummary() {
    const text = summaryText(state.current);
    if (!text) return;
    if (await tryCopy(text)) {
      toast("已复制本回合摘要");
      return;
    }
    showCopyFallback(text);
  }

  /** 优先 Clipboard API，退回 execCommand；都失败返回 false */
  async function tryCopy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        /* 权限被拒，继续走兜底 */
      }
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  /** 浏览器拒绝写剪贴板时，给一个已选中的文本框让人手动复制 */
  function showCopyFallback(text) {
    document.querySelector(".copy-fallback")?.remove();
    const wrap = document.createElement("div");
    wrap.className = "copy-fallback";
    wrap.innerHTML = `
      <div class="copy-box" role="dialog" aria-modal="true" aria-label="手动复制摘要">
        <div class="copy-head">
          <b>自动复制被浏览器拦住了</b>
          <button type="button" class="btn btn-ghost" data-close>关闭</button>
        </div>
        <p class="card-note">文本已选中，按 Ctrl+C（macOS 是 ⌘+C）即可复制。</p>
        <textarea readonly spellcheck="false"></textarea>
      </div>`;
    wrap.querySelector("textarea").value = text;
    document.body.appendChild(wrap);
    const ta = wrap.querySelector("textarea");
    ta.focus();
    ta.select();
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap || e.target.closest("[data-close]")) wrap.remove();
    });
    const onEsc = (e) => {
      if (e.key === "Escape") {
        wrap.remove();
        document.removeEventListener("keydown", onEsc);
      }
    };
    document.addEventListener("keydown", onEsc);
  }

  let toastTimer = null;
  function toast(msg) {
    const node = $("#toast");
    if (!node) return;
    node.textContent = msg;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.hidden = true;
    }, 1800);
  }

  function bind() {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.dataset.view));
    });

    $("#turnStrip").addEventListener("click", (e) => {
      const cell = e.target.closest(".turncell");
      if (cell) selectTurn(Number(cell.dataset.turn), { keepView: true });
    });

    $("#prevTurn").addEventListener("click", () => step(-1));
    $("#nextTurn").addEventListener("click", () => step(1));

    $("#searchInput").addEventListener("input", (e) => {
      state.search = e.target.value;
      if (state.view !== "overview") setView("overview");
      else render();
    });

    // 内容区是整体重绘的，所以用委托，别在 render 里反复绑
    $("#content").addEventListener("click", (e) => {
      if (e.target.closest("[data-copy]")) copySummary();
    });

    $("#themeBtn").addEventListener("click", () => {
      applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    });

    const panel = $("#methodPanel");
    const methodBtn = $("#methodBtn");
    methodBtn.addEventListener("click", () => {
      const open = panel.hasAttribute("hidden");
      if (open) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
      methodBtn.setAttribute("aria-expanded", String(open));
    });

    document.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "Home") {
        e.preventDefault();
        selectTurn(state.turnNums[0]);
      } else if (e.key === "End") {
        e.preventDefault();
        selectTurn(state.turnNums[state.turnNums.length - 1]);
      } else if (e.key === "1") setView("detail");
      else if (e.key === "2") setView("overview");
      else if (e.key === "3") setView("metrics");
    });

    window.addEventListener("hashchange", () => {
      const h = readHash();
      state.view = h.view;
      state.filter = h.filter;
      state.sort = h.sort;
      if (h.turn != null) state.current = clampTurn(h.turn);
      render();
    });
  }

  // ——————————————————————————————— 启动

  async function boot() {
    const saved = localStorage.getItem("civ6-theme");
    applyTheme(saved === "dark" ? "dark" : "light");

    const hash = readHash();
    state.view = hash.view;
    state.filter = hash.filter;
    state.sort = hash.sort;

    // 依赖先检查：metrics.js 没加载成功时给出可读的错，而不是一句 scoreAll undefined
    if (!M || typeof M.scoreAll !== "function") {
      setConn("err", "脚本缺失");
      $("#content").innerHTML = `
        <div class="card">
          <div class="empty">
            <strong>metrics.js 没有加载成功</strong>
            页面依赖 <code>frontend/metrics.js</code>，确认文件存在且和 <code>app.js</code> 同级，
            然后强制刷新（Ctrl+F5）。
          </div>
        </div>`;
      return;
    }

    try {
      await loadData();
    } catch (err) {
      setConn("err", "API 连不上");
      $("#content").innerHTML = `
        <div class="card">
          <div class="empty">
            <strong>没取到数据（${esc(err.message)}）</strong>
            确认 Java API 已启动：<code>run-evaluator.bat</code> 或 <code>java -cp ... com.civ.eval.ApiServer</code>，
            然后刷新本页。接口地址：<code>${esc(API_BASE)}/api/all</code>
          </div>
        </div>`;
      return;
    }

    state.current = clampTurn(hash.turn != null ? hash.turn : state.turnNums[0]);
    bind();
    setView(state.view);
    scrollStripTo(state.current);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
