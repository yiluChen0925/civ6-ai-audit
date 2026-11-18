# coding: utf-8
"""执行 trace：记录每次工具调用，并判断结果是不是"说成功但没生效"。

每次调用记三样东西：工具怎么说（ok）、真实回读值（readback）、花了多久。
结局分五类，因为"失败"和"假成功"处理方式完全不同。
"""

import json
import os
import sys
import time
from collections import Counter

from call_once import call_model
from planner import validate_action
from prompts import PLANNER_SYSTEM, PLANNER_USER

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACE_DIR = os.path.join(BASE_DIR, "codegen", "traces")


def trace_path(turn):
    """一回合一个文件。"""
    return os.path.join(TRACE_DIR, f"turn_{turn:03d}.jsonl")


def make_trace(turn, tool, args):
    return {
        "turn": turn, "tool": tool, "args": args,
        "ok": None, "readback_value": None,
        "silent_failure": False, "error_msg": None,
        "t_start": None,
        "t_end": None,
        "outcome": None,
    }


def is_silent_failure(trace, expected):
    """工具说成功，但回读到的状态和期望不一致。"""
    if not trace["ok"]:
        return False
    if trace["readback_value"] is None:
        return False
    if trace["readback_value"] == expected:
        return False
    return True


def classify(trace, expected):
    """把结局分成五类。布尔值分不出"缺信息"和"假成功"。"""
    if not trace["ok"]:
        return "EXPLICIT_FAILURE"

    rb = trace["readback_value"]
    if rb is None:
        return "UNKNOWN"
    if isinstance(rb, str) and rb.startswith("MISSING_INFO"):
        return "MISSING_INFO"
    if rb == expected:
        return "SUCCESS"
    return "SILENT_FAILURE"


def run_with_trace(turn, tool, args, executor, reader, expected):
    """包住一次调用：执行 → 回读 → 判定。

    executor(**args)         返回 {"ok": bool}
    reader(result, **args)   返回真实状态（回读要用到执行产物）
    """
    trace = make_trace(turn, tool, args)
    trace["t_start"] = time.perf_counter()

    try:
        result = executor(**args)
        trace["ok"] = result["ok"]
    except Exception as e:
        trace["ok"] = False
        trace["error_msg"] = f"执行异常: {type(e).__name__}: {e}"
        trace["t_end"] = time.perf_counter()
        trace["outcome"] = classify(trace, expected)
        return trace

    try:
        trace["readback_value"] = reader(result, **args)
    except Exception as e:
        # readback 保持 None，结局会是 UNKNOWN 而不是假成功
        trace["error_msg"] = f"回读异常: {type(e).__name__}: {e}"

    trace["t_end"] = time.perf_counter()
    trace["outcome"] = classify(trace, expected)
    trace["silent_failure"] = (trace["outcome"] == "SILENT_FAILURE")
    return trace


def save_traces(traces, path):
    """写 JSONL，一行一条。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for trace in traces:
            f.write(json.dumps(trace, ensure_ascii=False) + "\n")


def show_traces(path, only_failures=False):
    """打印 trace；only_failures=True 时只打印假成功那几条。"""
    with open(path, encoding="utf-8") as f:
        for line in f:
            trace = json.loads(line)
            if only_failures and trace.get("outcome") != "SILENT_FAILURE":
                continue
            print(f"[{trace.get('outcome')}] 回合{trace['turn']} {trace['tool']} "
                  f"readback={trace['readback_value']!r}")


def show_slow(path, top=5):
    """打印最慢的几条调用。"""
    with open(path, encoding="utf-8") as f:
        traces = [json.loads(line) for line in f]

    # 没跑完的记录没有耗时，排序前先排除
    traces = [t for t in traces
              if t.get("t_start") is not None and t.get("t_end") is not None]
    traces = sorted(traces, key=lambda t: t["t_end"] - t["t_start"], reverse=True)

    for trace in traces[:top]:
        cost_ms = (trace["t_end"] - trace["t_start"]) * 1000
        print(f"{cost_ms:8.3f} ms  {trace['tool']:22} ok={trace['ok']}")


# ===== 生成场景的 executor / reader（把 trace 用在"模型生成"上）=====

def make_gen_executor(task, current_turn):
    def _run(**kw):
        messages = [
            {"role": "system", "content": PLANNER_SYSTEM},
            {"role": "user", "content": PLANNER_USER.format(current_turn=current_turn, task=task)},
        ]
        raw = call_model(messages)
        return {"ok": raw is not None, "raw": raw}

    return _run


def make_gen_reader(current_turn):
    def _read(result, **kw):
        if not result or not result.get("raw"):
            return None
        try:
            action = json.loads(result["raw"])
        except json.JSONDecodeError as e:
            return f"NOT_JSON: {e}"
        ok, err = validate_action(action, current_turn)
        return "VALID" if ok else err

    return _read


# ===== 演示用的假函数 =====

def fake_executor(city_id, item_name):
    return {"ok": True}


def fake_reader(result, **args):
    return "BUILDING_GRANARY"


def main():
    if len(sys.argv) < 2:
        print("用法: python trace.py demo | gen | show <turn> | failures [turn] | slow <turn> [top]")
        return

    cmd = sys.argv[1]

    if cmd == "demo":
        traces = [
            run_with_trace(
                39, "set_city_production",
                {"city_id": 3, "item_name": "BUILDING_MONUMENT"},
                fake_executor,
                lambda result, **kw: "BUILDING_MONUMENT",
                "BUILDING_MONUMENT",
            ),
            run_with_trace(
                39, "purchase_item",
                {"city_id": 3, "item_name": "UNIT_WARRIOR"},
                fake_executor,
                fake_reader,
                "UNIT_WARRIOR",
            ),
        ]
        path = trace_path(39)
        save_traces(traces, path)
        print("已生成:", path)
        for t in traces:
            print(t)

    elif cmd == "gen":
        tasks = [
            "第 45 回合前把城市 3 改成造纪念碑",
            "让城市 3 造点有用的东西",
            "研究铁器",
            "把城市三的生产改成纪念碑",
            "买一个勇士",
        ]
        traces = []
        for task in tasks:
            trace = run_with_trace(
                39, "generate_action",
                {"task": task},
                make_gen_executor(task, 39),
                make_gen_reader(39),
                "VALID",
            )
            traces.append(trace)
            print(f"[{trace['outcome']}] {task}")
            print(f"     readback = {str(trace['readback_value'])[:80]}")

        out = os.path.join(TRACE_DIR, "gen_039.jsonl")
        save_traces(traces, out)
        print("\n已生成:", out)
        print("统计:", dict(Counter(t["outcome"] for t in traces)))

    elif cmd == "show":
        show_traces(trace_path(int(sys.argv[2])))

    elif cmd == "failures":
        turn = int(sys.argv[2]) if len(sys.argv) > 2 else 39
        show_traces(trace_path(turn), only_failures=True)

    elif cmd == "slow":
        turn = int(sys.argv[2])
        top = int(sys.argv[3]) if len(sys.argv) > 3 else 5
        show_slow(trace_path(turn), top)

    else:
        print(f"不认识的命令: {cmd}")
        print("用法: python trace.py demo | gen | show <turn> | failures [turn] | slow <turn> [top]")


if __name__ == "__main__":
    main()
