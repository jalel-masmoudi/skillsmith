// Derives the 20 fixed questions and their answers from the frozen fixture.
// The task JSON files are written by scripts/generate-fitforge.ts. Do not edit answers by hand.

import { dataset, type Member } from "../mcp/dataset.ts";
import { invoke } from "../mcp/tools.ts";
import { inInstantRange, tunisHHMM, tunisStart } from "../mcp/time.ts";

export interface TaskFile {
  id: string;
  title: string;
  holdout: boolean;
  question: string;
  answer_type: "number" | "text";
  answer: number | string;
  best_calls: number;
}

type Counter = { n: number };

function call<T>(counter: Counter, name: string, args: Record<string, unknown> = {}): T {
  counter.n += 1;
  return invoke(name, args) as T;
}

interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

function allPages<T>(counter: Counter, name: string, args: Record<string, unknown>): T[] {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = call<Page<T>>(counter, name, cursor ? { ...args, cursor } : args);
    items.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return items;
}

function gymId(counter: Counter, name: string): string {
  const res = call<{ matches: { id: string; name: string }[] }>(counter, "search_gyms", { q: name });
  const hit = res.matches.find((m) => m.name === name);
  if (!hit) throw new Error(`missing gym ${name}`);
  return hit.id;
}

function memberHits(counter: Counter, name: string, gym_id?: string): { id: string; gym_id: string }[] {
  const args: Record<string, unknown> = { q: name };
  if (gym_id) args.gym_id = gym_id;
  return call<{ matches: { id: string; gym_id: string }[] }>(counter, "search_members", args).matches;
}

function classHits(counter: Counter, name: string, gym_id?: string): { id: string; gym_id: string }[] {
  const args: Record<string, unknown> = { q: name };
  if (gym_id) args.gym_id = gym_id;
  return call<{ matches: { id: string; gym_id: string }[] }>(counter, "search_classes", args).matches;
}

function tnd(millimes: number): number {
  return millimes / 1000;
}

function month(year: number, monthNum: number): [number, number] {
  return [tunisStart(year, monthNum, 1), tunisStart(year, monthNum + 1, 1)];
}

function day(year: number, monthNum: number, d: number): [number, number] {
  return [tunisStart(year, monthNum, d), tunisStart(year, monthNum, d + 1)];
}

function current(m: Member): boolean {
  return m.status === "active" && m.deleted_at == null;
}

function namesOf(ids: string[]): string {
  const names = ids.map((id) => {
    const m = dataset.members.find((x) => x.id === id);
    if (!m) throw new Error(`missing member ${id}`);
    return m.full_name;
  });
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return names.join(", ");
}

function netMillimes(gymIdValue: string | null, memberId: string | null, start: number, end: number): number {
  const pays = dataset.payments.filter((p) => (gymIdValue ? p.gym_id === gymIdValue : true) && (memberId ? p.member_id === memberId : true) && inInstantRange(p.paid_at, start, end));
  const refs = dataset.refunds.filter((r) => (gymIdValue ? r.gym_id === gymIdValue : true) && (memberId ? r.member_id === memberId : true) && inInstantRange(r.refunded_at, start, end));
  return pays.reduce((s, p) => s + p.amount_millimes, 0) - refs.reduce((s, r) => s + r.amount_millimes, 0);
}

interface Spec {
  id: string;
  title: string;
  holdout: boolean;
  question: string;
  answer_type: "number" | "text";
  answer: () => number | string;
  plan: (c: Counter) => number | string;
}

const [mar0, mar1] = month(2026, 3);
const [apr0, apr1] = month(2026, 4);
const [d15a, d15b] = day(2026, 3, 15);
const [d02a, d02b] = day(2026, 4, 2);

const specs: Spec[] = [
  {
    id: "01-lac-current-members",
    title: "Current members at Lac",
    holdout: false,
    question: "How many current members does FitForge Lac have? Current means status active and no deletion timestamp. Answer with a number.",
    answer_type: "number",
    answer: () => dataset.members.filter((m) => m.gym_id === "gym_lac" && current(m)).length,
    plan: (c) => {
      const id = gymId(c, "FitForge Lac");
      const rows = allPages<Member>(c, "list_members", { gym_id: id, status: "active" });
      return rows.filter((m) => m.deleted_at == null).length;
    },
  },
  {
    id: "02-lac-march-net",
    title: "Lac March net collected",
    holdout: false,
    question: "What is the net amount collected at FitForge Lac during March 2026, Africa/Tunis time, in TND? Net means payments minus refunds, using each record's own timestamp. Answer with a number.",
    answer_type: "number",
    answer: () => tnd(netMillimes("gym_lac", null, mar0, mar1)),
    plan: (c) => {
      const id = gymId(c, "FitForge Lac");
      const pays = allPages<{ paid_at: string; amount_millimes: number }>(c, "list_payments", { gym_id: id });
      const refs = allPages<{ refunded_at: string; amount_millimes: number }>(c, "list_refunds", { gym_id: id });
      const paid = pays.filter((p) => inInstantRange(p.paid_at, mar0, mar1)).reduce((s, p) => s + p.amount_millimes, 0);
      const back = refs.filter((r) => inInstantRange(r.refunded_at, mar0, mar1)).reduce((s, r) => s + r.amount_millimes, 0);
      return tnd(paid - back);
    },
  },
  {
    id: "03-yoga-bookings",
    title: "Morning Yoga bookings",
    holdout: false,
    question: "How many bookings for Morning Yoga at FitForge Lac on 15 March 2026 (Africa/Tunis) are not cancelled? Answer with a number.",
    answer_type: "number",
    answer: () => {
      const cls = dataset.classes.find((x) => x.gym_id === "gym_lac" && x.name === "Morning Yoga" && inInstantRange(x.starts_at, d15a, d15b));
      if (!cls) return 0;
      return dataset.bookings.filter((b) => b.class_id === cls.id && b.status !== "cancelled").length;
    },
    plan: (c) => {
      const gid = gymId(c, "FitForge Lac");
      const hits = classHits(c, "Morning Yoga", gid);
      const cls = hits[0];
      if (!cls) return 0;
      const rows = allPages<{ status: string }>(c, "list_bookings", { class_id: cls.id, status: "booked" });
      return rows.length;
    },
  },
  {
    id: "04-amira-owed",
    title: "Amira amount owed",
    holdout: false,
    question: "How much does Amira Ben Ali still owe FitForge Lac, in TND? Count open invoices only. Answer with a number.",
    answer_type: "number",
    answer: () => {
      const m = dataset.members.find((x) => x.full_name === "Amira Ben Ali" && x.gym_id === "gym_lac");
      if (!m) return 0;
      const sum = dataset.invoices.filter((i) => i.member_id === m.id && i.status === "open").reduce((s, i) => s + i.amount_millimes, 0);
      return tnd(sum);
    },
    plan: (c) => {
      const hits = memberHits(c, "Amira Ben Ali");
      const rows = allPages<{ status: string; amount_millimes: number }>(c, "list_invoices", { member_id: hits[0].id });
      return tnd(rows.filter((i) => i.status === "open").reduce((s, i) => s + i.amount_millimes, 0));
    },
  },
  {
    id: "05-lac-classes-15-mar",
    title: "Lac classes on 15 March",
    holdout: false,
    question: "How many classes at FitForge Lac start on 15 March 2026 (Africa/Tunis) and are not cancelled? Answer with a number.",
    answer_type: "number",
    answer: () => dataset.classes.filter((x) => x.gym_id === "gym_lac" && x.status !== "cancelled" && inInstantRange(x.starts_at, d15a, d15b)).length,
    plan: (c) => {
      const id = gymId(c, "FitForge Lac");
      const rows = allPages<{ status: string }>(c, "list_classes", { gym_id: id, from: new Date(d15a).toISOString(), to: new Date(d15b).toISOString() });
      return rows.filter((x) => x.status !== "cancelled").length;
    },
  },
  {
    id: "06-yoga-instructor",
    title: "Morning Yoga instructor",
    holdout: false,
    question: "Who teaches Morning Yoga at FitForge Lac on 15 March 2026 (Africa/Tunis)? Answer with the instructor's full name.",
    answer_type: "text",
    answer: () => {
      const cls = dataset.classes.find((x) => x.gym_id === "gym_lac" && x.name === "Morning Yoga" && inInstantRange(x.starts_at, d15a, d15b));
      if (!cls) throw new Error("missing class");
      return cls.instructor;
    },
    plan: (c) => {
      const gid = gymId(c, "FitForge Lac");
      const rows = allPages<{ name: string; instructor: string; starts_at: string }>(c, "list_classes", {
        gym_id: gid,
        from: new Date(d15a).toISOString(),
        to: new Date(d15b).toISOString(),
      });
      const cls = rows.find((x) => x.name === "Morning Yoga");
      if (!cls) throw new Error("missing class");
      return cls.instructor;
    },
  },
  {
    id: "07-youssef-sfax-status",
    title: "Youssef Hammami at Sfax",
    holdout: false,
    question: "What is the membership status of Youssef Hammami at FitForge Sfax? Answer with the status.",
    answer_type: "text",
    answer: () => {
      const m = dataset.members.find((x) => x.full_name === "Youssef Hammami" && x.gym_id === "gym_sfax");
      if (!m) throw new Error("missing member");
      return m.status;
    },
    plan: (c) => {
      const gid = gymId(c, "FitForge Sfax");
      const hits = memberHits(c, "Youssef Hammami", gid);
      const member = call<Member>(c, "get_member", { member_id: hits[0].id });
      return member.status;
    },
  },
  {
    id: "08-nour-current",
    title: "Nour El Houda current member",
    holdout: false,
    question: "Is Nour El Houda a current member of FitForge Lac? Current means status active and no deletion timestamp. Answer yes or no.",
    answer_type: "text",
    answer: () => {
      const m = dataset.members.find((x) => x.full_name === "Nour El Houda" && x.gym_id === "gym_lac");
      return m && current(m) ? "yes" : "no";
    },
    plan: (c) => {
      const hits = memberHits(c, "Nour El Houda");
      const member = call<Member>(c, "get_member", { member_id: hits[0].id });
      return member.status === "active" && member.deleted_at == null ? "yes" : "no";
    },
  },
  {
    id: "09-lac-march-refunds",
    title: "Lac March refunds",
    holdout: false,
    question: "What is the total of refunds at FitForge Lac during March 2026 (Africa/Tunis), in TND? Use the refund timestamp. Answer with a number.",
    answer_type: "number",
    answer: () => tnd(dataset.refunds.filter((r) => r.gym_id === "gym_lac" && inInstantRange(r.refunded_at, mar0, mar1)).reduce((s, r) => s + r.amount_millimes, 0)),
    plan: (c) => {
      const id = gymId(c, "FitForge Lac");
      const refs = allPages<{ refunded_at: string; amount_millimes: number }>(c, "list_refunds", { gym_id: id });
      return tnd(refs.filter((r) => inInstantRange(r.refunded_at, mar0, mar1)).reduce((s, r) => s + r.amount_millimes, 0));
    },
  },
  {
    id: "10-sunrise-local-time",
    title: "Sunrise HIIT local time",
    holdout: false,
    question: "At what time of day does Sunrise HIIT at FitForge Lac start, on the Africa/Tunis clock? Answer HH:MM, 24-hour.",
    answer_type: "text",
    answer: () => {
      const cls = dataset.classes.find((x) => x.name === "Sunrise HIIT" && x.gym_id === "gym_lac");
      if (!cls) throw new Error("missing class");
      return tunisHHMM(cls.starts_at);
    },
    plan: (c) => {
      const hits = classHits(c, "Sunrise HIIT");
      const cls = call<{ starts_at: string }>(c, "get_class", { class_id: hits[0].id });
      return tunisHHMM(cls.starts_at);
    },
  },
  {
    id: "11-sunrise-booked-names",
    title: "Sunrise HIIT booked names",
    holdout: false,
    question: "Which members have a non-cancelled booking for Sunrise HIIT at FitForge Lac? Answer with full names, comma-separated, alphabetical.",
    answer_type: "text",
    answer: () => {
      const cls = dataset.classes.find((x) => x.name === "Sunrise HIIT" && x.gym_id === "gym_lac");
      if (!cls) return "";
      const ids = dataset.bookings.filter((b) => b.class_id === cls.id && b.status !== "cancelled").map((b) => b.member_id);
      return namesOf(ids);
    },
    plan: (c) => {
      const hits = classHits(c, "Sunrise HIIT");
      const rows = allPages<{ member_id: string }>(c, "list_bookings", { class_id: hits[0].id, status: "booked" });
      const names = rows.map((b) => call<Member>(c, "get_member", { member_id: b.member_id }).full_name);
      names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return names.join(", ");
    },
  },
  {
    id: "12-lac-march-invoices",
    title: "Lac March invoices",
    holdout: false,
    question: "How many invoices were issued at FitForge Lac during March 2026 (Africa/Tunis), excluding void invoices? Use the invoice timestamp. Answer with a number.",
    answer_type: "number",
    answer: () => dataset.invoices.filter((i) => i.gym_id === "gym_lac" && i.status !== "void" && inInstantRange(i.issued_at, mar0, mar1)).length,
    plan: (c) => {
      const id = gymId(c, "FitForge Lac");
      const rows = allPages<{ status: string; issued_at: string }>(c, "list_invoices", { gym_id: id });
      return rows.filter((i) => i.status !== "void" && inInstantRange(i.issued_at, mar0, mar1)).length;
    },
  },
  {
    id: "13-ariana-status",
    title: "Ariana gym status",
    holdout: false,
    question: "What is the status of the FitForge Ariana gym? Answer with the status.",
    answer_type: "text",
    answer: () => {
      const g = dataset.gyms.find((x) => x.name === "FitForge Ariana");
      if (!g) throw new Error("missing gym");
      return g.status;
    },
    plan: (c) => {
      const id = gymId(c, "FitForge Ariana");
      return call<{ status: string }>(c, "get_gym", { gym_id: id }).status;
    },
  },
  {
    id: "14-amira-march-net",
    title: "Amira March net collected",
    holdout: false,
    question: "What is Amira Ben Ali's net amount collected at FitForge Lac during March 2026 (Africa/Tunis), in TND? Payments minus refunds, by each record's timestamp. Answer with a number.",
    answer_type: "number",
    answer: () => {
      const m = dataset.members.find((x) => x.full_name === "Amira Ben Ali" && x.gym_id === "gym_lac");
      if (!m) return 0;
      return tnd(netMillimes("gym_lac", m.id, mar0, mar1));
    },
    plan: (c) => {
      const hits = memberHits(c, "Amira Ben Ali");
      const pays = allPages<{ paid_at: string; amount_millimes: number }>(c, "list_payments", { member_id: hits[0].id });
      const refs = allPages<{ refunded_at: string; amount_millimes: number }>(c, "list_refunds", { member_id: hits[0].id });
      const paid = pays.filter((p) => inInstantRange(p.paid_at, mar0, mar1)).reduce((s, p) => s + p.amount_millimes, 0);
      const back = refs.filter((r) => inInstantRange(r.refunded_at, mar0, mar1)).reduce((s, r) => s + r.amount_millimes, 0);
      return tnd(paid - back);
    },
  },
  {
    id: "15-boxe-free-seats",
    title: "Free seats in Boxe",
    holdout: true,
    question: "How many seats are still free in Boxe at FitForge Lac on 15 March 2026 (Africa/Tunis)? Free means capacity minus non-cancelled bookings. Answer with a number.",
    answer_type: "number",
    answer: () => {
      const cls = dataset.classes.find((x) => x.gym_id === "gym_lac" && x.name === "Boxe" && inInstantRange(x.starts_at, d15a, d15b));
      if (!cls) throw new Error("missing class");
      const taken = dataset.bookings.filter((b) => b.class_id === cls.id && b.status !== "cancelled").length;
      return cls.capacity - taken;
    },
    plan: (c) => {
      const gid = gymId(c, "FitForge Lac");
      const rows = allPages<{ id: string; name: string; capacity: number; status: string }>(c, "list_classes", {
        gym_id: gid,
        from: new Date(d15a).toISOString(),
        to: new Date(d15b).toISOString(),
      });
      const cls = rows.find((x) => x.name === "Boxe" && x.status !== "cancelled");
      if (!cls) throw new Error("missing class");
      const taken = allPages<{ id: string }>(c, "list_bookings", { class_id: cls.id, status: "booked" });
      return cls.capacity - taken.length;
    },
  },
  {
    id: "16-sousse-april-net",
    title: "Sousse April net collected",
    holdout: true,
    question: "What is the net amount collected at FitForge Sousse during April 2026, Africa/Tunis time, in TND? Net means payments minus refunds, using each record's own timestamp. Answer with a number.",
    answer_type: "number",
    answer: () => tnd(netMillimes("gym_sousse", null, apr0, apr1)),
    plan: (c) => {
      const id = gymId(c, "FitForge Sousse");
      const pays = allPages<{ paid_at: string; amount_millimes: number }>(c, "list_payments", { gym_id: id });
      const refs = allPages<{ refunded_at: string; amount_millimes: number }>(c, "list_refunds", { gym_id: id });
      const paid = pays.filter((p) => inInstantRange(p.paid_at, apr0, apr1)).reduce((s, p) => s + p.amount_millimes, 0);
      const back = refs.filter((r) => inInstantRange(r.refunded_at, apr0, apr1)).reduce((s, r) => s + r.amount_millimes, 0);
      return tnd(paid - back);
    },
  },
  {
    id: "17-sfax-classes-2-apr",
    title: "Sfax classes on 2 April",
    holdout: true,
    question: "How many classes at FitForge Sfax start on 2 April 2026 (Africa/Tunis) and are not cancelled? Answer with a number.",
    answer_type: "number",
    answer: () => dataset.classes.filter((x) => x.gym_id === "gym_sfax" && x.status !== "cancelled" && inInstantRange(x.starts_at, d02a, d02b)).length,
    plan: (c) => {
      const id = gymId(c, "FitForge Sfax");
      const rows = allPages<{ status: string }>(c, "list_classes", { gym_id: id, from: new Date(d02a).toISOString(), to: new Date(d02b).toISOString() });
      return rows.filter((x) => x.status !== "cancelled").length;
    },
  },
  {
    id: "18-omar-march-method",
    title: "Omar March payment method",
    holdout: true,
    question: "Omar Cherif has more than one payment at FitForge Lac. What payment method was used for the one that falls in March 2026, Africa/Tunis? Answer with the method.",
    answer_type: "text",
    answer: () => {
      const pays = dataset.payments.filter((p) => p.member_id === "mem_08" && p.gym_id === "gym_lac" && inInstantRange(p.paid_at, mar0, mar1));
      if (pays.length !== 1) throw new Error(`expected one March payment, saw ${pays.length}`);
      return pays[0].method;
    },
    plan: (c) => {
      const hits = memberHits(c, "Omar Cherif");
      const pays = allPages<{ paid_at: string; method: string }>(c, "list_payments", { member_id: hits[0].id });
      const march = pays.filter((p) => inInstantRange(p.paid_at, mar0, mar1));
      if (march.length !== 1) throw new Error(`expected one March payment, saw ${march.length}`);
      return march[0].method;
    },
  },
  {
    id: "19-zumba-booked-names",
    title: "Zumba booked names",
    holdout: true,
    question: "Which members have a non-cancelled booking for Zumba at FitForge Sfax on 2 April 2026 (Africa/Tunis)? Answer with full names, comma-separated, alphabetical.",
    answer_type: "text",
    answer: () => {
      const cls = dataset.classes.find((x) => x.name === "Zumba" && x.gym_id === "gym_sfax" && inInstantRange(x.starts_at, d02a, d02b));
      if (!cls) return "";
      const ids = dataset.bookings.filter((b) => b.class_id === cls.id && b.status !== "cancelled").map((b) => b.member_id);
      return namesOf(ids);
    },
    plan: (c) => {
      const hits = classHits(c, "Zumba");
      const rows = allPages<{ member_id: string }>(c, "list_bookings", { class_id: hits[0].id, status: "booked" });
      const people = allPages<Member>(c, "list_members", { gym_id: hits[0].gym_id });
      const byId = new Map(people.map((m) => [m.id, m.full_name]));
      const names = rows.map((b) => {
        const name = byId.get(b.member_id);
        if (!name) throw new Error(`missing member ${b.member_id}`);
        return name;
      });
      names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return names.join(", ");
    },
  },
  {
    id: "20-sarra-april-net",
    title: "Sarra April net collected",
    holdout: true,
    question: "What is Sarra Jebali's net amount collected at FitForge Sousse during April 2026 (Africa/Tunis), in TND? Payments minus refunds, by each record's timestamp. Answer with a number.",
    answer_type: "number",
    answer: () => {
      const m = dataset.members.find((x) => x.full_name === "Sarra Jebali" && x.gym_id === "gym_sousse");
      if (!m) return 0;
      return tnd(netMillimes("gym_sousse", m.id, apr0, apr1));
    },
    plan: (c) => {
      const hits = memberHits(c, "Sarra Jebali");
      const pays = allPages<{ paid_at: string; amount_millimes: number }>(c, "list_payments", { member_id: hits[0].id });
      const refs = allPages<{ refunded_at: string; amount_millimes: number }>(c, "list_refunds", { member_id: hits[0].id });
      const paid = pays.filter((p) => inInstantRange(p.paid_at, apr0, apr1)).reduce((s, p) => s + p.amount_millimes, 0);
      const back = refs.filter((r) => inInstantRange(r.refunded_at, apr0, apr1)).reduce((s, r) => s + r.amount_millimes, 0);
      return tnd(paid - back);
    },
  },
];

export function buildTasks(): TaskFile[] {
  return specs.map((s) => {
    const counter: Counter = { n: 0 };
    const fromPlan = s.plan(counter);
    const fromData = s.answer();
    if (fromPlan !== fromData) {
      throw new Error(`${s.id}: plan produced ${JSON.stringify(fromPlan)} but the fixture query produced ${JSON.stringify(fromData)}`);
    }
    return {
      id: s.id,
      title: s.title,
      holdout: s.holdout,
      question: s.question,
      answer_type: s.answer_type,
      answer: fromData,
      best_calls: counter.n,
    };
  });
}

export function questions(): { id: string; holdout: boolean; question: string }[] {
  return specs.map((s) => ({ id: s.id, holdout: s.holdout, question: s.question }));
}
