"""Trains the matcher and measures it against what the site uses today.

The matcher is a small open text model (22 million parameters, Apache 2.0) that turns a question and each variable's
description into lists of numbers; the variable whose numbers lie closest to the question's is the match. Training
pulls each question towards its own variable and away from the others, with extra weight on look-alikes from the
same dataset (coal use against coal production, a total against its per-person version).

Three things are scored on the same held-out questions, so the result is a comparison, not a claim:
  keyword search   what the Data Agent uses today (agent/tools.py, find_variables)
  before training  the open model as published
  after training   the same model after learning from model/out/train.jsonl

Run make_examples.py first. Settings, all optional: BASE_MODEL, EPOCHS, BATCH, LIMIT (train on only this many
questions, for a quick trial), MAX_MINUTES (stop training after this long and score what there is).
Writes model/out/results.json, model/out/REPORT.md and the trained model in model/out/sustainability-matcher/.
"""
import datetime
import json
import math
import os
import pathlib
import random
import sys
import time

import torch
import torch.nn.functional as F
from transformers import AutoModel, AutoTokenizer

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "model" / "out"
BASE = os.environ.get("BASE_MODEL") or "sentence-transformers/all-MiniLM-L6-v2"
EPOCHS = int(os.environ.get("EPOCHS") or 3)
BATCH = int(os.environ.get("BATCH") or 48)
LIMIT = int(os.environ.get("LIMIT") or 0)
MAX_MINUTES = float(os.environ.get("MAX_MINUTES") or 90)
LR, SCALE = 3e-5, 20.0


def read(name):
    return [json.loads(line) for line in (OUT / f"{name}.jsonl").read_text().splitlines() if line.strip()]


def embed(model, tok, texts, grad=False, size=128, length=64):
    """One unit-length list of numbers for each text: the average of the model's output over the words."""
    out = []
    for i in range(0, len(texts), size):
        b = tok(texts[i:i + size], padding=True, truncation=True, max_length=length, return_tensors="pt")
        with torch.set_grad_enabled(grad):
            h = model(**b).last_hidden_state
            m = b["attention_mask"].unsqueeze(-1).to(h.dtype)
            out.append(F.normalize((h * m).sum(1) / m.sum(1).clamp(min=1e-9), dim=-1))
    return torch.cat(out)


def tally(rows, answers):
    """answers[i] is the list of variable ids offered for rows[i], best first."""
    first = [bool(a[:1]) and a[0] in set(r["gold"]) for r, a in zip(rows, answers)]
    five = [any(x in set(r["gold"]) for x in a[:5]) for r, a in zip(rows, answers)]
    return {"questions": len(rows), "first_right": round(100 * sum(first) / len(rows), 1), "in_first_five": round(100 * sum(five) / len(rows), 1),
            "each": [{"q": r["q"], "answer": a[0] if a else "", "right": f, "in_five": v} for r, a, f, v in zip(rows, answers, first, five)]}


def by_model(model, tok, V, tests):
    model.eval()
    docs, ids = embed(model, tok, [v["doc"] for v in V]), [v["id"] for v in V]
    out = {}
    for name, rows in tests.items():
        top = (embed(model, tok, [r["q"] for r in rows]) @ docs.T).topk(5, dim=1).indices.tolist()
        out[name] = tally(rows, [[ids[j] for j in t] for t in top])
    return out


def by_keywords(tests):
    sys.path.insert(0, str(ROOT / "agent"))
    import tools
    return {name: tally(rows, [[f'{v["dataset"]}::{v["variable"]}' for v in tools.find_variables(r["q"], n=5)["variables"]] for r in rows])
            for name, rows in tests.items()}


def batches(pairs, rng):
    """Each batch is one third look-alikes (questions about one dataset) and two thirds a mix of everything."""
    groups = {}
    for p in pairs:
        groups.setdefault(p["id"].split("::")[0], []).append(p)
    pool = pairs[:]
    rng.shuffle(pool)
    near = BATCH // 3
    for i in range(0, len(pool), BATCH - near):
        mixed = pool[i:i + BATCH - near]
        g = groups[rng.choice(mixed)["id"].split("::")[0]]
        yield mixed + rng.sample(g, min(near, len(g)))


def train(model, tok, V, pairs):
    rng, var = random.Random(11), {v["id"]: v for v in V}
    opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.01)
    total = EPOCHS * math.ceil(len(pairs) / (BATCH - BATCH // 3))
    warm = max(1, total // 10)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: (s + 1) / warm if s < warm else max(0.0, (total - s) / max(1, total - warm)))
    start, step, losses = time.time(), 0, []
    for epoch in range(EPOCHS):
        model.train()
        for batch in batches(pairs, rng):
            q = embed(model, tok, [b["q"] for b in batch], grad=True, size=len(batch), length=48)
            d = embed(model, tok, [var[b["id"]]["doc"] for b in batch], grad=True, size=len(batch))
            scores = q @ d.T * SCALE
            keys = [var[b["id"]]["key"] for b in batch]
            same = torch.tensor([[a == b and i != j for j, b in enumerate(keys)] for i, a in enumerate(keys)])
            loss = F.cross_entropy(scores.masked_fill(same, -1e4), torch.arange(len(batch)))   # another copy of the same measure is not a wrong answer
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step(); sched.step(); opt.zero_grad()
            step += 1
            losses.append(loss.item())
            if step % 25 == 0 or step == total:
                print(f"step {step} of {total}, epoch {epoch + 1}, loss {sum(losses[-25:]) / len(losses[-25:]):.3f}, {int(time.time() - start)} s", flush=True)
            if time.time() - start > MAX_MINUTES * 60:
                print(f"stopped at the time limit after {step} steps", flush=True)
                return step, time.time() - start
    return step, time.time() - start


def report(results, facts):
    kinds = [("keyword", "Keyword search (used today)"), ("before", "Open model, before training"), ("after", "Our matcher, after training")]
    sets = [("test_natural", "hand-written questions"), ("test_synthetic", "held-out generated questions")]
    lines = ["# Sustainability and policy matcher: results", "",
             f"Trained {facts['when']} on GitHub's own machine in {facts['minutes']} minutes. Base model: `{facts['base']}`.", "",
             f"- {facts['variables']} numeric variables on the site were the possible answers to every question.",
             f"- {facts['focus']} of them, in the sustainability and policy datasets, had training questions ({facts['pairs']} in all).",
             "- The hand-written questions were never used for training.", ""]
    for key, label in sets:
        if key not in results["keyword"]:
            continue
        n = results["keyword"][key]["questions"]
        lines += [f"## {n} {label}", "", "| | First answer right | Right answer in the first five |", "|---|---|---|"]
        lines += [f"| {name} | {results[k][key]['first_right']}% | {results[k][key]['in_first_five']}% |" for k, name in kinds if k in results]
        lines.append("")
    if "after" in results and "test_natural" in results["after"]:
        after, kw = results["after"]["test_natural"]["each"], results["keyword"]["test_natural"]["each"]
        won = [a for a, k in zip(after, kw) if a["right"] and not k["in_five"]]
        lost = [a for a in after if not a["in_five"]]
        lines += ["## Questions it now gets right that keyword search could not find", ""] + [f"- {a['q']} → `{a['answer']}`" for a in won[:12]] + [""]
        lines += ["## Questions it still gets wrong", ""] + [f"- {a['q']} → it said `{a['answer']}`" for a in lost[:12]] + [""]
    return "\n".join(lines)


def main():
    torch.manual_seed(11)
    torch.set_num_threads(os.cpu_count() or 2)
    V, pairs = read("variables"), read("train")
    tests = {"test_natural": read("test_natural"), "test_synthetic": read("test_synthetic")}
    if LIMIT:
        pairs = pairs[:LIMIT]
    print(f"{len(V)} variables, {len(pairs)} training questions, base model {BASE}", flush=True)
    results = {"keyword": by_keywords(tests)}
    tok, model = AutoTokenizer.from_pretrained(BASE), AutoModel.from_pretrained(BASE)
    results["before"] = by_model(model, tok, V, tests)
    for k in ("keyword", "before"):
        print(k, {name: (r["first_right"], r["in_first_five"]) for name, r in results[k].items()}, flush=True)
    steps, seconds = train(model, tok, V, pairs)
    results["after"] = by_model(model, tok, V, tests)
    print("after", {name: (r["first_right"], r["in_first_five"]) for name, r in results["after"].items()}, flush=True)
    facts = {"when": datetime.date.today().isoformat(), "minutes": round(seconds / 60, 1), "base": BASE, "variables": len(V),
             "focus": sum(1 for v in V if v["focus"]), "pairs": len(pairs), "steps": steps, "epochs": EPOCHS}
    (OUT / "results.json").write_text(json.dumps({"facts": facts, **{k: {n: {x: r[x] for x in ("questions", "first_right", "in_first_five")} for n, r in v.items()} for k, v in results.items()}}, indent=1))
    (OUT / "REPORT.md").write_text(report(results, facts))
    where = OUT / "sustainability-matcher"
    model.save_pretrained(where); tok.save_pretrained(where)
    (where / "variables.jsonl").write_text((OUT / "variables.jsonl").read_text())
    print((OUT / "REPORT.md").read_text())


if __name__ == "__main__":
    main()
