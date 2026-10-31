import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { classifyTrain, diagnosisPrompt, holdoutHits, improveRun, type Forge, type ResultRow, type TraceSession } from "./improve-loop.ts";
import { loadTasks, ROOT } from "./lib.ts";

const tasks = loadTasks();
const results = JSON.parse(readFileSync(join(ROOT, "runs/run-01/results.json"), "utf8")) as ResultRow[];
const session = JSON.parse(readFileSync(join(ROOT, "runs/run-01/session.json"), "utf8")) as TraceSession;
const byId = new Map(tasks.map((t) => [t.id, t]));

const SAFE_SKILL = `---
name: fitforge-notes
description: Working notes for the FitForge tools. Read this before answering a question about FitForge.
---

# FitForge notes

- Instants in tool payloads are UTC. A local calendar day starts one hour earlier.
- Money fields are integer thousandths. Divide by 1000 when a question asks for dinars.
- When a question asks for a net, subtract reversals whose own timestamp falls in the same local month.
- When counting issued bills, skip rows whose status is void.
`;

test("run 1 prompt splits misses from extra calls and hides holdouts", () => {
  const items = classifyTrain(results, byId, session);
  const misses = items.filter((i) => i.kind === "miss").map((i) => i.id).sort();
  const extra = items.filter((i) => i.kind === "extra_calls").map((i) => i.id).sort();
  assert.deepEqual(misses, ["02-lac-march-net", "12-lac-march-invoices"]);
  assert.ok(extra.includes("03-yoga-bookings"));
  for (const item of items) {
    assert.equal(item.id.startsWith("15-") || item.id.startsWith("16-") || item.id.startsWith("17-") || item.id.startsWith("18-") || item.id.startsWith("19-") || item.id.startsWith("20-"), false);
    if (item.kind === "extra_calls") assert.ok(item.actual_calls > item.best_calls);
  }
  const prompt = diagnosisPrompt("01", items);
  const missAt = prompt.indexOf("## Misses");
  const extraAt = prompt.indexOf("## Extra calls");
  assert.ok(missAt >= 0 && extraAt > missAt);
  const missPart = prompt.slice(missAt, extraAt);
  const extraPart = prompt.slice(extraAt);
  assert.match(missPart, /These answers did not match/);
  assert.match(missPart, /02-lac-march-net/);
  assert.match(missPart, /12-lac-march-invoices/);
  assert.doesNotMatch(missPart, /03-yoga-bookings/);
  assert.match(extraPart, /These answers matched, and they used more tool calls/);
  assert.match(extraPart, /03-yoga-bookings/);
  assert.match(prompt, /subagent/i);
  assert.match(prompt, /list_payments|list_invoices|search_gyms/);
  assert.deepEqual(holdoutHits(prompt, tasks), []);
  for (const t of tasks.filter((t) => t.holdout)) {
    assert.equal(prompt.includes(t.question), false, t.id);
    assert.equal(prompt.toLowerCase().includes(t.id), false, t.id);
  }
});

test("fixture loop writes a skill commit and never sends holdout traces", async () => {
  const root = mkdtempSync(join(tmpdir(), "skillsmith-improve-"));
  const rel = "agent/skills/fitforge-notes/SKILL.md";
  mkdirSync(join(root, "agent/skills/fitforge-notes"), { recursive: true });
  const seed = readFileSync(join(ROOT, rel), "utf8");
  writeFileSync(join(root, rel), seed);
  const prompts: string[] = [];
  const commits: string[] = [];
  const fixture: ResultRow[] = [
    { task_id: "02-lac-march-net", holdout: false, passed: false, correct: false, score: 0, actual_calls: 3, best_calls: 4, reply: "train reply", turn_id: "turn-train", parsed: true },
    { task_id: "03-yoga-bookings", holdout: false, passed: false, correct: true, score: 0.9, actual_calls: 6, best_calls: 3, reply: "train extra", turn_id: "turn-extra", parsed: true },
    { task_id: "16-sousse-april-net", holdout: true, passed: false, correct: false, score: 0, actual_calls: 2, best_calls: 3, reply: "HOLDOUT_REPLY_16", turn_id: "turn-hold", parsed: true },
  ];
  const traces: TraceSession = {
    turns: [
      { id: "turn-train", events: [{ type: "tool.response", content: "TRAIN_TRACE_PAYMENTS" }] },
      { id: "turn-extra", events: [{ type: "tool.response", content: "TRAIN_TRACE_EXTRA" }] },
      { id: "turn-hold", events: [{ type: "tool.response", content: "HOLDOUT_MARKER_SOUSSE" }] },
    ],
  };
  const forge: Forge = {
    async diagnose(prompt) {
      prompts.push(prompt);
      return { sessionId: "diag_1", text: "Instants are UTC. Integer money is scaled. Reversals in the same local month come off the total." };
    },
    async rewrite(prompt) {
      prompts.push(prompt);
      return {
        sessionId: "rewrite_1",
        text: `<<<FILE agent/skills/fitforge-notes/SKILL.md\n${SAFE_SKILL}\n>>>\n<<<LEARNED\nScale integer money and use local month bounds.\n>>>`,
      };
    },
  };
  try {
    const outcome = await improveRun({ root, tasks, results: fixture, session: traces, runLabel: "01", forge, commit: (m) => commits.push(m) });
    assert.ok(!("skipped" in outcome));
    if ("skipped" in outcome) return;
    assert.equal(outcome.rewriteSessionId, "rewrite_1");
    assert.ok(outcome.message.endsWith("Agent-Session: rewrite_1"));
    assert.equal(commits.length, 1);
    assert.equal(commits[0], outcome.message);
    assert.equal(readFileSync(join(root, rel), "utf8").includes("integer thousandths"), true);
    assert.equal(readFileSync(join(ROOT, rel), "utf8"), seed);
    const blob = prompts.join("\n");
    assert.equal(blob.includes("HOLDOUT_MARKER_SOUSSE"), false);
    assert.equal(blob.includes("HOLDOUT_REPLY_16"), false);
    assert.equal(blob.includes("TRAIN_TRACE_PAYMENTS"), true);
    assert.equal(blob.includes("TRAIN_TRACE_EXTRA"), true);
    assert.deepEqual(holdoutHits(blob, tasks), []);
    assert.match(prompts[0], /## Misses/);
    assert.match(prompts[0], /## Extra calls/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a leaking skill is not committed", async () => {
  const root = mkdtempSync(join(tmpdir(), "skillsmith-leak-"));
  const rel = "agent/skills/fitforge-notes/SKILL.md";
  mkdirSync(join(root, "agent/skills/fitforge-notes"), { recursive: true });
  const seed = readFileSync(join(ROOT, rel), "utf8");
  writeFileSync(join(root, rel), seed);
  const commits: string[] = [];
  const forge: Forge = {
    async diagnose() {
      return { sessionId: "diag_2", text: "No names here." };
    },
    async rewrite() {
      return {
        sessionId: "rewrite_2",
        text: `<<<FILE agent/skills/fitforge-notes/SKILL.md\n---\nname: fitforge-notes\ndescription: Working notes for the FitForge tools. Read this before answering a question about FitForge.\n---\n\n# FitForge notes\n\nRemember gym_lac.\n>>>\n<<<LEARNED\nnone\n>>>`,
      };
    },
  };
  const results: ResultRow[] = [
    { task_id: "02-lac-march-net", holdout: false, passed: false, correct: false, score: 0, actual_calls: 3, best_calls: 4, reply: "x", turn_id: "t", parsed: true },
  ];
  try {
    await assert.rejects(
      () => improveRun({
        root,
        tasks,
        results,
        session: { turns: [{ id: "t", events: [] }] },
        runLabel: "01",
        forge,
        commit: (m) => commits.push(m),
      }),
      /leak guard/,
    );
    assert.equal(commits.length, 0);
    assert.equal(readFileSync(join(root, rel), "utf8"), seed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
