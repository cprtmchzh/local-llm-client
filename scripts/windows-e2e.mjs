import { spawn } from "node:child_process";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const target = option("target");
const model = option(
  "model",
  "hf.co/0xSojalSec/Qwen3.8-27B-Uncensored-Cyber-agent:IQ4_XS-imatrix-fromq8",
);
const remotePort = Number(option("remote-port", "11434"));
const localPort = Number(option("local-port", "18080"));
if (!target || target.startsWith("-") || !Number.isInteger(remotePort) || !Number.isInteger(localPort)) {
  console.error("Usage: npm run test:e2e:windows -- --target user@host [--model <ollama-model>] [--remote-port 11434] [--local-port 18080]");
  process.exit(2);
}

const baseUrl = `http://127.0.0.1:${localPort}`;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function openTunnel() {
  return spawn("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "ExitOnForwardFailure=yes", "-N", "-L", `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`, target], { stdio: ["ignore", "ignore", "pipe"] });
}

async function waitForHealth() {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // The tunnel or Windows API may still be starting.
    }
    await delay(250);
  }
  throw new Error("Ollama health did not become ready through the SSH tunnel");
}

async function assertStreaming() {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply briefly: E2E ready" }], stream: true, max_tokens: 64, temperature: 0 }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok || !response.body) throw new Error(`Streaming request failed with HTTP ${response.status}`);
  const payload = await response.text();
  if (!payload.includes("data: ") || !payload.includes("[DONE]")) throw new Error("Response was not a complete SSE stream");
}

async function assertInvalidModel() {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "__missing_model__", messages: [{ role: "user", content: "test" }], stream: false }),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.ok) throw new Error("Invalid model unexpectedly succeeded");
}

async function assertToolCalling() {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Use the list_directory tool to inspect the workspace root. The root path is an empty string." }],
      tools: [{
        type: "function",
        function: {
          name: "list_directory",
          description: "List files in a workspace-relative directory.",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      }],
      tool_choice: "auto",
      stream: false,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`Tool-call request failed with HTTP ${response.status}`);
  const payload = await response.json();
  const call = payload.choices?.[0]?.message?.tool_calls?.[0];
  if (call?.function?.name !== "list_directory") throw new Error("Cyber model did not return the expected list_directory tool call");
}

let tunnel = openTunnel();
try {
  await waitForHealth();
  console.log("PASS: SSH local forwarding health");
  await assertStreaming();
  console.log("PASS: OpenAI-compatible SSE streaming");
  await assertToolCalling();
  console.log("PASS: Cyber model tool calling");
  await assertInvalidModel();
  console.log("PASS: invalid model error");
  tunnel.kill("SIGTERM");
  await delay(250);
  tunnel = openTunnel();
  await waitForHealth();
  console.log("PASS: tunnel reconnect and stale listener recovery");
} finally {
  tunnel.kill("SIGTERM");
}
