# coding: utf-8
"""从 102 个游戏快照里提取"真实出现过的 ID"，生成白名单。"""

import glob
import json
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP_DIR = os.path.join(BASE_DIR, "data", "collected")
ITEM_PREFIXES = ("UNIT_", "BUILDING_", "DISTRICT_", "PROJECT_", "IMPROVEMENT_")
TECH_PREFIXES = ("TECH_",)
CIVIC_PREFIXES = ("CIVIC_",)


def clean(values, prefixes):
    """只保留以合法前缀开头的值（自动滤掉 NONE / UNKNOWN / 空串）。"""
    return sorted(v for v in values if v and v.startswith(prefixes))

def collect():
    items, techs, civics = set(), set(), set()

    for path in glob.glob(os.path.join(SNAP_DIR, "*.json")):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)

        for p in data.get("players", []):
            techs.update(p.get("techs", []))
            if p.get("current_research"):
                techs.add(p["current_research"])
            civics.update(p.get("civics", []))
            if p.get("current_civic"):
                civics.add(p["current_civic"])

        for c in data.get("cities", []):
            if c.get("producing"):
                items.add(c["producing"])

        for u in data.get("units", []):
            if u.get("type"):
                items.add(u["type"])

    return items, techs, civics


if __name__ == "__main__":
    items, techs, civics = collect()

    vocab = {
        "items":  clean(items,  ITEM_PREFIXES),
        "techs":  clean(techs,  TECH_PREFIXES),
        "civics": clean(civics, CIVIC_PREFIXES),
        "source": f"{len(glob.glob(os.path.join(SNAP_DIR, '*.json')))} snapshots",
    }

    out = os.path.join(BASE_DIR, "codegen", "vocab.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(vocab, f, ensure_ascii=False, indent=2)

    print(f"写入 {out}")
    print(f"items {len(vocab['items'])} / techs {len(vocab['techs'])} / civics {len(vocab['civics'])}")