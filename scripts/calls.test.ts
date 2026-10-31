import assert from "node:assert/strict";
import { test } from "node:test";
import { countMcpToolCalls, mcpCallsForTurn, type SessionExport } from "./lib.ts";

// Parsed shape of a model.message tool call in @truefoundry/trueforge-sdk 0.182.0
// (ModelMessageEvent.toolCalls / ToolCall.toolInfo / McpToolInfo). The installed
// client is 0.180.0; those interfaces match 0.182.0. Wire JSON uses tool_calls
// and tool_info; listTurnEvents returns the camelCase form below.

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
