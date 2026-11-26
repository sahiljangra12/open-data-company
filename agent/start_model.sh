#!/usr/bin/env bash
# Start the Data Agent's brain on this machine: an open model run by llama.cpp's server, which speaks the same
# chat-with-tools protocol as the big hosted services. Nothing leaves the runner and no key is needed.
#
#   AGENT_HF_MODEL   the model, as <Hugging Face repository>:<quantisation>   (default below)
#   LLAMA_CACHE      where the model file is kept between runs (the workflow caches this folder)
#
# On a GitHub-hosted runner (4 cores, 16 GB) a 4-billion-parameter model at 4-bit answers a question in a few minutes.
set -euo pipefail
MODEL="${AGENT_HF_MODEL:-Qwen/Qwen3-4B-GGUF:Q4_K_M}"
export LLAMA_CACHE="${LLAMA_CACHE:-$HOME/agent-models}"
BIN="$HOME/llama-bin"
mkdir -p "$LLAMA_CACHE" "$BIN"

if [ -z "$(find "$BIN" -type f -name llama-server | head -1)" ]; then
  echo "Downloading llama.cpp (latest release, Linux x64, CPU)"
  cd "$BIN"
  gh release view --repo ggml-org/llama.cpp --json tagName,assets -q '.tagName, (.assets[].name)' | tee assets.txt
  ASSET="$(grep -iE '(ubuntu|linux)' assets.txt | grep -iE '(x64|x86_64|amd64)' | grep -viE 'vulkan|cuda|rocm|sycl|opencl|hip|openvino|arm|s390|riscv|android' | head -1)"
  [ -n "$ASSET" ] || { echo "No Linux x64 CPU build among the release files above"; exit 1; }
  echo "Using $ASSET"
  gh release download --repo ggml-org/llama.cpp --pattern "$ASSET" --clobber
  for f in *; do case "$f" in *.zip) unzip -q -o "$f" ;; *.tar.gz|*.tgz) tar -xzf "$f" ;; esac; done
  cd - >/dev/null
fi
SERVER="$(find "$BIN" -type f -name llama-server | head -1)"
[ -n "$SERVER" ] || { echo "llama-server was not in the release archive"; find "$BIN" | head -40; exit 1; }
chmod +x "$SERVER"
export LD_LIBRARY_PATH="$(dirname "$SERVER"):${LD_LIBRARY_PATH:-}"

echo "Starting $SERVER with $MODEL"
nohup "$SERVER" -hf "$MODEL" --host 127.0.0.1 --port 8080 --ctx-size 8192 --threads "$(nproc)" --jinja --reasoning-budget 0 \
  --parallel 1 > "$HOME/llama-server.log" 2>&1 &
for i in $(seq 1 180); do                       # the first run downloads about 2.5 GB; later runs read the cache
  if curl -sf http://127.0.0.1:8080/health >/dev/null; then echo "Model ready after $((i * 5)) s"; exit 0; fi
  if ! pgrep -f llama-server >/dev/null; then echo "llama-server stopped:"; tail -40 "$HOME/llama-server.log"; exit 1; fi
  sleep 5
done
echo "Model did not become ready in time:"; tail -40 "$HOME/llama-server.log"; exit 1
