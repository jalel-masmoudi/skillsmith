// FitForge tools. Descriptions stay short on purpose: the agent is meant to learn the rest.

import { dataset, PAGE_SIZE, type Booking, type GymClass, type Invoice, type Member, type Payment, type Refund } from "./dataset.ts";
import { parseInstant } from "./time.ts";

export class ToolError extends Error {}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const str = { type: "string" };
const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const TOOLS: ToolSpec[] = [
  { name: "list_gyms", description: "List gyms.", inputSchema: obj({ cursor: str }) },
  { name: "search_gyms", description: "Find gyms by name.", inputSchema: obj({ q: str }, ["q"]) },
  { name: "get_gym", description: "Gym by id.", inputSchema: obj({ gym_id: str }, ["gym_id"]) },
  { name: "search_members", description: "Find members by name.", inputSchema: obj({ q: str, gym_id: str }, ["q"]) },
  { name: "get_member", description: "Member by id.", inputSchema: obj({ member_id: str }, ["member_id"]) },
  { name: "list_members", description: "List members.", inputSchema: obj({ gym_id: str, status: str, cursor: str }) },
  { name: "search_classes", description: "Find classes by name.", inputSchema: obj({ q: str, gym_id: str }, ["q"]) },
  { name: "get_class", description: "Class by id.", inputSchema: obj({ class_id: str }, ["class_id"]) },
  { name: "list_classes", description: "List classes.", inputSchema: obj({ gym_id: str, from: str, to: str, cursor: str }) },
  { name: "list_bookings", description: "List bookings.", inputSchema: obj({ class_id: str, member_id: str, status: str, cursor: str }) },
  { name: "list_invoices", description: "List invoices.", inputSchema: obj({ member_id: str, gym_id: str, cursor: str }) },
  { name: "list_payments", description: "List payments.", inputSchema: obj({ member_id: str, gym_id: str, invoice_id: str, cursor: str }) },
  { name: "list_refunds", description: "List refunds.", inputSchema: obj({ member_id: str, gym_id: str, payment_id: str, cursor: str }) },
];

export const TOOL_NAMES: string[] = TOOLS.map((t) => t.name);

interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

function byId<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): number {
  let raw: string;
  try {
    raw = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new ToolError("bad cursor");
  }
  if (!/^\d+$/.test(raw)) throw new ToolError("bad cursor");
  return Number(raw);
}

function paginate<T extends { id: string }>(rows: T[], cursor?: string): Page<T> {
  const offset = cursor ? decodeCursor(cursor) : 0;
  const sorted = byId(rows);
  const items = sorted.slice(offset, offset + PAGE_SIZE);
  const next = offset + PAGE_SIZE < sorted.length ? encodeCursor(offset + PAGE_SIZE) : null;
  return { items, next_cursor: next };
}

function includesFold(hay: string, needle: string): boolean {
  return hay.toLowerCase().includes(needle.trim().toLowerCase());
}

function q(args: Record<string, unknown>): string {
  const v = args.q;
  if (typeof v !== "string" || !v.trim()) throw new ToolError("q required");
  return v;
}

function opt(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v == null) return undefined;
  if (typeof v !== "string") throw new ToolError(`${key} must be a string`);
  return v;
}

function req(args: Record<string, unknown>, key: string): string {
  const v = opt(args, key);
  if (!v) throw new ToolError(`${key} required`);
  return v;
}

function instant(value: string): number {
  try {
    return parseInstant(value);
  } catch {
    throw new ToolError("bad timestamp");
  }
}

function notFound(): never {
  throw new ToolError("not found");
}

export function invoke(name: string, args: Record<string, unknown> = {}): unknown {
  switch (name) {
    case "list_gyms":
      return paginate(dataset.gyms, opt(args, "cursor"));
    case "search_gyms": {
      const query = q(args);
      const matches = byId(dataset.gyms.filter((g) => includesFold(g.name, query))).map((g) => ({ id: g.id, name: g.name }));
      return { matches };
    }
    case "get_gym": {
      const gym = dataset.gyms.find((g) => g.id === req(args, "gym_id"));
      return gym ?? notFound();
    }
    case "search_members": {
      const query = q(args);
      const gymId = opt(args, "gym_id");
      let rows = dataset.members.filter((m) => includesFold(m.full_name, query));
      if (gymId) rows = rows.filter((m) => m.gym_id === gymId);
      return { matches: byId(rows).map((m) => ({ id: m.id, full_name: m.full_name, gym_id: m.gym_id })) };
    }
    case "get_member": {
      const member = dataset.members.find((m) => m.id === req(args, "member_id"));
      return member ?? notFound();
    }
    case "list_members": {
      let rows: Member[] = dataset.members;
      const gymId = opt(args, "gym_id");
      const status = opt(args, "status");
      if (gymId) rows = rows.filter((m) => m.gym_id === gymId);
      if (status) rows = rows.filter((m) => m.status === status);
      return paginate(rows, opt(args, "cursor"));
    }
    case "search_classes": {
      const query = q(args);
      const gymId = opt(args, "gym_id");
      let rows = dataset.classes.filter((c) => includesFold(c.name, query));
      if (gymId) rows = rows.filter((c) => c.gym_id === gymId);
      return { matches: byId(rows).map((c) => ({ id: c.id, name: c.name, gym_id: c.gym_id })) };
    }
    case "get_class": {
      const cls = dataset.classes.find((c) => c.id === req(args, "class_id"));
      return cls ?? notFound();
    }
    case "list_classes": {
      let rows: GymClass[] = dataset.classes;
      const gymId = opt(args, "gym_id");
      const from = opt(args, "from");
      const to = opt(args, "to");
      if (gymId) rows = rows.filter((c) => c.gym_id === gymId);
      if (from) {
        const start = instant(from);
        rows = rows.filter((c) => Date.parse(c.starts_at) >= start);
      }
      if (to) {
        const end = instant(to);
        rows = rows.filter((c) => Date.parse(c.starts_at) < end);
      }
      return paginate(rows, opt(args, "cursor"));
    }
    case "list_bookings": {
      let rows: Booking[] = dataset.bookings;
      const classId = opt(args, "class_id");
      const memberId = opt(args, "member_id");
      const status = opt(args, "status");
      if (classId) rows = rows.filter((b) => b.class_id === classId);
      if (memberId) rows = rows.filter((b) => b.member_id === memberId);
      if (status) rows = rows.filter((b) => b.status === status);
      return paginate(rows, opt(args, "cursor"));
    }
    case "list_invoices": {
      let rows: Invoice[] = dataset.invoices;
      const memberId = opt(args, "member_id");
      const gymId = opt(args, "gym_id");
      if (memberId) rows = rows.filter((i) => i.member_id === memberId);
      if (gymId) rows = rows.filter((i) => i.gym_id === gymId);
      return paginate(rows, opt(args, "cursor"));
    }
    case "list_payments": {
      let rows: Payment[] = dataset.payments;
      const memberId = opt(args, "member_id");
      const gymId = opt(args, "gym_id");
      const invoiceId = opt(args, "invoice_id");
      if (memberId) rows = rows.filter((p) => p.member_id === memberId);
      if (gymId) rows = rows.filter((p) => p.gym_id === gymId);
      if (invoiceId) rows = rows.filter((p) => p.invoice_id === invoiceId);
      return paginate(rows, opt(args, "cursor"));
    }
    case "list_refunds": {
      let rows: Refund[] = dataset.refunds;
      const memberId = opt(args, "member_id");
      const gymId = opt(args, "gym_id");
      const paymentId = opt(args, "payment_id");
      if (memberId) rows = rows.filter((r) => r.member_id === memberId);
      if (gymId) rows = rows.filter((r) => r.gym_id === gymId);
      if (paymentId) rows = rows.filter((r) => r.payment_id === paymentId);
      return paginate(rows, opt(args, "cursor"));
    }
    default:
      throw new ToolError("unknown tool");
  }
}
