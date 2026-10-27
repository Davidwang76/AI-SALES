import { hostname } from "node:os";
import { pool, tx } from "../../packages/db/index.js";
import { ModelAdapter } from "../../packages/adapters/model.js";
const adapter = new ModelAdapter();
export async function processOne() {
  const job = await tx(async (db) => {
    const v = (
      await db.query(
        "SELECT * FROM jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
      )
    ).rows[0];
    if (!v) return null;
    await db.query(
      "UPDATE jobs SET status='running',locked_at=now(),attempts=attempts+1 WHERE id=$1",
      [v.id],
    );
    return v;
  });
  if (!job) return false;
  try {
    const source = (
      await pool.query(
        "SELECT * FROM sources WHERE id=$1 AND business_entity_id=$2",
        [job.source_id, job.business_entity_id],
      )
    ).rows[0];
    const output = await adapter.extract(
      { id: source.id, body: source.body },
      job.kind,
    );
    await tx(async (db) => {
      const current = (
        await db.query(
          "SELECT row_version FROM sources WHERE id=$1 FOR UPDATE",
          [source.id],
        )
      ).rows[0];
      await db.query(
        "UPDATE jobs SET status=$1,result=$2,usage=$3,model=$4,finished_at=now() WHERE id=$5",
        [
          current.row_version === job.input_version ? "needs_review" : "stale",
          JSON.stringify(output.result),
          JSON.stringify(output.usage),
          output.model,
          job.id,
        ],
      );
    });
  } catch (e: any) {
    await pool.query(
      "UPDATE jobs SET status='needs_manual',error=$1,finished_at=now() WHERE id=$2",
      [e.code || "MODEL_OUTPUT_OR_CONNECTION_ERROR", job.id],
    );
  }
  return true;
}
if (process.argv[1]?.endsWith("worker.ts")) {
  let stopped = false;
  for (const s of ["SIGINT", "SIGTERM"])
    process.on(s, () => {
      stopped = true;
    });
  console.log("Durable PostgreSQL worker started; external sending disabled");
  while (!stopped) {
    await pool.query(
      "INSERT INTO worker_status(worker_id,updated_at) VALUES($1,now()) ON CONFLICT(worker_id) DO UPDATE SET updated_at=now()",
      [hostname()],
    );
    await pool.query(
      "UPDATE jobs SET status='needs_manual',error='WORKER_INTERRUPTED_OUTCOME_UNKNOWN' WHERE status='running' AND locked_at<now()-interval '5 minutes'",
    );
    if (!(await processOne())) await new Promise((r) => setTimeout(r, 1000));
  }
  await pool.end();
}
