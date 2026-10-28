import type { FastifyInstance } from "fastify";
import { z } from "zod";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { pool, tx, type DB } from "../../packages/db/index.js";
import { ensure } from "../../packages/domain/rules.js";
import { goalPeriodRange } from "../../packages/domain/goal-periods.js";
import {
  GoalModelAdapter,
  type GoalSnapshot,
  type GoalReference,
} from "../../packages/adapters/goal-model.js";
import { snapshotFresh } from "./goal-draft-worker.js";
import {
  owned,
  member,
  insert,
  audit,
  permission,
  body,
  params,
  type Actor,
} from "./context.js";
export const voices = ["superior", "subordinate", "secretary"] as const;
export function voiceOf(plan: any, id: string) {
  return voices.find((v) => plan[v + "_id"] === id);
}
export async function planAccess(db: DB, a: Actor, id: string, lock = false) {
  const plan = await owned(db, "goal_plans", id, a, lock);
  ensure(
    a.role === "owner" || voiceOf(plan, a.id),
    "NOT_FOUND",
    "目标议题不存在或无权参与",
    404,
  );
  return plan;
}
function participate(a: Actor, plan: any) {
  permission(a, [
    "owner",
    "manager",
    "sales",
    "market",
    "procurement",
    "finance",
  ]);
  const voice = voiceOf(plan, a.id);
  ensure(
    voice,
    "NOT_PARTICIPANT",
    "只有本议题指定的上级、下级、秘书可以操作",
    403,
  );
  return voice;
}
async function touch(db: DB, a: Actor, plan: any) {
  await db.query(
    "UPDATE goal_draft_jobs SET status='stale',error='INPUT_CHANGED',finished_at=now() WHERE plan_id=$1 AND status='queued'",
    [plan.id],
  );
  await db.query(
    "UPDATE goal_plans SET context_version=context_version+1,row_version=row_version+1,updated_at=now(),updated_by=$2,workflow=CASE WHEN workflow='confirmed' THEN 'confirmed' ELSE 'discussion' END,current_revision_id=CASE WHEN workflow='confirmed' THEN current_revision_id ELSE NULL END WHERE id=$1",
    [plan.id, a.id],
  );
}
async function parentReady(db: DB, plan: any) {
  if (!plan.parent_id) return null;
  const parent = (
    await db.query(
      "SELECT * FROM goal_plans WHERE id=$1 AND business_entity_id=$2",
      [plan.parent_id, plan.business_entity_id],
    )
  ).rows[0];
  ensure(
    parent?.workflow === "confirmed" && parent.confirmed_revision_id,
    "PARENT_UNCONFIRMED",
    "上级周期目标尚未完成三方确认",
  );
  ensure(
    plan.parent_revision_id === parent.confirmed_revision_id,
    "PARENT_CHANGED",
    "上级目标已更新，请先重新对齐并起草本周期目标",
    409,
  );
  await parentReady(db, parent);
  return parent;
}
async function lockTree(db: DB, a: Actor, id: string) {
  const initial = await planAccess(db, a, id);
  // All period changes lock the same quarter first, preventing parent revision races.
  let root = initial;
  while (root.parent_id) root = await planAccess(db, a, root.parent_id);
  await planAccess(db, a, root.id, true);
  return planAccess(db, a, id, true);
}
async function createPlan(db: DB, a: Actor, p: any) {
  let parent: any = null;
  if (p.parent_id) {
    parent = await lockTree(db, a, p.parent_id);
    participate(a, parent);
    ensure(
      parent.workflow === "confirmed" && parent.confirmed_revision_id,
      "PARENT_UNCONFIRMED",
      "请先完成上级周期目标的三方确认",
    );
    await parentReady(db, parent);
    ensure(parent.level !== "ten_day", "INVALID_PARENT", "旬目标不再向下分解");
  } else
    permission(a, [
      "owner",
      "manager",
      "sales",
      "market",
      "procurement",
      "finance",
    ]);
  const level = parent
    ? parent.level === "quarter"
      ? "month"
      : "ten_day"
    : "quarter";
  const year = parent?.year || p.year,
    quarter = parent?.quarter || p.quarter;
  ensure(year && quarter, "PERIOD_REQUIRED", "请选择年份与季度");
  const month =
    level === "quarter" ? null : level === "month" ? p.month : parent.month;
  const ten_day = level === "ten_day" ? p.ten_day : null;
  if (level !== "quarter")
    ensure(
      month && Math.floor((month - 1) / 3) + 1 === quarter,
      "INVALID_MONTH",
      "月份必须属于上级季度",
    );
  if (level === "ten_day")
    ensure(ten_day, "SEGMENT_REQUIRED", "请选择上旬、中旬或下旬");
  const ids = Object.fromEntries(
    voices.map((v) => [v + "_id", parent?.[v + "_id"] || p[v + "_id"]]),
  );
  ensure(
    new Set(Object.values(ids)).size === 3 && Object.values(ids).every(Boolean),
    "THREE_PARTICIPANTS",
    "请指定三位不同的上级、下级和秘书",
  );
  ensure(
    a.role === "owner" || Object.values(ids).includes(a.id),
    "NOT_PARTICIPANT",
    "发起人须是指定的三方之一，或由公司管理员代为建立议题",
    403,
  );
  for (const id of Object.values(ids)) {
    await member(db, a, id as string);
    ensure(
      (
        await db.query(
          "SELECT 1 FROM memberships WHERE user_id=$1 AND entity_id=$2 AND role<>'viewer'",
          [id, a.entity],
        )
      ).rowCount,
      "PARTICIPANT_READ_ONLY",
      "三方参与人不能是只读账号",
    );
  }
  ensure(
    (
      await db.query(
        "SELECT 1 FROM memberships WHERE user_id=$1 AND entity_id=$2 AND role IN ('owner','manager')",
        [ids.superior_id, a.entity],
      )
    ).rowCount,
    "INVALID_SUPERIOR",
    "上级须为本公司的系统管理员或管理者",
  );
  const plan = await insert(db, "goal_plans", a, {
    title: p.title,
    parent_id: parent?.id || null,
    parent_revision_id: parent?.confirmed_revision_id || null,
    predecessor_id: p.predecessor_id || null,
    level,
    year,
    quarter,
    month,
    ten_day,
    ...ids,
  });
  await audit(db, a, "goal.plan.create", "goal_plans", plan.id, {
    level,
    parent_id: plan.parent_id,
  });
  return plan;
}
export async function goalSnapshot(db: DB, plan: any): Promise<GoalSnapshot> {
  const refs: GoalReference[] = [];
  if (plan.parent_revision_id) {
    const parent = (
      await db.query("SELECT * FROM goal_revisions WHERE id=$1", [
        plan.parent_revision_id,
      ])
    ).rows[0];
    ensure(parent, "PARENT_UNCONFIRMED", "缺少已确认的上级版本");
    refs.push(...parent.input_snapshot.refs, {
      id: "parent:" + parent.id,
      kind: "confirmed_goal",
      title: "已确认的上级目标",
      content: parent.proposal,
    });
  }
  const messages = (
    await db.query(
      "SELECT * FROM goal_messages WHERE plan_id=$1 ORDER BY created_at,id",
      [plan.id],
    )
  ).rows;
  for (const m of messages)
    refs.push({
      id: "message:" + m.id,
      kind: m.voice,
      title:
        "本周期" +
        ({ superior: "上级", subordinate: "下级", secretary: "秘书" } as any)[
          m.voice
        ] +
        "留言",
      content: m.content,
    });
  const materials = (
    await db.query(
      "SELECT * FROM goal_materials WHERE plan_id=$1 ORDER BY created_at,id",
      [plan.id],
    )
  ).rows;
  for (const m of materials)
    if (m.content.trim() && !plan.excluded_material_ids.includes(m.id))
      refs.push({
        id: "material:" + m.id,
        kind: "material",
        title: m.title,
        content: m.content,
      });
  let previousReviewCount = 0,
    previousConfirmedRevision: string | null = null;
  if (plan.predecessor_id) {
    const previous = (
      await db.query(
        "SELECT * FROM goal_plans WHERE id=$1 AND business_entity_id=$2",
        [plan.predecessor_id, plan.business_entity_id],
      )
    ).rows[0];
    ensure(
      previous?.workflow === "confirmed",
      "PREVIOUS_UNCONFIRMED",
      "请先完成上一旬调整后的确认",
    );
    previousConfirmedRevision = previous.confirmed_revision_id;
    const reviews = (
      await db.query(
        "SELECT * FROM goal_reviews WHERE plan_id=$1 AND confirmed_revision_id=$2 ORDER BY created_at,id",
        [plan.predecessor_id, previousConfirmedRevision],
      )
    ).rows;
    previousReviewCount = reviews.length;
    for (const r of reviews)
      refs.push({
        id: "review:" + r.id,
        kind: "review",
        title: "上一旬复盘",
        content: `实际结果：${r.results}\n下一旬调整建议：${r.adjustments}`,
      });
  }
  const participantNames: Record<string, string> = {};
  for (const v of voices) {
    const user = (
      await db.query("SELECT name FROM users WHERE id=$1", [plan[v + "_id"]])
    ).rows[0];
    participantNames[v] = user.name;
  }
  const snapshot: GoalSnapshot = {
    refs: [...new Map(refs.map((r) => [r.id, r])).values()],
    period: {
      level: plan.level,
      year: plan.year,
      quarter: plan.quarter,
      month: plan.month,
      ten_day: plan.ten_day,
      ...goalPeriodRange(plan),
    },
    participants: participantNames,
    parent_revision_id: plan.parent_revision_id,
    parent_plan_id: plan.parent_id,
    predecessor_id: plan.predecessor_id,
    previous_review_count: previousReviewCount,
    previous_confirmed_revision_id: previousConfirmedRevision,
    purpose: plan.title,
  };
  for (const kind of ["superior", "subordinate", "material"])
    ensure(
      snapshot.refs.some((r) => r.kind === kind),
      "INPUT_REQUIRED",
      "起草前需要上级观点、下级观点及秘书提交的可读资料；下级周期可沿用已确认上级资料",
    );
  ensure(
    JSON.stringify(snapshot).length <= 120000,
    "CONTEXT_TOO_LARGE",
    "资料总量过大，请分批整理为摘要后再提交",
  );
  return snapshot;
}
function nextPeriod(plan: any) {
  if (plan.ten_day < 3)
    return { year: plan.year, month: plan.month, ten_day: plan.ten_day + 1 };
  const date = new Date(Date.UTC(plan.year, plan.month, 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    ten_day: 1,
  };
}
async function nextMonths(db: DB, plan: any) {
  if (plan.level !== "ten_day") return [];
  const next = nextPeriod(plan);
  return (
    await db.query(
      "SELECT id,title,month,year FROM goal_plans WHERE business_entity_id=$1 AND level='month' AND year=$2 AND month=$3 AND workflow='confirmed' AND superior_id=$4 AND subordinate_id=$5 AND secretary_id=$6 ORDER BY created_at",
      [
        plan.business_entity_id,
        next.year,
        next.month,
        plan.superior_id,
        plan.subordinate_id,
        plan.secretary_id,
      ],
    )
  ).rows;
}
export async function registerGoalCollaboration(app: FastifyInstance) {
  app.get("/api/v1/goal-plans", async (r) => ({
    data: (
      await pool.query(
        `SELECT p.*,u.name AS subordinate_name,s.name AS superior_name,k.name AS secretary_name,parent.confirmed_revision_id AS latest_parent_revision_id FROM goal_plans p JOIN users u ON u.id=p.subordinate_id JOIN users s ON s.id=p.superior_id JOIN users k ON k.id=p.secretary_id LEFT JOIN goal_plans parent ON parent.id=p.parent_id WHERE p.business_entity_id=$1 AND ($2::boolean OR $3 IN(p.superior_id,p.subordinate_id,p.secretary_id)) ORDER BY p.year DESC,p.quarter DESC,p.month NULLS FIRST,p.ten_day NULLS FIRST,p.created_at`,
        [r.actor.entity, r.actor.role === "owner", r.actor.id],
      )
    ).rows,
  }));
  app.post("/api/v1/goal-plans", async (r) => {
    const p = body(
      z.object({
        title: z.string().trim().min(1).max(300),
        parent_id: z.string().uuid().optional(),
        year: z.number().int().min(2000).max(2200).optional(),
        quarter: z.number().int().min(1).max(4).optional(),
        month: z.number().int().min(1).max(12).optional(),
        ten_day: z.number().int().min(1).max(3).optional(),
        superior_id: z.string().uuid().optional(),
        subordinate_id: z.string().uuid().optional(),
        secretary_id: z.string().uuid().optional(),
      }),
      r,
    );
    return { data: await tx((db) => createPlan(db, r.actor, p)) };
  });
  app.get("/api/v1/goal-plans/:id", async (r) => {
    const plan = await planAccess(pool, r.actor, params(r).id);
    const [
      messages,
      materials,
      revisions,
      confirmations,
      reviews,
      jobs,
      participants,
    ] = await Promise.all(
      [
        "goal_messages",
        "goal_materials",
        "goal_revisions",
        "goal_confirmations",
        "goal_reviews",
        "goal_draft_jobs",
      ]
        .map((table) =>
          pool.query(
            `SELECT t.*,u.name AS author_name FROM ${table} t LEFT JOIN users u ON u.id=t.created_by WHERE t.plan_id=$1 ORDER BY t.created_at,t.id`,
            [plan.id],
          ),
        )
        .concat([
          pool.query("SELECT id,name FROM users WHERE id=ANY($1::uuid[])", [
            [plan.superior_id, plan.subordinate_id, plan.secretary_id],
          ]),
        ]),
    );
    const parent = plan.parent_id
      ? (
          await pool.query(
            "SELECT id,title,workflow,confirmed_revision_id FROM goal_plans WHERE id=$1",
            [plan.parent_id],
          )
        ).rows[0]
      : null;
    let parentIssue: string | null = null;
    try {
      await parentReady(pool, plan);
    } catch (e: any) {
      parentIssue = e.message;
    }
    const range = goalPeriodRange(plan);
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return {
      data: {
        plan,
        messages: messages.rows,
        materials: materials.rows.map((m: any) => ({
          ...m,
          excluded: plan.excluded_material_ids.includes(m.id),
        })),
        revisions: revisions.rows,
        confirmations: confirmations.rows,
        reviews: reviews.rows,
        previous_reviews: plan.predecessor_id
          ? (
              await pool.query(
                "SELECT r.* FROM goal_reviews r JOIN goal_plans p ON p.id=r.plan_id WHERE r.plan_id=$1 AND r.confirmed_revision_id=p.confirmed_revision_id ORDER BY r.created_at",
                [plan.predecessor_id],
              )
            ).rows
          : [],
        input_changed: plan.current_revision_id
          ? !(await snapshotFresh(
              pool,
              revisions.rows.find((v: any) => v.id === plan.current_revision_id)
                .input_snapshot,
              plan.business_entity_id,
            ))
          : false,
        jobs: jobs.rows.map(({ input_snapshot, ...job }: any) => job),
        participants: participants.rows,
        parent,
        parent_issue: parentIssue,
        days_to_end: Math.round(
          (Date.parse(range.end + "T00:00:00Z") -
            Date.parse(today + "T00:00:00Z")) /
            86400000,
        ),
        next_months: await nextMonths(pool, plan),
        ai_configured: new GoalModelAdapter().configured(),
      },
    };
  });
  app.post("/api/v1/goal-plans/:id/messages", async (r) => {
    const p = body(
      z.object({ content: z.string().trim().min(1).max(20000) }),
      r,
    );
    return {
      data: await tx(async (db) => {
        const plan = await lockTree(db, r.actor, params(r).id);
        const voice = participate(r.actor, plan);
        const message = await insert(db, "goal_messages", r.actor, {
          plan_id: plan.id,
          voice,
          content: p.content,
        });
        await touch(db, r.actor, plan);
        await audit(db, r.actor, "goal.message", "goal_plans", plan.id, {
          message_id: message.id,
          voice,
        });
        return message;
      }),
    };
  });
  app.post("/api/v1/goal-plans/:id/materials", async (r) => {
    const p = body(
      z.object({
        title: z.string().trim().min(1).max(200),
        content: z.string().trim().max(80000).optional(),
        source_id: z.string().uuid().optional(),
      }),
      r,
    );
    return {
      data: await tx(async (db) => {
        const plan = await lockTree(db, r.actor, params(r).id);
        ensure(
          participate(r.actor, plan) === "secretary",
          "SECRETARY_REQUIRED",
          "由本议题秘书提交会议纪要与数据资料",
          403,
        );
        let content = p.content || "";
        if (p.source_id) {
          const source = await owned(db, "sources", p.source_id, r.actor);
          content = [source.body, p.content ? "秘书补充文本：" + p.content : ""]
            .filter(Boolean)
            .join("\n");
        }
        ensure(
          p.source_id || content,
          "MATERIAL_REQUIRED",
          "请粘贴纪要、数据表格，或选择原件",
        );
        const material = await insert(db, "goal_materials", r.actor, {
          plan_id: plan.id,
          source_id: p.source_id || null,
          title: p.title,
          content,
        });
        await touch(db, r.actor, plan);
        await audit(db, r.actor, "goal.material", "goal_plans", plan.id, {
          material_id: material.id,
        });
        return material;
      }),
    };
  });
  app.post("/api/v1/goal-plans/:id/materials/:materialId/use", async (r) => {
    const p = body(z.object({ include: z.boolean() }), r);
    return {
      data: await tx(async (db) => {
        const plan = await lockTree(db, r.actor, params(r).id);
        ensure(
          participate(r.actor, plan) === "secretary",
          "SECRETARY_REQUIRED",
          "由秘书选择本次起草资料",
          403,
        );
        const material = await owned(
          db,
          "goal_materials",
          params(r).materialId,
          r.actor,
        );
        ensure(
          material.plan_id === plan.id,
          "NOT_FOUND",
          "资料不属于本议题",
          404,
        );
        await db.query(
          "UPDATE goal_plans SET excluded_material_ids=CASE WHEN $1 THEN array_remove(excluded_material_ids,$2::uuid) ELSE array_append(array_remove(excluded_material_ids,$2::uuid),$2::uuid) END WHERE id=$3",
          [p.include, material.id, plan.id],
        );
        await touch(db, r.actor, plan);
        await audit(db, r.actor, "goal.material.scope", "goal_plans", plan.id, {
          material_id: material.id,
          include: p.include,
        });
        return { include: p.include };
      }),
    };
  });
  app.get(
    "/api/v1/goal-plans/:id/materials/:materialId/download",
    async (r, reply) => {
      const plan = await planAccess(pool, r.actor, params(r).id);
      const m = (
        await pool.query(
          "SELECT s.* FROM goal_materials m JOIN sources s ON s.id=m.source_id AND s.business_entity_id=m.business_entity_id WHERE m.id=$1 AND m.plan_id=$2 AND m.business_entity_id=$3",
          [params(r).materialId, plan.id, r.actor.entity],
        )
      ).rows[0];
      ensure(m?.storage_key, "NO_FILE", "未找到原件", 404);
      ensure(
        /^[a-f0-9]{48}$/.test(m.storage_key),
        "NO_FILE",
        "未找到原件",
        404,
      );
      await audit(
        pool,
        r.actor,
        "goal.material.download",
        "goal_plans",
        plan.id,
        { material_id: params(r).materialId },
      );
      return reply
        .type(m.mime)
        .header(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(m.name)}`,
        )
        .send(
          await readFile(
            path.join(
              path.resolve(process.env.STORAGE_DIR || ".local/files"),
              m.storage_key,
            ),
          ),
        );
    },
  );
  app.post("/api/v1/goal-plans/:id/generate", async (r) => ({
    data: await tx(async (db) => {
      const plan = await lockTree(db, r.actor, params(r).id);
      participate(r.actor, plan);
      await parentReady(db, plan);
      ensure(
        plan.workflow !== "confirmed",
        "REVISION_REQUIRED",
        "已确认目标需先发起调整讨论",
      );
      ensure(
        plan.workflow !== "drafting",
        "ALREADY_QUEUED",
        "AI正在起草，请等待当前任务",
      );
      ensure(
        !(
          await db.query(
            "SELECT 1 FROM goal_draft_jobs WHERE plan_id=$1 AND status IN ('queued','running')",
            [plan.id],
          )
        ).rowCount,
        "ALREADY_QUEUED",
        "上一项起草任务仍在结束，请稍后重新起草",
        409,
      );
      const snapshot = await goalSnapshot(db, plan);
      ensure(
        new GoalModelAdapter().configured(),
        "MODEL_NOT_CONNECTED",
        "AI模型未连接，请先在服务器配置模型；留言和资料已保存",
        503,
      );
      const job = await insert(db, "goal_draft_jobs", r.actor, {
        plan_id: plan.id,
        context_version: plan.context_version,
        input_snapshot: snapshot,
      });
      await db.query(
        "UPDATE goal_plans SET workflow='drafting',current_revision_id=NULL,updated_at=now() WHERE id=$1",
        [plan.id],
      );
      await audit(db, r.actor, "goal.ai.queued", "goal_plans", plan.id, {
        job_id: job.id,
      });
      return job;
    }),
  }));
  app.post("/api/v1/goal-plans/:id/edit", async (r) => {
    const p = body(
      z.object({
        revision_id: z.string().uuid(),
        proposal: z.string().trim().min(10).max(50000),
      }),
      r,
    );
    return {
      data: await tx(async (db) => {
        const plan = await lockTree(db, r.actor, params(r).id);
        participate(r.actor, plan);
        await parentReady(db, plan);
        ensure(
          plan.workflow !== "confirmed" && plan.workflow !== "drafting",
          "REVISION_REQUIRED",
          "请先发起调整或等待AI任务结束",
        );
        ensure(
          plan.current_revision_id === p.revision_id,
          "STALE_REVISION",
          "草案已经变化，请刷新",
          409,
        );
        const old = (
          await db.query("SELECT * FROM goal_revisions WHERE id=$1", [
            p.revision_id,
          ])
        ).rows[0];
        ensure(
          await snapshotFresh(db, old.input_snapshot, plan.business_entity_id),
          "INPUT_CHANGED",
          "上级目标或上一旬复盘已更新，请重新起草",
          409,
        );
        ensure(
          old.context_version === plan.context_version,
          "STALE_REVISION",
          "意见或资料有更新，请重新起草",
          409,
        );
        const revision = await insert(db, "goal_revisions", r.actor, {
          plan_id: plan.id,
          revision: old.revision + 1,
          context_version: plan.context_version,
          input_snapshot: old.input_snapshot,
          proposal: p.proposal,
          evidence: JSON.stringify(old.evidence),
          unknowns: JSON.stringify(old.unknowns),
          risks: JSON.stringify(old.risks),
          origin: "human_edit",
          model: old.model,
        });
        await db.query(
          "UPDATE goal_plans SET current_revision_id=$1,workflow='awaiting_superior' WHERE id=$2",
          [revision.id, plan.id],
        );
        await audit(db, r.actor, "goal.draft.edited", "goal_plans", plan.id, {
          revision_id: revision.id,
        });
        return revision;
      }),
    };
  });
  app.post("/api/v1/goal-plans/:id/confirm", async (r) => {
    const p = body(
      z.object({
        revision_id: z.string().uuid(),
        note: z.string().max(3000).default(""),
      }),
      r,
    );
    return {
      data: await tx(async (db) => {
        const plan = await lockTree(db, r.actor, params(r).id);
        const voice = participate(r.actor, plan);
        await parentReady(db, plan);
        ensure(
          plan.current_revision_id === p.revision_id,
          "STALE_REVISION",
          "这不是当前草案，不能确认",
          409,
        );
        ensure(
          plan.workflow === "awaiting_" + voice,
          "CONFIRM_ORDER",
          "请按上级、下级、秘书的顺序确认，不能代替他人",
          409,
        );
        const rev = (
          await db.query("SELECT * FROM goal_revisions WHERE id=$1", [
            p.revision_id,
          ])
        ).rows[0];
        ensure(
          await snapshotFresh(db, rev.input_snapshot, plan.business_entity_id),
          "INPUT_CHANGED",
          "上级目标或上一旬复盘已更新，请重新起草",
          409,
        );
        ensure(
          rev.context_version === plan.context_version,
          "STALE_REVISION",
          "意见或资料已有更新，请重新起草",
          409,
        );
        await insert(db, "goal_confirmations", r.actor, {
          plan_id: plan.id,
          revision_id: rev.id,
          voice,
          note: p.note,
        });
        const next =
          voice === "superior"
            ? "awaiting_subordinate"
            : voice === "subordinate"
              ? "awaiting_secretary"
              : "confirmed";
        await db.query(
          "UPDATE goal_plans SET workflow=$1,confirmed_revision_id=CASE WHEN $1='confirmed' THEN $2 ELSE confirmed_revision_id END,updated_at=now() WHERE id=$3",
          [next, rev.id, plan.id],
        );
        await audit(
          db,
          r.actor,
          "goal.confirm." + voice,
          "goal_plans",
          plan.id,
          { revision_id: rev.id },
        );
        return { workflow: next };
      }),
    };
  });
  app.post("/api/v1/goal-plans/:id/revise", async (r) => {
    const p = body(
      z.object({ reason: z.string().trim().min(1).max(20000) }),
      r,
    );
    return {
      data: await tx(async (db) => {
        const plan = await lockTree(db, r.actor, params(r).id);
        const voice = participate(r.actor, plan);
        let parentRevision = plan.parent_revision_id;
        if (plan.parent_id) {
          const parent = (
            await db.query("SELECT * FROM goal_plans WHERE id=$1", [
              plan.parent_id,
            ])
          ).rows[0];
          ensure(
            parent.workflow === "confirmed",
            "PARENT_UNCONFIRMED",
            "请先确认上级目标",
          );
          parentRevision = parent.confirmed_revision_id;
        }
        await insert(db, "goal_messages", r.actor, {
          plan_id: plan.id,
          voice,
          content: "调整/退回原因：" + p.reason,
        });
        await db.query(
          "UPDATE goal_plans SET workflow='discussion',current_revision_id=NULL,context_version=context_version+1,parent_revision_id=$1,updated_at=now() WHERE id=$2",
          [parentRevision, plan.id],
        );
        await db.query(
          "UPDATE goal_draft_jobs SET status='stale',error='INPUT_CHANGED',finished_at=now() WHERE plan_id=$1 AND status='queued'",
          [plan.id],
        );
        await audit(db, r.actor, "goal.revise", "goal_plans", plan.id, {
          reason: p.reason,
        });
        return { workflow: "discussion" };
      }),
    };
  });
  app.post("/api/v1/goal-plans/:id/reviews", async (r) => {
    const p = body(
      z.object({
        results: z.string().trim().min(1).max(20000),
        adjustments: z.string().trim().min(1).max(20000),
      }),
      r,
    );
    return {
      data: await tx(async (db) => {
        const plan = await lockTree(db, r.actor, params(r).id);
        participate(r.actor, plan);
        await parentReady(db, plan);
        ensure(
          plan.level === "ten_day" && plan.workflow === "confirmed",
          "REVIEW_NOT_READY",
          "请先完成本旬目标的三方确认",
        );
        const review = await insert(db, "goal_reviews", r.actor, {
          plan_id: plan.id,
          confirmed_revision_id: plan.confirmed_revision_id,
          ...p,
        });
        await audit(db, r.actor, "goal.review", "goal_plans", plan.id, {
          review_id: review.id,
        });
        return review;
      }),
    };
  });
  app.post("/api/v1/goal-plans/:id/next-cycle", async (r) => {
    const p = body(
      z.object({ next_month_plan_id: z.string().uuid().optional() }),
      r,
    );
    return {
      data: await tx(async (db) => {
        const plan = await lockTree(db, r.actor, params(r).id);
        participate(r.actor, plan);
        ensure(
          plan.level === "ten_day" && plan.workflow === "confirmed",
          "REVIEW_NOT_READY",
          "先确认本旬目标并复盘",
        );
        const old = (
          await db.query("SELECT * FROM goal_plans WHERE predecessor_id=$1", [
            plan.id,
          ])
        ).rows[0];
        if (old) return old;
        await parentReady(db, plan);
        ensure(
          (
            await db.query(
              "SELECT 1 FROM goal_reviews WHERE plan_id=$1 AND confirmed_revision_id=$2",
              [plan.id, plan.confirmed_revision_id],
            )
          ).rowCount,
          "REVIEW_REQUIRED",
          "先提交本旬复盘及下一旬调整建议",
        );
        const next = nextPeriod(plan);
        const choices = await nextMonths(db, plan);
        const parent = p.next_month_plan_id
          ? choices.find((v) => v.id === p.next_month_plan_id)
          : choices.length === 1
            ? choices[0]
            : null;
        ensure(
          parent,
          "NEXT_MONTH_REQUIRED",
          "请先确认下一旬所属的月度目标，再选择该月度目标",
        );
        const existing = (
          await db.query(
            "SELECT * FROM goal_plans WHERE parent_id=$1 AND ten_day=$2 AND business_entity_id=$3",
            [parent.id, next.ten_day, r.actor.entity],
          )
        ).rows[0];
        if (existing) {
          const target = await lockTree(db, r.actor, existing.id);
          ensure(
            !target.predecessor_id || target.predecessor_id === plan.id,
            "NEXT_CYCLE_LINKED",
            "下一旬已关联另一条复盘",
            409,
          );
          await db.query(
            "UPDATE goal_plans SET predecessor_id=$1,workflow='discussion',current_revision_id=NULL,context_version=context_version+1,parent_revision_id=(SELECT confirmed_revision_id FROM goal_plans WHERE id=$2),updated_at=now() WHERE id=$3",
            [plan.id, parent.id, target.id],
          );
          await db.query(
            "UPDATE goal_draft_jobs SET status='stale',error='INPUT_CHANGED',finished_at=now() WHERE plan_id=$1 AND status='queued'",
            [target.id],
          );
          await insert(db, "goal_messages", r.actor, {
            plan_id: target.id,
            voice: participate(r.actor, target),
            content: "依据上一旬复盘，对本旬已拟定目标发起调整并重新确认。",
          });
          await audit(
            db,
            r.actor,
            "goal.next.revise",
            "goal_plans",
            target.id,
            { predecessor_id: plan.id },
          );
          return (
            await db.query("SELECT * FROM goal_plans WHERE id=$1", [target.id])
          ).rows[0];
        }
        return createPlan(db, r.actor, {
          title: `${next.year}年${next.month}月${["上旬", "中旬", "下旬"][next.ten_day - 1]}目标调整`,
          parent_id: parent.id,
          ten_day: next.ten_day,
          predecessor_id: plan.id,
        });
      }),
    };
  });
}
