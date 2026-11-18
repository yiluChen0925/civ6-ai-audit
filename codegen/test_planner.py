# coding: utf-8
"""planner.validate_action 的单元测试（纯逻辑，不需要网络）。"""

import pytest

from planner import validate_action, ACTIONS


def base(**over):
    """构造一个合法的 action，按需覆盖字段。"""
    d = {
        "action": "set_city_production",
        "target": "3",
        "args": {"city_id": 3, "item_name": "BUILDING_MONUMENT"},
        "deadline_turn": 45,
        "raw_text": "第 45 回合造纪念碑",
    }
    d.update(over)
    return d


class TestValid:
    def test_normal(self):
        ok, err = validate_action(base(), 39)
        assert ok is True and err is None

    def test_deadline_none(self):
        assert validate_action(base(deadline_turn=None), 39)[0] is True

    def test_research_valid(self):
        d = base(action="set_research", target=None,
                 args={"tech_or_civic": "TECH_IRON_WORKING", "category": "tech"})
        assert validate_action(d, 39)[0] is True


class TestInvalid:
    def test_missing_top_field(self):
        raw = base()
        del raw["raw_text"]
        ok, err = validate_action(raw, 39)
        assert not ok and "缺少顶层字段" in err

    def test_action_not_in_whitelist(self):
        ok, err = validate_action(base(action="造个骑兵"), 39)
        assert not ok and "action 不合法" in err

    def test_args_not_dict(self):
        ok, err = validate_action(base(args="city_id=3"), 39)
        assert not ok and "args 必须是对象" in err

    def test_missing_arg(self):
        ok, err = validate_action(base(args={}), 39)
        assert not ok and "请添加" in err

    def test_extra_arg(self):
        ok, err = validate_action(base(args={"city_id": 3, "item_name": "BUILDING_MONUMENT", "reason": "x"}), 39)
        assert not ok and "删除" in err

    def test_bool_as_int(self):
        ok, err = validate_action(base(args={"city_id": False, "item_name": "BUILDING_MONUMENT"}), 39)
        assert not ok and "类型不对" in err

    def test_target_not_digit(self):
        ok, err = validate_action(base(target="city_3"), 39)
        assert not ok and "纯数字" in err

    def test_target_is_int(self):
        ok, err = validate_action(base(target=3), 39)
        assert not ok and "应该是字符串" in err

    def test_research_with_target(self):
        d = base(action="set_research", target="铁器",
                 args={"tech_or_civic": "TECH_IRON_WORKING", "category": "tech"})
        ok, err = validate_action(d, 39)
        assert not ok and "target 必须是 null" in err


class TestMissingInfo:
    def test_item_name_none(self):
        ok, err = validate_action(base(args={"city_id": 3, "item_name": None}), 39)
        assert not ok and err.startswith("MISSING_INFO")

    def test_city_id_none(self):
        ok, err = validate_action(base(args={"city_id": None, "item_name": "BUILDING_MONUMENT"}), 39)
        assert not ok and err.startswith("MISSING_INFO")

    def test_target_none_when_needed(self):
        ok, err = validate_action(base(target=None), 39)
        assert not ok and err.startswith("MISSING_INFO")


class TestDeadline:
    def test_too_early(self):
        ok, err = validate_action(base(deadline_turn=39), 39)
        assert not ok and "不在合理范围" in err

    def test_too_late(self):
        ok, err = validate_action(base(deadline_turn=60), 39)
        assert not ok and "不在合理范围" in err

    def test_bool(self):
        ok, err = validate_action(base(deadline_turn=True), 39)
        assert not ok and "类型不合法" in err


class TestWhitelist:
    def test_item_not_in_whitelist(self):
        ok, err = validate_action(base(args={"city_id": 3, "item_name": "X"}), 39)
        assert not ok and "不在合法值里" in err

    def test_tech_not_in_whitelist(self):
        d = base(action="set_research", target=None,
                 args={"tech_or_civic": "TECH_NOT_REAL", "category": "tech"})
        ok, err = validate_action(d, 39)
        assert not ok and "不在合法值里" in err