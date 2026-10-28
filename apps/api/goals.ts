import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, tx, type DB } from "../../packages/db/index.js";
import { ensure } from "../../packages/domain/rules.js";
import {
  owned,
  member,
  insert,
  update,
  audit,
  elevated,
  permission,
  body,
  params,
  type Actor,
} from "./context.js";
const writers = [
  "owner",
  "manager",
  "sales",
  "market",
  "procurement",
  "finance",
];
async function access(db: DB, a: Actor, id: string, lock = false) {
  const goal = await owned(db, "goals", id, a, lock);
  ensure(
    elevated(a) || goal.owner_id === a.id,
    "NOT_FOUND",
    "目标不存在或不可访问",
    404,
  );
  return goal;
}
export async function registerGoals(app: FastifyInstance) {
  app.get("/api/v1/goals", async (r) => {
    const q = z
      .object({
        year: z.coerce.number().int().min(2000).max(2200).optional(),
        quarter: z.coerce.number().int().min(1).max(4).optional(),
      })
      .parse(r.query);
    return {
      data: (
        await pool.query(
          `SELECT g.*,u.name AS owner_name FROM goals g JOIN users u ON u.id=g.owner_id WHERE g.business_entity_id=$1 AND ($2::integer IS NULL OR g.year=$2) AND ($3::integer IS NULL OR g.quarter=$3) AND ($4::boolean OR g.owner_id=$5) ORDER BY g.year DESC,g.quarter DESC,g.month NULLS FIRST,g.ten_day NULLS FIRST,g.created_at`,
          [
            r.actor.entity,
            q.year || null,
            q.quarter || null,
            elevated(r.actor),
            r.actor.id,
          ],
        )
      ).rows,
    };
  });
  app.post("/api/v1/goals", async (r) => {
    permission(r.actor, writers);
    const p = body(
      z.object({
        title: z.string().trim().min(1).max(300),
        parent_id: z.string().uuid().optional(),
        year: z.number().int().min(2000).max(2200).optional(),
        quarter: z.number().int().min(1).max(4).optional(),
        month: z.number().int().min(1).max(12).optional(),
        ten_day: z.number().int().min(1).max(3).optional(),
        owner_id: z.string().uuid().optional(),
      }),
      r,
    );
    return {
      data: await tx(async (db) => {
        let parent: any = null;
        if (p.parent_id) {
          // Serialize mutations within one goal tree, including parent completion.
          const found = await access(db, r.actor, p.parent_id);
          const root =
            found.level === "quarter"
              ? found
              : await access(db, r.actor, found.parent_id);
          await access(db, r.actor, root.id, true);
          parent = await access(db, r.actor, p.parent_id, true);
          ensure(
            !["completed", "cancelled"].includes(parent.status),
            "GOAL_CLOSED",
            "请先重新打开上级目标，再进行分解",
          );
          ensure(
            parent.level !== "ten_day",
            "INVALID_PARENT",
            "旬目标已经是最下级目标",
          );
        }
        const owner = p.owner_id || parent?.owner_id || r.actor.id;
        ensure(
          elevated(r.actor) || owner === r.actor.id,
          "FORBIDDEN",
          "只能为自己建立目标",
          403,
        );
        await member(db, r.actor, owner);
        if (parent)
          ensure(
            owner === parent.owner_id,
            "OWNER_MISMATCH",
            "分解目标沿用上级负责人",
          );
        const level = parent
          ? parent.level === "quarter"
            ? "month"
            : "ten_day"
          : "quarter";
        const year = parent?.year ?? p.year,
          quarter = parent?.quarter ?? p.quarter;
        ensure(
          year && quarter,
          "PERIOD_REQUIRED",
          "请选择季度目标的年份和季度",
        );
        const month =
          level === "quarter"
            ? null
            : level === "month"
              ? p.month
              : parent.month;
        const ten_day = level === "ten_day" ? p.ten_day : null;
        if (level !== "quarter")
          ensure(
            month && Math.floor((month - 1) / 3) + 1 === quarter,
            "INVALID_MONTH",
            "月份必须属于上级季度",
          );
        if (level === "ten_day")
          ensure(ten_day, "SEGMENT_REQUIRED", "请选择上旬、中旬或下旬");
        const goal = await insert(db, "goals", r.actor, {
          title: p.title,
          parent_id: parent?.id || null,
          level,
          year,
          quarter,
          month,
          ten_day,
          owner_id: owner,
        });
        await audit(db, r.actor, "goal.create", "goals", goal.id, {
          parent_id: goal.parent_id,
          level,
        });
        return goal;
      }),
    };
  });
  app.post("/api/v1/goals/:id/state", async (r) => {
    permission(r.actor, writers);
    const p = body(
      z.object({
        row_version: z.number().int().positive(),
        status: z.enum(["planned", "in_progress", "completed", "cancelled"]),
        result_note: z.string().trim().max(5000).optional(),
      }),
      r,
    );
    return {
      data: await tx(async (db) => {
        const found = await access(db, r.actor, params(r).id);
        const parent = found.parent_id
          ? await access(db, r.actor, found.parent_id)
          : null;
        const root =
          found.level === "quarter"
            ? found
            : found.level === "month"
              ? parent
              : await access(db, r.actor, parent.parent_id);
        await access(db, r.actor, root.id, true);
        const goal = await access(db, r.actor, found.id, true);
        if (parent) {
          const current = await access(db, r.actor, parent.id);
          ensure(
            !["completed", "cancelled"].includes(current.status),
            "PARENT_CLOSED",
            "请先重新打开上级目标",
          );
        }
        if (["completed", "cancelled"].includes(p.status))
          ensure(
            !(
              await db.query(
                "SELECT 1 FROM goals WHERE parent_id=$1 AND status NOT IN ('completed','cancelled')",
                [goal.id],
              )
            ).rowCount,
            "OPEN_CHILDREN",
            "还有下级目标未结束，请先处理下级目标",
          );
        const updated = await update(
          db,
          "goals",
          goal.id,
          r.actor,
          p.row_version,
          { status: p.status, result_note: p.result_note ?? goal.result_note },
        );
        await audit(db, r.actor, "goal.state", "goals", goal.id, {
          from: goal.status,
          to: p.status,
        });
        return updated;
      }),
    };
  });
}
