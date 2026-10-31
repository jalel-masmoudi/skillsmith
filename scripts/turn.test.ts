import assert from "node:assert/strict";
import { test } from "node:test";
import { TurnStreamingEvent } from "@truefoundry/trueforge-sdk/serialization";
import { consumeTurnEvents } from "./lib.ts";

test("unknown stream events are ignored until turn.done", async () => {
  const result = await consumeTurnEvents([
    { type: "turn.created", turnId: "t1" },
    { type: "thread.context_compaction_started" },
    { type: "some.future_event" },
    { type: "turn.done", state: { status: "done", output: { content: "ok" } } },
  ]);
  assert.equal(result.turnId, "t1");
  assert.equal(result.status, "done");
  assert.equal(result.text, "ok");
});

test("sdk 0.182 parses a context compaction event and rejects an unknown type", () => {
  const parsed = TurnStreamingEvent.parse({
    type: "thread.context_compaction_started",
    id: "01JTESTCOMPACTION",
    created_at: "2026-10-31T18:21:00.000Z",
    thread_id: "main",
    trigger: { type: "context_threshold_exceeded", context_tokens: 90000, threshold_tokens: 80000 },
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.type, "thread.context_compaction_started");
  assert.equal(TurnStreamingEvent.parse({ type: "some.future_event" }).ok, false);
});
