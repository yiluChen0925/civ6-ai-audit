# coding: utf-8
"""generate_action 的端到端回归测试。

★ 会真实调用模型，跑一遍要花十几秒，不适合放进 CI。
"""

from planner import generate_action

# (任务, 期望是否生成成功)
CASES = [
    ("第 45 回合前把城市 3 改成造纪念碑", True),
    ("让城市 3 造点有用的东西", False),
    ("研究铁器", True),
    ("把城市三的生产改成纪念碑", True),
    ("买一个勇士", False),
]


if __name__ == "__main__":
    passed = 0
    for task, expect_ok in CASES:
        action, err, attempts = generate_action(task, 39)
        ok = action is not None
        if ok == expect_ok:
            passed += 1

        print(f"{'✓' if ok == expect_ok else '✗'} [{attempts} 次] {task}")
        if err:
            print(f"     {err}")

    print(f"\n{passed}/{len(CASES)} 符合预期")
