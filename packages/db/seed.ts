import { pool, tx } from "./index.js";
import { passwordHash, ensure } from "../domain/rules.js";
export async function bootstrap(email: string, password: string, demo = false) {
  ensure(password.length >= 12, "WEAK_PASSWORD", "初始化密码至少12位");
  return tx(async (db) => {
    const old = (await db.query("SELECT id FROM users WHERE email=$1", [email]))
      .rows[0];
    if (old) return old;
    const org = (
      await db.query("INSERT INTO organizations(name) VALUES($1) RETURNING *", [
        demo ? "虚构演示组织" : process.env.BOOTSTRAP_ENTITY || "我的公司",
      ])
    ).rows[0];
    const entity = (
      await db.query(
        "INSERT INTO entities(organization_id,name,is_demo) VALUES($1,$2,$3) RETURNING *",
        [
          org.id,
          demo
            ? "演示 · 广州汽配主体"
            : process.env.BOOTSTRAP_ENTITY || "广州经营主体",
          demo,
        ],
      )
    ).rows[0];
    const u = (
      await db.query(
        "INSERT INTO users(email,password_hash,name) VALUES($1,$2,$3) RETURNING *",
        [email.toLowerCase(), passwordHash(password), "负责人"],
      )
    ).rows[0];
    await db.query("INSERT INTO memberships VALUES($1,$2,'owner')", [
      u.id,
      entity.id,
    ]);
    return { id: u.id, entity_id: entity.id };
  });
}
if (process.argv[1]?.endsWith("seed.ts")) {
  ensure(
    process.env.BOOTSTRAP_PASSWORD && process.env.BOOTSTRAP_EMAIL,
    "BOOTSTRAP_REQUIRED",
    "请设置 BOOTSTRAP_EMAIL 与 BOOTSTRAP_PASSWORD",
  );
  await bootstrap(
    process.env.BOOTSTRAP_EMAIL,
    process.env.BOOTSTRAP_PASSWORD,
    process.argv.includes("--demo"),
  );
  console.log("初始化完成；已存在账号不会被重设。");
  await pool.end();
}
