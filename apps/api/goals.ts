import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../../packages/db/index.js";
import { BusinessError } from "../../packages/domain/rules.js";
import { elevated } from "./context.js";
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
  const readOnly = async () => {
    throw new BusinessError(
      "LEGACY_GOALS_READ_ONLY",
      "旧版目标已转为只读，请使用三方协作目标制定",
      409,
    );
  };
  app.post("/api/v1/goals", readOnly);
  app.post("/api/v1/goals/:id/state", readOnly);
}
