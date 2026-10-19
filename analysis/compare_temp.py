"""
对比 AI 的承诺和下一回合的事实

用法：在项目根目录执行 python analysis/compare_temp.py
数据目录默认取 ./data/collected，可用环境变量 CIV6_DATA_DIR 覆盖。
"""

import json
import os
import sys
from pathlib import Path

# Windows 控制台默认 GBK，直接 print 表情符号会 UnicodeEncodeError，先兜住
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DATA_DIR = Path(os.environ.get("CIV6_DATA_DIR", Path("data") / "collected"))


def load_all_turns():
    """加载所有回合数据，返回 {回合号: 数据}"""
    turns = {}
    for f in sorted(DATA_DIR.glob("turn_*.json")):
        turn_num = int(f.stem.split("_")[1])
        with open(f, encoding="utf-8") as fp:
            turns[turn_num] = json.load(fp)
    return turns


def extract_units(turn_data):
    """把 units 列表转成 {unit_id: unit} 的字典，方便查找"""
    return {u["id"]: u for u in turn_data.get("units", [])}


def compare_turn(turn_num, current, next_turn):
    """对比当前回合的承诺和下一回合的事实"""

    print(f"\n{'='*60}")
    print(f"=== 回合 {turn_num} ===")
    print(f"{'='*60}")

    # 打印 AI 的承诺
    print(f"\n📝 AI 计划：{current['reflections']['planning']}")
    print(f"🔮 AI 预测：{current['reflections']['hypothesis']}")

    # 对比单位变化
    units_now = extract_units(current)
    units_next = extract_units(next_turn)

    print(f"\n⚔️  单位变化：")
    for uid, u_now in units_now.items():
        if uid in units_next:
            u_next = units_next[uid]
            pos_changed = (u_now["x"], u_now["y"]) != (u_next["x"], u_next["y"])
            dmg_changed = u_now["damage"] != u_next["damage"]

            status = []
            if pos_changed:
                status.append(f"位置 ({u_now['x']},{u_now['y']}) → ({u_next['x']},{u_next['y']})")
            if dmg_changed:
                status.append(f"损伤 {u_now['damage']} → {u_next['damage']}")

            if status:
                print(f"  ✅ {u_now['type']} (id={uid}): {', '.join(status)}")
            else:
                print(f"  ⚪ {u_now['type']} (id={uid}): 无变化")
        else:
            print(f"  ❌ {u_now['type']} (id={uid}): 消失了（可能阵亡或升级）")

    # 对比城市生产
    city_now = next((c for c in current["cities"] if c["pid"] == 0), None)
    city_next = next((c for c in next_turn["cities"] if c["pid"] == 0), None)

    print(f"\n🏙️  城市生产：")
    if city_now and city_next:
        if city_now["producing"] != city_next["producing"]:
            print(f"  ✅ {city_now['producing']} → {city_next['producing']}（完工了！）")
        else:
            print(f"  ⚪ 仍在生产 {city_now['producing']}（未完工）")


def main():
    turns = load_all_turns()
    print(f"加载了 {len(turns)} 个回合：{sorted(turns.keys())}")

    turn_nums = sorted(turns.keys())
    for i in range(len(turn_nums) - 1):
        current = turns[turn_nums[i]]
        next_turn = turns[turn_nums[i + 1]]
        compare_turn(turn_nums[i], current, next_turn)


if __name__ == "__main__":
    main()