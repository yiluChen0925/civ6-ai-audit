# coding: utf-8
"""trace.py 的单元测试（纯逻辑，不需要网络、不需要模型）。"""

import pytest

from trace import classify, is_silent_failure, make_trace, run_with_trace


#  ① 五类结局

class TestClassify:
    def test_success(self):
        t = {"ok": True, "readback_value": "VALID"}
        assert classify(t, "VALID") == "SUCCESS"

    def test_missing_info(self):
        t = {"ok": True, "readback_value": "MISSING_INFO: 不确定 ['item_name']"}
        assert classify(t, "VALID") == "MISSING_INFO"

    def test_silent_failure(self):
        t = {"ok": True, "readback_value": "BUILDING_GRANARY"}
        assert classify(t, "UNIT_WARRIOR") == "SILENT_FAILURE"

    def test_explicit_failure(self):
        t = {"ok": False, "readback_value": None}
        assert classify(t, "VALID") == "EXPLICIT_FAILURE"

    def test_unknown(self):
        t = {"ok": True, "readback_value": None}
        assert classify(t, "VALID") == "UNKNOWN"


#  ② 布尔判定的四类

class TestIsSilentFailure:
    def test_true_success(self):
        t = {"ok": True, "readback_value": "A"}
        assert is_silent_failure(t, "A") is False

    def test_silent_failure(self):
        t = {"ok": True, "readback_value": "B"}
        assert is_silent_failure(t, "A") is True

    def test_explicit_failure(self):
        t = {"ok": False, "readback_value": None}
        assert is_silent_failure(t, "A") is False

    def test_no_readback(self):
        t = {"ok": True, "readback_value": None}
        assert is_silent_failure(t, "A") is False


# ③ run_with_trace 的三个路径

def fake_executor(**kw):
    return {"ok": True}

def fake_reader(result, **kw):
    return "WRONG"

def boom_executor(**kw):
    raise RuntimeError("游戏连不上")

def boom_reader(result, **kw):
    raise RuntimeError("回读超时")


class TestRunWithTrace:
    def test_normal_silent_failure(self):
        t = run_with_trace(39, "tool", {}, fake_executor, fake_reader, "EXPECTED")
        assert t["ok"] is True
        assert t["readback_value"] == "WRONG"
        assert t["outcome"] == "SILENT_FAILURE"

    def test_executor_raises(self):
        t = run_with_trace(39, "tool", {}, boom_executor, fake_reader, "EXPECTED")
        assert t["ok"] is False
        assert "执行异常" in t["error_msg"]
        assert t["outcome"] == "EXPLICIT_FAILURE"

    def test_reader_raises(self):
        t = run_with_trace(39, "tool", {}, fake_executor, boom_reader, "EXPECTED")
        assert t["ok"] is True
        assert t["readback_value"] is None
        assert "回读异常" in t["error_msg"]
        assert t["outcome"] == "UNKNOWN"

    def test_executor_raises_has_outcome(self):
        """回归测试：执行抛异常时 outcome 必须有值（曾经是 None）。"""
        t = run_with_trace(39, "tool", {}, boom_executor, fake_reader, "EXPECTED")
        assert t["outcome"] is not None, "outcome 不能是 None —— 否则这条失败记录会被统计漏掉"