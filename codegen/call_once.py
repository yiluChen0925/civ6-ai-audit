import json
import os
import urllib.error
import urllib.request

from prompts import PLANNER_SYSTEM, PLANNER_USER


def load_env(path: str = ".env") -> None:
    """极简 .env 读取：每行 KEY=VALUE，跳过空行和注释。"""
    if not os.path.exists(path):
        print("没找到", path)
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def call_model(messages):
    """调一次 DeepSeek，返回原始字符串；失败返回 None。"""
    api_key = os.getenv("DEEPSEEK_API_KEY")

    if not api_key:
        # 没读到再找 .env，避免依赖 import 顺序
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
        load_env(env_path)
        api_key = os.getenv("DEEPSEEK_API_KEY")

    if not api_key:
        print("没读到 DEEPSEEK_API_KEY（环境变量和 .env 都没有）")
        return None

    payload = {
        "model": "deepseek-chat",
        "messages": messages,
        "response_format": {"type": "json_object"},
        "temperature": 0,
    }

    req = urllib.request.Request(
        "https://api.deepseek.com/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return body["choices"][0]["message"]["content"]
    except urllib.error.HTTPError as e:
        # urlopen 遇 4xx/5xx 是抛异常，错误正文要从 e 里读
        print("HTTP", e.code)
        print(e.read().decode("utf-8", errors="replace")[:800])
        return None
    except Exception as e:
        print("请求失败:", type(e).__name__, e)
        return None


def call_once(task, current_turn):
    """单轮问答，保留给一次性调试用。"""
    messages = [
        {"role": "system", "content": PLANNER_SYSTEM},
        {"role": "user", "content": PLANNER_USER.format(current_turn=current_turn, task=task)},
    ]
    return call_model(messages)
