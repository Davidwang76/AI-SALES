import { z } from "zod";
import type { DB } from "../../packages/db/index.js";
import { insert, owned, audit, member, type Actor } from "./context.js";
import { ensure, hash } from "../../packages/domain/rules.js";
export const leadInput = z.object({
  activity_id: z.string().uuid(),
  event_id: z.string().min(1).max(100),
  company: z.string().trim().min(1).max(200),
  contact_name: z.string().max(100).default(""),
  email: z.union([z.email(), z.literal("")]).default(""),
  phone: z.string().max(60).default(""),
  country: z.string().max(100).default(""),
  website: z.string().max(300).default(""),
  notes: z.string().max(20000).default(""),
  classification: z
    .enum(["importer", "distributor", "retail", "supplier", "unknown", "spam"])
    .default("unknown"),
  permission: z.enum(["unknown", "granted"]).default("unknown"),
  source_id: z.string().uuid().optional(),
  utm: z.record(z.string(), z.string().max(1000)).default({}),
});
export async function captureLead(
  db: DB,
  a: Actor,
  p: z.infer<typeof leadInput>,
) {
  const activity = await owned(db, "activities", p.activity_id, a);
  ensure(p.email || p.phone, "CONTACT_REQUIRED", "邮箱或电话至少填写一项");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `${a.entity}:${p.activity_id}:${p.event_id}`,
  ]);
  const digest = hash(p);
  const existing = await db.query(
    "SELECT * FROM leads WHERE business_entity_id=$1 AND activity_id=$2 AND event_id=$3",
    [a.entity, p.activity_id, p.event_id],
  );
  if (existing.rowCount) {
    ensure(
      existing.rows[0].payload_hash === digest,
      "IDEMPOTENCY_CONFLICT",
      "相同采集编号的内容不同",
      409,
    );
    return existing.rows[0];
  }
  let source;
  if (p.source_id) source = await owned(db, "sources", p.source_id, a);
  else
    source = await insert(db, "sources", a, {
      name: `${p.company} · ${activity.name}`,
      kind: activity.type === "online" ? "form" : "meeting",
      body: p.notes,
      allowed_use: "internal",
    });
  const { source_id, ...data } = p;
  const lead = await insert(db, "leads", a, {
    ...data,
    email: p.email.toLowerCase(),
    source_id: source.id,
    payload_hash: digest,
    assigned_to: activity.owner_id || a.id,
  });
  await insert(db, "touches", a, {
    lead_id: lead.id,
    activity_id: activity.id,
    source_id: source.id,
    channel: activity.type,
    utm: p.utm,
  });
  await insert(db, "tasks", a, {
    lead_id: lead.id,
    title: `核实与跟进：${p.company}`,
    kind: "verify",
    owner_id: activity.owner_id || a.id,
    due_at: new Date(Date.now() + 86400000).toISOString(),
  });
  await audit(db, a, "lead.capture", "leads", lead.id);
  return lead;
}
export async function convertLead(
  db: DB,
  a: Actor,
  id: string,
  p: { account_id?: string; owner_id?: string },
) {
  const lead = await owned(db, "leads", id, a, true);
  if (lead.account_id) return lead;
  const owner = p.owner_id || lead.assigned_to || a.id;
  await member(db, a, owner);
  let account;
  if (p.account_id)
    account = await owned(db, "accounts", p.account_id, a, true);
  else
    account = await insert(db, "accounts", a, {
      name: lead.company,
      country: lead.country,
      website: lead.website,
      company_type: lead.classification,
      owner_id: owner,
    });
  ensure(
    account.owner_id === owner,
    "OWNER_CONFLICT",
    "已有负责人不同，请由负责人复核交接",
    409,
  );
  let contact = (
    await db.query("SELECT * FROM contacts WHERE account_id=$1 AND email=$2", [
      account.id,
      lead.email,
    ])
  ).rows[0];
  if (!contact) {
    const suppressed = (
      await db.query(
        "SELECT 1 FROM suppressions WHERE business_entity_id=$1 AND endpoint=$2",
        [a.entity, lead.email.toLowerCase()],
      )
    ).rowCount;
    contact = await insert(db, "contacts", a, {
      account_id: account.id,
      name: lead.contact_name,
      email: lead.email,
      phone: lead.phone,
      permission: suppressed ? "withdrawn" : lead.permission,
      permission_source_id: lead.source_id,
    });
  }
  await db.query(
    "UPDATE leads SET account_id=$1,contact_id=$2,status='converted',row_version=row_version+1,updated_at=now() WHERE id=$3",
    [account.id, contact.id, id],
  );
  await db.query(
    "UPDATE touches SET account_id=$1,contact_id=$2 WHERE lead_id=$3",
    [account.id, contact.id, id],
  );
  await db.query("UPDATE tasks SET account_id=$1 WHERE lead_id=$2", [
    account.id,
    id,
  ]);
  await audit(db, a, "lead.convert", "accounts", account.id, { lead_id: id });
  return {
    ...lead,
    account_id: account.id,
    contact_id: contact.id,
    status: "converted",
  };
}
