import assert from "node:assert/strict";
import { test } from "node:test";
import { answersMatch, callRatio, normalizeText, parseAnswer, scoreRun, scoreTask, type ScoredTask } from "./score.ts";

function task(over: Partial<ScoredTask> = {}): ScoredTask {
  return {
    id: "t",
    title: "t",
    question: "q",
    answer_type: "number",
    answer: 10,
    best_calls: 4,
    ...over,
  };
}

function reply(answer: unknown): string {
  return "note\n\n```json\n" + JSON.stringify({ answer }) + "\n```\n";
}

test("wrong and unparseable score 0", () => {
  assert.equal(scoreTask(task(), reply(3), 4).score, 0);
  assert.equal(scoreTask(task(), "no json here", 1).score, 0);
  assert.equal(scoreTask(task(), "no json here", 1).parsed, false);
});

test("correct and efficient scores 1 and passes", () => {
  const s = scoreTask(task(), reply(10), 4);
  assert.equal(s.score, 1);
  assert.equal(s.passed, true);
  assert.equal(s.correct, true);
});

test("correct with extra calls keeps the 0.8 floor", () => {
  const s = scoreTask(task({ best_calls: 2 }), reply(10), 4);
  assert.equal(s.score, 0.9);
  assert.equal(s.passed, false);
});

test("fewer calls than the reference still cap at 1", () => {
  assert.equal(scoreTask(task({ best_calls: 5 }), reply(10), 1).score, 1);
  assert.equal(callRatio(5, 0), 1);
});

test("numeric tolerance is ±0.01 inclusive", () => {
  const t = task({ answer: 105 });
  assert.equal(answersMatch(t, 105.01), true);
  assert.equal(answersMatch(t, 104.99), true);
  assert.equal(answersMatch(t, "105.000"), true);
  assert.equal(answersMatch(t, 105.02), false);
  assert.equal(answersMatch(t, "105 TND"), false);
});

test("text normalization", () => {
  const t = task({ answer_type: "text", answer: "Amina Sfar, Ines Gharbi" });
  assert.equal(normalizeText("  AMINA   SFAR,ines gharbi "), "amina sfar, ines gharbi");
  assert.equal(answersMatch(t, "amina  sfar,ines gharbi"), true);
  assert.equal(answersMatch(t, "Ines Gharbi, Amina Sfar"), false);
});

test("last json block wins", () => {
  const raw = "```json\n{\"answer\": 1}\n```\n```json\n{\"answer\": 10}\n```";
  assert.equal(parseAnswer(raw), 10);
});

test("run score is 100 times the mean", () => {
  const a = scoreTask(task(), reply(10), 4);
  const b = scoreTask(task({ id: "u", answer: 1 }), reply(9), 4);
  assert.equal(scoreRun([a, b]).score, 50);
  assert.equal(scoreRun([a, b]).tasks_passed, 1);
});
