/**
 * metrics.js — 评分口径的单一实现
 *
 * 这里是前端唯一一份评分逻辑，app.js 只负责渲染。
 * 口径必须和 analysis/compare_loose.py、analysis/strict_plan_check.py 一致，
 * 改口径请三个文件一起改，否则界面和脚本又会分叉（之前已经踩过一次）。
 *
 * 宽松口径 7 项：
 *   单位移动 / 单位战斗 / 城市生产 / 人口增长 / 科技推进 / 文化推进 / 金币增长
 * 已知偏差（刻意保留，和脚本对齐）：
 *   1. 城市、人口只看 pid=0 的第一座城；
 *   2. 金币增长几乎恒真。
 *
 * 严格口径：从 planning 里按固定词表抽兵种，核对下一回合该兵种是否
 * 移动 / 造成伤害 / 从快照消失。只是被打掉血不算，那是别人执行的。
 */
const Civ6Metrics = (() => {
  "use strict";

  const LOOSE_CHECKS = [
    { key: "unitMoved", label: "单位移动", group: "unit", hint: "本回合有单位改变了坐标" },
    { key: "unitFought", label: "单位战斗", group: "unit", hint: "本回合有单位的损伤值发生变化" },
    { key: "cityProduced", label: "城市生产", group: "city", hint: "第一座城的生产项换了，意味着完工" },
    { key: "popGrew", label: "人口增长", group: "city", hint: "第一座城人口增加" },
    { key: "techDone", label: "科技推进", group: "player", hint: "科技完成数增加" },
    { key: "civicDone", label: "文化推进", group: "player", hint: "市政完成数增加" },
    { key: "goldGrew", label: "金币增长", group: "player", hint: "金币余额增加（几乎恒真）" },
  ];

  const MY_PID = 0;

  // 固定词表：和 analysis/strict_plan_check.py 里的 UNIT_WORDS 保持一致
  const UNIT_WORDS = [
    ["勇士", "UNIT_WARRIOR"],
    ["战士", "UNIT_WARRIOR"],
    ["弓箭手", "UNIT_ARCHER"],
    ["弓手", "UNIT_ARCHER"],
    ["建造者", "UNIT_BUILDER"],
    ["开拓者", "UNIT_SETTLER"],
    ["移民", "UNIT_SETTLER"],
    ["商人", "UNIT_TRADER"],
    ["英雄", "UNIT_HERO_HIMIKO"],
  ];

  const UNIT_LABEL = {
    UNIT_WARRIOR: "勇士",
    UNIT_ARCHER: "弓箭手",
    UNIT_BUILDER: "建造者",
    UNIT_SETTLER: "开拓者",
    UNIT_TRADER: "商人",
    UNIT_HERO_HIMIKO: "英雄",
  };

  const ERA_LABEL = {
    ERA_ANCIENT: "远古",
    ERA_CLASSICAL: "古典",
    ERA_MEDIEVAL: "中世纪",
    ERA_RENAISSANCE: "文艺复兴",
    ERA_INDUSTRIAL: "工业",
    ERA_MODERN: "现代",
  };

  const myCities = (turn) => (turn?.cities || []).filter((c) => c.pid === MY_PID);
  const myPlayer = (turn) => (turn?.players || []).find((p) => p.pid === MY_PID) || null;
  const unitsById = (turn) => {
    const map = new Map();
    (turn?.units || []).forEach((u) => map.set(u.id, u));
    return map;
  };

  /** 计划里点名的兵种（去重），和严格口径共用同一张词表 */
  function mentionedUnitTypes(planning) {
    const hits = [];
    UNIT_WORDS.forEach(([word, type]) => {
      if (String(planning || "").includes(word) && !hits.includes(type)) hits.push(type);
    });
    return hits;
  }

  /**
   * 计划里有没有「可核对的对象」：点了兵种名，或者写了坐标。
   * 两个都没有的计划，无法判断兑现与否——严格口径的分母就是排除了这 34 条。
   */
  function hasVerifiableTarget(planning) {
    return mentionedUnitTypes(planning).length > 0 || /\d+\s*[,，]\s*\d+/.test(String(planning || ""));
  }

  /** 宽松口径：返回每个检查项的原始结果，以及缺口说明 */
  function checkLoose(cur, next) {
    const results = {};
    const unavailable = [];
    const details = {};

    // ——— 单位
    const now = cur?.units || [];
    const after = unitsById(next);
    let moved = false;
    let fought = false;
    const unitChanges = [];
    now.forEach((u) => {
      const n = after.get(u.id);
      if (!n) {
        unitChanges.push({ id: u.id, type: u.type, status: "gone" });
        return;
      }
      const posChanged = u.x !== n.x || u.y !== n.y;
      const dmgChanged = u.damage !== n.damage;
      if (posChanged) moved = true;
      if (dmgChanged) fought = true;
      unitChanges.push({
        id: u.id, type: u.type, status: posChanged || dmgChanged ? "changed" : "still",
        from: { x: u.x, y: u.y, damage: u.damage },
        to: { x: n.x, y: n.y, damage: n.damage },
      });
    });
    if (now.length) {
      results.unitMoved = moved;
      results.unitFought = fought;
    } else {
      unavailable.push("单位移动", "单位战斗");
    }
    details.units = unitChanges;

    // ——— 城市（只看第一座，和脚本口径一致）
    const cNow = myCities(cur)[0];
    const cNext = myCities(next)[0];
    if (cNow && cNext) {
      results.cityProduced = cNow.producing !== cNext.producing;
      results.popGrew = (cNext.pop || 0) > (cNow.pop || 0);
    } else {
      unavailable.push("城市生产", "人口增长");
    }
    details.city = cNow
      ? {
          name: cNow.city,
          from: cNow.producing,
          to: cNext ? cNext.producing : null,
          popFrom: cNow.pop,
          popTo: cNext ? cNext.pop : null,
          progressing: cNext ? cNow.producing === cNext.producing : null,
        }
      : null;

    // ——— 玩家
    const pNow = myPlayer(cur);
    const pNext = myPlayer(next);
    if (pNow && pNext) {
      results.techDone = (pNext.techs_completed || 0) > (pNow.techs_completed || 0);
      results.civicDone = (pNext.civics_completed || 0) > (pNow.civics_completed || 0);
      results.goldGrew = (pNext.gold || 0) > (pNow.gold || 0);
    } else {
      unavailable.push("科技推进", "文化推进", "金币增长");
    }
    details.player = { now: pNow, next: pNext };

    const checks = LOOSE_CHECKS.map((c) => ({
      ...c,
      passed: results[c.key],
      available: results[c.key] !== undefined,
    }));

    const availableChecks = checks.filter((c) => c.available);
    const passed = availableChecks.filter((c) => c.passed).length;
    return {
      checks,
      passed,
      total: availableChecks.length,
      score: availableChecks.length ? Math.round((passed / availableChecks.length) * 100) : null,
      unavailable,
      details,
    };
  }

  /** 严格口径：planning 里点名的兵种，下一回合是否真的动了 */
  function checkStrict(cur, next) {
    const planning = cur?.reflections?.planning || "";
    const named = [];
    UNIT_WORDS.forEach(([word, type]) => {
      if (planning.includes(word) && !named.includes(type)) named.push(type);
    });

    const now = cur?.units || [];
    const after = unitsById(next);
    const items = named.map((type) => {
      const units = now.filter((u) => u.type === type);
      if (!units.length) {
        return { type, mentioned: true, passed: false, reason: "计划点名了，但当前快照里没有这个兵种", units: [] };
      }
      let passed = false;
      const unitDetails = units.map((u) => {
        const n = after.get(u.id);
        const gone = !n;
        const moved = !!n && (u.x !== n.x || u.y !== n.y);
        const dealt = !!n && n.damage < u.damage;
        const took = !!n && n.damage > u.damage;
        const did = gone || moved || dealt;
        if (did) passed = true;
        return { id: u.id, gone, moved, dealt, took, from: { x: u.x, y: u.y, damage: u.damage }, to: n ? { x: n.x, y: n.y, damage: n.damage } : null };
      });
      return {
        type,
        mentioned: true,
        passed,
        reason: passed ? "" : units.some((u) => !after.get(u.id)) ? "" : "点名了，但下一回合没有任何动作",
        units: unitDetails,
      };
    });

    const passed = items.filter((i) => i.passed).length;
    return { planning, items, passed, total: items.length };
  }

  /** 全部回合的宽松评分 { turn: {score, passed, total} } */
  function scoreAll(turns, turnNumbers) {
    const out = {};
    for (let i = 0; i < turnNumbers.length - 1; i++) {
      const a = turnNumbers[i];
      const b = turnNumbers[i + 1];
      const r = checkLoose(turns[a], turns[b]);
      if (r.score !== null) out[a] = { score: r.score, passed: r.passed, total: r.total };
    }
    return out;
  }

  /** 逐项通过率 */
  function checkRates(turns, turnNumbers) {
    const acc = {};
    LOOSE_CHECKS.forEach((c) => (acc[c.key] = { label: c.label, passed: 0, total: 0 }));
    for (let i = 0; i < turnNumbers.length - 1; i++) {
      const r = checkLoose(turns[turnNumbers[i]], turns[turnNumbers[i + 1]]);
      r.checks.forEach((c) => {
        if (!c.available) return;
        acc[c.key].total += 1;
        if (c.passed) acc[c.key].passed += 1;
      });
    }
    return LOOSE_CHECKS.map((c) => ({
      ...c,
      passed: acc[c.key].passed,
      total: acc[c.key].total,
      rate: acc[c.key].total ? acc[c.key].passed / acc[c.key].total : null,
    }));
  }

  /** 阶段对比：T39-59 vs T60+，按逐回合评分再平均 */
  function phaseCompare(scores, split = 60) {
    const early = [];
    const late = [];
    Object.entries(scores).forEach(([t, s]) => {
      (Number(t) < split ? early : late).push(s.score);
    });
    const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
    return { early: { avg: avg(early), n: early.length }, late: { avg: avg(late), n: late.length } };
  }

  /** 题面说明用的数据缺口：哪些回合缺了哪个 AI */
  function playerGaps(turns, turnNumbers) {
    const gaps = {};
    turnNumbers.forEach((t) => {
      const have = new Set((turns[t]?.players || []).map((p) => p.pid));
      [1, 2, 3, 4, 5].forEach((pid) => {
        if (!have.has(pid)) (gaps[pid] = gaps[pid] || []).push(t);
      });
    });
    return gaps;
  }

  return {
    LOOSE_CHECKS, UNIT_LABEL, ERA_LABEL, MY_PID,
    myCities, myPlayer, checkLoose, checkStrict, scoreAll,
    checkRates, phaseCompare, playerGaps,
    mentionedUnitTypes, hasVerifiableTarget,
  };
})();

// 经典脚本里的 const 不会自动挂到 window 上，必须显式导出，
// 否则 app.js 里 window.Civ6Metrics 是 undefined。
window.Civ6Metrics = Civ6Metrics;
