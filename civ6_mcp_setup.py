# -*- coding: utf-8 -*-
"""
civ6_mcp_setup.py -- 为 Civ6 MCP 生成/修正 MCP 配置

由 civ6claude.bat 调用。关键行为：

  ★ 不新增重复条目。如果 Cline 里已经有指向本项目的 Civ6 server
    （无论叫什么名字），就在原条目上**修正**，而不是再塞一个。

  ★ 保留你的自定义项（例如 timeout）。

  ★ 启动方式用 `uv run --directory <项目绝对路径> civ-mcp`
    —— 即 pyproject.toml 里声明的 console script，也是项目 README 的写法。
    好处：uv 会读取该项目的 requires-python(>=3.12)，自动准备正确的解释器，
    不需要依赖 Cline 的 cwd（cwd 写错是这类配置最常见的失效原因）。

用法:
    python civ6_mcp_setup.py --project "D:\\...\\civ6-mcp" [--disable-lua]
                             [--server-name civ6-mcp] [--dry-run]
"""

import argparse
import json
import os
import sys
from pathlib import Path

DEFAULT_SERVER_NAME = "civ6-mcp"


def norm(p) -> str:
    """路径比较用：统一小写、统一反斜杠、去掉尾部斜杠。"""
    return str(p).replace("/", "\\").rstrip("\\").lower()


def build_entry(project: Path, disable_lua: bool) -> dict:
    entry = {
        "command": "uv",
        "args": ["run", "--directory", str(project), "civ-mcp"],
        "disabled": False,
        "autoApprove": [],
    }
    if disable_lua:
        entry["env"] = {"CIV_MCP_DISABLE_LUA": "1"}
    return entry


def points_at_project(entry: dict, project: Path) -> bool:
    """判断一个已存在的 server 条目是不是指向本项目。"""
    if not isinstance(entry, dict):
        return False
    target = norm(project)
    blob = " ".join(
        [str(entry.get("command", ""))]
        + [str(a) for a in entry.get("args", []) or []]
        + [str(entry.get("cwd", ""))]
    )
    return target in norm(blob) or "civ6-mcp" in norm(blob)


def cline_settings_paths():
    appdata = os.environ.get("APPDATA", "")
    if not appdata:
        return []
    base = Path(appdata)
    rel = Path("User") / "globalStorage" / "saoudrizwan.claude-dev" / "settings" / "cline_mcp_settings.json"
    return [
        base / "Code" / rel,
        base / "Code - Insiders" / rel,
        base / "VSCodium" / rel,
    ]


def update_cline(entry: dict, project: Path, server_name: str, dry_run: bool):
    paths = cline_settings_paths()
    existing = [p for p in paths if p.exists()]
    if not existing:
        return "notfound", paths[0] if paths else None, None, None

    target = existing[0]
    try:
        text = target.read_text(encoding="utf-8").strip()
        data = json.loads(text) if text else {}
    except Exception as e:
        return "parse_error:%s" % e, target, None, None

    servers = data.setdefault("mcpServers", {})

    # 优先复用"已存在且指向本项目"的条目，保留其自定义字段
    key = None
    for k, v in servers.items():
        if points_at_project(v, project):
            key = k
            break
    if key is None:
        key = server_name

    old = servers.get(key, {})
    merged = dict(old) if isinstance(old, dict) else {}
    merged.update(entry)                 # 覆盖 command/args/disabled/autoApprove
    merged.pop("cwd", None)              # ★ 移除危险的 cwd（路径写错就会启动失败）
    merged.setdefault("timeout", 300)    # 保留/补上超时

    servers[key] = merged

    if not dry_run:
        target.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return ("updated" if old else "added"), target, key, merged


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="civ6-mcp 的绝对路径")
    ap.add_argument("--disable-lua", action="store_true")
    ap.add_argument("--server-name", default=DEFAULT_SERVER_NAME)
    ap.add_argument("--dry-run", action="store_true", help="只打印将要写入的内容，不改文件")
    args = ap.parse_args()

    project = Path(args.project).resolve()
    if not (project / "pyproject.toml").exists():
        print("       [X] 不是有效的 civ6-mcp 目录: %s" % project)
        return 1

    entry = build_entry(project, args.disable_lua)

    # ---- 1) 项目内 .mcp.json（Claude Code）----
    mcp_json = project / ".mcp.json"
    data = {"mcpServers": {args.server_name: {k: v for k, v in entry.items()
                                              if k in ("command", "args")}}}
    if args.disable_lua:
        data["mcpServers"][args.server_name]["env"] = entry["env"]
    if not args.dry_run:
        mcp_json.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("       [OK] %s .mcp.json" % ("将写入" if args.dry_run else "已写入"))

    # ---- 2) Cline 设置 ----
    status, target, key, merged = update_cline(entry, project, args.server_name, args.dry_run)

    if status in ("updated", "added"):
        verb = "修正" if status == "updated" else "新增"
        print("       [OK] Cline 配置已%s条目 \"%s\"" % (verb, key))
        print("            文件: %s" % target)
        if status == "updated":
            print("            （原条目里的 cwd 已移除 —— 它指向的路径不存在，会导致启动失败）")
    elif status == "notfound":
        print("       [!] 没找到 Cline 的 globalStorage，跳过自动写入。")
        print("           请在 Cline -> MCP Servers -> Configure 里手动加：")
        print("           " + json.dumps({"mcpServers": {args.server_name: entry}}, ensure_ascii=False))
    else:
        print("       [!] 读取 Cline 配置失败（%s）——原文件未改动。" % status)
        print("           请手动加：")
        print("           " + json.dumps({"mcpServers": {args.server_name: entry}}, ensure_ascii=False))
        return 1

    if args.dry_run:
        print("\n---- dry-run：将写入 Cline 的【完整条目】（保留你的 timeout 等自定义字段）----")
        print(json.dumps({key: merged}, indent=2, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    sys.exit(main())
