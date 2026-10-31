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
const ALLOWED = /^agent\/skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md$/;

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
  const holdouts = tasks.filter((t) => t.holdout).map((t) => ({ id: t.id, question: t.question, answer: t.answer ?? "" }));
  const wanted = new Set<string>();
  for (const t of holdouts) {
    wanted.add(t.id);
    wanted.add(t.question);
    wanted.add(String(t.answer));
    if (typeof t.answer === "number" && Number.isFinite(t.answer)) wanted.add(String(Math.round(t.answer * 1000)));
  }
  return findLeaks(prompt, holdouts).filter((hit) => wanted.has(hit));
}

/** First line only, capped, and never a trailer or a leak. */
export function sanitizeLearned(raw: string, tasks: { id: string; question: string; answer?: number | string }[]): string {
  const line = (raw.split(/\r?\n/).find((s) => s.trim()) ?? "").trim().slice(0, 200);
  const banned = /co-authored|claude|cursor|copilot|antigravity/i;
  if (!line || /^[\w-]+:\s/.test(line) || banned.test(line) || findLeaks(line, tasks.map((t) => ({ id: t.id, question: t.question, answer: t.answer ?? "" }))).length) {
    return "(no summary given)";
  }
  return line;
}

export function parseAgentEdit(text: string): { files: { path: string; text: string }[]; learned: string } {
  const files = [...text.matchAll(/<<<FILE ([^\n]+)\n([\s\S]*?)\n>>>/g)].map((m) => ({
    path: normalize(m[1].trim()).replaceAll("\\", "/"),
    text: m[2].trimEnd() + "\n",
  }));
  const learned = text.match(/<<<LEARNED\n([\s\S]*?)\n>>>/)?.[1].trim() ?? "";
  return { files, learned };
}

export function skillCommitMessage(nn: string, learned: string, sessionId: string, tasks: { id: string; question: string; answer?: number | string }[]): string {
  return `agent: learn from run ${nn}\n\n${sanitizeLearned(learned, tasks)}\n\nAgent-Session: ${sessionId}`;
}

/** Stage `spec`, refuse if anything else is already staged, then commit only `spec`. */
export function commitChecked(runGit: (...args: string[]) => string, message: string, spec: string[]): void {
  runGit("add", "--", ...spec);
  const staged = runGit("diff", "--cached", "--name-only").split(/\r?\n/).map((s) => s.trim().replaceAll("\\", "/")).filter(Boolean);
  const ok = (name: string) => name.startsWith("agent/") || spec.includes(name);
  const bad = staged.filter((name) => !ok(name));
  if (bad.length) throw new Error(`refusing to commit ${bad.join(", ")}`);
  runGit("commit", "-q", "-m", message, "--", ...spec);
}

export interface ImproveInput {
  root: string;
  tasks: Task[];
  results: ResultRow[];
  session: TraceSession;
  runLabel: string;
  forge: Forge;
  allowLeaks?: boolean;
  onDiagnoseSession?: (sessionId: string) => Promise<void>;
  onRewriteSession?: (sessionId: string) => Promise<void>;
  commit?: (message: string) => void;
}

export async function improveRun(opts: ImproveInput): Promise<{ rewriteSessionId: string; message: string } | { skipped: true }> {
  const byId = new Map(opts.tasks.map((t) => [t.id, t]));
  const items = classifyTrain(opts.results, byId, opts.session);
  if (!items.length) return { skipped: true };

  const dPrompt = diagnosisPrompt(opts.runLabel, items);
  // Train traces contain small counts beside names. Those match holdout answers "2" and "14".
  const hidden = holdoutHits(dPrompt, opts.tasks).filter((h) => !/^\d{1,2}$/.test(h));
  if (hidden.length) throw new Error(`diagnosis prompt includes holdout ${hidden.join(", ")}`);

  const diagnosis = await opts.forge.diagnose(dPrompt);
  if (opts.onDiagnoseSession) await opts.onDiagnoseSession(diagnosis.sessionId);
  const skillPath = join(opts.root, SKILL_PATH);
  const current = readFileSync(skillPath, "utf8");
  const rPrompt = rewritePrompt(current, diagnosis.text);
  const hiddenRewrite = holdoutHits(rPrompt, opts.tasks).filter((h) => !/^\d{1,2}$/.test(h));
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
  for (const f of files) {
    if (!/^---\n[\s\S]*?\bname:[\s\S]*?\bdescription:[\s\S]*?\n---\n/.test(f.text) || f.text.split("\n").length < 6) {
      throw new Error(`${f.path} lost its frontmatter`);
    }
  }

  for (const f of files) {
    const dest = join(opts.root, f.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, f.text);
  }
  if (opts.onRewriteSession) await opts.onRewriteSession(rewrite.sessionId);
  const message = skillCommitMessage(opts.runLabel, learned, rewrite.sessionId, opts.tasks);
  if (opts.commit) opts.commit(message);
  return { rewriteSessionId: rewrite.sessionId, message };
}
