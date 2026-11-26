#!/usr/bin/env bash
# Runs the browser checks: serves the site and the Data AI function locally, with a scripted stand-in for the model.
# Needs: node 22+, "npm ci" done in ai/, python with playwright (and its chromium) and pillow.  Use:  bash tests/browser/run.sh [ai|data]
cd "$(dirname "$0")/../.." || exit 1
(cd docs && exec python3 -m http.server 8766 >/dev/null 2>&1) & site=$!
node tests/browser/serve.mjs > /tmp/data-ai-serve.log 2>&1 & fn=$!
trap 'kill $site $fn 2>/dev/null' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:8767/api/data-ai && curl -s -o /dev/null http://localhost:8766/ask.html && break; sleep 0.5; done
status=0
if [ "${1:-ai}" != "data" ]; then python3 tests/browser/test_ai.py || status=1; fi
if [ "${1:-data}" != "ai" ]; then python3 tests/browser/test_data.py || status=1; fi
exit $status
