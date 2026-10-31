import assert from "node:assert/strict";
import { test } from "node:test";
import { countMcpToolCalls, mcpCallsForTurn, type SessionExport } from "./lib.ts";

// Verified by unpacking @truefoundry/trueforge-sdk 0.182.0 and reading
// ModelMessageEvent, ToolCall, and McpToolInfo: camelCase toolCalls, toolInfo
// { type: "mcp", name, serverId, serverName }. Those three interfaces are the
// same in the 0.180.0 client installed here. Both versions' serializer Raw
// form uses tool_calls and tool_info (server_name). No server was called.

const captured = {
  type: "model.message",
  id: "01JTESTMESSAGE00000000000000",
  createdAt: "2026-10-31T12:00:00.000Z",
  threadId: "main",
  content: "",
  toolCalls: [
    {
      id: "call_list_gyms",
      type: "function" as const,
      function: { name: "fitforge__list_gyms", arguments: "{}" },
      toolInfo: { type: "mcp" as const, name: "list_gyms", serverId: "srv_fitforge", serverName: "fitforge" },
    },
    {
      id: "call_web",
      type: "function" as const,
      function: { name: "web_search", arguments: "{\"query\":\"FitForge\"}" },
      toolInfo: { type: "truefoundry-system" as const, name: "web_search" },
    },
  ],
};

test("prefixed MCP tool names count and system tools do not", () => {
  assert.equal(countMcpToolCalls([captured]), 1);
  assert.equal(
    countMcpToolCalls([
      {
        type: "model.message",
        toolCalls: [
          {
            id: "c2",
            type: "function",
            function: { name: "fitforge__list_gyms", arguments: "{}" },
            toolInfo: { type: "mcp", name: "list_gyms", serverId: "other", serverName: "other" },
          },
        ],
      },
    ]),
    0,
  );
  assert.equal(
    countMcpToolCalls([
      {
        type: "model.message",
        toolCalls: [{ id: "c", type: "function", function: { name: "fitforge__list_members", arguments: "{}" } }],
      },
    ]),
    1,
  );
});

test("raw tool_calls from the serializer also count", () => {
  assert.equal(
    countMcpToolCalls([
      {
        type: "model.message",
        tool_calls: [
          {
            id: "call_raw",
            type: "function",
            function: { name: "fitforge__get_member", arguments: "{\"member_id\":\"mem_01\"}" },
            tool_info: { type: "mcp", name: "get_member", server_id: "srv_fitforge", server_name: "fitforge" },
          },
        ],
      },
    ]),
    1,
  );
});

test("a missing turn throws", () => {
  const exp = { turns: [] } as unknown as SessionExport;
  assert.throws(() => mcpCallsForTurn(exp, "turn_missing"), /no turn turn_missing/);
});
