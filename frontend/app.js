let allTurns = {};   // {39: {...}, 40: {...}}
let currentTurn = null;
let trendChart = null;  // Chart.js 实例

const API_BASE = "http://localhost:8080";

async function loadAllTurns() {
    // 完全走 Java API
    const resp = await fetch(`${API_BASE}/api/all`);
    if (!resp.ok) {
        throw new Error(`API 请求失败: ${resp.status}`);
    }
    const data = await resp.json();

    // data 的 key 是回合号（字符串），转成数字并排序
    const turnNums = Object.keys(data).map(Number).sort((a, b) => a - b);
    turnNums.forEach(t => {
        allTurns[t] = data[t];
    });

    return turnNums;
}

function renderTurnButtons(turnNums) {
    const container = document.getElementById("turnSelector");
    container.innerHTML = "";
    turnNums.forEach(t => {
        const btn = document.createElement("button");
        btn.className = "turn-btn";
        btn.textContent = `第${t}回合`;
        btn.onclick = () => showTurn(t);
        container.appendChild(btn);
    });
}

function showTurn(turnNum) {
    currentTurn = turnNum;
    document.querySelectorAll(".turn-btn").forEach(b => {
        b.classList.toggle("active", b.textContent === `第${turnNum}回合`);
    });
    renderContent(turnNum);
}

function renderContent(turnNum) {
    const current = allTurns[turnNum];
    const next = allTurns[turnNum + 1];
    if (!current) return;

    const main = document.getElementById("content");
    let html = "";

    // 总览表格（放在最前面）
    html += renderOverviewTable(turnNum);

    // 1. AI 的承诺
    if (current.reflections) {
        html += `
            <div class="card ai-said">
                <h2>📝 AI 的计划</h2>
                <p>${escapeHtml(current.reflections.planning)}</p>
            </div>
            <div class="card ai-said">
                <h2>🔮 AI 的预测</h2>
                <p>${escapeHtml(current.reflections.hypothesis)}</p>
            </div>
        `;
    }

    // 2. 事实对比
    if (next) {

        html += renderUnitChanges(current, next);
        html += renderCityChanges(current, next);
    } else {
        html += `<div class="card"><p>没有下一回合数据可对比</p></div>`;
    }

    // 3. 评分卡片 + 趋势图
    if (next) {
        const scoreResult = calculateScore(current, next);
        if (scoreResult) {
            const allScores = calculateAllScores();
            const values = Object.values(allScores);
            const avg = values.length > 0
                ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
                : 0;

            const scoreClass = scoreResult.score >= 60 ? "score-good"
                : scoreResult.score >= 30 ? "score-mid"
                    : "score-bad";
            const diff = scoreResult.score - avg;
            const diffText = diff > 0
                ? `<span class="better">↑ 高于平均 ${diff}%</span>`
                : diff < 0
                    ? `<span class="worse">↓ 低于平均 ${Math.abs(diff)}%</span>`
                    : `<span>等于平均</span>`;

            html += `
                <div class="card score-card ${scoreClass}">
                    <h2>📊 本回合承诺兑现率</h2>
                    <div class="score-number">${scoreResult.score}%</div>
                    <div class="score-bar-bg">
                        <div class="score-bar-fill" style="width:${scoreResult.score}%"></div>
                    </div>
                    <div class="score-details">
                        ${scoreResult.details.map(d =>
                `<span class="${d.passed ? 'passed' : 'failed'}">
                                ${d.passed ? '✅' : '❌'} ${d.label}
                            </span>`
            ).join("")}
                    </div>
                    <div class="score-compare">${diffText}（平均 ${avg}%）</div>
                </div>
            `;
        }

        // 趋势图卡片
        const allScores = calculateAllScores();
        html += renderTrendStats(allScores);
        html += renderPhaseComparison();
    }

    main.innerHTML = html;

    // 4. 渲染图表（必须在 innerHTML 之后执行）
    if (next) {
        const allScores = calculateAllScores();
        renderTrendChart(allScores, turnNum);
    }
}

function renderUnitChanges(current, next) {
    const unitsNow = {};
    const unitsNext = {};
    (current.units || []).forEach(u => unitsNow[u.id] = u);
    (next.units || []).forEach(u => unitsNext[u.id] = u);

    let html = `<div class="card fact"><h2>⚔️ 单位变化（下一回合实际）</h2>`;
    let changeCount = 0;

    for (const [id, uNow] of Object.entries(unitsNow)) {
        const uNext = unitsNext[id];
        if (!uNext) {
            html += `<div class="unit-line disappeared">❌ ${uNow.type} (id=${id}): 消失了（阵亡或升级）</div>`;
            changeCount++;
            continue;
        }

        const posChanged = uNow.x !== uNext.x || uNow.y !== uNext.y;
        const dmgChanged = uNow.damage !== uNext.damage;

        if (posChanged || dmgChanged) {
            let parts = [];
            if (posChanged) parts.push(`位置 (${uNow.x},${uNow.y}) → (${uNext.x},${uNext.y})`);
            if (dmgChanged) parts.push(`损伤 ${uNow.damage} → ${uNext.damage}`);
            html += `<div class="unit-line changed">✅ ${uNow.type} (id=${id}): ${parts.join(", ")}</div>`;
            changeCount++;
        } else {
            html += `<div class="unit-line unchanged">⚪ ${uNow.type} (id=${id}): 无变化</div>`;
        }
    }

    html += `</div>`;
    return html;
}

function renderCityChanges(current, next) {
    const cNow = (current.cities || []).find(c => c.pid === 0);
    const cNext = (next.cities || []).find(c => c.pid === 0);
    if (!cNow || !cNext) return "";

    const changed = cNow.producing !== cNext.producing;
    const cls = changed ? "fact" : "fact warning";
    const icon = changed ? "✅" : "⚪";
    const text = changed
        ? `${cNow.producing} → ${cNext.producing}（完工了！）`
        : `仍在生产 ${cNow.producing}（未完工）`;

    return `
        <div class="card ${cls}">
            <h2>🏙️ 城市生产</h2>
            <div class="unit-line">${icon} ${text}</div>
        </div>
    `;
}

function escapeHtml(s) {
    if (!s) return "";
    return s.replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
}

// ===== 承诺兑现率评分 =====
function calculateScore(current, next) {
    if (!next) return null;

    const checks = [];

    // 检查1：单位是否移动
    const unitsNow = current.units || [];
    const unitsNext = next.units || [];
    const unitsNextMap = {};
    unitsNext.forEach(u => unitsNextMap[u.id] = u);

    let unitMoved = false;
    let unitFought = false;
    let unitDied = false;
    for (const u of unitsNow) {
        const n = unitsNextMap[u.id];
        if (!n) {
            unitDied = true;
        } else if (u.x !== n.x || u.y !== n.y) {
            unitMoved = true;
        }
        if (n && u.damage !== n.damage) {
            unitFought = true;
        }
    }
    if (unitsNow.length > 0) {
        checks.push({ label: "单位移动", passed: unitMoved });
        checks.push({ label: "单位战斗", passed: unitFought });
    }

    // 检查2：城市生产是否推进
    const cityNow = (current.cities || []).find(c => c.pid === 0);
    const cityNext = (next.cities || []).find(c => c.pid === 0);
    if (cityNow && cityNext) {
        checks.push({
            label: "城市生产",
            passed: cityNow.producing !== cityNext.producing
        });
        // 人口增长
        checks.push({
            label: "人口增长",
            passed: cityNext.pop > cityNow.pop
        });
    }

    // 检查3：科技推进
    const playerNow = (current.players || []).find(p => p.pid === 0);
    const playerNext = (next.players || []).find(p => p.pid === 0);
    if (playerNow && playerNext) {
        checks.push({
            label: "科技推进",
            passed: playerNext.techs_completed > playerNow.techs_completed
        });
        checks.push({
            label: "文化推进",
            passed: playerNext.civics_completed > playerNow.civics_completed
        });
        checks.push({
            label: "金币增长",
            passed: playerNext.gold > playerNow.gold
        });
    }

    const passed = checks.filter(c => c.passed).length;
    const score = Math.round((passed / checks.length) * 100);
    return { score, details: checks };
}

// ===== 计算所有回合的评分 =====
function calculateAllScores() {
    const scores = {};  // {turn: score}
    const turnNums = Object.keys(allTurns).map(Number).sort((a, b) => a - b);

    for (let i = 0; i < turnNums.length - 1; i++) {
        const cur = allTurns[turnNums[i]];
        const nxt = allTurns[turnNums[i + 1]];
        const result = calculateScore(cur, nxt);
        if (result) scores[turnNums[i]] = result.score;
    }
    return scores;
}

// ===== 渲染趋势图 =====
function renderTrendChart(scores, currentTurn) {
    const ctx = document.getElementById("trendChart");
    if (!ctx) return;

    const turns = Object.keys(scores).map(Number).sort((a, b) => a - b);
    const values = turns.map(t => scores[t]);

    // 高亮当前回合
    const colors = turns.map(t =>
        t === currentTurn ? "#4a9eff" : "#b0d4ff"
    );

    if (trendChart) trendChart.destroy();

    trendChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: turns.map(t => `T${t}`),
            datasets: [{
                label: "承诺兑现率",
                data: values,
                backgroundColor: colors,
                borderRadius: 4,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `承诺兑现率: ${ctx.parsed.y}%`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { callback: v => v + "%" }
                }
            }
        }
    });
}

// ===== 渲染趋势统计卡片 =====
function renderTrendStats(scores) {
    const values = Object.values(scores);
    if (values.length === 0) return "";

    const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    const max = Math.max(...values);
    const min = Math.min(...values);

    return `
        <div class="card trend-card">
            <h2>📊 承诺兑现率趋势</h2>
            <div class="trend-stats">
                <div>
                    <div class="stat-value">${avg}%</div>
                    <div class="stat-label">平均</div>
                </div>
                <div>
                    <div class="stat-value" style="color:#4caf50">${max}%</div>
                    <div class="stat-label">最高</div>
                </div>
                <div>
                    <div class="stat-value" style="color:#f44336">${min}%</div>
                    <div class="stat-label">最低</div>
                </div>
            </div>
            <div class="chart-container">
                <canvas id="trendChart"></canvas>
            </div>
        </div>
    `;
}

// ===== 渲染总览表格 =====
function renderOverviewTable(currentTurn) {
    const turnNums = Object.keys(allTurns).map(Number).sort((a, b) => a - b);
    const allScores = calculateAllScores();

    let rows = "";
    for (const t of turnNums) {
        const cur = allTurns[t];
        const nxt = allTurns[t + 1];
        const scoreResult = nxt ? calculateScore(cur, nxt) : null;

        const isActive = t === currentTurn;
        const rowCls = isActive ? "row-active" : "row-dim";

        // AI 计划摘要（太长就截断）
        const plan = cur.reflections?.planning || "（无）";
        const summary = plan.length > 40 ? plan.substring(0, 40) + "…" : plan;

        // 单位/城市图标
        const unitIcon = scoreResult?.details.find(d => d.label === "单位行动")?.passed ? "✅" : "❌";
        const cityIcon = scoreResult?.details.find(d => d.label === "城市生产")?.passed ? "✅" : "❌";

        const score = allScores[t];

        rows += `
            <tr class="${rowCls}" onclick="showTurn(${t})">
                <td>T${t}</td>
                <td>${escapeHtml(summary)}</td>
                <td class="cell-score">${score != null ? score + "%" : "-"}</td>
                <td class="cell-icon">${unitIcon}</td>
                <td class="cell-icon">${cityIcon}</td>
            </tr>
        `;
    }

    return `
        <div class="card overview-card">
            <h2>📋 所有回合总览</h2>
            <table class="overview-table">
                <thead>
                    <tr>
                        <th style="width:60px">回合</th>
                        <th>AI 计划</th>
                        <th style="width:80px">兑现率</th>
                        <th style="width:50px">单位</th>
                        <th style="width:50px">城市</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

function renderPhaseComparison() {
    const s = calculateAllScores();
    const turns = Object.keys(s).map(Number).sort((a, b) => a - b);
    const early = turns.filter(t => t < 60).map(t => s[t]);
    const late = turns.filter(t => t >= 60).map(t => s[t]);

    const avgEarly = early.length ? Math.round(early.reduce((a, b) => a + b, 0) / early.length) : 0;
    const avgLate = late.length ? Math.round(late.reduce((a, b) => a + b, 0) / late.length) : 0;
    const diff = avgLate - avgEarly;

    return `
        <div class="card">
            <h2>📉 阶段对比</h2>
            <div style="display:flex; justify-content:space-around; margin:16px 0;">
                <div style="text-align:center">
                    <div style="font-size:32px; font-weight:bold; color:#4a9eff">${avgEarly}%</div>
                    <div style="color:#888; font-size:13px">前期（T39-59）</div>
                </div>
                <div style="text-align:center">
                    <div style="font-size:32px; font-weight:bold; color:#f44336">${avgLate}%</div>
                    <div style="color:#888; font-size:13px">后期（T60+）</div>
                </div>
            </div>
            <p style="text-align:center; color:${diff < 0 ? '#f44336' : '#4caf50'}; font-weight:500;">
                ${diff < 0 ? '↓' : '↑'} 变化 ${Math.abs(diff)}%
            </p>
            <p style="text-align:center; color:#666; font-size:13px; margin-top:10px;">
                AI 的承诺兑现率随回合数增加而持续下降
            </p>
        </div>
    `;
}

// 启动
(async () => {
    const turnNums = await loadAllTurns();
    if (turnNums.length === 0) {
        document.getElementById("content").innerHTML =
            `<div class="card">❌ 没有找到数据。请确保用 http://localhost:8000 访问。</div>`;
        return;
    }
    renderTurnButtons(turnNums);
    showTurn(turnNums[0]);
})();