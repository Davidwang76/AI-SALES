import { randomBytes } from "node:crypto";
import { pool, tx } from "./index.js";
import { ensure, passwordHash } from "../domain/rules.js";
// Credential output is intended only for a mode-600 file on the server.
const credentials = await tx(async (db) => {
  await db.query("SELECT pg_advisory_xact_lock(7218902)");
  const owner = (
    await db.query(
      `SELECT u.id,u.email,m.entity_id FROM users u JOIN memberships m ON m.user_id=u.id WHERE lower(u.email)=lower($1) AND m.role='owner' AND u.active ORDER BY m.entity_id LIMIT 1`,
      [process.env.BOOTSTRAP_EMAIL || ""],
    )
  ).rows[0];
  ensure(owner, "BOOTSTRAP_REQUIRED", "未找到原公司管理员，停止初始化入口");
  const result: string[] = [
    "公司入口初始账号（请妥善保存，不要公开）",
    "01：原管理员邮箱及密码继续有效。",
  ];
  for (let slot = 1; slot <= 9; slot++) {
    const portal = (
      await db.query("SELECT * FROM company_portals WHERE slot=$1 FOR UPDATE", [
        slot,
      ])
    ).rows[0];
    if (slot === 1 && portal.entity_id) {
      await db.query(
        "UPDATE entities SET workspace_config=$1 WHERE id=$2 AND workspace_config IS NULL",
        [
          JSON.stringify({
            purpose: "现有销售经营业务",
            modules: [
              "market-tasks",
              "activities",
              "leads",
              "accounts",
              "conversations",
              "rfqs",
              "knowledge",
              "products",
              "quotes",
              "orders",
              "purchase-rfqs",
              "samples",
              "trade-documents",
              "receipts",
              "aftersales",
              "automation-rules",
              "eval-datasets",
              "tasks",
              "sources",
            ],
          }),
          portal.entity_id,
        ],
      );
    }
    if (portal.entity_id) continue;
    if (slot === 1) {
      await db.query("UPDATE company_portals SET entity_id=$1 WHERE slot=1", [
        owner.entity_id,
      ]);
      await db.query(
        "UPDATE entities SET workspace_config=$1 WHERE id=$2 AND workspace_config IS NULL",
        [
          JSON.stringify({
            purpose: "现有销售经营业务",
            modules: [
              "market-tasks",
              "activities",
              "leads",
              "accounts",
              "conversations",
              "rfqs",
              "knowledge",
              "products",
              "quotes",
              "orders",
              "purchase-rfqs",
              "samples",
              "trade-documents",
              "receipts",
              "aftersales",
              "automation-rules",
              "eval-datasets",
              "tasks",
              "sources",
            ],
          }),
          owner.entity_id,
        ],
      );
      if (portal.display_name)
        await db.query("UPDATE entities SET name=$1 WHERE id=$2", [
          portal.display_name,
          owner.entity_id,
        ]);
      result.push(`01 用户名：${owner.email}；密码沿用原密码。`);
      continue;
    }
    const org = (
      await db.query(
        "INSERT INTO organizations(name) VALUES($1) RETURNING id",
        [portal.display_name || `公司入口${String(slot).padStart(2, "0")}`],
      )
    ).rows[0];
    const entity = (
      await db.query(
        "INSERT INTO entities(organization_id,name) VALUES($1,$2) RETURNING id",
        [
          org.id,
          portal.display_name || `公司入口${String(slot).padStart(2, "0")}`,
        ],
      )
    ).rows[0];
    const username = `company${String(slot).padStart(2, "0")}.admin`;
    const password = randomBytes(24).toString("base64url");
    const user = (
      await db.query(
        "INSERT INTO users(email,login_username,password_hash,name) VALUES($1,$2,$3,'公司系统管理员') RETURNING id",
        [`${username}@accounts.invalid`, username, passwordHash(password)],
      )
    ).rows[0];
    await db.query(
      "INSERT INTO memberships(user_id,entity_id,role) VALUES($1,$2,'owner')",
      [user.id, entity.id],
    );
    await db.query("UPDATE company_portals SET entity_id=$1 WHERE slot=$2", [
      entity.id,
      slot,
    ]);
    result.push(
      `${String(slot).padStart(2, "0")} 用户名：${username}；初始密码：${password}`,
    );
  }
  return result;
});
console.log(credentials.join("\n"));
await pool.end();
