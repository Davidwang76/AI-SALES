import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bootstrap } from "../packages/db/seed.js";
import { pool } from "../packages/db/index.js";
import { migrate } from "../packages/db/migrate.js";
import { buildApp } from "../apps/api/server.js";
test("公司入口、用户名登录、角色变更和公司隔离", async () => {
  assert.ok(process.env.DATABASE_URL?.includes("sales_test"));
  await migrate();
  const app = await buildApp();
  const key = randomUUID(),
    password = "Test-only-" + randomUUID();
  const first = await bootstrap(`portal-a-${key}@example.com`, password),
    second = await bootstrap(`portal-b-${key}@example.com`, password);
  async function login(username: string, entity_id: string) {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/session",
      payload: { username, password, entity_id },
    });
    return { r, cookie: r.cookies[0] ? "session=" + r.cookies[0].value : "" };
  }
  const a = (
    await pool.query("SELECT entity_id FROM memberships WHERE user_id=$1", [
      first.id,
    ])
  ).rows[0].entity_id;
  const b = (
    await pool.query("SELECT entity_id FROM memberships WHERE user_id=$1", [
      second.id,
    ])
  ).rows[0].entity_id;
  const request = (
    cookie: string,
    entity: string,
    method: any,
    url: string,
    payload?: any,
  ) =>
    app.inject({
      method,
      url: "/api/v1/" + url,
      headers: { cookie, "x-entity-id": entity },
      payload,
    });
  try {
    const entries = (
      await app.inject({ method: "GET", url: "/api/v1/public/company-portals" })
    ).json().data;
    assert.equal(entries.length, 9);
    assert.deepEqual(
      entries.slice(0, 3).map((v: any) => [v.display_name, v.subtitle]),
      [
        ["SRR", "AI外贸"],
        ["LTMC", "目标管理"],
        ["LJYL", "AI培训"],
      ],
    );
    assert.ok(
      entries
        .slice(3)
        .every((v: any) => v.display_name === "" && v.subtitle === ""),
    );
    const wrong = await login(`portal-a-${key}@example.com`, b);
    assert.equal(wrong.r.statusCode, 401);
    assert.equal(wrong.cookie, "");
    const owner = await login(`portal-a-${key}@example.com`, a);
    assert.equal(owner.r.statusCode, 200);
    assert.equal(
      (await request(owner.cookie, b, "GET", "accounts")).statusCode,
      403,
    );
    for (const role of ["manager", "sales"]) {
      const username = role + "-" + key;
      const created = await request(owner.cookie, a, "POST", "members", {
        name: role,
        email: `${username}@example.com`,
        username,
        password,
        role,
      });
      assert.equal(created.statusCode, 200, created.body);
      const actor = await login(username, a);
      assert.equal(actor.r.statusCode, 200);
      assert.equal(
        (
          await request(actor.cookie, a, "POST", "members", {
            name: "forbidden",
            email: `bad-${key}@example.com`,
            password,
            role: "owner",
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await request(actor.cookie, a, "POST", "company-workspace", {
            purpose: "forbidden",
            modules: [],
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await request(actor.cookie, a, "POST", `members/${first.id}/role`, {
            role: "sales",
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (await request(actor.cookie, b, "GET", "sources")).statusCode,
        403,
      );
      const updated = await request(
        owner.cookie,
        a,
        "POST",
        `members/${created.json().data.id}/role`,
        { role: "owner" },
      );
      assert.equal(updated.statusCode, 200);
      // Existing sessions use the latest company role, rather than a cached claim.
      assert.equal(
        (
          await request(actor.cookie, a, "POST", "company-workspace", {
            purpose: "公司独立目标",
            modules: [],
          })
        ).statusCode,
        200,
      );
    }
    assert.equal(
      (
        await request(owner.cookie, a, "POST", `members/${first.id}/role`, {
          role: "sales",
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (
        await request(owner.cookie, a, "POST", `members/${second.id}/role`, {
          role: "sales",
        })
      ).statusCode,
      422,
    );
    const config = (
      await request(owner.cookie, a, "GET", "company-workspace")
    ).json().data;
    assert.equal(config.purpose, "公司独立目标");
    assert.deepEqual(config.modules, []);
    const other = await login(`portal-b-${key}@example.com`, b);
    assert.equal(
      (await request(other.cookie, b, "GET", "company-workspace")).json().data
        .purpose,
      "",
    );
  } finally {
    await app.close();
    await pool.end();
  }
});
