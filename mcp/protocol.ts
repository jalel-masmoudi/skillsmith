// Stateless MCP (JSON-RPC) for the 2025 streamable HTTP transport and for stdio.

import { TOOLS, ToolError, invoke } from "./tools.ts";

export const SERVER_INFO = { name: "fitforge", version: "1.0.0" };
const KNOWN_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const DEFAULT_VERSION = "2025-03-26";

export interface RpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown> | unknown[];
  result?: unknown;
  error?: unknown;
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

function params(msg: RpcMessage): Record<string, unknown> {
  const p = msg.params;
  if (p && typeof p === "object" && !Array.isArray(p)) return p;
  return {};
}

export function handleRpc(msg: RpcMessage): RpcResponse | null {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    if (msg && "id" in msg && msg.id != null) {
      return { jsonrpc: "2.0", id: msg.id, error: { code: -32600, message: "invalid request" } };
    }
    return null;
  }
  const note = msg.id === undefined || msg.id === null;
  // Notifications carry no id. A response is not required.
  if (note && msg.method.startsWith("notifications/")) return null;

  let result: unknown;
  try {
    result = dispatch(msg.method, params(msg));
  } catch (e) {
    const message = e instanceof Error ? e.message : "error";
    const code = message === "method not found" ? -32601 : -32603;
    if (note) return null;
    return { jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } };
  }
  if (note) return null;
  return { jsonrpc: "2.0", id: msg.id ?? null, result };
}

function dispatch(method: string, p: Record<string, unknown>): unknown {
  switch (method) {
    case "initialize": {
      const requested = typeof p.protocolVersion === "string" ? p.protocolVersion : DEFAULT_VERSION;
      return {
        protocolVersion: KNOWN_VERSIONS.has(requested) ? requested : DEFAULT_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      };
    }
    case "ping":
    case "logging/setLevel":
      return {};
    case "tools/list":
      return {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: true },
        })),
      };
    case "tools/call": {
      const name = typeof p.name === "string" ? p.name : "";
      const args = p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments) ? (p.arguments as Record<string, unknown>) : {};
      try {
        const payload = invoke(name, args);
        return { content: [{ type: "text", text: JSON.stringify(payload) }], isError: false };
      } catch (e) {
        const message = e instanceof ToolError ? e.message : "error";
        return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
      }
    }
    default:
      throw new Error("method not found");
  }
}

export function frame(obj: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  return Buffer.concat([header, body]);
}

/** Incremental stdio framing (Content-Length headers). Returns complete JSON bodies. */
export function pushFrames(state: { buf: Buffer }, chunk: Buffer): unknown[] {
  state.buf = Buffer.concat([state.buf, chunk]);
  const out: unknown[] = [];
  for (;;) {
    const sep = state.buf.indexOf("\r\n\r\n");
    if (sep < 0) break;
    const header = state.buf.subarray(0, sep).toString("utf8");
    const m = header.match(/Content-Length:\s*(\d+)/i);
    if (!m) {
      state.buf = state.buf.subarray(sep + 4);
      continue;
    }
    const len = Number(m[1]);
    const start = sep + 4;
    if (state.buf.length < start + len) break;
    const body = state.buf.subarray(start, start + len).toString("utf8");
    state.buf = state.buf.subarray(start + len);
    out.push(JSON.parse(body));
  }
  return out;
}
