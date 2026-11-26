"""The Data Agent's brain: an open language model that runs on the same machine as the agent.

In GitHub Actions, agent/start_model.sh downloads Ollama and an open model (Qwen3 4B by default, Apache 2.0) and
starts it on 127.0.0.1:11434. This file talks to it with Ollama's chat protocol, tools included.
No key, no outside AI service, no cost: the model is a file and the runner does the thinking.

The same loop can also use any server that speaks the OpenAI chat-completions protocol:
    AGENT_API_URL    base address, default http://127.0.0.1:11434/v1
    AGENT_API_KEY    sent as a bearer token when set (a local server needs none)
    AGENT_MODEL      model name passed in the request and shown under answers, default qwen3:4b

A small model on a CPU is slow and has a short memory, so the loop keeps its history compact and stops after a few steps.
"""
import json, os, re, time, urllib.error, urllib.request

API = (os.environ.get("AGENT_API_URL") or "http://127.0.0.1:11434/v1").rstrip("/")
MODEL = os.environ.get("AGENT_MODEL") or "qwen3:4b"
OLLAMA = (os.environ.get("AGENT_API_STYLE") or ("ollama" if ":11434" in API else "openai")) == "ollama"


class Unavailable(Exception):
    """The model could not be reached or gave nothing usable."""


def _post(path, body, timeout=900, base=None):
    headers = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "open-data-company-agent"}
    if os.environ.get("AGENT_API_KEY"):
        headers["Authorization"] = "Bearer " + os.environ["AGENT_API_KEY"]
    req = urllib.request.Request((base or API) + path, data=json.dumps(body).encode(), method="POST", headers=headers)
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


def chat(messages, tools_spec):
    """One call to the model. Returns (text, tool calls as [(id, name, args)], the assistant message to keep, note)."""
    if OLLAMA:                                   # Ollama's own protocol: the reliable way to switch thinking off
        body = {"model": MODEL, "messages": messages, "stream": False, "think": False,
                "options": {"temperature": 0.2, "num_predict": 700}}
        if tools_spec:
            body["tools"] = tools_spec
        try:
            res = _post("/api/chat", body, base=API.removesuffix("/v1"))
        except urllib.error.HTTPError as ex:
            if ex.code != 400:
                raise
            body.pop("think")                    # a model with no thinking mode refuses the switch
            res = _post("/api/chat", body, base=API.removesuffix("/v1"))
        msg = res.get("message") or {}
        raw = msg.get("tool_calls") or []
        calls = [(f"call{i}", c["function"]["name"], c["function"].get("arguments") or {}) for i, c in enumerate(raw)]
        keep = {"role": "assistant", "content": clean(msg.get("content")), **({"tool_calls": raw} if raw else {})}
        note = f"{res.get('prompt_eval_count')} tokens read, {res.get('eval_count')} written"
        return keep["content"], calls, keep, note, res.get("done_reason") == "length"
    body = {"model": MODEL, "messages": messages, "temperature": 0.2, "max_tokens": 700}
    if tools_spec:
        body["tools"] = tools_spec
    res = _post("/chat/completions", body)
    choice = res["choices"][0]
    msg = choice["message"]
    raw = msg.get("tool_calls") or []
    calls = []
    for c in raw:
        args = c["function"].get("arguments") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args or "{}")
            except json.JSONDecodeError:
                args = {}
        calls.append((c.get("id") or f"call{len(calls)}", c["function"]["name"], args))
    keep = {"role": "assistant", "content": clean(msg.get("content")), **({"tool_calls": raw} if raw else {})}
    u = res.get("usage") or {}
    return keep["content"], calls, keep, f"{u.get('prompt_tokens')} tokens read, {u.get('completion_tokens')} written", choice.get("finish_reason") == "length"


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
        try:
            text, calls, keep, note, cut = chat(messages, None if final else tools_spec)
        except urllib.error.HTTPError as ex:
            raise Unavailable(f"HTTP {ex.code} {ex.read()[:300].decode(errors='replace')}") from None
        except Exception as ex:  # noqa: BLE001
            raise Unavailable(str(ex)) from None
        messages.append(keep)
        log(f"step {step + 1}: {len(calls)} tool call(s), {len(text)} chars of text, {note}, {time.time() - t0:.0f} s")
        if not calls:
            if cut:
                raise Unavailable("the model ran out of room before finishing its answer")
            return text, MODEL, trace
        for cid, name, args in calls:
            key = name + json.dumps(args, sort_keys=True, default=str)
            out = call_tool(name, args) if key not in seen else json.dumps({"note": "You already made this exact call. Use the earlier result and write the answer."})
            seen.add(key)
            trace.append({"tool": name, "args": args})
            log(f"  tool {name}({json.dumps(args, ensure_ascii=False, default=str)[:160]}) -> {len(out)} chars")
            messages.append({"role": "tool", "content": out, **({"tool_name": name} if OLLAMA else {"tool_call_id": cid})})
    return "", MODEL, trace
