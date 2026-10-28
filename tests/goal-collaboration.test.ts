import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../packages/db/index.js";
import { migrate } from "../packages/db/migrate.js";
import { bootstrap } from "../packages/db/seed.js";
import { buildApp } from "../apps/api/server.js";
import { processGoalDraftOne } from "../apps/api/goal-draft-worker.js";
import {
  GoalModelAdapter,
  validateGoalDraft,
  type GoalSnapshot,
} from "../packages/adapters/goal-model.js";
let app: Awaited<ReturnType<typeof buildApp>>,
  upper: any,
  lower: any,
  secretary: any,
  outsider: any,
  foreign: any,
  seq = 0;
const password = "Only-for-tests-" + randomUUID(),
  token = randomUUID();
const originalEnv = {
  key: process.env.MODEL_API_KEY,
  name: process.env.MODEL_NAME,
};
async function request(a: any, method: any, path: string, payload?: any) {
  return app.inject({
    method,
    url: "/api/v1/" + path,
    remoteAddress: "127.0.0.5",
    headers: { cookie: a.cookie, "x-entity-id": a.entity },
    payload,
  });
}
async function post(a: any, path: string, payload: any = {}) {
  const r = await request(a, "POST", path, payload);
  assert.equal(r.statusCode, 200, r.body);
  return r.json().data;
}
async function login(email: string) {
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/session",
    remoteAddress: "127.0.0.5",
    payload: { email, password },
  });
  assert.equal(r.statusCode, 200, r.body);
  return {
    id: r.json().data.id,
    cookie: "session=" + r.cookies[0].value,
    entity: r.json().data.entities[0].id,
    email,
  };
}
async function plan(parent?: any, extra: any = {}) {
  const n = seq++;
  return post(upper, "goal-plans", {
    title: "合成协商目标 " + n,
    ...(parent
      ? { parent_id: parent.id }
      : {
          year: 2030 + Math.floor(n / 4),
          quarter: (n % 4) + 1,
          superior_id: upper.id,
          subordinate_id: lower.id,
          secretary_id: secretary.id,
        }),
    ...extra,
  });
}
async function detail(p: any, a = upper) {
  const r = await request(a, "GET", "goal-plans/" + p.id);
  assert.equal(r.statusCode, 200, r.body);
  return r.json().data;
}
async function inputs(p: any) {
  await post(upper, `goal-plans/${p.id}/messages`, {
    content: "上级希望提高交付质量，需要量化目标。",
  });
  await post(lower, `goal-plans/${p.id}/messages`, {
    content: "下级指出现有人员三人，需保留培训时间。",
  });
  await post(secretary, `goal-plans/${p.id}/materials`, {
    title: "合成会议纪要及数据表",
    content: "会议记录：现有人员3人。本旬完成8项交付，有2项返工。",
  });
}
function fakeOutput(snapshot: GoalSnapshot) {
  return {
    proposal:
      "这是本地验证用的模型返回草案，不是实际经营建议。目标由三方确认后才生效。",
    evidence: ["superior", "subordinate", "material"].map((kind) => {
      const ref = snapshot.refs.find((r) => r.kind === kind)!;
      return { ref_id: ref.id, quote: ref.content.slice(0, 40) };
    }),
    unknowns: ["需核实下周期可用工时"],
    risks: ["合成测试风险"],
  };
}
const adapter = {
  async generate(snapshot: GoalSnapshot) {
    return {
      output: fakeOutput(snapshot),
      model: "test-adapter-only",
      usage: { total_tokens: 10 },
    };
  },
};
async function draft(p: any) {
  await post(upper, `goal-plans/${p.id}/generate`);
  assert.equal(await processGoalDraftOne(adapter), true);
  const d = await detail(p);
  assert.equal(d.plan.workflow, "awaiting_superior", JSON.stringify(d.jobs));
  return d.revisions.at(-1);
}
async function confirm(p: any) {
  const d = await detail(p),
    rev = d.plan.current_revision_id;
  for (const a of [upper, lower, secretary])
    await post(a, `goal-plans/${p.id}/confirm`, { revision_id: rev });
  return (await detail(p)).plan;
}
before(async () => {
  assert.ok(process.env.DATABASE_URL?.includes("sales_test"));
  await migrate();
  app = await buildApp();
  await bootstrap(`upper-${token}@example.com`, password);
  upper = await login(`upper-${token}@example.com`);
  for (const [label, role] of [
    ["lower", "sales"],
    ["secretary", "finance"],
    ["outsider", "sales"],
  ])
    await post(upper, "members", {
      name: label,
      email: `${label}-${token}@example.com`,
      password,
      role,
    });
  lower = await login(`lower-${token}@example.com`);
  secretary = await login(`secretary-${token}@example.com`);
  outsider = await login(`outsider-${token}@example.com`);
  await bootstrap(`foreign-${token}@example.com`, password);
  foreign = await login(`foreign-${token}@example.com`);
  process.env.MODEL_API_KEY = "local-test-key";
  process.env.MODEL_NAME = "local-test-model";
});
after(async () => {
  if (originalEnv.key === undefined) delete process.env.MODEL_API_KEY;
  else process.env.MODEL_API_KEY = originalEnv.key;
  if (originalEnv.name === undefined) delete process.env.MODEL_NAME;
  else process.env.MODEL_NAME = originalEnv.name;
  await app.close();
  await pool.end();
});
test("三位不同参与人、公司和讨论范围隔离，秘书专属材料", async () => {
  const p = await plan();
  assert.equal(
    (await request(outsider, "GET", "goal-plans/" + p.id)).statusCode,
    404,
  );
  assert.equal(
    (await request(foreign, "GET", "goal-plans/" + p.id)).statusCode,
    404,
  );
  assert.equal(
    (
      await request(lower, "POST", `goal-plans/${p.id}/materials`, {
        title: "伪装秘书",
        content: "测试",
      })
    ).statusCode,
    403,
  );
  const initiated = await post(lower, "goal-plans", {
    title: "下级参与发起",
    year: 2052,
    quarter: 1,
    superior_id: upper.id,
    subordinate_id: lower.id,
    secretary_id: secretary.id,
  });
  assert.equal(initiated.workflow, "discussion");
  const duplicate = await request(upper, "POST", "goal-plans", {
    title: "重复身份",
    year: 2050,
    quarter: 1,
    superior_id: upper.id,
    subordinate_id: lower.id,
    secretary_id: lower.id,
  });
  assert.equal(duplicate.statusCode, 422);
  assert.equal(
    (
      await request(lower, "POST", "goal-plans", {
        title: "越权发起",
        year: 2051,
        quarter: 1,
        superior_id: upper.id,
        subordinate_id: outsider.id,
        secretary_id: secretary.id,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(upper, "POST", "goal-plans", {
        title: "跨公司成员",
        year: 2050,
        quarter: 2,
        superior_id: upper.id,
        subordinate_id: lower.id,
        secretary_id: foreign.id,
      })
    ).statusCode,
    422,
  );
});
test("意见、可读材料是AI输入前提；无模型不伪造草案", async () => {
  const p = await plan();
  assert.equal(
    (await request(upper, "POST", `goal-plans/${p.id}/generate`, {}))
      .statusCode,
    422,
  );
  await inputs(p);
  delete process.env.MODEL_API_KEY;
  assert.equal(
    (await request(upper, "POST", `goal-plans/${p.id}/generate`, {}))
      .statusCode,
    503,
  );
  process.env.MODEL_API_KEY = "local-test-key";
  const d = await detail(p);
  assert.equal(d.revisions.length, 0);
  assert.equal(d.plan.workflow, "discussion");
});
test("证据必须来自上级、下级和秘书材料，篡改引文拒绝", async () => {
  const p = await plan();
  await inputs(p);
  await post(upper, `goal-plans/${p.id}/generate`);
  const job = (await detail(p)).jobs.at(-1);
  const snapshot = (
    await pool.query("SELECT input_snapshot FROM goal_draft_jobs WHERE id=$1", [
      job.id,
    ])
  ).rows[0].input_snapshot;
  assert.throws(() =>
    validateGoalDraft(
      {
        ...fakeOutput(snapshot),
        evidence: [{ ref_id: "invented", quote: "假引用" }],
      },
      snapshot,
    ),
  );
  await processGoalDraftOne({
    async generate(s) {
      return {
        output: {
          ...fakeOutput(s),
          evidence: [{ ref_id: "invented", quote: "假引用" }],
        },
        model: "invalid-test-model",
        usage: null,
      };
    },
  });
  const d = await detail(p);
  assert.equal(d.revisions.length, 0);
  assert.equal(d.jobs.at(-1).status, "needs_manual");
  assert.equal(d.plan.workflow, "discussion");
});
test("AI草案按上级、下级、秘书顺序确认；不可代签、不可提前分解", async () => {
  const p = await plan();
  await inputs(p);
  const rev = await draft(p);
  assert.equal(
    (
      await request(upper, "POST", "goal-plans", {
        title: "提前分解",
        parent_id: p.id,
        month: (p.quarter - 1) * 3 + 1,
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await request(lower, "POST", `goal-plans/${p.id}/confirm`, {
        revision_id: rev.id,
      })
    ).statusCode,
    409,
  );
  const first = await Promise.all([
    request(upper, "POST", `goal-plans/${p.id}/confirm`, {
      revision_id: rev.id,
    }),
    request(upper, "POST", `goal-plans/${p.id}/confirm`, {
      revision_id: rev.id,
    }),
  ]);
  assert.deepEqual(first.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(
    (
      await request(upper, "POST", `goal-plans/${p.id}/confirm`, {
        revision_id: rev.id,
      })
    ).statusCode,
    409,
  );
  await post(lower, `goal-plans/${p.id}/confirm`, { revision_id: rev.id });
  await post(secretary, `goal-plans/${p.id}/confirm`, { revision_id: rev.id });
  assert.equal((await detail(p)).plan.workflow, "confirmed");
  const m = await plan(p, { month: (p.quarter - 1) * 3 + 1 });
  assert.equal(m.parent_revision_id, rev.id);
  assert.equal(m.secretary_id, secretary.id);
  const mr = await draft(m);
  assert.ok(
    mr.input_snapshot.refs.some((r: any) => r.kind === "confirmed_goal"),
  );
});
test("留言更新使待确认草案失效，旧确认不迁移到新版本，审计和版本不可篡改", async () => {
  const p = await plan();
  await inputs(p);
  const rev = await draft(p);
  await post(upper, `goal-plans/${p.id}/confirm`, { revision_id: rev.id });
  await post(lower, `goal-plans/${p.id}/messages`, {
    content: "可用工时已减少，原计划需要调整。",
  });
  assert.equal(
    (
      await request(lower, "POST", `goal-plans/${p.id}/confirm`, {
        revision_id: rev.id,
      })
    ).statusCode,
    409,
  );
  const fresh = await draft(p);
  assert.equal(fresh.revision, 2);
  assert.equal(
    (await detail(p)).confirmations.filter(
      (v: any) => v.revision_id === fresh.id,
    ).length,
    0,
  );
  await assert.rejects(
    pool.query("UPDATE goal_revisions SET proposal=$1 WHERE id=$2", [
      "篡改",
      rev.id,
    ]),
  );
  await assert.rejects(
    pool.query("DELETE FROM goal_confirmations WHERE revision_id=$1", [rev.id]),
  );
});
test("起草期间输入变化，过期AI结果不进入确认链", async () => {
  const p = await plan();
  await inputs(p);
  await post(upper, `goal-plans/${p.id}/generate`);
  await post(secretary, `goal-plans/${p.id}/materials`, {
    title: "补充数据",
    content: "最新统计返工为3项。",
  });
  await processGoalDraftOne(adapter);
  const d = await detail(p);
  assert.equal(d.jobs.at(-1).status, "stale");
  assert.equal(d.revisions.length, 0);
});
test("模型失败保留讨论、允许重试；秘书可以排除大文件并保留原件", async () => {
  const p = await plan();
  await inputs(p);
  const large = await post(secretary, `goal-plans/${p.id}/materials`, {
    title: "长表",
    content: "合成长表数据".repeat(12000),
  });
  await post(secretary, `goal-plans/${p.id}/materials`, {
    title: "长表2",
    content: "合成第二长表数据".repeat(8000),
  });
  assert.equal(
    (await request(upper, "POST", `goal-plans/${p.id}/generate`, {}))
      .statusCode,
    422,
  );
  await post(secretary, `goal-plans/${p.id}/materials/${large.id}/use`, {
    include: false,
  });
  await post(upper, `goal-plans/${p.id}/generate`);
  await processGoalDraftOne({
    async generate() {
      throw Object.assign(new Error("test provider failure"), {
        code: "MODEL_PROVIDER_ERROR",
      });
    },
  });
  assert.equal((await detail(p)).plan.workflow, "discussion");
  const rev = await draft(p);
  assert.equal(rev.origin, "model");
});
test("人工修订产生新版本并清空本版本确认顺序，退回原因入留言板", async () => {
  const p = await plan();
  await inputs(p);
  const rev = await draft(p);
  await post(upper, `goal-plans/${p.id}/confirm`, { revision_id: rev.id });
  const edit = await post(lower, `goal-plans/${p.id}/edit`, {
    revision_id: rev.id,
    proposal: "经讨论修订的目标草案，需要由上级、下级、秘书重新确认。",
  });
  assert.equal(edit.origin, "human_edit");
  assert.equal((await detail(p)).plan.workflow, "awaiting_superior");
  await post(secretary, `goal-plans/${p.id}/revise`, {
    reason: "数据口径需再次核对",
  });
  assert.equal((await detail(p)).plan.current_revision_id, null);
});
test("旬复盘进入下一旬AI输入，跨月必须确认对应月度目标，重复创建幂等", async () => {
  const q = await plan();
  await inputs(q);
  await draft(q);
  await confirm(q);
  const month = (q.quarter - 1) * 3 + 1;
  const m = await plan(q, { month });
  await draft(m);
  await confirm(m);
  const t = await plan(m, { ten_day: 1 });
  await draft(t);
  await confirm(t);
  const prepared = await plan(m, { ten_day: 2 });
  await draft(prepared);
  const initialNext = await confirm(prepared);
  assert.equal(
    (await request(lower, "POST", `goal-plans/${t.id}/next-cycle`, {}))
      .statusCode,
    422,
  );
  await post(lower, `goal-plans/${t.id}/reviews`, {
    results: "本旬实际完成6项，存在两项延期。",
    adjustments: "下一旬减少并行任务，优先消除延期。",
  });
  const next = await post(secretary, `goal-plans/${t.id}/next-cycle`, {});
  assert.equal(next.ten_day, 2);
  assert.equal(next.id, prepared.id);
  assert.equal(next.workflow, "discussion");
  assert.equal(next.confirmed_revision_id, initialNext.confirmed_revision_id);
  assert.equal(
    (await post(upper, `goal-plans/${t.id}/next-cycle`, {})).id,
    next.id,
  );
  const rev = await draft(next);
  assert.ok(
    rev.input_snapshot.refs.some(
      (r: any) => r.kind === "review" && r.content.includes("减少并行任务"),
    ),
  );
  await post(secretary, `goal-plans/${t.id}/reviews`, {
    results: "复盘补充了最新交付数据。",
    adjustments: "还应优先处理质量复核。",
  });
  assert.equal(
    (
      await request(upper, "POST", `goal-plans/${next.id}/confirm`, {
        revision_id: rev.id,
      })
    ).statusCode,
    409,
  );
  const last = await plan(m, { ten_day: 3 });
  await draft(last);
  await confirm(last);
  await post(upper, `goal-plans/${last.id}/reviews`, {
    results: "月末结果汇总。",
    adjustments: "下月先做资源调整。",
  });
  assert.equal(
    (await request(upper, "POST", `goal-plans/${last.id}/next-cycle`, {}))
      .statusCode,
    422,
  );
  const m2 = await plan(q, { month: month + 1 });
  await draft(m2);
  await confirm(m2);
  const cross = await post(upper, `goal-plans/${last.id}/next-cycle`, {
    next_month_plan_id: m2.id,
  });
  assert.equal(cross.month, month + 1);
  assert.equal(cross.ten_day, 1);
});
test("上级确认版本调整后，下级旧草案不能确认，重新对齐后才可起草", async () => {
  const q = await plan();
  await inputs(q);
  await draft(q);
  await confirm(q);
  const m = await plan(q, { month: (q.quarter - 1) * 3 + 1 });
  const old = await draft(m);
  await post(upper, `goal-plans/${q.id}/revise`, {
    reason: "季度资源投入发生变化",
  });
  assert.equal(
    (
      await request(upper, "POST", `goal-plans/${m.id}/confirm`, {
        revision_id: old.id,
      })
    ).statusCode,
    422,
  );
  await draft(q);
  await confirm(q);
  assert.equal(
    (
      await request(upper, "POST", `goal-plans/${m.id}/confirm`, {
        revision_id: old.id,
      })
    ).statusCode,
    409,
  );
  await post(lower, `goal-plans/${m.id}/revise`, { reason: "对齐上级新版本" });
  await draft(m);
  await confirm(m);
  assert.equal((await detail(m)).plan.workflow, "confirmed");
});
test("模型适配器发送真实协议结构并验证响应（本地HTTP替身，不冒充线上模型实测）", async () => {
  const p = await plan();
  await inputs(p);
  await post(upper, `goal-plans/${p.id}/generate`);
  const job = (await detail(p)).jobs.at(-1);
  const snapshot = (
    await pool.query("SELECT input_snapshot FROM goal_draft_jobs WHERE id=$1", [
      job.id,
    ])
  ).rows[0].input_snapshot;
  const original = globalThis.fetch;
  globalThis.fetch = async (input: any, init: any) => {
    assert.equal(new URL(String(input)).protocol, "https:");
    const body = JSON.parse(init.body);
    assert.equal(body.messages[0].role, "system");
    assert.ok(body.messages[0].content.includes("UNTRUSTED DATA"));
    return new Response(
      JSON.stringify({
        choices: [
          { message: { content: JSON.stringify(fakeOutput(snapshot)) } },
        ],
        usage: { total_tokens: 12 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const result = await new GoalModelAdapter().generate(snapshot);
    assert.equal(result.usage.total_tokens, 12);
  } finally {
    globalThis.fetch = original;
  }
  await processGoalDraftOne(adapter);
});

test("秘书上传CSV、下级按议题下载原件，外公司拒绝；留言身份不可伪造", async () => {
  const p = await plan();
  const csv = "项目,实际值\n交付,8\n返工,2\n";
  const boundary = "test-goal-" + randomUUID();
  const upload = await app.inject({
    method: "POST",
    url: "/api/v1/files",
    headers: {
      cookie: secretary.cookie,
      "x-entity-id": secretary.entity,
      "content-type": "multipart/form-data; boundary=" + boundary,
    },
    payload: Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="meeting.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`,
    ),
  });
  assert.equal(upload.statusCode, 200, upload.body);
  const source = upload.json().data;
  const material = await post(secretary, `goal-plans/${p.id}/materials`, {
    title: "会议表格",
    source_id: source.id,
    content: "秘书补充核对说明",
  });
  assert.ok(material.content.includes(csv));
  assert.ok(material.content.includes("秘书补充核对说明"));
  const file = await request(
    lower,
    "GET",
    `goal-plans/${p.id}/materials/${material.id}/download`,
  );
  assert.equal(file.statusCode, 200, file.body);
  assert.equal(file.body, csv);
  assert.equal(
    (
      await request(
        foreign,
        "GET",
        `goal-plans/${p.id}/materials/${material.id}/download`,
      )
    ).statusCode,
    404,
  );
  const message = await post(secretary, `goal-plans/${p.id}/messages`, {
    content: "秘书不能冒充上级。",
    voice: "superior",
  });
  assert.equal(message.voice, "secretary");
});
