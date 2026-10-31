import assert from "node:assert/strict";
import { test } from "node:test";
import { findLeaks, type LeakTask } from "./leaks.ts";

const tasks: LeakTask[] = [
  { id: "01-lac-current-members", question: "How many current members does FitForge Lac have?", answer: 6 },
  { id: "04-amira-owed", question: "How much does Amira Ben Ali still owe FitForge Lac, in TND?", answer: 25 },
  { id: "03-yoga-bookings", question: "How many bookings for Morning Yoga at FitForge Lac are not cancelled?", answer: 5 },
  { id: "08-nour-current", question: "Is Nour El Houda a current member of FitForge Lac?", answer: "no" },
  { id: "02-lac-march-net", question: "What is the net amount collected at FitForge Lac during March 2026?", answer: 375 },
  { id: "10-sunrise-local-time", question: "At what time of day does Sunrise HIIT at FitForge Lac start?", answer: "00:30" },
  { id: "07-youssef-sfax-status", question: "What is the membership status of Youssef Hammami at FitForge Sfax?", answer: "frozen" },
  { id: "13-ariana-status", question: "What is the status of the FitForge Ariana gym?", answer: "closed" },
  { id: "18-omar-march-method", question: "What payment method was used for Omar Cherif in March?", answer: "cash" },
];

function has(text: string, bit: string): boolean {
  return findLeaks(text, tasks).some((h) => h.toLowerCase() === bit.toLowerCase());
}

test("blocks the memorized train note and id or unit disguises", () => {
  const note = "Lac: 6 current. Amira owes 25. Yoga booked 5 ... Nour: no.";
  for (const bit of ["Lac", "6", "Amira", "25", "Yoga", "5", "Nour", "no"]) assert.ok(has(note, bit), bit);
  assert.ok(has("see gym-lac", "gym_lac"));
  assert.ok(has("see mem-01", "mem_01"));
  assert.ok(has("Amira\nBen Ali", "Amira"));
  assert.ok(has("375000 millimes", "375000"));
  assert.ok(has("The gym id is gym_lac.", "gym_lac"));
  assert.ok(has("The March net was 375.", "375"));
  assert.ok(has("Sunrise starts at 00:30 local.", "00:30"));
});

test("schema words, Tunis, a bare clock time, and lowercase spin are allowed", () => {
  for (const ok of [
    "frozen or cancelled member is not current",
    "convert UTC to Tunis",
    "23:30 UTC is 00:30 next local day",
    "spin through every page",
    "Status values include closed.",
    "An enclosed error is still an error.",
    "There were 13750 millimes.",
    "Answer no when the row has a deletion timestamp.",
    "List tools return a page. Amounts are integers. The zone is Africa/Tunis, one hour ahead of UTC.",
  ]) {
    assert.deepEqual(findLeaks(ok, tasks), [], ok);
  }
});
