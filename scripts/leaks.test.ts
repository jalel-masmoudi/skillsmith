import assert from "node:assert/strict";
import { test } from "node:test";
import { findLeaks, type LeakTask } from "./leaks.ts";

const tasks: LeakTask[] = [
  { id: "13-ariana-status", question: "What is the status of the FitForge Ariana gym?", answer: "closed" },
  { id: "07-youssef-sfax-status", question: "What is the membership status of Youssef Hammami at FitForge Sfax?", answer: "frozen" },
  { id: "10-sunrise-local-time", question: "At what time of day does Sunrise HIIT start?", answer: "00:30" },
  { id: "08-nour-current", question: "Is Nour El Houda a current member?", answer: "no" },
  { id: "02-lac-march-net", question: "What is the net amount collected at FitForge Lac during March 2026?", answer: 375 },
];

test("blocks fixture names, ids, and short answers as tokens", () => {
  assert.ok(findLeaks("The gym id is gym_lac.", tasks).includes("gym_lac"));
  assert.ok(findLeaks("Remember Amira Ben Ali owes money.", tasks).includes("Amira Ben Ali"));
  assert.ok(findLeaks("Status values include closed.", tasks).includes("closed"));
  assert.ok(findLeaks("A frozen membership is not current.", tasks).includes("frozen"));
  assert.ok(findLeaks("Sunrise starts at 00:30 local.", tasks).includes("00:30"));
  assert.ok(findLeaks("The March net was 375.", tasks).includes("375"));
});

test("does not flag a longer token or a clean note", () => {
  assert.equal(findLeaks("An enclosed error is still an error.", tasks).includes("closed"), false);
  assert.equal(findLeaks("There were 13750 millimes.", tasks).includes("375"), false);
  const clean = findLeaks("List tools return a page. Amounts are integers. The zone is Africa/Tunis, one hour ahead of UTC.", tasks);
  assert.deepEqual(clean, []);
});

test("a two-character answer is below the token rule", () => {
  assert.equal(findLeaks("Answer no when the row has a deletion timestamp.", tasks).includes("no"), false);
});
