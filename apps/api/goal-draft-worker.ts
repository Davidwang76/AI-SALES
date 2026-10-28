import { pool, tx, type DB } from "../../packages/db/index.js";
import {
  GoalModelAdapter,
  validateGoalDraft,
  type GoalSnapshot,
} from "../../packages/adapters/goal-model.js";
export async function snapshotFresh(
  db: DB,
  snapshot: GoalSnapshot,
  entity: string,
) {
  if (snapshot.parent_plan_id) {
    const p = (
      await db.query(
        "SELECT * FROM goal_plans WHERE id=$1 AND business_entity_id=$2",
        [snapshot.parent_plan_id, entity],
      )
    ).rows[0];
    if (
      p?.workflow !== "confirmed" ||
      p.confirmed_revision_id !== snapshot.parent_revision_id
    )
      return false;
    let ancestor = p;
    while (ancestor.parent_id) {
      const higher = (
        await db.query(
          "SELECT * FROM goal_plans WHERE id=$1 AND business_entity_id=$2",
          [ancestor.parent_id, entity],
        )
      ).rows[0];
      if (
        higher?.workflow !== "confirmed" ||
        higher.confirmed_revision_id !== ancestor.parent_revision_id
      )
        return false;
      ancestor = higher;
    }
  }
  if (snapshot.predecessor_id) {
    const prev = (
      await db.query(
        "SELECT workflow,confirmed_revision_id FROM goal_plans WHERE id=$1 AND business_entity_id=$2",
        [snapshot.predecessor_id, entity],
      )
    ).rows[0];
    if (
      prev?.workflow !== "confirmed" ||
      prev.confirmed_revision_id !== snapshot.previous_confirmed_revision_id
    )
      return false;
    const count = Number(
      (
        await db.query(
          "SELECT count(*) FROM goal_reviews WHERE plan_id=$1 AND business_entity_id=$2 AND confirmed_revision_id=$3",
          [
            snapshot.predecessor_id,
            entity,
            snapshot.previous_confirmed_revision_id,
          ],
        )
      ).rows[0].count,
    );
    if (count !== snapshot.previous_review_count) return false;
  }
  return true;
}
// Adapter injection is for local verification only; production always uses the configured provider.
export async function processGoalDraftOne(
  adapter: Pick<GoalModelAdapter, "generate"> = new GoalModelAdapter(),
) {
  const job = await tx(async (db) => {
    const row = (
      await db.query(
        "SELECT * FROM goal_draft_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
      )
    ).rows[0];
    if (!row) return null;
    await db.query(
      "UPDATE goal_draft_jobs SET status='running',locked_at=now() WHERE id=$1",
      [row.id],
    );
    return row;
  });
  if (!job) return false;
  try {
    const actor = (
      await pool.query("SELECT active FROM users WHERE id=$1", [job.created_by])
    ).rows[0];
    if (!actor?.active)
      throw Object.assign(new Error(), { code: "ACTOR_INACTIVE" });
    const result = await adapter.generate(job.input_snapshot);
    const output = validateGoalDraft(result.output, job.input_snapshot);
    await tx(async (db) => {
      // Lock the quarter before the selected plan, matching every workflow mutation.
      let root = (
        await db.query(
          "SELECT * FROM goal_plans WHERE id=$1 AND business_entity_id=$2",
          [job.plan_id, job.business_entity_id],
        )
      ).rows[0];
      while (root.parent_id)
        root = (
          await db.query("SELECT * FROM goal_plans WHERE id=$1", [
            root.parent_id,
          ])
        ).rows[0];
      await db.query("SELECT id FROM goal_plans WHERE id=$1 FOR UPDATE", [
        root.id,
      ]);
      const plan = (
        await db.query("SELECT * FROM goal_plans WHERE id=$1 FOR UPDATE", [
          job.plan_id,
        ])
      ).rows[0];
      if (
        plan.context_version !== job.context_version ||
        plan.workflow !== "drafting" ||
        !(await snapshotFresh(db, job.input_snapshot, job.business_entity_id))
      ) {
        await db.query(
          "UPDATE goal_draft_jobs SET status='stale',finished_at=now(),error='INPUT_CHANGED' WHERE id=$1",
          [job.id],
        );
        if (
          plan.workflow === "drafting" &&
          plan.context_version === job.context_version
        )
          await db.query(
            "UPDATE goal_plans SET workflow='discussion' WHERE id=$1",
            [plan.id],
          );
        return;
      }
      const rev = Number(
        (
          await db.query(
            "SELECT coalesce(max(revision),0)+1 AS n FROM goal_revisions WHERE plan_id=$1",
            [plan.id],
          )
        ).rows[0].n,
      );
      const revision = (
        await db.query(
          "INSERT INTO goal_revisions(organization_id,business_entity_id,created_by,updated_by,is_demo,plan_id,revision,context_version,input_snapshot,proposal,evidence,unknowns,risks,origin,model) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'model',$13) RETURNING id",
          [
            job.organization_id,
            job.business_entity_id,
            job.created_by,
            job.is_demo,
            plan.id,
            rev,
            job.context_version,
            JSON.stringify(job.input_snapshot),
            output.proposal,
            JSON.stringify(output.evidence),
            JSON.stringify(output.unknowns),
            JSON.stringify(output.risks),
            result.model,
          ],
        )
      ).rows[0];
      await db.query(
        "UPDATE goal_plans SET workflow='awaiting_superior',current_revision_id=$1,updated_at=now() WHERE id=$2",
        [revision.id, plan.id],
      );
      await db.query(
        "UPDATE goal_draft_jobs SET status='succeeded',finished_at=now(),model=$1,usage=$2 WHERE id=$3",
        [result.model, JSON.stringify(result.usage), job.id],
      );
      await db.query(
        "INSERT INTO audit_events(business_entity_id,actor_id,action,object_type,object_id,detail) VALUES($1,$2,'goal.ai.draft','goal_plans',$3,$4)",
        [
          job.business_entity_id,
          job.created_by,
          plan.id,
          JSON.stringify({
            job_id: job.id,
            revision_id: revision.id,
            origin: "model",
          }),
        ],
      );
    });
  } catch (e: any) {
    await tx(async (db) => {
      let root = (
        await db.query("SELECT * FROM goal_plans WHERE id=$1", [job.plan_id])
      ).rows[0];
      while (root.parent_id)
        root = (
          await db.query("SELECT * FROM goal_plans WHERE id=$1", [
            root.parent_id,
          ])
        ).rows[0];
      await db.query("SELECT id FROM goal_plans WHERE id=$1 FOR UPDATE", [
        root.id,
      ]);
      await db.query("SELECT id FROM goal_plans WHERE id=$1 FOR UPDATE", [
        job.plan_id,
      ]);

      await db.query(
        "UPDATE goal_draft_jobs SET status='needs_manual',error=$1,finished_at=now() WHERE id=$2",
        [e.code || "MODEL_OUTPUT_OR_CONNECTION_ERROR", job.id],
      );
      await db.query(
        "UPDATE goal_plans SET workflow='discussion' WHERE id=$1 AND workflow='drafting' AND context_version=$2",
        [job.plan_id, job.context_version],
      );
    });
  }
  return true;
}
