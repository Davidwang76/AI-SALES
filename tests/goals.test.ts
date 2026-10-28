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
test("季月旬持久保存、负责人范围、公司隔离、版本并发与层级结束约束", async () => {
  assert.ok(process.env.DATABASE_URL?.includes("sales_test"));
  await migrate();
  const app = await buildApp();
  const id = randomUUID(),
    password = "Test-only-" + randomUUID();
  const email = `goals-${id}@example.com`,
    otherEmail = `goals-other-${id}@example.com`;
  await bootstrap(email, password);
  await bootstrap(otherEmail, password);
  async function login(email: string) {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/session",
      remoteAddress: "127.0.0.3",
      payload: { email, password },
    });
    assert.equal(r.statusCode, 200, r.body);
    return {
      cookie: "session=" + r.cookies[0].value,
      entity: r.json().data.entities[0].id,
    };
  }
  const admin = await login(email),
    foreign = await login(otherEmail);
  async function req(
    actor: typeof admin,
    method: any,
    path: string,
    payload?: any,
  ) {
    return app.inject({
      method,
      url: "/api/v1/" + path,
      headers: { cookie: actor.cookie, "x-entity-id": actor.entity },
      payload,
    });
  }
  async function post(path: string, payload: any, actor = admin) {
    const r = await req(actor, "POST", path, payload);
    assert.equal(r.statusCode, 200, r.body);
    return r.json().data;
  }
  try {
    const executor = await post("members", {
      name: "目标执行者",
      email: `exec-${id}@example.com`,
      password,
      role: "sales",
    });
    const exec = await login(`exec-${id}@example.com`);
    const quarter = await post("goals", {
      title: "季度合成目标",
      year: 2028,
      quarter: 1,
      owner_id: executor.id,
    });
    const monthly = await post("goals", {
      title: "二月分解",
      parent_id: quarter.id,
      month: 2,
    });
    const ten = await post(
      "goals",
      { title: "下旬执行", parent_id: monthly.id, ten_day: 3 },
      exec,
    );
    assert.equal(ten.owner_id, executor.id);
    assert.equal(ten.year, 2028);
    assert.equal(ten.month, 2);
    assert.equal(
      (
        await req(admin, "POST", "goals", {
          title: "错误月份",
          parent_id: quarter.id,
          month: 4,
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (
        await req(foreign, "POST", "goals", {
          title: "跨公司分解",
          parent_id: quarter.id,
          month: 1,
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (await req({ ...exec, entity: foreign.entity }, "GET", "goals"))
        .statusCode,
      403,
    );
    assert.deepEqual(
      (await req(foreign, "GET", "goals?year=2028&quarter=1")).json().data,
      [],
    );
    const own = await post("goals", {
      title: "管理者个人目标",
      year: 2028,
      quarter: 1,
    });
    assert.ok(
      !(await req(exec, "GET", "goals?year=2028&quarter=1"))
        .json()
        .data.some((v: any) => v.id === own.id),
    );
    assert.equal(
      (
        await req(exec, "POST", `goals/${own.id}/state`, {
          row_version: 1,
          status: "completed",
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await req(exec, "POST", "goals", {
          title: "越权分派",
          year: 2028,
          quarter: 1,
          owner_id: (
            await pool.query("SELECT created_by FROM goals WHERE id=$1", [
              own.id,
            ])
          ).rows[0].created_by,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await req(admin, "POST", `goals/${quarter.id}/state`, {
          row_version: quarter.row_version,
          status: "completed",
        })
      ).statusCode,
      422,
    );
    const race = await Promise.all([
      req(exec, "POST", `goals/${ten.id}/state`, {
        row_version: 1,
        status: "completed",
        result_note: "执行完成",
      }),
      req(exec, "POST", `goals/${ten.id}/state`, {
        row_version: 1,
        status: "in_progress",
      }),
    ]);
    assert.deepEqual(race.map((v) => v.statusCode).sort(), [200, 409]);
    let stored = (await req(exec, "GET", "goals?year=2028&quarter=1"))
      .json()
      .data.find((v: any) => v.id === ten.id);
    if (stored.status !== "completed")
      stored = await post(
        `goals/${ten.id}/state`,
        {
          row_version: stored.row_version,
          status: "completed",
          result_note: "执行完成",
        },
        exec,
      );
    await post(`goals/${monthly.id}/state`, {
      row_version: monthly.row_version,
      status: "completed",
    });
    await post(`goals/${quarter.id}/state`, {
      row_version: quarter.row_version,
      status: "completed",
    });
    assert.equal(
      (
        await req(exec, "POST", `goals/${ten.id}/state`, {
          row_version: stored.row_version,
          status: "planned",
        })
      ).statusCode,
      422,
    );
    const persisted = (
      await pool.query("SELECT * FROM goals WHERE id=$1", [ten.id])
    ).rows[0];
    assert.equal(persisted.result_note, "执行完成");
    assert.equal(persisted.status, "completed");
  } finally {
    await app.close();
    await pool.end();
  }
});
