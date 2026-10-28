import type { FastifyRequest } from "fastify";
import type { DB } from "../../packages/db/index.js";
import { BusinessError, ensure } from "../../packages/domain/rules.js";
export type Actor = {
  id: string;
  entity: string;
  organization: string;
  role: string;
  demo: boolean;
  name: string;
};
declare module "fastify" {
  interface FastifyRequest {
    actor: Actor;
  }
}
export const elevated = (a: Actor) => ["owner", "manager"].includes(a.role);
export function permission(
  a: Actor,
  roles: string[] = ["owner", "manager", "sales", "market"],
) {
  ensure(roles.includes(a.role), "FORBIDDEN", "当前角色无此操作权限", 403);
}
export async function owned(
  db: DB,
  table: string,
  id: string,
  a: Actor,
  lock = false,
): Promise<any> {
  ensure(/^[0-9a-f-]{36}$/i.test(id), "NOT_FOUND", "记录不存在", 404);
  const r = await db.query(
    `SELECT * FROM ${table} WHERE id=$1 AND business_entity_id=$2 ${lock ? "FOR UPDATE" : ""}`,
    [id, a.entity],
  );
  ensure(r.rowCount, "NOT_FOUND", "记录不存在或不可访问", 404);
  const obj = r.rows[0];
  if (
    ["sources", "jobs"].includes(table) &&
    !elevated(a) &&
    ["sales", "market"].includes(a.role)
  ) {
    let accessible = obj.created_by === a.id;
    if (table === "sources" && !accessible)
      accessible = Boolean(
        (
          await db.query(
            "SELECT 1 FROM accounts ac WHERE ac.owner_id=$1 AND ac.business_entity_id=$2 AND (EXISTS(SELECT 1 FROM leads l WHERE l.account_id=ac.id AND l.source_id=$3) OR EXISTS(SELECT 1 FROM rfqs f WHERE f.account_id=ac.id AND f.source_id=$3))",
            [a.id, a.entity, id],
          )
        ).rowCount,
      );
    ensure(accessible, "NOT_FOUND", "记录不存在或不可访问", 404);
  }
  if (
    table === "accounts" &&
    !elevated(a) &&
    ["sales", "market"].includes(a.role)
  )
    ensure(obj.owner_id === a.id, "NOT_FOUND", "记录不存在或不可访问", 404);
  return obj;
}
export async function accountAccess(db: DB, a: Actor, id: string) {
  return owned(db, "accounts", id, a);
}
export async function member(db: DB, a: Actor, id: string) {
  ensure(
    (
      await db.query(
        "SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.entity_id=$1 AND m.user_id=$2 AND u.active",
        [a.entity, id],
      )
    ).rowCount,
    "INVALID_OWNER",
    "负责人不属于当前主体",
  );
}
export async function insert(
  db: DB,
  table: string,
  a: Actor,
  data: Record<string, unknown>,
) {
  const d = {
    organization_id: a.organization,
    business_entity_id: a.entity,
    created_by: a.id,
    updated_by: a.id,
    is_demo: a.demo,
    ...data,
  };
  const keys = Object.keys(d);
  const r = await db.query(
    `INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
    Object.values(d),
  );
  return r.rows[0];
}
export async function audit(
  db: DB,
  a: Actor,
  action: string,
  type: string,
  id: string,
  detail: unknown = {},
) {
  await db.query(
    "INSERT INTO audit_events(business_entity_id,actor_id,action,object_type,object_id,detail) VALUES($1,$2,$3,$4,$5,$6)",
    [a.entity, a.id, action, type, id, JSON.stringify(detail)],
  );
}
export async function update(
  db: DB,
  table: string,
  id: string,
  a: Actor,
  version: number,
  fields: Record<string, unknown>,
) {
  const keys = Object.keys(fields);
  const r = await db.query(
    `UPDATE ${table} SET ${keys.map((k, i) => `${k}=$${i + 4}`).join(",")},row_version=row_version+1,updated_at=now(),updated_by=$3 WHERE id=$1 AND business_entity_id=$2 AND row_version=$${keys.length + 4} RETURNING *`,
    [id, a.entity, a.id, ...Object.values(fields), version],
  );
  ensure(r.rowCount, "VERSION_CONFLICT", "记录已更新，请刷新后重试", 409);
  return r.rows[0];
}
export function body<T>(
  schema: { parse: (x: unknown) => T },
  r: FastifyRequest,
): T {
  return schema.parse(r.body);
}
export const params = (r: FastifyRequest) => r.params as Record<string, string>;

// Serialize company administration and recheck live privileges after acquiring the lock.
export async function companyAdmin(db: DB, a: Actor) {
  await db.query("SELECT id FROM entities WHERE id=$1 FOR UPDATE", [a.entity]);
  ensure(
    (
      await db.query(
        "SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.entity_id=$2 AND m.role='owner' AND u.active",
        [a.id, a.entity],
      )
    ).rowCount,
    "FORBIDDEN",
    "当前账号无公司系统管理员权限",
    403,
  );
}
