"""严格口径：从 planning 里抽出具名兵种，核对下一回合该兵种是否真有行动。

和「宽松口径」的区别：宽松口径只看整局有没有动静（单位移动/战斗、城市生产、
人口、科技、文化、金币），跟模型写的那句话没有直接关系；这个脚本要求
「计划里点了名的兵种」在下一回合真的动了——名字对上了才算数。

判定口径（写在代码里，避免以后又对不上）：
  1. 兵种 = 六个中文名到 UNIT_* 的固定映射，不做模糊匹配；
  2. 一个兵种在同一回合的计划里只算一项；
  3. 计划提到某兵种、但当前快照里没有该兵种，算不通过（不能因为没兵就免检）；
  4. 「有行动」= 移动 / 造成伤害 / 从快照里消失（阵亡或升级）。
     只是被打掉血不算——那是别人执行的，不是它执行了计划。

用法：
    python analysis/strict_plan_check.py            # 打印汇总
    python analysis/strict_plan_check.py --json out.json   # 另外导出每回合明细

数据目录默认 ./data/collected，可用环境变量 CIV6_DATA_DIR 覆盖。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DATA_DIR = Path(os.environ.get("CIV6_DATA_DIR", Path("data") / "collected"))

# 固定映射：计划文本里的说法 -> 游戏里的单位类型
UNIT_WORDS = {
    "勇士": "UNIT_WARRIOR",
    "战士": "UNIT_WARRIOR",
    "弓箭手": "UNIT_ARCHER",
    "弓手": "UNIT_ARCHER",
    "建造者": "UNIT_BUILDER",
    "开拓者": "UNIT_SETTLER",
    "移民": "UNIT_SETTLER",
    "商人": "UNIT_TRADER",
    "英雄": "UNIT_HERO_HIMIKO",
}


def load_all_turns() -> dict[int, dict]:
    turns = {}
    for f in sorted(DATA_DIR.glob("turn_*.json")):
        with open(f, encoding="utf-8") as fp:
            data = json.load(fp)
        turns[data["turn"]] = data
    return turns


def mentioned_types(planning: str) -> list[str]:
    """计划里点名的兵种，按出现顺序去重。"""
    hits = []
    for word, unit_type in UNIT_WORDS.items():
        if word in planning and unit_type not in hits:
            hits.append(unit_type)
    return hits


def actions_of(turn: dict, next_turn: dict) -> dict[int, dict]:
    """每个单位在下一回合发生了什么。"""
    after = {u["id"]: u for u in next_turn.get("units", [])}
    result = {}
    for u in turn.get("units", []):
        n = after.get(u["id"])
        if n is None:
            result[u["id"]] = {"moved": False, "damaged_self": False, "dealt": False, "gone": True}
        else:
            result[u["id"]] = {
                "moved": (u["x"], u["y"]) != (n["x"], n["y"]),
                "damaged_self": n["damage"] > u["damage"],
                "dealt": n["damage"] < u["damage"],
                "gone": False,
            }
    return result


def check_turn(turn: dict, next_turn: dict) -> dict:
    planning = (turn.get("reflections") or {}).get("planning") or ""
    named = mentioned_types(planning)
    by_type: dict[str, list[dict]] = {}
    for u in turn.get("units", []):
        by_type.setdefault(u["type"], []).append(u)

    acts = actions_of(turn, next_turn)
    items = []
    for unit_type in named:
        units = by_type.get(unit_type, [])
        if not units:
            items.append({
                "unit_type": unit_type,
                "passed": False,
                "reason": "计划点名了，但快照里没有这个兵种",
                "units": [],
            })
            continue
        detail = []
        passed = False
        for u in units:
            a = acts[u["id"]]
            did = a["moved"] or a["dealt"] or a["gone"]
            passed = passed or did
            detail.append({"id": u["id"], **a})
        items.append({"unit_type": unit_type, "passed": passed, "units": detail})

    return {"turn": turn["turn"], "planning": planning, "checks": items}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", help="把每回合明细写到这里（UTF-8 JSON）")
    args = parser.parse_args()

    turns = load_all_turns()
    if not turns:
        print(f"没读到数据：{DATA_DIR}")
        return 1

    nums = sorted(turns)
    per_turn = []
    for a, b in zip(nums, nums[1:]):
        per_turn.append(check_turn(turns[a], turns[b]))

    total = sum(len(r["checks"]) for r in per_turn)
    passed = sum(1 for r in per_turn for c in r["checks"] if c["passed"])
    rate = 100 * passed / total if total else 0.0

    print(f"数据目录: {DATA_DIR}")
    print(f"回合数: {len(nums)}（{nums[0]}–{nums[-1]}），可比对 {len(per_turn)} 段")
    print(f"严格口径: 通过 {passed}/{total} = {rate:.1f}%")

    per_type = Counter()
    per_type_total = Counter()
    for r in per_turn:
        for c in r["checks"]:
            per_type_total[c["unit_type"]] += 1
            if c["passed"]:
                per_type[c["unit_type"]] += 1
    if per_type_total:
        print("按兵种:")
        for t, n in per_type_total.most_common():
            print(f"  {t:<20} {per_type[t]:>3}/{n:<3} = {100 * per_type[t] / n:5.1f}%")

    no_named = sum(1 for r in per_turn if not r["checks"])
    print(f"计划里没点任何兵种的回合: {no_named}/{len(per_turn)}")

    if args.json:
        Path(args.json).write_text(
            json.dumps({"rate": rate, "passed": passed, "total": total, "turns": per_turn},
                       ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"明细已写入 {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
