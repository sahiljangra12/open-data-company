"""The Data Agent's brain: an open language model that runs on the same machine as the agent.

In GitHub Actions, agent/start_model.sh downloads Ollama and an open model (Qwen3 4B by default, Apache 2.0) and
starts it on 127.0.0.1:11434. This file talks to it with the OpenAI chat-completions protocol, tools included.
No key, no outside AI service, no cost: the model is a file and the runner does the thinking.

Because the protocol is the common one, the same code can use any other server that speaks it:
    AGENT_API_URL    base address, default http://127.0.0.1:11434/v1
    AGENT_API_KEY    sent as a bearer token when set (a local server needs none)
    AGENT_MODEL      model name passed in the request and shown under answers, default qwen3:4b

A small model on a CPU is slow and has a short memory, so the loop keeps its history compact and stops after a few steps.
"""
import json, os, re, time, urllib.error, urllib.request

API = (os.environ.get("AGENT_API_URL") or "http://127.0.0.1:11434/v1").rstrip("/")
MODEL = os.environ.get("AGENT_MODEL") or "qwen3:4b"
LOCAL = "127.0.0.1" in API or "localhost" in API


class Unavailable(Exception):
    """The model could not be reached or gave nothing usable."""


def _post(path, body, timeout=900):
    headers = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "open-data-company-agent"}
    if os.environ.get("AGENT_API_KEY"):
        headers["Authorization"] = "Bearer " + os.environ["AGENT_API_KEY"]
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        try:
            return json.loads(raw.decode("utf-8-sig"))
        except ValueError:
            raise ValueError(f"not JSON: HTTP {r.status}, {r.headers.get('Content-Type')}, starts {raw[:160]!r}") from None


def clean(text):
    """Drop a reasoning model's private notes, which some servers leave inside the reply."""
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S)
    return re.sub(r"^.*?</think>", "", text, flags=re.S).strip()


def compact(messages, budget=14000):
    """Shrink the oldest tool results until the conversation fits the model's memory (about 4 characters a token)."""
    size = lambda: sum(len(m.get("content") or "") + len(json.dumps(m.get("tool_calls") or "")) for m in messages)
    for m in messages[2:]:
        if size() <= budget:
            break
        if m["role"] == "tool" and len(m["content"]) > 300:
            m["content"] = m["content"][:300] + '…"(shortened to save space)"'


def run(system, task, tools_spec, call_tool, max_steps=6, log=print):
    """The agent loop. Returns (answer_text, model_used, trace) where trace lists each tool call."""
    messages = [{"role": "system", "content": system}, {"role": "user", "content": task}]
    trace, seen = [], set()
    for step in range(max_steps):
        compact(messages)
        final = step == max_steps - 1
        if final:
            messages.append({"role": "user", "content": "Write the final answer now from what the tools returned. No more tool calls."})
        t0 = time.time()
        body = {"model": MODEL, "messages": messages, "temperature": 0.2, "max_tokens": 900}
        if LOCAL:
            body["reasoning_effort"] = "none"                             # answer directly; thinking aloud is slow on a CPU
        if not final:
            body["tools"] = tools_spec
        try:
            try:
                res = _post("/chat/completions", body)
            except urllib.error.HTTPError as ex:
                if ex.code != 400 or "reasoning_effort" not in body:
                    raise
                log("server refused reasoning_effort, retrying without:", ex.read()[:200].decode(errors="replace"))
                body.pop("reasoning_effort")
                res = _post("/chat/completions", body)
        except urllib.error.HTTPError as ex:
            raise Unavailable(f"HTTP {ex.code} {ex.read()[:300].decode(errors='replace')}") from None
        except Exception as ex:  # noqa: BLE001
            raise Unavailable(str(ex)) from None
        msg = res["choices"][0]["message"]
        calls = msg.get("tool_calls") or []
        text = clean(msg.get("content"))
        messages.append({"role": "assistant", "content": text, **({"tool_calls": calls} if calls else {})})
        u = res.get("usage") or {}
        log(f"step {step + 1}: {len(calls)} tool call(s), {len(text)} chars of text, "
            f"{u.get('prompt_tokens')} tokens read, {u.get('completion_tokens')} written, {time.time() - t0:.0f} s")
        if not calls:
            return text, MODEL, trace
        for c in calls:
            name = c["function"]["name"]
            args = c["function"].get("arguments") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args or "{}")
                except json.JSONDecodeError:
                    args = {}
            key = name + json.dumps(args, sort_keys=True)
            out = call_tool(name, args) if key not in seen else json.dumps({"note": "You already made this exact call. Use the earlier result and write the answer."})
            seen.add(key)
            trace.append({"tool": name, "args": args})
            log(f"  tool {name}({json.dumps(args, ensure_ascii=False)[:160]}) -> {len(out)} chars")
            messages.append({"role": "tool", "tool_call_id": c.get("id") or f"call{len(trace)}", "content": out})
    return "", MODEL, trace
