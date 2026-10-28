import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  goalPeriodRange,
  goalPeriodLabel,
} from "../packages/domain/goal-periods.js";
import { pool } from "../packages/db/index.js";
import { migrate } from "../packages/db/migrate.js";
import { bootstrap } from "../packages/db/seed.js";
import { buildApp } from "../apps/api/server.js";
test("旬与季度日期：闰年、平年、大小月和年末", () => {
  assert.deepEqual(
    goalPeriodRange({ year: 2028, quarter: 1, month: 2, ten_day: 3 }),
    { start: "2028-02-21", end: "2028-02-29" },
  );
  assert.equal(
    goalPeriodRange({ year: 2027, quarter: 1, month: 2, ten_day: 3 }).end,
    "2027-02-28",
  );
  assert.equal(
    goalPeriodRange({ year: 2027, quarter: 2, month: 4, ten_day: 3 }).end,
    "2027-04-30",
  );
  assert.equal(goalPeriodRange({ year: 2027, quarter: 4 }).end, "2027-12-31");
  assert.deepEqual(
    goalPeriodRange({ year: 2027, quarter: 1, month: 3, ten_day: 2 }),
    { start: "2027-03-11", end: "2027-03-20" },
  );
  assert.equal(
    goalPeriodLabel({ year: 2027, quarter: 1, month: 3, ten_day: 2 }),
    "2027年3月中旬",
  );
});
test("旧版目标保留可读，旧写入接口不能绕过三方确认", async () => {
  assert.ok(process.env.DATABASE_URL?.includes("sales_test"));
  await migrate();
  const app = await buildApp();
  const email = `legacy-${randomUUID()}@example.com`,
    password = "Test-only-" + randomUUID();
  await bootstrap(email, password);
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/session",
    remoteAddress: "127.0.0.3",
    payload: { email, password },
  });
  const session = login.json().data;
  const entity = session.entities[0].id;
  const cookie = "session=" + login.cookies[0].value;
  const org = session.entities[0].organization_id;
  const goal = (
    await pool.query(
      "INSERT INTO goals(organization_id,business_entity_id,created_by,updated_by,level,year,quarter,title,owner_id) VALUES($1,$2,$3,$3,'quarter',2028,1,'原有历史目标',$3) RETURNING id",
      [org, entity, session.id],
    )
  ).rows[0];
  try {
    const headers = { cookie, "x-entity-id": entity };
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/goals",
      headers,
    });
    assert.ok(list.json().data.some((g: any) => g.id === goal.id));
    for (const url of ["/api/v1/goals", `/api/v1/goals/${goal.id}/state`])
      assert.equal(
        (await app.inject({ method: "POST", url, headers, payload: {} }))
          .statusCode,
        409,
      );
  } finally {
    await app.close();
    await pool.end();
  }
});
