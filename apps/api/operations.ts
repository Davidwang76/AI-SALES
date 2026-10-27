import type { FastifyInstance } from "fastify";
import { z } from "zod";
import Decimal from "decimal.js";
import { pool, tx } from "../../packages/db/index.js";
import {
  quoteCalculation,
  ensure,
  hash,
  scoreDimensions,
  passwordHash,
} from "../../packages/domain/rules.js";
import {
  body,
  params,
  owned,
  insert,
  update,
  audit,
  permission,
  accountAccess,
  elevated,
} from "./context.js";
const money = z.string().regex(/^\d+(\.\d{1,6})?$/);
export async function registerOperations(app: FastifyInstance) {
  const ok = (data: unknown) => ({ data });
  app.get("/api/v1/contacts", async (r) =>
    ok(
      (
        await pool.query(
          "SELECT c.*,a.name AS company FROM contacts c JOIN accounts a ON a.id=c.account_id WHERE c.business_entity_id=$1 AND ($2::boolean OR a.owner_id=$3) ORDER BY c.created_at DESC LIMIT 200",
          [r.actor.entity, elevated(r.actor), r.actor.id],
        )
      ).rows,
    ),
  );
  app.get("/api/v1/supplier-responses", async (r) => {
    permission(r.actor, ["owner", "manager", "procurement"]);
    return ok(
      (
        await pool.query(
          "SELECT s.*,p.name AS product_name,r.rfq_id FROM supplier_responses s JOIN products p ON p.id=s.product_id JOIN purchase_rfqs r ON r.id=s.purchase_rfq_id WHERE s.business_entity_id=$1 ORDER BY s.created_at DESC LIMIT 200",
          [r.actor.entity],
        )
      ).rows,
    );
  });
  app.post("/api/v1/members", async (r) => {
    permission(r.actor, ["owner"]);
    const p = body(
      z.object({
        name: z.string().min(1).max(100),
        email: z.email(),
        password: z.string().min(12).max(200),
        role: z.enum([
          "manager",
          "sales",
          "market",
          "procurement",
          "finance",
          "viewer",
        ]),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        ensure(
          !(
            await db.query("SELECT 1 FROM users WHERE email=$1", [
              p.email.toLowerCase(),
            ])
          ).rowCount,
          "USER_EXISTS",
          "该邮箱已有账号，需单独授权，不可重设密码",
        );
        const u = (
          await db.query(
            "INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email",
            [p.name, p.email.toLowerCase(), passwordHash(p.password)],
          )
        ).rows[0];
        await db.query("INSERT INTO memberships VALUES($1,$2,$3)", [
          u.id,
          r.actor.entity,
          p.role,
        ]);
        await audit(db, r.actor, "member.create", "users", u.id, {
          role: p.role,
        });
        return u;
      }),
    );
  });
  for (const table of [
    "samples",
    "aftersales",
    "trade_documents",
    "automation_rules",
    "eval_datasets",
    "eval_runs",
    "feedback",
  ]) {
    if (table === "feedback") continue;
    app.get("/api/v1/" + table.replaceAll("_", "-"), async (r) => {
      if (["automation_rules", "eval_datasets", "eval_runs"].includes(table))
        permission(r.actor, ["owner", "manager"]);
      const args: any[] = [r.actor.entity];
      let scope = "";
      if (["samples", "aftersales"].includes(table) && !elevated(r.actor)) {
        scope = " AND account_id IN(SELECT id FROM accounts WHERE owner_id=$2)";
        args.push(r.actor.id);
      }
      if (table === "trade_documents" && !elevated(r.actor)) {
        scope =
          " AND order_id IN(SELECT o.id FROM orders o JOIN accounts a ON a.id=o.account_id WHERE a.owner_id=$2)";
        args.push(r.actor.id);
      }
      return ok(
        (
          await pool.query(
            `SELECT * FROM ${table} WHERE business_entity_id=$1 ${scope} ORDER BY created_at DESC LIMIT 100`,
            args,
          )
        ).rows,
      );
    });
  }
  app.post("/api/v1/rfqs/:id/lines/:line", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        oe: z.string().default(""),
        description: z.string().min(1),
        quantity: money.nullable(),
        unit: z.string().default(""),
        quality: z.string().default(""),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const rfq = await owned(db, "rfqs", params(r).id, r.actor, true);
        await accountAccess(db, r.actor, rfq.account_id);
        ensure(
          !(await db.query("SELECT 1 FROM quotes WHERE rfq_id=$1", [rfq.id]))
            .rowCount,
          "RFQ_HAS_QUOTE",
          "该询盘已有报价，请新建询盘版本以保留历史",
        );
        const l = (
          await db.query(
            "UPDATE rfq_lines SET oe=$1,description=$2,quantity=$3,unit=$4,quality=$5,status=$6,product_id=NULL WHERE id=$7 AND rfq_id=$8 RETURNING *",
            [
              p.oe,
              p.description,
              p.quantity,
              p.unit,
              p.quality,
              !p.oe || !p.quantity || !p.unit || !rfq.destination
                ? "needs_clarification"
                : "pending_match",
              params(r).line,
              rfq.id,
            ],
          )
        ).rows[0];
        ensure(l, "NOT_FOUND", "询盘行不存在", 404);
        await audit(db, r.actor, "rfq.clarify", "rfqs", rfq.id, {
          line_id: l.id,
        });
        return l;
      }),
    );
  });
  app.post("/api/v1/accounts/:id/archive", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    const p = body(z.object({ reason: z.string().min(1) }), r);
    return ok(
      await tx(async (db) => {
        const a = await owned(db, "accounts", params(r).id, r.actor);
        const v = await update(db, "accounts", a.id, r.actor, a.row_version, {
          archived_at: new Date().toISOString(),
          archive_reason: p.reason,
        });
        await audit(db, r.actor, "account.archive", "accounts", a.id, p);
        return v;
      }),
    );
  });
  app.post("/api/v1/accounts/:id/relationships", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        name: z.string().min(1),
        kind: z.enum(["branch", "warehouse", "distributor", "buying_role"]),
        location: z.string().default(""),
        fact_status: z
          .enum(["unknown", "extracted", "confirmed", "conflicted"])
          .default("extracted"),
        source_id: z.string().uuid(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await accountAccess(db, r.actor, params(r).id);
        await owned(db, "sources", p.source_id, r.actor);
        const v = await insert(db, "account_relationships", r.actor, {
          ...p,
          account_id: params(r).id,
        });
        await audit(
          db,
          r.actor,
          "relationship.record",
          "accounts",
          params(r).id,
        );
        return v;
      }),
    );
  });
  app.get("/api/v1/accounts/:id/relationships", async (r) => {
    await accountAccess(pool, r.actor, params(r).id);
    return ok(
      (
        await pool.query(
          "SELECT * FROM account_relationships WHERE account_id=$1",
          [params(r).id],
        )
      ).rows,
    );
  });
  app.post("/api/v1/development-plans", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        account_id: z.string().uuid(),
        market_task_id: z.string().uuid(),
        proposal: z.string().min(1),
        unknowns: z.string().default(""),
        next_steps: z.string().min(1),
        knowledge_ids: z.array(z.string().uuid()).default([]),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await accountAccess(db, r.actor, p.account_id);
        const market = await owned(
          db,
          "market_tasks",
          p.market_task_id,
          r.actor,
        );
        for (const id of p.knowledge_ids) {
          const k = await owned(db, "knowledge", id, r.actor);
          ensure(
            k.status === "approved" && new Date(k.valid_until) > new Date(),
            "KNOWLEDGE_UNAVAILABLE",
            "供货资料无效",
          );
        }
        const rev = (
          await db.query(
            "SELECT id FROM market_revisions WHERE task_id=$1 AND revision=$2",
            [market.id, market.revision],
          )
        ).rows[0];
        const { market_task_id, ...data } = p;
        const v = await insert(db, "development_plans", r.actor, {
          ...data,
          market_revision_id: rev.id,
        });
        await audit(
          db,
          r.actor,
          "development.propose",
          "development_plans",
          v.id,
        );
        return v;
      }),
    );
  });
  app.post("/api/v1/samples", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        account_id: z.string().uuid(),
        product_id: z.string().uuid(),
        quantity: money,
        purpose: z.string().min(1),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await accountAccess(db, r.actor, p.account_id);
        await owned(db, "products", p.product_id, r.actor);
        const v = await insert(db, "samples", r.actor, p);
        await audit(db, r.actor, "sample.plan", "samples", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/samples/:id/status", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        row_version: z.number().int(),
        status: z.enum([
          "approved",
          "shipped",
          "received",
          "validated",
          "rejected",
        ]),
        source_id: z.string().uuid(),
        feedback: z.string().default(""),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const s = await owned(db, "samples", params(r).id, r.actor, true);
        await accountAccess(db, r.actor, s.account_id);
        await owned(db, "sources", p.source_id, r.actor);
        const transitions: Record<string, string[]> = {
          planned: ["approved"],
          approved: ["shipped"],
          shipped: ["received"],
          received: ["validated", "rejected"],
        };
        ensure(
          transitions[s.status]?.includes(p.status),
          "INVALID_STATE",
          "签收与客户验证必须分开推进",
        );
        if (p.status === "approved") permission(r.actor, ["owner", "manager"]);
        if (["validated", "rejected"].includes(p.status))
          ensure(p.feedback, "FEEDBACK_REQUIRED", "请填写客户验证反馈");
        const { row_version, ...data } = p;
        const v = await update(db, "samples", s.id, r.actor, row_version, data);
        await audit(db, r.actor, "sample.status", "samples", s.id, {
          status: p.status,
        });
        return v;
      }),
    );
  });
  app.post("/api/v1/aftersales", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        order_id: z.string().uuid(),
        product_id: z.string().uuid(),
        batch: z.string().min(1),
        problem: z.string().min(1),
        source_id: z.string().uuid(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const order = await owned(db, "orders", p.order_id, r.actor);
        await accountAccess(db, r.actor, order.account_id);
        await owned(db, "sources", p.source_id, r.actor);
        ensure(
          (
            await db.query(
              "SELECT 1 FROM order_lines WHERE order_id=$1 AND product_id=$2",
              [order.id, p.product_id],
            )
          ).rowCount,
          "PRODUCT_MISMATCH",
          "产品不属于该订单",
        );
        const v = await insert(db, "aftersales", r.actor, {
          ...p,
          account_id: order.account_id,
        });
        await audit(db, r.actor, "aftersales.open", "aftersales", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/aftersales/:id/resolve", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        row_version: z.number().int(),
        resolution: z.string().min(1),
        compensation: money.default("0"),
        customer_feedback: z.string().default(""),
        action: z.enum(["submit", "approve", "close"]),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const v = await owned(db, "aftersales", params(r).id, r.actor, true);
        await accountAccess(db, r.actor, v.account_id);
        let status = "pending_approval";
        if (p.action === "approve") {
          permission(r.actor, ["owner", "manager"]);
          ensure(
            v.status === "pending_approval",
            "INVALID_STATE",
            "请先提交方案",
          );
          status = "approved";
        }
        if (p.action === "close") {
          ensure(
            v.status === "approved" && p.customer_feedback,
            "APPROVAL_REQUIRED",
            "需批准方案与客户反馈才可关闭",
          );
          status = "closed";
        }
        const n = await update(db, "aftersales", v.id, r.actor, p.row_version, {
          resolution: p.resolution,
          compensation: p.compensation,
          customer_feedback: p.customer_feedback,
          status,
          ...(p.action === "approve" ? { approved_by: r.actor.id } : {}),
        });
        await audit(db, r.actor, `aftersales.${p.action}`, "aftersales", v.id);
        return n;
      }),
    );
  });
  app.post("/api/v1/orders/:id/documents", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    const p = body(
      z.object({
        kind: z.enum(["pi", "invoice", "packing_list"]),
        shipment_ids: z.array(z.string().uuid()).default([]),
        box_count: z.number().int().positive().optional(),
        gross_weight: money.optional(),
        weight_source_id: z.string().uuid().optional(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const order = await owned(db, "orders", params(r).id, r.actor, true);
        const entity = (
          await db.query("SELECT name FROM entities WHERE id=$1", [
            r.actor.entity,
          ])
        ).rows[0];
        const account = await owned(db, "accounts", order.account_id, r.actor);
        const lines = (
          await db.query("SELECT * FROM order_lines WHERE order_id=$1", [
            order.id,
          ])
        ).rows;
        let shipments: any[] = [];
        if (p.kind === "packing_list") {
          ensure(
            p.shipment_ids.length &&
              p.box_count &&
              p.gross_weight &&
              p.weight_source_id,
            "PACKING_EVIDENCE_REQUIRED",
            "装箱单需实际批次、箱数、重量与来源",
          );
          await owned(db, "sources", p.weight_source_id, r.actor);
          shipments = (
            await db.query(
              "SELECT * FROM shipments WHERE id=ANY($1::uuid[]) AND order_id=$2",
              [p.shipment_ids, order.id],
            )
          ).rows;
          ensure(
            shipments.length === new Set(p.shipment_ids).size,
            "SHIPMENT_MISMATCH",
            "批次不属于当前订单",
          );
        }
        const rev =
          Number(
            (
              await db.query(
                "SELECT coalesce(max(revision),0) AS n FROM trade_documents WHERE order_id=$1 AND kind=$2",
                [order.id, p.kind],
              )
            ).rows[0].n,
          ) + 1;
        const snapshot = {
          entity: entity.name,
          customer: account.name,
          order_id: order.id,
          currency: order.currency,
          amount: order.amount,
          lines,
          shipments,
          ...p,
        };
        const v = await insert(db, "trade_documents", r.actor, {
          order_id: order.id,
          kind: p.kind,
          revision: rev,
          snapshot: JSON.stringify(snapshot),
          snapshot_hash: hash(snapshot),
        });
        await audit(db, r.actor, "document.draft", "trade_documents", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/trade-documents/:id/approve", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    return ok(
      await tx(async (db) => {
        const d = await owned(
          db,
          "trade_documents",
          params(r).id,
          r.actor,
          true,
        );
        ensure(d.status === "draft", "INVALID_STATE", "不是待批草稿");
        const v = await update(
          db,
          "trade_documents",
          d.id,
          r.actor,
          d.row_version,
          { status: "approved", approved_by: r.actor.id },
        );
        await audit(db, r.actor, "document.approve", "trade_documents", d.id);
        return v;
      }),
    );
  });
  app.get("/api/v1/trade-documents/:id/export", async (r, reply) => {
    const d = await owned(pool, "trade_documents", params(r).id, r.actor);
    const order = await owned(pool, "orders", d.order_id, r.actor);
    await accountAccess(pool, r.actor, order.account_id);
    const esc = (v: any) =>
      String(v)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    await audit(pool, r.actor, "document.export", "trade_documents", d.id);
    return reply
      .type("text/html; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="${d.kind}-v${d.revision}.html"`,
      )
      .send(
        `<html><meta charset="UTF-8"><h1>${esc(d.kind.toUpperCase())} / ${d.status === "draft" ? "DRAFT" : "APPROVED — NOT SENT"}</h1><p>${esc(d.snapshot.entity)} → ${esc(d.snapshot.customer)}</p><p>Version ${d.revision} / Template ${esc(d.template_version)}</p><pre>${esc(JSON.stringify(d.snapshot, null, 2))}</pre></html>`,
      );
  });
  app.post("/api/v1/allocations/:id/reverse", async (r) => {
    permission(r.actor, ["owner", "finance"]);
    const p = body(z.object({ reason: z.string().min(1) }), r);
    return ok(
      await tx(async (db) => {
        const allocation = await owned(
          db,
          "allocations",
          params(r).id,
          r.actor,
          true,
        );
        const old = (
          await db.query(
            "SELECT * FROM allocation_reversals WHERE allocation_id=$1",
            [allocation.id],
          )
        ).rows[0];
        if (old) return old;
        await owned(db, "receipts", allocation.receipt_id, r.actor, true);
        const exposure = (
          await db.query(
            "SELECT e.*,p.credit_limit FROM credit_exposures e JOIN credit_policies p ON p.account_id=e.account_id WHERE e.order_id=$1 FOR UPDATE OF e,p",
            [allocation.order_id],
          )
        ).rows[0];
        const v = await insert(db, "allocation_reversals", r.actor, {
          allocation_id: allocation.id,
          reason: p.reason,
        });
        if (exposure)
          await db.query(
            "UPDATE credit_exposures SET amount=amount+$1 WHERE id=$2",
            [allocation.amount, exposure.id],
          );
        await audit(
          db,
          r.actor,
          "allocation.reverse",
          "allocation_reversals",
          v.id,
        );
        return v;
      }),
    );
  });
  app.post("/api/v1/accounts/:id/payment-policy", async (r) => {
    permission(r.actor, ["owner", "finance"]);
    const p = body(
      z.object({
        mode: z.enum(["warn_only", "prepaid", "credit"]),
        min_prepaid_ratio: money,
        source_id: z.string().uuid(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await owned(db, "accounts", params(r).id, r.actor);
        await owned(db, "sources", p.source_id, r.actor);
        const v = await insert(db, "payment_policy", r.actor, {
          ...p,
          account_id: params(r).id,
        });
        await audit(db, r.actor, "payment.policy", "payment_policy", v.id);
        return v;
      }),
    );
  });
  app.get("/api/v1/accounts/:id/operating-view", async (r) => {
    await accountAccess(pool, r.actor, params(r).id);
    const orders = (
      await pool.query(
        "SELECT * FROM orders WHERE account_id=$1 AND status<>'cancelled' ORDER BY created_at",
        [params(r).id],
      )
    ).rows;
    const totals: Record<string, Decimal> = {};
    for (const o of orders)
      totals[o.currency] = (totals[o.currency] || new Decimal(0)).plus(
        o.amount,
      );
    return ok({
      orders,
      confirmed_purchase_totals: Object.fromEntries(
        Object.entries(totals).map(([k, v]) => [k, v.toFixed(2)]),
      ),
      independent_purchases: new Set(orders.map((o) => o.purchase_reference))
        .size,
      replenishment_status: "needs_customer_confirmation",
      replenishment_reason:
        "仅有我方订单或出货记录，未获得客户库存与下游销量；不能断言客户缺货。",
      aftersales: (
        await pool.query("SELECT * FROM aftersales WHERE account_id=$1", [
          params(r).id,
        ])
      ).rows,
    });
  });
  app.get("/api/v1/reports/finance", async (r) => {
    permission(r.actor, ["owner", "manager", "finance"]);
    const demo = (r.query as any).demo === "true";
    const orders = (
      await pool.query(
        "SELECT currency,sum(amount)::text AS confirmed_orders,count(DISTINCT(account_id,purchase_reference))::int AS independent_purchases FROM orders WHERE business_entity_id=$1 AND is_demo=$2 AND status<>'cancelled' GROUP BY currency",
        [r.actor.entity, demo],
      )
    ).rows;
    const receipts = (
      await pool.query(
        "SELECT currency,sum(amount)::text AS verified_receipts FROM receipts WHERE business_entity_id=$1 AND is_demo=$2 AND status='verified' GROUP BY currency",
        [r.actor.entity, demo],
      )
    ).rows;
    const allocated = (
      await pool.query(
        "SELECT o.currency,sum(a.amount)::text AS allocated FROM allocations a JOIN orders o ON o.id=a.order_id WHERE a.business_entity_id=$1 AND a.is_demo=$2 AND a.id NOT IN(SELECT allocation_id FROM allocation_reversals) GROUP BY o.currency",
        [r.actor.entity, demo],
      )
    ).rows;
    return ok({
      orders,
      receipts,
      allocated,
      notes:
        "订单为确认采购，非收入确认；到账与核销分开，币种分列，默认排除演示。",
    });
  });
  app.post("/api/v1/feedback", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        object_type: z.enum(["accounts", "products", "knowledge", "rfqs"]),
        object_id: z.string().uuid(),
        field: z.string().min(1),
        before_value: z.string(),
        after_value: z.string(),
        reason: z.string().min(1),
        minutes: z.number().int().positive(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await owned(db, p.object_type, p.object_id, r.actor);
        const v = await insert(db, "feedback", r.actor, p);
        await insert(db, "work_logs", r.actor, {
          category: "rework",
          minutes: p.minutes,
          note: `修订反馈 ${v.id}`,
        });
        await audit(db, r.actor, "feedback.propose", "feedback", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/automation-rules", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    const p = body(
      z.object({
        name: z.string().min(1),
        kind: z.enum(["internal_followup", "internal_review"]),
        daily_limit: z.number().int().positive().max(2000),
        scope_activity_id: z.string().uuid().optional(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        if (p.scope_activity_id)
          await owned(db, "activities", p.scope_activity_id, r.actor);
        const v = await insert(db, "automation_rules", r.actor, p);
        await audit(db, r.actor, "rule.create", "automation_rules", v.id);
        return v;
      }),
    );
  });
  app.get("/api/v1/automation-rules/:id/preview", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    const rule = await owned(pool, "automation_rules", params(r).id, r.actor);
    return ok(
      (
        await pool.query(
          "SELECT id,company FROM leads WHERE business_entity_id=$1 AND status='needs_verification' AND ($2::uuid IS NULL OR activity_id=$2) ORDER BY created_at LIMIT $3",
          [r.actor.entity, rule.scope_activity_id, rule.daily_limit],
        )
      ).rows,
    );
  });
  app.post("/api/v1/automation-rules/:id/:action", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    const { id, action } = params(r);
    ensure(
      ["enable", "pause", "execute"].includes(action),
      "NOT_FOUND",
      "操作不存在",
      404,
    );
    return ok(
      await tx(async (db) => {
        const rule = await owned(db, "automation_rules", id, r.actor, true);
        if (action !== "execute") {
          const v = await update(
            db,
            "automation_rules",
            id,
            r.actor,
            rule.row_version,
            {
              enabled: action === "enable",
              version: rule.version + 1,
              stop_reason: action === "pause" ? "人工暂停" : null,
            },
          );
          await audit(db, r.actor, `rule.${action}`, "automation_rules", id);
          return v;
        }
        ensure(rule.enabled, "RULE_PAUSED", "规则已暂停，旧执行不得继续");
        const already = Number(
          (
            await db.query(
              "SELECT count(*) FROM action_executions WHERE rule_id=$1 AND created_at>=date_trunc('day',now())",
              [id],
            )
          ).rows[0].count,
        );
        const remaining = Math.max(0, rule.daily_limit - already);
        const leads = (
          await db.query(
            "SELECT * FROM leads WHERE business_entity_id=$1 AND status='needs_verification' AND ($2::uuid IS NULL OR activity_id=$2) ORDER BY created_at LIMIT $3",
            [r.actor.entity, rule.scope_activity_id, remaining],
          )
        ).rows;
        const results = [];
        for (const lead of leads) {
          const key = `${rule.id}:${rule.version}:${lead.id}`;
          if (
            (
              await db.query(
                "SELECT 1 FROM action_executions WHERE idempotency_key=$1",
                [key],
              )
            ).rowCount
          )
            continue;
          const task = await insert(db, "tasks", r.actor, {
            lead_id: lead.id,
            account_id: lead.account_id,
            title: `内部核实：${lead.company}`,
            kind: "verify",
            owner_id: lead.assigned_to || r.actor.id,
            due_at: new Date(Date.now() + 86400000).toISOString(),
          });
          results.push(
            await insert(db, "action_executions", r.actor, {
              rule_id: id,
              task_id: task.id,
              idempotency_key: key,
              status: "succeeded",
            }),
          );
        }
        await audit(db, r.actor, "rule.execute", "automation_rules", id, {
          count: results.length,
        });
        return results;
      }),
    );
  });
  app.post("/api/v1/eval-datasets", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    const p = body(
      z.object({
        name: z.string().min(1),
        revision: z.number().int().positive().default(1),
        fixture_type: z.enum(["synthetic", "anonymized"]),
        adjudicator: z.string().min(1),
        cases: z
          .array(
            z.object({
              id: z.string().min(1),
              kind: z.enum(["quote", "score", "manual"]),
              input: z.record(z.string(), z.any()),
              expected: z.record(z.string(), z.any()),
              critical: z.boolean(),
            }),
          )
          .min(1),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const v = await insert(db, "eval_datasets", r.actor, {
          ...p,
          cases: JSON.stringify(p.cases),
        });
        await audit(db, r.actor, "eval.dataset", "eval_datasets", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/eval-runs", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    const p = body(
      z.object({
        dataset_id: z.string().uuid(),
        config_version: z.string().min(1),
        code_version: z.string().min(1),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const dataset = await owned(db, "eval_datasets", p.dataset_id, r.actor);
        const results = dataset.cases.map((c: any) => {
          if (c.kind === "manual")
            return {
              case_id: c.id,
              status: "pending_adjudication",
              critical: c.critical,
            };
          try {
            const actual =
              c.kind === "quote"
                ? quoteCalculation(c.input)
                : scoreDimensions(c.input.dimensions);
            const pass = Object.entries(c.expected).every(
              ([key, v]) => (actual as any)[key] === v,
            );
            return {
              case_id: c.id,
              status: pass ? "passed" : "failed",
              actual,
              expected: c.expected,
              critical: c.critical,
            };
          } catch {
            return { case_id: c.id, status: "failed", critical: c.critical };
          }
        });
        const status = results.some((c: any) => c.status === "failed")
          ? "failed"
          : results.some((c: any) => c.status === "pending_adjudication")
            ? "pending_adjudication"
            : "passed";
        const v = await insert(db, "eval_runs", r.actor, {
          ...p,
          status,
          results: JSON.stringify(results),
        });
        await audit(db, r.actor, "eval.run", "eval_runs", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/release-gates", async (r) => {
    permission(r.actor, ["owner"]);
    const p = body(
      z.object({
        eval_run_id: z.string().uuid(),
        stage: z.enum(["A", "B", "C"]),
        reason: z.string().min(1),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const run = await owned(db, "eval_runs", p.eval_run_id, r.actor);
        ensure(
          run.status === "passed",
          "RELEASE_BLOCKED",
          "存在失败或未裁定案例，不能发布配置",
        );
        const v = await insert(db, "release_gates", r.actor, {
          ...p,
          status: "released",
        });
        await audit(db, r.actor, "config.release", "release_gates", v.id);
        return v;
      }),
    );
  });
  app.get("/api/v1/reports/runtime", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    return ok({
      worker_recent: Boolean(
        (
          await pool.query(
            "SELECT 1 FROM worker_status WHERE updated_at>now()-interval '30 seconds'",
          )
        ).rowCount,
      ),
      jobs: (
        await pool.query(
          "SELECT status,count(*)::int AS count FROM jobs WHERE business_entity_id=$1 GROUP BY status",
          [r.actor.entity],
        )
      ).rows,
      external_sending: "disabled",
    });
  });
  app.post("/api/v1/account/password", async (r) => {
    const p = body(
      z.object({
        old_password: z.string().min(1),
        new_password: z.string().min(12).max(200),
      }),
      r,
    );
    const { checkPassword } = await import("../../packages/domain/rules.js");
    return ok(
      await tx(async (db) => {
        const u = (
          await db.query(
            "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
            [r.actor.id],
          )
        ).rows[0];
        ensure(
          checkPassword(p.old_password, u.password_hash),
          "PASSWORD_MISMATCH",
          "当前密码不正确",
          403,
        );
        await db.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
          passwordHash(p.new_password),
          r.actor.id,
        ]);
        await db.query("DELETE FROM sessions WHERE user_id=$1", [r.actor.id]);
        await audit(db, r.actor, "user.password_changed", "users", r.actor.id);
        return { reauthenticate: true };
      }),
    );
  });
  app.post("/api/v1/opportunities/:id/win", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({ order_id: z.string().uuid(), row_version: z.number().int() }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const o = await owned(db, "opportunities", params(r).id, r.actor);
        await accountAccess(db, r.actor, o.account_id);
        const order = await owned(db, "orders", p.order_id, r.actor);
        ensure(
          order.account_id === o.account_id && order.status !== "cancelled",
          "ORDER_REQUIRED",
          "赢单需同客户的确认订单",
        );
        const v = await update(
          db,
          "opportunities",
          o.id,
          r.actor,
          p.row_version,
          { stage: "won", confirmed_order_id: order.id },
        );
        await audit(db, r.actor, "opportunity.win", "opportunities", o.id, {
          order_id: order.id,
        });
        return v;
      }),
    );
  });
  app.post("/api/v1/accounts/:id/preferences", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        row_version: z.number().int(),
        preferences: z.string().max(10000),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await accountAccess(db, r.actor, params(r).id);
        const v = await update(
          db,
          "accounts",
          params(r).id,
          r.actor,
          p.row_version,
          { preferences: p.preferences },
        );
        await audit(db, r.actor, "account.preferences", "accounts", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/financial-settings", async (r) => {
    permission(r.actor, ["owner", "finance"]);
    const p = body(
      z.object({ margin_floor: money, source_id: z.string().uuid() }),
      r,
    );
    ensure(
      new Decimal(p.margin_floor).lt(1),
      "INVALID_MARGIN",
      "毛利底线需小于1",
    );
    return ok(
      await tx(async (db) => {
        await owned(db, "sources", p.source_id, r.actor);
        const v = (
          await db.query(
            "INSERT INTO financial_settings(business_entity_id,margin_floor,approved_by,source_id) VALUES($1,$2,$3,$4) ON CONFLICT(business_entity_id) DO UPDATE SET margin_floor=$2,approved_by=$3,source_id=$4,updated_at=now() RETURNING *",
            [r.actor.entity, p.margin_floor, r.actor.id, p.source_id],
          )
        ).rows[0];
        await audit(
          db,
          r.actor,
          "finance.margin_policy",
          "entities",
          r.actor.entity,
        );
        return v;
      }),
    );
  });
  app.post("/api/v1/quotes/:id/feedback", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        line_index: z.number().int().min(0),
        response: z.enum([
          "accepted",
          "negotiating",
          "rejected",
          "needs_model_change",
        ]),
        notes: z.string().min(1),
        source_id: z.string().uuid(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const q = await owned(db, "quotes", params(r).id, r.actor);
        await accountAccess(db, r.actor, q.account_id);
        const rev = await owned(
          db,
          "quote_revisions",
          q.current_revision_id,
          r.actor,
        );
        await owned(db, "sources", p.source_id, r.actor);
        ensure(
          p.line_index < rev.snapshot.lines.length,
          "LINE_NOT_FOUND",
          "报价行不存在",
        );
        const v = await insert(db, "quote_feedback", r.actor, {
          ...p,
          quote_revision_id: rev.id,
        });
        await audit(db, r.actor, "quote.feedback", "quotes", q.id, {
          feedback_id: v.id,
        });
        return v;
      }),
    );
  });
  app.post("/api/v1/quotes/:id/register-dispatch", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        evidence_id: z.string().uuid(),
        occurred_at: z.string().datetime(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const q = await owned(db, "quotes", params(r).id, r.actor);
        await accountAccess(db, r.actor, q.account_id);
        const rev = await owned(
          db,
          "quote_revisions",
          q.current_revision_id,
          r.actor,
        );
        const c = await owned(db, "contacts", rev.recipient_id, r.actor);
        ensure(
          rev.status === "approved" && new Date(rev.valid_until) > new Date(),
          "APPROVAL_REQUIRED",
          "需有效批准版本",
        );
        ensure(
          c.permission !== "withdrawn",
          "SUPPRESSED",
          "联系人已退订，不能登记新发送",
        );
        await owned(db, "sources", p.evidence_id, r.actor);
        const v = await insert(db, "manual_dispatches", r.actor, {
          object_type: "quote",
          object_id: rev.id,
          recipient_id: c.id,
          ...p,
        });
        await audit(db, r.actor, "quote.dispatch_registered", "quotes", q.id, {
          dispatch_id: v.id,
          revision: rev.revision,
        });
        return v;
      }),
    );
  });
}
