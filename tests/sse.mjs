/* A stand-in model's reply in the event-stream form the SDK expects when it asks for the words as they are written.
   pause (milliseconds) puts a gap between pieces of text, so a test can see an answer arrive bit by bit. */
export async function sse(res, m, { pieces = 2, pause = 0 } = {}) {
  res.setHeader("content-type", "text/event-stream");
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`), wait = () => (pause ? new Promise(r => setTimeout(r, pause)) : null);
  ev("message_start", { message: { ...m, content: [], stop_reason: null, usage: { input_tokens: m.usage.input_tokens, output_tokens: 0 } } });
  for (const [index, b] of m.content.entries()) {
    if (b.type === "text") {
      ev("content_block_start", { index, content_block: { type: "text", text: "" } });
      const size = Math.max(1, Math.ceil(b.text.length / pieces));
      for (let i = 0; i < b.text.length; i += size) { ev("content_block_delta", { index, delta: { type: "text_delta", text: b.text.slice(i, i + size) } }); await wait(); }
    } else if (b.type === "tool_use") { ev("content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } }); ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } }); }
    else if (b.type === "thinking") { ev("content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } }); ev("content_block_delta", { index, delta: { type: "thinking_delta", thinking: b.thinking } }); ev("content_block_delta", { index, delta: { type: "signature_delta", signature: b.signature } }); }
    ev("content_block_stop", { index });
  }
  ev("message_delta", { delta: { stop_reason: m.stop_reason, stop_sequence: null }, usage: { output_tokens: m.usage.output_tokens } });
  ev("message_stop", {}); res.end();
}
