// The scorer. Deterministic: same reply in, same number out. Higher is better.
// Don't change it (or evals/tasks/) after run 1: every run must be scored the same way.
//
//   npm run score -- runs/run-01     re-score a saved run from its results.json
//   npm run score -- --selftest      check the scorer on perfect, empty and noisy answers
//
// Per question:
//   wrong (or unparseable) → 0
//   correct → 0.8 + 0.2 * min(1, best_calls / actual_calls)
// Text is an exact match after normalization. Numbers match within ±0.01.
// actual_calls of 0 makes the ratio 1, because best/0 is unbounded and the ratio is capped.
// Run score = 100 × the mean task score.
// A task passes when the answer is correct and the call ratio is 1.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const NUMERIC_TOLERANCE = 0.01;

export interface ScoredTask {
  id: string;
  title: string;
  holdout?: boolean;
  question: string;
  answer_type: "number" | "text";
  answer: number | string;
  best_calls: number;
}

export interface TaskScore {
  task_id: string;
  holdout: boolean;
  score: number; // 0..1
  passed: boolean;
  parsed: boolean;
  correct: boolean;
  best_calls: number;
  actual_calls: number;
}

/** Trim, casefold, collapse whitespace, and normalize spaces around commas. */
export function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim();
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
  return null;
}

/** The `answer` field from the last ```json block, or from a bare JSON object. */
export function parseAnswer(reply: string): unknown {
  const blocks = [...reply.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = blocks.length ? [blocks[blocks.length - 1]] : [reply.trim() ? [reply] : []].flat();
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c.trim()) as unknown;
      if (obj && typeof obj === "object" && !Array.isArray(obj) && "answer" in obj) {
        return (obj as { answer: unknown }).answer;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function answersMatch(task: ScoredTask, got: unknown): boolean {
  if (task.answer_type === "number") {
    const actual = asNumber(got);
    const expected = asNumber(task.answer);
    if (actual == null || expected == null) return false;
    // 1e-9 absorbs binary dust on the ±0.01 boundary (105.01 - 105 is slightly over 0.01).
    return Math.abs(actual - expected) <= NUMERIC_TOLERANCE + 1e-9;
  }
  if (typeof got !== "string" && typeof got !== "number") return false;
  return normalizeText(String(got)) === normalizeText(String(task.answer));
}

/** Ratio capped at 1. A non-positive actual call count yields 1 (best/0 is unbounded). */
export function callRatio(best: number, actual: number): number {
  if (!(actual > 0)) return 1;
  return Math.min(1, best / actual);
}

export function scoreTask(task: ScoredTask, reply: string, actualCalls = task.best_calls): TaskScore {
  const base = {
    task_id: task.id,
    holdout: !!task.holdout,
    best_calls: task.best_calls,
    actual_calls: actualCalls,
  };
  const got = parseAnswer(reply);
  if (got === undefined) {
    return { ...base, score: 0, passed: false, parsed: false, correct: false };
  }
  const correct = answersMatch(task, got);
  const ratio = callRatio(task.best_calls, actualCalls);
  const score = correct ? 0.8 + 0.2 * ratio : 0;
  return {
    ...base,
    score: round(score, 4),
    passed: correct && ratio === 1,
    parsed: true,
    correct,
  };
}

export function scoreRun(tasks: TaskScore[]): { score: number; tasks_passed: number; tasks_total: number } {
  const mean = tasks.length ? tasks.reduce((s, t) => s + t.score, 0) / tasks.length : 0;
  return { score: round(100 * mean, 2), tasks_passed: tasks.filter((t) => t.passed).length, tasks_total: tasks.length };
}

function round(x: number, d: number): number {
  const k = 10 ** d;
  return Math.round(x * k) / k;
}

// ---------- CLI ----------

const here = dirname(fileURLToPath(import.meta.url));

function loadTasks(): ScoredTask[] {
  const dir = join(here, "tasks");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as ScoredTask);
}

function reply(answer: number | string): string {
  return "```json\n" + JSON.stringify({ answer }) + "\n```\n";
}

function selftest(): void {
  const tasks = loadTasks();
  const perfect = tasks.map((t) => scoreTask(t, reply(t.answer), t.best_calls));
  const empty = tasks.map((t) => scoreTask(t, reply(t.answer_type === "number" ? -1 : "___nope___"), t.best_calls));
  const garbage = tasks.map((t) => scoreTask(t, "I could not find anything."));
  const costly = tasks.map((t) => scoreTask(t, reply(t.answer), t.best_calls * 2));
  const check = (name: string, got: number, want: number) => {
    const ok = got === want;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${got}${ok ? "" : ` (want ${want})`}`);
    if (!ok) process.exitCode = 1;
  };
  check("perfect answers score", scoreRun(perfect).score, 100);
  check("perfect answers pass", scoreRun(perfect).tasks_passed, tasks.length);
  check("wrong answers score", scoreRun(empty).score, 0);
  check("unparseable answers score", scoreRun(garbage).score, 0);
  check("correct but twice the calls", scoreRun(costly).score, 90);

  const sample = tasks.find((t) => t.answer_type === "number");
  if (!sample || typeof sample.answer !== "number") {
    console.log("FAIL no numeric task");
    process.exitCode = 1;
    return;
  }
  check("tolerance includes +0.01", scoreTask(sample, reply(sample.answer + 0.01)).score, 1);
  check("tolerance rejects +0.02", scoreTask(sample, reply(sample.answer + 0.02)).score, 0);
  const text = tasks.find((t) => t.answer_type === "text" && String(t.answer).includes(","));
  if (!text) {
    console.log("FAIL no list answer");
    process.exitCode = 1;
    return;
  }
  const sloppy = String(text.answer).toUpperCase().replace(", ", ",");
  check("normalized text matches", scoreTask(text, reply(sloppy)).score, 1);
}

function rescore(dir: string): void {
  const results = JSON.parse(readFileSync(join(resolve(dir), "results.json"), "utf8")) as {
    task_id: string;
    reply: string;
    actual_calls?: number;
  }[];
  const tasks = new Map(loadTasks().map((t) => [t.id, t]));
  const scored = results.map((r) => {
    const t = tasks.get(r.task_id);
    if (!t) throw new Error(`unknown task ${r.task_id}`);
    return scoreTask(t, r.reply, r.actual_calls ?? t.best_calls);
  });
  for (const s of scored) {
    console.log(
      `${s.passed ? "pass" : "    "} ${s.task_id.padEnd(28)} ${s.score.toFixed(2)}  ${s.correct ? "ok" : "wrong"}  calls ${s.actual_calls}/${s.best_calls}`,
    );
  }
  console.log(JSON.stringify(scoreRun(scored)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === "--selftest") selftest();
  else if (arg) rescore(arg);
  else console.log("usage: npm run score -- runs/run-NN | --selftest");
}
