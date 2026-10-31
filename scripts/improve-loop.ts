// Train-only packet for `npm run improve`.
// Misses are training tasks whose answer did not match.
// Extra calls are training tasks whose answer matched but used more calls than a short solution.
// Holdout tasks are never copied into either prompt.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { Task } from "./lib.ts";
import { findLeaks } from "./leaks.ts";

export interface ResultRow {
  task_id: string;
  holdout?: boolean;
  passed: boolean;
  correct: boolean;
  score: number;
  actual_calls: number;
  best_calls: number;
  reply?: string;
  turn_id?: string;
  parsed?: boolean;
}

export interface TraceSession {
  turns: { id: string; events?: readonly object[] }[];
}

export type TrainKind = "miss" | "extra_calls";

export interface TrainItem {
  kind: TrainKind;
  id: string;
  question: string;
  score: number;
  actual_calls: number;
  best_calls: number;
  replyTail: string;
  trace: string;
}

export interface Forge {
  diagnose(prompt: string): Promise<{ sessionId: string; text: string }>;
  rewrite(prompt: string): Promise<{ sessionId: string; text: string }>;
}

const SKILL_PATH = "agent/skills/fitforge-notes/SKILL.md";
const ALLOWED = /^agent\/(instructions\.md|skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md)$/;

export function toolTrace(events: readonly object[] | undefined): string {
  const lines: string[] = [];
  for (const e of events ?? []) {
    const rec = e as {
      type?: string;
      content?: unknown;
      toolCalls?: { function?: { name?: string; arguments?: string }; toolInfo?: { name?: string }; tool_info?: { name?: string } }[];
      tool_calls?: { function?: { name?: string; arguments?: string }; toolInfo?: { name?: string }; tool_info?: { name?: string } }[];
    };
    if (rec.type === "model.message") {
      const calls = rec.toolCalls ?? rec.tool_calls ?? [];
      for (const c of calls) {
        const info = c.toolInfo ?? c.tool_info;
        const name = info?.name ?? c.function?.name ?? "tool";
        lines.push(`call ${name} ${c.function?.arguments ?? ""}`.slice(0, 240));
      }
    } else if (rec.type === "tool.response") {
      lines.push(`result ${String(rec.content ?? "").slice(0, 360)}`);
    }
  }
  return lines.join("\n").slice(0, 1800);
}

export function classifyTrain(results: ResultRow[], tasks: Map<string, Task>, session: TraceSession): TrainItem[] {
  const turns = new Map(session.turns.map((t) => [t.id, t.events]));
  const items: TrainItem[] = [];
  for (const r of results) {
    if (r.holdout) continue;
    const kind: TrainKind | undefined = !r.correct ? "miss" : r.actual_calls > r.best_calls ? "extra_calls" : undefined;
    if (!kind) continue;
    const task = tasks.get(r.task_id);
    if (!task) throw new Error(`unknown task ${r.task_id}`);
    if (task.holdout) throw new Error(`holdout task ${r.task_id} was not marked on the result`);
    if (r.turn_id && !turns.has(r.turn_id)) throw new Error(`no trace for ${r.task_id}`);
    items.push({
      kind,
      id: r.task_id,
      question: task.question,
      score: r.score,
      actual_calls: r.actual_calls,
      best_calls: r.best_calls,
      replyTail: (r.reply ?? "").slice(-400),
      trace: toolTrace(r.turn_id ? turns.get(r.turn_id) : []),
    });
  }
  return items;
}

function block(item: TrainItem): string {
  return [
    `### ${item.id}`,
    `Score ${item.score}. Tool calls: ${item.actual_calls} (a short solution uses ${item.best_calls}).`,
    "Question:",
    item.question,
    "Reply tail:",
    item.replyTail || "(empty)",
    "Tool trace:",
    item.trace || "(no tool calls)",
  ].join("\n");
}

export function diagnosisPrompt(nn: string, items: TrainItem[]): string {
  const misses = items.filter((i) => i.kind === "miss");
  const extra = items.filter((i) => i.kind === "extra_calls");
  return [
    `You diagnose training tasks from run ${nn}. Spawn one subagent per task.`,
    "A subagent reads only that task's tool trace and writes two sentences about how the tools behaved.",
    "Do not write a skill file. Do not add tasks that are not listed here.",
    "",
    "## Misses",
    "These answers did not match.",
    "",
    misses.map(block).join("\n\n") || "(none)",
    "",
    "## Extra calls",
    "These answers matched, and they used more tool calls than a short solution.",
    "",
    extra.map(block).join("\n\n") || "(none)",
  ].join("\n");
}

export function rewritePrompt(currentSkill: string, diagnosis: string): string {
  return [
    "This is not a question to answer. Rewrite your skill from the diagnosis.",
    "Misses are answers that did not match. Extra calls are answers that matched but took more calls than a short solution.",
    "",
    "Rules:",
    "- Write general notes about how the tools behave.",
    "- Do not paste a question, a task id, an answer, or a name or id from the data.",
    "- Keep the frontmatter (name and description).",
    "",
    "Return only this shape:",
    "",
    "<<<FILE agent/skills/fitforge-notes/SKILL.md",
    "(the whole file)",
    ">>>",
    "<<<LEARNED",
    "(one sentence)",
    ">>>",
    "",
    "## Current skill",
    "",
    currentSkill.trim(),
    "",
    "## Diagnosis",
    "",
    diagnosis.trim(),
  ].join("\n");
}

export function holdoutHits(prompt: string, tasks: { id: string; holdout?: boolean; question: string; answer?: number | string }[]): string[] {
  const folded = prompt.replace(/[\s\u00a0]+/g, " ").replace(/-/g, "_").toLowerCase();
  const hits: string[] = [];
  for (const t of tasks) {
    if (!t.holdout) continue;
    const id = t.id.toLowerCase().replace(/-/g, "_");
    if (id && folded.includes(id)) hits.push(t.id);
    const question = t.question.replace(/[\s\u00a0]+/g, " ").replace(/-/g, "_").toLowerCase();
    if (question && folded.includes(question)) hits.push(t.id);
    const answer = String(t.answer ?? "").trim();
    if (answer.length >= 12 && folded.includes(answer.toLowerCase().replace(/-/g, "_"))) hits.push(t.id);
  }
  return hits;
}

export function parseAgentEdit(text: string): { files: { path: string; text: string }[]; learned: string } {
  const files = [...text.matchAll(/<<<FILE ([^\n]+)\n([\s\S]*?)\n>>>/g)].map((m) => ({
    path: normalize(m[1].trim()).replaceAll("\\", "/"),
    text: m[2].trimEnd() + "\n",
  }));
  const learned = text.match(/<<<LEARNED\n([\s\S]*?)\n>>>/)?.[1].trim() ?? "";
  return { files, learned };
}

export function skillCommitMessage(nn: string, learned: string, sessionId: string): string {
  return `agent: learn from run ${nn}\n\n${learned || "(no summary given)"}\n\nAgent-Session: ${sessionId}`;
}

export interface ImproveInput {
  root: string;
  tasks: Task[];
  results: ResultRow[];
  session: TraceSession;
  runLabel: string;
  forge: Forge;
  allowLeaks?: boolean;
  onRewriteSession?: (sessionId: string) => Promise<void>;
  commit?: (message: string) => void;
}

export async function improveRun(opts: ImproveInput): Promise<{ rewriteSessionId: string; message: string } | { skipped: true }> {
  const byId = new Map(opts.tasks.map((t) => [t.id, t]));
  const items = classifyTrain(opts.results, byId, opts.session);
  if (!items.length) return { skipped: true };

  const dPrompt = diagnosisPrompt(opts.runLabel, items);
  const hidden = holdoutHits(dPrompt, opts.tasks);
  if (hidden.length) throw new Error(`diagnosis prompt includes holdout ${hidden.join(", ")}`);

  const diagnosis = await opts.forge.diagnose(dPrompt);
  const skillPath = join(opts.root, SKILL_PATH);
  const current = readFileSync(skillPath, "utf8");
  const rPrompt = rewritePrompt(current, diagnosis.text);
  const hiddenRewrite = holdoutHits(rPrompt, opts.tasks);
  if (hiddenRewrite.length) throw new Error(`rewrite prompt includes holdout ${hiddenRewrite.join(", ")}`);

  const rewrite = await opts.forge.rewrite(rPrompt);
  const { files, learned } = parseAgentEdit(rewrite.text);
  if (!files.length) throw new Error("the agent proposed no files");
  for (const f of files) {
    if (!ALLOWED.test(f.path)) throw new Error(`refusing to write ${f.path}`);
  }

  if (!opts.allowLeaks) {
    const leaks: string[] = [];
    for (const f of files) for (const hit of findLeaks(f.text, opts.tasks)) leaks.push(`${f.path} quotes "${hit.slice(0, 80)}"`);
    if (leaks.length) throw new Error(`leak guard:\n${leaks.join("\n")}`);
  }
  for (const f of files.filter((f) => f.path.endsWith("/SKILL.md"))) {
    if (!/^---\n[\s\S]*?\bname:[\s\S]*?\bdescription:[\s\S]*?\n---\n/.test(f.text) || f.text.split("\n").length < 6) {
      throw new Error(`${f.path} lost its frontmatter`);
    }
  }
  const instructions = files.find((f) => f.path === "agent/instructions.md");
  if (instructions && !instructions.text.includes('"answer"')) throw new Error("instructions dropped the answer format");

  for (const f of files) {
    const dest = join(opts.root, f.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, f.text);
  }
  if (opts.onRewriteSession) await opts.onRewriteSession(rewrite.sessionId);
  const message = skillCommitMessage(opts.runLabel, learned, rewrite.sessionId);
  if (opts.commit) opts.commit(message);
  return { rewriteSessionId: rewrite.sessionId, message };
}
