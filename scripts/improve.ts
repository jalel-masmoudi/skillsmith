// npm run improve [-- --run NN] [-- --no-commit] [-- --allow-leaks]
//
// 1. Reads the latest scored run. Training misses (answer did not match) and
//    training tasks that matched but used extra calls are kept. Holdouts are dropped.
// 2. A diagnosis session, with subagents enabled, reads those traces.
// 3. The agent itself rewrites agent/skills/fitforge-notes/SKILL.md.
// 4. The leak guard checks the edit. A clean edit is committed.
//    The message ends with Agent-Session: <rewrite session id>.
//
// Review the commit with git show. Drop it with git reset --hard HEAD~1.
// Then npm run eval.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TrueForge } from "@truefoundry/trueforge-sdk";
import type { Forge } from "./improve-loop.ts";
import { improveRun } from "./improve-loop.ts";
import type { ResultRow, TraceSession } from "./improve-loop.ts";
import {
  client,
  die,
  exportSession,
  flag,
  git,
  isClean,
  loadTasks,
  option,
  readAgent,
  ROOT,
  runDir,
  runTurn,
  SUMMARY_CSV,
  writeJson,
  type AgentFile,
} from "./lib.ts";

function liveForge(tf: TrueForge, agent: AgentFile): Forge {
  const quiet = (subagents: boolean) => ({
    askUserQuestions: { enabled: false },
    generativeUi: { enabled: false },
    dynamicSubAgents: { enabled: subagents },
    webSearch: { enabled: false },
  });
  return {
    async diagnose(prompt) {
      const { data: session } = await tf.sessions.create({
        agent: {
          spec: {
            model: agent.model,
            instructions: "You diagnose tool traces. Spawn one subagent per task. You do not edit files.",
            config: quiet(true),
          },
        },
        metadata: { purpose: "improve-diagnose" },
      });
      await tf.sessions.update(session.id, { title: "improve diagnose" });
      const turn = await runTurn(tf, session.id, prompt, false);
      if (turn.status !== "done") die(`diagnose ended ${turn.status}${turn.error ? `: ${turn.error}` : ""}`);
      return { sessionId: session.id, text: turn.text };
    },
    async rewrite(prompt) {
      const { data: session } = await tf.sessions.create({
        agent: { name: agent.name },
        metadata: { purpose: "improve-rewrite" },
      });
      await tf.sessions.update(session.id, { title: "improve rewrite skill" });
      const turn = await runTurn(tf, session.id, prompt, false);
      if (turn.status !== "done") die(`rewrite ended ${turn.status}${turn.error ? `: ${turn.error}` : ""}`);
      return { sessionId: session.id, text: turn.text };
    },
  };
}

const rows = existsSync(SUMMARY_CSV) ? readFileSync(SUMMARY_CSV, "utf8").trim().split("\n").slice(1).filter(Boolean) : [];
if (!rows.length) die("No runs yet. Run npm run eval first.");
const run = Number(option("run") ?? rows.length);
const dir = runDir(run);
const nn = String(run).padStart(2, "0");
if (!existsSync(join(dir, "results.json"))) die(`No results for run ${nn} in ${dir}`);
if (!existsSync(join(dir, "session.json"))) die(`No session trace for run ${nn} in ${dir}`);
if (!isClean("agent")) die("agent/ has uncommitted changes. Commit or discard them first: the agent's change must be its own.");

const results = JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as ResultRow[];
const session = JSON.parse(readFileSync(join(dir, "session.json"), "utf8")) as TraceSession;
const { agent } = readAgent();
const tf = client();

try {
  const outcome = await improveRun({
    root: ROOT,
    tasks: loadTasks(),
    results,
    session,
    runLabel: nn,
    forge: liveForge(tf, agent),
    allowLeaks: flag("allow-leaks"),
    onRewriteSession: async (id) => {
      writeJson(join(dir, "improve-session.json"), await exportSession(tf, id));
    },
    commit: flag("no-commit")
      ? undefined
      : (message) => {
          git("add", "agent", join(dir, "improve-session.json"));
          git("commit", "-q", "-m", message);
          console.log(`\nCommitted the agent's change.\n${message}`);
          console.log("Review it: git show    Drop it: git reset --hard HEAD~1    Then: npm run eval");
        },
  });
  if ("skipped" in outcome) {
    console.log(`Nothing to learn from run ${nn}: every training task matched in a short number of calls.`);
  } else if (flag("no-commit")) {
    console.log(`\nSkill written, not committed.\n${outcome.message}`);
  }
} catch (e) {
  die((e as Error).message);
}
