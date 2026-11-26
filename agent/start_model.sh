#!/usr/bin/env bash
# Start the Data Agent's brain on this machine: an open model run by Ollama (the llama.cpp engine with a small server
# around it), which speaks the same chat-with-tools protocol as the big hosted services. Nothing leaves the runner
# and no key is needed.
#
#   AGENT_MODEL     the model, by its name in the Ollama library. Default: the first of DEFAULTS that can be fetched.
#                   They are small open models that answer directly (no long "thinking" phase) and can call tools.
#   OLLAMA_MODELS   where the model file is kept between runs (the workflow caches this folder)
#
# On a GitHub-hosted runner (4 cores, 16 GB) a 4-billion-parameter model answers a question in a few minutes.
set -euo pipefail
DEFAULTS="qwen3:4b-instruct qwen2.5:7b llama3.2:3b"
WANT="${AGENT_MODEL:-}"
export OLLAMA_MODELS="${OLLAMA_MODELS:-$HOME/agent-models}"
export OLLAMA_HOST=127.0.0.1:11434
export OLLAMA_CONTEXT_LENGTH=8192          # room for the tool descriptions and a few tool results
export OLLAMA_KEEP_ALIVE=30m
DIR="$HOME/ollama"
mkdir -p "$OLLAMA_MODELS" "$DIR"

if [ ! -x "$DIR/bin/ollama" ]; then
  echo "Downloading Ollama for Linux x64"
  if curl -fsSL --retry 3 https://ollama.com/download/ollama-linux-amd64.tar.zst -o /tmp/ollama.tar.zst; then
    tar --zstd -xf /tmp/ollama.tar.zst -C "$DIR"
  else
    curl -fsSL --retry 3 https://ollama.com/download/ollama-linux-amd64.tgz -o /tmp/ollama.tgz
    tar -xzf /tmp/ollama.tgz -C "$DIR"
  fi
  rm -f /tmp/ollama.tar.zst /tmp/ollama.tgz
fi
"$DIR/bin/ollama" --version || true

nohup "$DIR/bin/ollama" serve > "$HOME/model-server.log" 2>&1 &
for i in $(seq 1 30); do curl -sf http://$OLLAMA_HOST/api/version >/dev/null && break; sleep 1; done
curl -sf http://$OLLAMA_HOST/api/version || { echo "Ollama did not start:"; tail -30 "$HOME/model-server.log"; exit 1; }
echo
MODEL=""
for m in ${WANT:-$DEFAULTS}; do
  echo "Fetching $m (a few GB the first time; later runs read the cache)"
  if "$DIR/bin/ollama" pull "$m" 2>&1 | tail -2 && "$DIR/bin/ollama" show "$m" >/dev/null 2>&1; then MODEL="$m"; break; fi
  echo "Could not fetch $m"
done
[ -n "$MODEL" ] || { echo "No model could be fetched"; exit 1; }
"$DIR/bin/ollama" list
[ -n "${GITHUB_ENV:-}" ] && echo "AGENT_MODEL=$MODEL" >> "$GITHUB_ENV"     # tell the next steps which model is running
echo "Model ready: $MODEL"
