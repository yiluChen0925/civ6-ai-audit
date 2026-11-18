# coding: utf-8
"""动作的结构定义、分层校验，以及带重试的生成入口。

这个模块只负责"把模型想做什么约束成可校验的形式"，不直接碰游戏。
"""

import json
import os
from typing import TypedDict

from call_once import call_model
from prompts import PLANNER_SYSTEM, PLANNER_USER

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOCAB_PATH = os.path.join(BASE_DIR, "codegen", "vocab.json")


def load_vocab():
    """从 vocab.json 读白名单（由 build_vocab.py 从 102 个快照提取）。

    读不到直接报错，不做静默兜底：白名单变空会让校验大面积误拒，比崩溃更难查。
    """
    try:
        with open(VOCAB_PATH, encoding="utf-8") as f:
            v = json.load(f)
    except FileNotFoundError:
        raise RuntimeError(
            f"没找到 {VOCAB_PATH}\n"
            f"请先运行：python build_vocab.py"
        )

    return set(v["items"]), set(v["techs"]), set(v["civics"])


ITEM_WHITELIST, TECH_WHITELIST, CIVIC_WHITELIST = load_vocab()


class PlannedAction(TypedDict):
    """模型生成的一个动作。

    raw_text 保留自然语言原话，便于事后对照"它想做什么"和"它实际填了什么"。
    """
    action: str
    target: str | None
    args: dict
    deadline_turn: int | None
    raw_text: str


ACTIONS = {
    "set_city_production": {"args": {"city_id": int, "item_name": str}, "needs_target": True},
    "purchase_item":       {"args": {"city_id": int, "item_name": str}, "needs_target": True},
    "set_research":        {"args": {"tech_or_civic": str, "category": str}, "needs_target": False},
}


def validate_action(raw: dict, current_turn: int) -> tuple[bool, str | None]:
    """校验模型产出的动作。

    返回 (ok, err)。错误字符串是给模型看的，要能指出"哪里不对、怎么改"，
    因为调用方会把它原样回喂进下一轮对话。
    """
    try:
        missing = [k for k in ("action", "target", "args", "deadline_turn", "raw_text") if k not in raw]
        if missing:
            return False, f"缺少顶层字段 {missing}，请补全（target / deadline_turn 可为 null）"

        now_action = raw["action"]
        now_args = raw["args"]

        if not isinstance(now_args, dict):
            return False, f"args 必须是对象（dict），不是 {type(now_args).__name__}"
        if now_action not in ACTIONS:
            return False, f"action 不合法，可选：{sorted(ACTIONS)}"

        expected_map = ACTIONS[now_action]["args"]
        required = [k for k in expected_map if k not in now_args]
        extra = [k for k in now_args if k not in expected_map]
        if required or extra:
            return False, f"请添加 {required}，删除 {extra}"

        # 模型明确说"不知道"的字段单独处理：这是缺信息，不是答错
        unknown_fields = [k for k, v in now_args.items() if v is None]
        if ACTIONS[now_action]["needs_target"] and raw["target"] is None:
            unknown_fields.append("target")
        if unknown_fields:
            return False, f"MISSING_INFO: 不确定 {unknown_fields}，需要向用户澄清"

        for k, v in now_args.items():
            expected_type = expected_map[k]
            if isinstance(v, bool) or not isinstance(v, expected_type):
                return False, f"参数 {k} 类型不对：期望 {expected_type.__name__}，实际 {type(v).__name__}"

        if now_action == "set_research":
            pool = TECH_WHITELIST if now_args.get("category") == "tech" else CIVIC_WHITELIST
            if now_args["tech_or_civic"] not in pool:
                return False, f"tech_or_civic 不在合法值里，可选：{sorted(pool)}；或填 null 表示不确定"
        else:
            if now_args["item_name"] not in ITEM_WHITELIST:
                return False, f"item_name 不在合法值里，可选：{sorted(ITEM_WHITELIST)}；或填 null 表示不确定"

        # 不针对具体对象的动作不该有 target；先查语义，再查格式
        if not ACTIONS[now_action]["needs_target"] and raw["target"] is not None:
            return False, f"{now_action} 的 target 必须是 null（不针对具体对象）"

        if raw["target"] is not None:
            if not isinstance(raw["target"], str):
                return False, f'target 应该是字符串（如 "3"），不是 {type(raw["target"]).__name__}'
            if not raw["target"].isdigit():
                return False, f'target 应该是纯数字（如 "3"），不是 {raw["target"]!r}'

        deadline_turn = raw["deadline_turn"]
        if deadline_turn is not None:
            if not isinstance(deadline_turn, int) or isinstance(deadline_turn, bool):
                return False, "deadline_turn 类型不合法，应该是 int 类型"
            if deadline_turn <= current_turn or deadline_turn > current_turn + 20:
                return False, f"期限 {deadline_turn} 不在合理范围内，当前 {current_turn}，最多 +20"

        if not isinstance(raw.get("raw_text"), str) or not raw["raw_text"].strip():
            return False, "raw_text 必须是非空字符串"

        return True, None

    except (KeyError, TypeError) as e:
        return False, f"输入不合法: {e}"


def generate_action(task, current_turn, max_retries=3):
    """调模型生成动作，校验不过就把错误回喂重试。

    返回 (action | None, err | None, attempts)。
    缺信息（MISSING_INFO）不重试：那不是模型答错，是该回去问用户。
    """
    messages = [
        {"role": "system", "content": PLANNER_SYSTEM},
        {"role": "user", "content": PLANNER_USER.format(current_turn=current_turn, task=task)},
    ]

    err = None
    for attempt in range(1, max_retries + 1):
        raw = call_model(messages)
        if raw is None:
            return None, "调用模型失败", attempt

        try:
            action = json.loads(raw)
        except json.JSONDecodeError as e:
            err = f"不是合法 JSON: {e}"
        else:
            ok, err = validate_action(action, current_turn)
            if ok:
                return action, None, attempt
            if err.startswith("MISSING_INFO"):
                return None, err, attempt

        print(f"  [attempt {attempt}] 失败: {err}")
        messages.append({"role": "assistant", "content": raw})
        messages.append({
            "role": "user",
            "content": f"上面这个输出不符合要求：{err}。请只输出修正后的 JSON。"
        })

    return None, f"{max_retries} 次均未通过校验（最后一次：{err}）", max_retries


if __name__ == "__main__":
    print("校验逻辑的测试见 test_planner.py：")
    print("  pytest test_planner.py -v")
