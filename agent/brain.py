"""The Data Agent's brain: a chat model on GitHub Models, reached with the repository's own GITHUB_TOKEN.

Inside GitHub Actions the workflow grants `models: read`, so no key is stored anywhere and nothing is paid. The free
tier has small per-request limits (about 8,000 tokens in, 4,000 out on most models) and a daily request allowance, so
the loop below keeps its history short and stops after a few steps.

The model is chosen from GitHub's live catalog: the first of PREFERRED that is listed and can call tools, else any
listed model that can. Set the repository variable AGENT_MODEL to force one. AGENT_API_URL points the client at another
OpenAI-compatible server (the test uses a stand-in).
"""
import json, os, sys, time, urllib.error, urllib.request

API = os.environ.get("AGENT_API_URL", "https://models.github.ai").rstrip("/")
PREFERRED = ["openai/gpt-4.1-mini", "openai/gpt-4o-mini", "openai/gpt-4.1", "openai/gpt-4o", "mistral-ai/mistral-medium-2505",
             "meta/llama-4-maverick-17b-128e-instruct-fp8"]


class Unavailable(Exception):
    """No model could be reached: no token, no allowance left, or the service is down."""


HEADERS = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "open-data-company-agent"}


def _read(req, timeout):
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            import gzip
            raw = gzip.decompress(raw)
        try:
            return json.loads(raw.decode("utf-8-sig"))
        except ValueError:
            raise ValueError(f"not JSON: HTTP {r.status}, {r.headers.get('Content-Type')}, {len(raw)} bytes, starts {raw[:160]!r}") from None


def _post(path, body, token, timeout=90):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), method="POST",
                                 headers={**HEADERS, "Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return _read(req, timeout)


def models(token):
    forced = os.environ.get("AGENT_MODEL", "").strip()
    if forced:
        return [forced]
    try:
        cat = _read(urllib.request.Request(API + "/catalog/models", headers={**HEADERS, "Authorization": f"Bearer {token}"}), 30)
        able = [m["id"] for m in cat if "tool-calling" in (m.get("capabilities") or [])]
    except Exception as ex:  # noqa: BLE001 - without the catalog, fall back to the usual names
        print("catalog error:", ex, file=sys.stderr)
        return PREFERRED[:3]
    first = [m for m in PREFERRED if m in able]
    low = [m for m in able if m not in first and any(k in m for k in ("mini", "small", "nano", "flash"))]
    return (first + low)[:4] or able[:3] or PREFERRED[:3]


def compact(messages, budget=16000):
    """Shrink the oldest tool results until the conversation fits the free tier's input limit (≈4 characters a token)."""
    size = lambda: sum(len(m.get("content") or "") + len(json.dumps(m.get("tool_calls") or "")) for m in messages)
    for m in messages[2:]:
        if size() <= budget:
            break
        if m["role"] == "tool" and len(m["content"]) > 300:
            m["content"] = m["content"][:300] + '…"(shortened to save space)"'


def run(system, task, tools_spec, call_tool, max_steps=7, log=print):
    """The agent loop. Returns (answer_text, model_used, trace) where trace lists each tool call."""
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_MODELS_TOKEN")
    if not token:
        raise Unavailable("No GITHUB_TOKEN in the environment.")
    candidates = models(token)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": task}]
    trace, model, last_err = [], None, None
    for step in range(max_steps):
        compact(messages)
        final = step == max_steps - 1
        body = {"messages": messages, "temperature": 0.2, "max_tokens": 1500}
        if not final:
            body["tools"] = tools_spec
        else:
            messages.append({"role": "user", "content": "Write the final answer now from what the tools returned. No more tool calls."})
        res = None
        for m in ([model] if model else candidates):
            for attempt in range(2):
                try:
                    res = _post("/inference/chat/completions", {**body, "model": m}, token)
                    model = m
                    break
                except urllib.error.HTTPError as ex:
                    last_err = f"{m}: HTTP {ex.code} {ex.read()[:200].decode(errors='replace')}"
                    log("model error:", last_err)
                    if ex.code == 429 and attempt == 0:
                        time.sleep(min(int(ex.headers.get("Retry-After") or 10), 30))
                        continue
                    break
                except Exception as ex:  # noqa: BLE001
                    last_err = f"{m}: {ex}"
                    log("model error:", last_err)
                    break
            if res:
                break
        if not res:
            raise Unavailable(last_err or "no model answered")
        msg = res["choices"][0]["message"]
        calls = msg.get("tool_calls") or []
        messages.append({"role": "assistant", "content": msg.get("content") or "", **({"tool_calls": calls} if calls else {})})
        if not calls:
            return (msg.get("content") or "").strip(), model, trace
        for c in calls:
            name = c["function"]["name"]
            try:
                args = json.loads(c["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            out = call_tool(name, args)
            trace.append({"tool": name, "args": args})
            log(f"tool {name}({json.dumps(args, ensure_ascii=False)[:160]}) -> {len(out)} chars")
            messages.append({"role": "tool", "tool_call_id": c["id"], "content": out})
    return "", model, trace
