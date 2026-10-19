"""宽松口径：7 项通用游戏进展检查（前端 app.js 里 calculateScore 的同一套口径）。

这 7 项跟模型写的计划文本没有直接关系，本质是在测「这一回合有没有动静」：
    单位移动 / 单位战斗 / 城市生产 / 人口增长 / 科技推进 / 文化推进 / 金币增长

两处已知偏差，这里刻意保持和前端一致，不要"顺手修正"，否则数字会和界面分叉：
    1. 城市相关检查只看 pid=0 的第一座城（实测 78/102 回合玩家有多座城）；
    2. 「金币增长」几乎恒真（因为每回合金币收入为正），去掉它平均分会明显下降。

用法：
    python analysis/compare_loose.py
    python analysis/compare_loose.py --json out.json

数据目录默认 ./data/collected，可用环境变量 CIV6_DATA_DIR 覆盖。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DATA_DIR = Path(os.environ.get("CIV6_DATA_DIR", Path("data") / "collected"))

CHECKS = ["单位移动", "单位战斗", "城市生产", "人口增长", "科技推进", "文化推进", "金币增长"]


def load_all_turns() -> dict[int, dict]:
    turns = {}
    for f in sorted(DATA_DIR.glob("turn_*.json")):
        with open(f, encoding="utf-8") as fp:
            data = json.load(fp)
        turns[data["turn"]] = data
    return turns


def _mine(seq, pid=0):
    return next((x for x in seq or [] if x.get("pid") == pid), None)


def score_turn(turn: dict, next_turn: dict) -> dict[str, bool]:
    result: dict[str, bool] = {}

    units_now = turn.get("units") or []
    after = {u["id"]: u for u in next_turn.get("units") or []}
    moved = fought = False
    for u in units_now:
        n = after.get(u["id"])
        if n is None:
            continue
        if (u["x"], u["y"]) != (n["x"], n["y"]):
            moved = True
        if u["damage"] != n["damage"]:
            fought = True
    if units_now:
        result["单位移动"] = moved
        result["单位战斗"] = fought

    city_now, city_next = _mine(turn.get("cities")), _mine(next_turn.get("cities"))
    if city_now and city_next:
        result["城市生产"] = city_now.get("producing") != city_next.get("producing")
        result["人口增长"] = (city_next.get("pop") or 0) > (city_now.get("pop") or 0)

    me_now, me_next = _mine(turn.get("players")), _mine(next_turn.get("players"))
    if me_now and me_next:
        result["科技推进"] = (me_next.get("techs_completed") or 0) > (me_now.get("techs_completed") or 0)
        result["文化推进"] = (me_next.get("civics_completed") or 0) > (me_now.get("civics_completed") or 0)
        result["金币增长"] = (me_next.get("gold") or 0) > (me_now.get("gold") or 0)

    return result


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
        per_turn.append({"turn": a, "checks": score_turn(turns[a], turns[b])})

    total = sum(len(r["checks"]) for r in per_turn)
    passed = sum(1 for r in per_turn for v in r["checks"].values() if v)
    rate = 100 * passed / total if total else 0.0

    print(f"数据目录: {DATA_DIR}")
    print(f"回合数: {len(nums)}（{nums[0]}–{nums[-1]}），可比对 {len(per_turn)} 段")
    print(f"宽松口径: 通过 {passed}/{total} = {rate:.1f}%")

    print("逐项通过率:")
    for name in CHECKS:
        n = sum(1 for r in per_turn if name in r["checks"])
        p = sum(1 for r in per_turn if r["checks"].get(name))
        if n:
            print(f"  {name:<8} {p:>3}/{n:<3} = {100 * p / n:5.1f}%")

    no_gold_total = total - sum(1 for r in per_turn if "金币增长" in r["checks"])
    no_gold_pass = passed - sum(1 for r in per_turn if r["checks"].get("金币增长"))
    if no_gold_total:
        print(f"去掉「金币增长」后: 通过 {no_gold_pass}/{no_gold_total} = "
              f"{100 * no_gold_pass / no_gold_total:.1f}%")

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
