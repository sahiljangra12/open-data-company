"""Checks the Data Agent without spending any model allowance.

A stand-in server plays the part of the model server (Ollama in the workflow): it answers the chat calls with a
scripted sequence (three tool calls, one of them to a tool that does not exist, then a final text). The real loop, the real tools and the real data files are used.

    python tests/check_agent.py
"""
import json, os, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "agent"))
SEEN = []


class Stand(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        SEEN.append(body)
        if self.path == "/api/chat":             # Ollama's own protocol, the one used in the workflow
            assert body["think"] is False and body["stream"] is False
            tools = [m for m in body["messages"] if m["role"] == "tool"]
            if "stubborn" in body["messages"][1]["content"]:                 # a model that answers from memory whatever it is told
                return self.send({"message": {"role": "assistant", "content": "The United States emits 15.7 t per person."}, "done_reason": "stop"})
            if not tools:
                return self.send({"message": {"role": "assistant", "content": "", "tool_calls": [
                    {"function": {"name": "rank", "arguments": {"dataset": "co2-and-greenhouse-gases", "variable": "co2", "n": 2}}}]}, "done_reason": "stop"})
            assert tools[0]["tool_name"] == "rank"
            top = json.loads(tools[0]["content"])["ranking"][0]
            if "Who emits how much" in body["messages"][1]["content"]:      # first a transposed figure, then the right one
                fixed = any("match nothing" in m["content"] for m in body["messages"] if m["role"] == "user")
                assert "tools" not in body or not fixed
                v = f"{top['value']:,}" if fixed else "12,471.5"
                return self.send({"message": {"role": "assistant", "content": f"{top['place']} emitted {v} Mt."}, "done_reason": "stop"})
            return self.send({"message": {"role": "assistant", "content": f"{top['place']} emits the most."}, "done_reason": "stop", "prompt_eval_count": 9, "eval_count": 5})
        assert self.path == "/v1/chat/completions", self.path
        n = sum(1 for m in body["messages"] if m["role"] == "assistant")
        call = lambda name, args: self.send({"choices": [{"message": {"role": "assistant", "content": None, "tool_calls": [
            {"id": f"c{n}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}}]})
        if n == 0:
            call("find_variables", {"query": "co2 per capita"})
        elif n == 1:
            call("get_values", {"dataset": "co2-and-greenhouse-gases", "variable": "co2_per_capita", "places": ["India", "USA"]})
        elif n == 2:
            call("no_such_tool", {})
        elif "from memory" in body["messages"][1]["content"] and n == 0:
            pass
        else:
            last = [m for m in body["messages"] if m["role"] == "tool"][1]["content"]
            v = json.loads(last)["values"]
            self.send({"choices": [{"message": {"role": "assistant", "content": f"<think>private notes</think>India {v[0]['value']} t, United States {v[1]['value']} t ({v[0]['when']})."}}]})


def main():
    srv = HTTPServer(("127.0.0.1", 0), Stand)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    os.environ["AGENT_API_URL"] = f"http://127.0.0.1:{srv.server_port}/v1"
    os.environ["AGENT_MODEL"] = "stand-in"
    os.environ["AGENT_API_STYLE"] = "openai"
    import brain, run, tools

    # the tools, against the real files
    assert tools.find_variables("life expectancy")["variables"], "find_variables found nothing"
    r = tools.rank("co2-and-greenhouse-gases", "co2", n=3)
    assert [x["place"] for x in r["ranking"]][0] == "China" and "World" not in [x["place"] for x in r["ranking"]]
    s = tools.get_series("crude-oil-prices", "brent_usd_per_barrel", start="2020")
    assert s["count"] > 100 and len(s["points"]) <= 26 and s["first"]["when"] >= "2020"
    assert "error" in json.loads(tools.call("get_values", {"dataset": "nope", "variable": "x", "places": ["a"]}))
    assert "error" in json.loads(tools.call("rank", {"wrong": 1}))
    assert len(tools.call("describe_dataset", {"dataset": "co2-and-greenhouse-gases"})) <= 2520
    top = tools.find_variables("Which three countries emit the most CO2 per person, and how does India compare?")["variables"][0]
    assert (top["dataset"], top["variable"]) == ("co2-and-greenhouse-gases", "co2_per_capita"), top
    assert tools.find_variables("life expectancy")["variables"][0]["variable"].startswith("life_expectancy")
    assert {f["function"]["name"] for f in tools.SPEC} <= set(tools.TOOLS) and tools.READS <= {f["function"]["name"] for f in tools.SPEC}
    assert tools.recent_changes(1)["checks"][0]["changed"] is not None

    # the loop
    text, model, trace = run.answer("Compare CO2 per person in India and the USA")
    assert model == "stand-in", model
    assert [t["tool"] for t in trace] == ["find_variables", "get_values", "no_such_tool"], trace
    assert text.startswith("India ") and "United States" in text, text
    assert all("tools" in b for b in SEEN) and SEEN[0]["messages"][0]["role"] == "system"
    assert "No tool named" in [m for m in SEEN[-1]["messages"] if m["role"] == "tool"][-1]["content"]

    # the same loop over Ollama's own protocol
    import importlib
    os.environ["AGENT_API_STYLE"] = "ollama"
    importlib.reload(brain)
    run.brain = brain
    text, model, tr2 = run.answer("Who emits the most CO2?")
    assert text == "China emits the most." and [t["tool"] for t in tr2] == ["rank"], (text, tr2)

    # a figure that matches nothing read is sent back to the model, which corrects it
    text, model, tr3 = run.answer("Who emits how much CO2?")
    assert "12,417.5" in text and "Check before citing" not in text, text

    # a model that keeps answering from memory never gets its figures published: the data answers instead
    text, model, tr4 = run.answer("stubborn: which countries emit the most CO2 per person, and how does India compare?")
    assert model is None and "15.7" not in text and "figure check" in text and "India" in text and "Qatar" in text, text

    # text that thinks aloud, or that read no tool, is never published
    assert not run.usable("Okay, let's tackle this user query step by step.", trace) and not run.usable("India 2.2 t.", [])
    assert run.usable("India 2.2 t, United States 14.5 t (2025).", trace)

    # every figure in a text must match something the agent read
    ev = '{"value": 2.188, "when": "2025"} {"value": -1973487000} {"value": 14.5} {"rows": 1813, "mag": 5.7, "share": 0.4312}'
    assert run.ungrounded("India 2.19 t and the US 14.5 t in 2025; balance -1.973 billion; 1,813 rows; magnitude 5.7 at 15:26 UTC on 26 November 2026; 43.1%", ev) == []
    assert run.ungrounded("India emitted 3.4 t per person and 9,999 rows changed.", ev) == ["3.4", "9999"]
    assert json.loads(tools.call("get_values", {"dataset": "co2-and-greenhouse-gases", "variable": "CO₂ emissions per capita", "places": ["India"]}))["values"][0]["value"]

    # a claimed rise or fall needs two figures; a country the question names must have been read
    chk = run.figure_check("How does India compare with the US?", question="How does India compare with the US?")
    tr = [{"tool": "rank", "args": {}, "out": '{"place": "Qatar", "value": 31.471}'}]
    assert "India" in chk("Qatar leads with 31.471 t.", tr) and "United States" in chk("Qatar leads with 31.471 t.", tr)
    tr.append({"tool": "get_values", "args": {}, "out": '{"place": "India", "value": 2.188} {"place": "United States", "value": 14.5}'})
    assert chk("Qatar 31.471 t; India 2.188 t; United States 14.5 t.", tr) is None
    assert "claims a change" in chk("India's emissions dropped to 2.188 t.", tr)
    assert chk("India's figure fell from 14.5 t to 2.188 t.", tr) is None

    # history is kept inside the free tier's input limit
    msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "q"}] + [{"role": "tool", "tool_call_id": str(i), "content": "x" * 2500} for i in range(12)]
    brain.compact(msgs)
    assert sum(len(m["content"]) for m in msgs) <= 14000 and len(msgs[-1]["content"]) == 2500

    # no model reachable: the agent still answers from the data, and says so
    os.environ["AGENT_API_URL"] = "http://127.0.0.1:9/v1"
    importlib.reload(brain)
    run.brain = brain
    text, model, trace = run.answer("co2 emissions per capita")
    assert model is None and "could not be reached" in text and "Source:" in text, text
    assert "could not be reached" in run.fallback_brief(tools.recent_changes(1))
    assert "figure check" in run.fallback_brief(tools.recent_changes(1), "the model's draft did not pass the figure check")

    # the brief's Markdown is escaped before it becomes HTML
    h = run.md_html("**Head** <script>x</script>\n\n### What changed\n- a [link](https://example.org/a) and [bad](javascript:alert(1))\n- _note_")
    assert "<script>" not in h and '<a href="https://example.org/a">link</a>' in h and "javascript:alert(1))" in h and 'href="javascript' not in h
    assert h.count("<li>") == 2 and "<h3>What changed</h3>" in h and "<em>note</em>" in h
    print("Data Agent checks passed:", len(tools.TOOLS), "tools,", len(tools.datasets()), "datasets")


if __name__ == "__main__":
    main()
