// FitForge MCP server.
//   npm run mcp            streamable HTTP on 127.0.0.1:$GYM_MCP_PORT (default 8787), path /mcp
//   npm run mcp:stdio      stdio, Content-Length frames, for a local client
//
// TrueForge attaches remote HTTP MCP servers (Settings → Connectors). It does not
// spawn this process. See docs/MCP.md.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { frame, handleRpc, pushFrames, type RpcMessage } from "./protocol.ts";

const MAX_BODY = 1024 * 1024;

export function startHttp(port = 8787, host = "127.0.0.1"): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    void onRequest(req, res);
  });
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const got = typeof addr === "object" && addr ? addr.port : port;
      resolveListen({
        port: got,
        close: () => new Promise((r, j) => server.close((e) => (e ? j(e) : r()))),
      });
    });
  });
}

async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  if (req.method === "GET" || req.method === "DELETE") {
    res.writeHead(405, { allow: "POST", "content-type": "application/json" });
    res.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST" });
    res.end();
    return;
  }
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    res.writeHead(413, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "payload too large" }));
    req.resume();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const buf = c as Buffer;
    size += buf.length;
    if (size > MAX_BODY) {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "payload too large" }));
      return;
    }
    chunks.push(buf);
  }
  let msg: RpcMessage;
  try {
    msg = JSON.parse(Buffer.concat(chunks).toString("utf8")) as RpcMessage;
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }));
    return;
  }
  const response = handleRpc(msg);
  if (!response) {
    res.writeHead(202);
    res.end();
    return;
  }
  const body = JSON.stringify(response);
  const accept = req.headers.accept ?? "";
  const sseOnly = accept.includes("text/event-stream") && !accept.includes("application/json");
  if (sseOnly) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "mcp-protocol-version": "2025-03-26",
    });
    res.end(`event: message\ndata: ${body}\n\n`);
    return;
  }
  res.writeHead(200, {
    "content-type": "application/json",
    "mcp-protocol-version": "2025-03-26",
  });
  res.end(body);
}

function serveStdio(): void {
  const state = { buf: Buffer.alloc(0) };
  process.stdin.on("data", (chunk: Buffer) => {
    let messages: unknown[];
    try {
      messages = pushFrames(state, chunk);
    } catch (e) {
      process.stderr.write(`stdio parse error: ${(e as Error).message}\n`);
      return;
    }
    for (const msg of messages) {
      const response = handleRpc(msg as RpcMessage);
      if (response) process.stdout.write(frame(response));
    }
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  if (process.argv.includes("--stdio")) {
    serveStdio();
  } else {
    const port = Number(process.env.GYM_MCP_PORT ?? process.env.PORT ?? 8787);
    const host = process.env.GYM_MCP_HOST ?? "127.0.0.1";
    startHttp(port, host).then(
      (s) => process.stderr.write(`FitForge MCP http://${host}:${s.port}/mcp\n`),
      (e) => {
        process.stderr.write(`${(e as Error).message}\n`);
        process.exit(1);
      },
    );
  }
}
