import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { dataset } from "../mcp/dataset.ts";
import { buildTasks } from "./ground-truth.ts";
import { tunisHHMM, inInstantRange, tunisStart } from "../mcp/time.ts";

const tasksDir = join(import.meta.dirname, "tasks");

test("committed tasks and fixture match the generator", () => {
  const built = buildTasks();
  const files = readdirSync(tasksDir).filter((f) => f.endsWith(".json")).sort();
  assert.deepEqual(
    files,
    built.map((t) => `${t.id}.json`),
  );
  for (const t of built) {
    const onDisk = JSON.parse(readFileSync(join(tasksDir, `${t.id}.json`), "utf8"));
    assert.deepEqual(onDisk, t);
  }
  const frozen = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "fitforge.json"), "utf8"));
  assert.deepEqual(frozen, dataset);
});

test("split is 14 train and 6 holdout", () => {
  const tasks = buildTasks();
  assert.equal(tasks.length, 20);
  assert.equal(tasks.filter((t) => t.holdout).length, 6);
  assert.deepEqual(
    tasks.filter((t) => t.holdout).map((t) => t.id),
    [
      "15-boxe-free-seats",
      "16-sousse-april-net",
      "17-sfax-classes-2-apr",
      "18-omar-march-method",
      "19-zumba-booked-names",
      "20-sarra-april-net",
    ],
  );
});

test("known answers from the fixture", () => {
  const byId = new Map(buildTasks().map((t) => [t.id, t.answer]));
  assert.equal(byId.get("01-lac-current-members"), 6);
  assert.equal(byId.get("02-lac-march-net"), 375);
  assert.equal(byId.get("03-yoga-bookings"), 5);
  assert.equal(byId.get("04-amira-owed"), 25);
  assert.equal(byId.get("05-lac-classes-15-mar"), 3);
  assert.equal(byId.get("06-yoga-instructor"), "Sarra Ben Romdhane");
  assert.equal(byId.get("07-youssef-sfax-status"), "frozen");
  assert.equal(byId.get("08-nour-current"), "no");
  assert.equal(byId.get("09-lac-march-refunds"), 95);
  assert.equal(byId.get("10-sunrise-local-time"), "00:30");
  assert.equal(byId.get("11-sunrise-booked-names"), "Amina Sfar, Ines Gharbi");
  assert.equal(byId.get("12-lac-march-invoices"), 7);
  assert.equal(byId.get("13-ariana-status"), "closed");
  assert.equal(byId.get("14-amira-march-net"), 105);
  assert.equal(byId.get("15-boxe-free-seats"), 14);
  assert.equal(byId.get("16-sousse-april-net"), 180);
  assert.equal(byId.get("17-sfax-classes-2-apr"), 2);
  assert.equal(byId.get("18-omar-march-method"), "cash");
  assert.equal(byId.get("19-zumba-booked-names"), "Ahmed Ben Youssef, Bilel Trabelsi, Hayet Khemiri, Nadia Jmal, Youssef Hammami");
  assert.equal(byId.get("20-sarra-april-net"), 90);
});

test("every reference plan makes at least one call", () => {
  for (const t of buildTasks()) assert.ok(t.best_calls >= 1, t.id);
});

test("name lookups that omit status or the start time stay at 3 calls", () => {
  const calls = new Map(buildTasks().map((t) => [t.id, t.best_calls]));
  assert.equal(calls.get("03-yoga-bookings"), 3);
  assert.equal(calls.get("07-youssef-sfax-status"), 3);
});

test("Tunis offset puts 23:30Z on the next local calendar day", () => {
  assert.equal(tunisHHMM("2026-03-14T23:30:00.000Z"), "00:30");
  const march = [tunisStart(2026, 3, 1), tunisStart(2026, 4, 1)] as const;
  assert.equal(inInstantRange("2026-02-28T23:30:00.000Z", march[0], march[1]), true);
  assert.equal(inInstantRange("2026-03-31T22:30:00.000Z", march[0], march[1]), true);
  assert.equal(inInstantRange("2026-03-31T23:30:00.000Z", march[0], march[1]), false);
});

test("fixture references resolve and refunds do not exceed the payment", () => {
  const gyms = new Set(dataset.gyms.map((g) => g.id));
  const members = new Set(dataset.members.map((m) => m.id));
  const classes = new Set(dataset.classes.map((c) => c.id));
  const invoices = new Map(dataset.invoices.map((i) => [i.id, i]));
  const payments = new Map(dataset.payments.map((p) => [p.id, p]));
  for (const m of dataset.members) assert.ok(gyms.has(m.gym_id));
  for (const c of dataset.classes) assert.ok(gyms.has(c.gym_id));
  for (const b of dataset.bookings) {
    assert.ok(classes.has(b.class_id));
    assert.ok(members.has(b.member_id));
  }
  for (const i of dataset.invoices) {
    assert.ok(members.has(i.member_id));
    assert.ok(gyms.has(i.gym_id));
  }
  for (const p of dataset.payments) {
    const inv = invoices.get(p.invoice_id);
    assert.ok(inv);
    assert.equal(p.member_id, inv.member_id);
    assert.equal(p.gym_id, inv.gym_id);
    assert.equal(p.amount_millimes, inv.amount_millimes);
  }
  for (const r of dataset.refunds) {
    const pay = payments.get(r.payment_id);
    assert.ok(pay);
    assert.equal(r.member_id, pay.member_id);
    assert.equal(r.gym_id, pay.gym_id);
    assert.ok(r.amount_millimes <= pay.amount_millimes);
  }
  const ids = [
    ...dataset.gyms,
    ...dataset.members,
    ...dataset.classes,
    ...dataset.bookings,
    ...dataset.invoices,
    ...dataset.payments,
    ...dataset.refunds,
  ].map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});
