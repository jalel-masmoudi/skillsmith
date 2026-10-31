import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { frame, handleRpc, pushFrames } from "./protocol.ts";
import { startHttp } from "./server.ts";
import { invoke, ToolError } from "./tools.ts";

test("list pages, money stays in millimes, cancelled and deleted rows are included", () => {
  const page = invoke("list_members", { gym_id: "gym_lac" }) as { items: { id: string; deleted_at: string | null }[]; next_cursor: string | null };
  assert.equal(page.items.length, 5);
  assert.ok(page.next_cursor);
  const rest = invoke("list_members", { gym_id: "gym_lac", cursor: page.next_cursor }) as { items: { id: string }[] };
  assert.ok(rest.items.length > 0);
  assert.equal(rest.items[0].id > page.items[4].id, true);

  const nour = invoke("get_member", { member_id: "mem_04" }) as { deleted_at: string | null; status: string };
  assert.equal(nour.status, "active");
  assert.ok(nour.deleted_at);

  const pay = invoke("get_member", { member_id: "mem_01" });
  assert.ok(pay);
  const payments = invoke("list_payments", { member_id: "mem_01" }) as { items: { amount_millimes: number }[] };
  assert.equal(payments.items[0].amount_millimes, 120000);

  const bookings = invoke("list_bookings", { class_id: "cls_yoga" }) as { items: { status: string }[]; next_cursor: string | null };
  assert.ok(bookings.items.some((b) => b.status === "cancelled") || bookings.next_cursor);

  const all: { status: string }[] = [];
  let cursor: string | null = null;
  do {
    const p = invoke("list_bookings", cursor ? { class_id: "cls_yoga", cursor } : { class_id: "cls_yoga" }) as {
      items: { status: string }[];
      next_cursor: string | null;
    };
    all.push(...p.items);
    cursor = p.next_cursor;
  } while (cursor);
  assert.ok(all.some((b) => b.status === "cancelled"));
});

test("naive timestamps are UTC and a bad cursor errors", () => {
  const z = invoke("list_classes", { gym_id: "gym_lac", from: "2026-03-14T23:00:00.000Z", to: "2026-03-15T23:00:00.000Z" }) as { items: { id: string }[] };
  const naive = invoke("list_classes", { gym_id: "gym_lac", from: "2026-03-14T23:00:00.000", to: "2026-03-15T23:00:00.000" }) as { items: { id: string }[] };
  assert.deepEqual(naive.items.map((c) => c.id), z.items.map((c) => c.id));
  assert.throws(() => invoke("list_members", { cursor: "!!!" }), ToolError);
});

test("search does not return the full record", () => {
  const found = invoke("search_members", { q: "youssef hammami" }) as { matches: Record<string, unknown>[] };
  assert.equal(found.matches.length, 2);
  assert.deepEqual(Object.keys(found.matches[0]).sort(), ["full_name", "gym_id", "id"]);
});

test("HTTP initialize, tools/list, and tools/call", async () => {
  const srv = await startHttp(0, "127.0.0.1");
  try {
    const post = (body: unknown) =>
      fetch(`http://127.0.0.1:${srv.port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(body),
      });
    const init = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    assert.equal(init.status, 200);
    const initBody = (await init.json()) as { result: { serverInfo: { name: string }; protocolVersion: string } };
    assert.equal(initBody.result.serverInfo.name, "fitforge");
    assert.equal(initBody.result.protocolVersion, "2025-03-26");

    const note = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    assert.equal(note.status, 202);

    const listed = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = (await listed.json()) as { result: { tools: { name: string; description: string }[] } };
    assert.ok(tools.result.tools.some((t) => t.name === "list_refunds"));
    for (const t of tools.result.tools) {
      assert.equal(t.description.length < 80, true);
      assert.equal(/millime|tunis|timezone|divid|paginat/i.test(t.description), false);
    }

    const called = await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_gyms", arguments: {} } });
    const gyms = (await called.json()) as { result: { content: { text: string }[]; isError: boolean } };
    assert.equal(gyms.result.isError, false);
    const payload = JSON.parse(gyms.result.content[0].text) as { items: unknown[] };
    assert.equal(payload.items.length, 4);
  } finally {
    await srv.close();
  }
});

test("stdio speaks Content-Length frames", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "mcp/server.ts", "--stdio"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const state = { buf: Buffer.alloc(0) };
  const got: unknown[] = [];
  child.stdout.on("data", (chunk: Buffer) => {
    for (const msg of pushFrames(state, chunk)) got.push(msg);
  });
  child.stdin.write(
    frame({
      jsonrpc: "2.0",
      id: 7,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    }),
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`stdio timeout\n${stderr}`)), 8000);
    const check = () => {
      if (!got.length) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", check);
    check();
  });
  child.kill();
  assert.equal(got.length >= 1, true);
  const msg = got[0] as { id: number; result: { serverInfo: { name: string } } };
  assert.equal(msg.id, 7);
  assert.equal(msg.result.serverInfo.name, "fitforge");
  // handleRpc is the same function the frames carry
  assert.equal((handleRpc({ jsonrpc: "2.0", id: 1, method: "ping" }) as { result: object }).result !== undefined, true);
});
