import type { FastifyInstance } from "fastify";
import { z } from "zod";
import Decimal from "decimal.js";
import { pool, tx } from "../../packages/db/index.js";
import { ensure, hash, quoteCalculation } from "../../packages/domain/rules.js";
import {
  body,
  params,
  owned,
  insert,
  update,
  permission,
  audit,
  accountAccess,
  elevated,
  type Actor,
} from "./context.js";
const money = z.string().regex(/^\d+(\.\d{1,6})?$/),
  currency = z.string().regex(/^[A-Z]{3}$/);
export async function registerTrade(app: FastifyInstance) {
  const ok = (data: unknown) => ({ data });
  for (const t of [
    "products",
    "suppliers",
    "purchase_rfqs",
    "quotes",
    "orders",
    "receipts",
  ])
    app.get("/api/v1/" + t.replaceAll("_", "-"), async (r) => {
      if (["suppliers", "purchase_rfqs"].includes(t))
        permission(r.actor, ["owner", "manager", "procurement"]);
      let extra = "";
      const args: any[] = [r.actor.entity];
      if (
        ["quotes", "orders", "receipts"].includes(t) &&
        !elevated(r.actor) &&
        r.actor.role === "sales"
      ) {
        extra = " AND account_id IN(SELECT id FROM accounts WHERE owner_id=$2)";
        args.push(r.actor.id);
      }
      const page = z
        .object({
          limit: z.coerce.number().int().min(1).max(200).default(100),
          offset: z.coerce.number().int().min(0).default(0),
          q: z.string().max(200).default(""),
        })
        .parse(r.query);
      if (page.q) {
        args.push("%" + page.q + "%");
        extra += ` AND to_jsonb(t)::text ILIKE $${args.length}`;
      }
      args.push(page.limit, page.offset);
      return ok(
        (
          await pool.query(
            `SELECT t.* FROM ${t} t WHERE business_entity_id=$1 ${extra} ORDER BY created_at DESC LIMIT $${args.length - 1} OFFSET $${args.length}`,
            args,
          )
        ).rows,
      );
    });
  app.post("/api/v1/products", async (r) => {
    permission(r.actor, ["owner", "manager", "procurement"]);
    const p = body(
      z.object({
        sku: z.string().min(1),
        name: z.string().min(1),
        category: z.string().min(1),
        unit: z.string().min(1).default("piece"),
        oe: z.string().default(""),
        fitment: z.string().default(""),
        fitment_status: z
          .enum(["unverified", "confirmed", "conflicted"])
          .default("unverified"),
        source_id: z.string().uuid(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await owned(db, "sources", p.source_id, r.actor);
        const v = await insert(db, "products", r.actor, p);
        await audit(db, r.actor, "product.create", "products", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/suppliers", async (r) => {
    permission(r.actor, ["owner", "manager", "procurement"]);
    const p = body(
      z.object({
        name: z.string().min(1),
        email: z.email(),
        evidence_id: z.string().uuid(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await owned(db, "sources", p.evidence_id, r.actor);
        return insert(db, "suppliers", r.actor, p);
      }),
    );
  });
  app.post("/api/v1/rfqs/:id/match", async (r) => {
    permission(r.actor, ["owner", "manager", "procurement"]);
    const p = body(
      z.object({ line_id: z.string().uuid(), product_id: z.string().uuid() }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const rfq = await owned(db, "rfqs", params(r).id, r.actor);
        const product = await owned(db, "products", p.product_id, r.actor);
        const line = (
          await db.query("SELECT * FROM rfq_lines WHERE id=$1 AND rfq_id=$2", [
            p.line_id,
            rfq.id,
          ])
        ).rows[0];
        ensure(line, "NOT_FOUND", "询盘行不存在", 404);
        ensure(
          product.fitment_status === "confirmed" &&
            product.oe &&
            line.oe === product.oe,
          "FITMENT_UNCONFIRMED",
          "OE不符、缺失或适配尚未确认",
        );
        ensure(
          line.quantity && line.unit && rfq.destination,
          "RFQ_INCOMPLETE",
          "数量、单位或目的地待补充",
        );
        await db.query(
          "UPDATE rfq_lines SET product_id=$1,status='matched' WHERE id=$2",
          [product.id, line.id],
        );
        await audit(db, r.actor, "rfq.match", "rfqs", rfq.id, {
          line_id: line.id,
          product_id: product.id,
        });
        return { id: line.id, status: "matched" };
      }),
    );
  });
  app.post("/api/v1/purchase-rfqs", async (r) => {
    permission(r.actor, ["owner", "manager", "procurement"]);
    const p = body(
      z.object({ rfq_id: z.string().uuid(), name: z.string().min(1) }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await owned(db, "rfqs", p.rfq_id, r.actor);
        const v = await insert(db, "purchase_rfqs", r.actor, p);
        await audit(db, r.actor, "purchase_rfq.create", "purchase_rfqs", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/purchase-rfqs/:id/responses", async (r) => {
    permission(r.actor, ["owner", "manager", "procurement"]);
    const p = body(
      z.object({
        rfq_line_id: z.string().uuid(),
        supplier_id: z.string().uuid(),
        product_id: z.string().uuid(),
        source_id: z.string().uuid(),
        price: money,
        currency,
        pack_qty: money.nullable(),
        unit: z.string().min(1),
        quality: z.string().min(1),
        fee_scope: z.string().min(1),
        moq: money,
        valid_until: z.string().datetime(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const request = await owned(db, "purchase_rfqs", params(r).id, r.actor);
        for (const [t, id] of [
          ["suppliers", p.supplier_id],
          ["products", p.product_id],
          ["sources", p.source_id],
        ])
          await owned(db, t, id, r.actor);
        ensure(
          (
            await db.query(
              "SELECT 1 FROM rfq_lines WHERE id=$1 AND rfq_id=$2",
              [p.rfq_line_id, request.rfq_id],
            )
          ).rowCount,
          "LINE_MISMATCH",
          "询盘行不属于当前采购任务",
        );
        const v = await insert(db, "supplier_responses", r.actor, {
          ...p,
          purchase_rfq_id: request.id,
        });
        await audit(
          db,
          r.actor,
          "supplier.response",
          "supplier_responses",
          v.id,
        );
        return v;
      }),
    );
  });
  app.get("/api/v1/purchase-rfqs/:id/comparison", async (r) => {
    permission(r.actor, ["owner", "manager", "procurement"]);
    const request = await owned(pool, "purchase_rfqs", params(r).id, r.actor);
    const rows = (
      await pool.query(
        "SELECT s.*,p.name AS product_name FROM supplier_responses s JOIN products p ON p.id=s.product_id WHERE purchase_rfq_id=$1",
        [request.id],
      )
    ).rows;
    const signatures = new Set(
      rows.map((x) => [x.currency, x.quality, x.fee_scope, x.unit].join("|")),
    );
    return ok(
      rows.map((x) => ({
        ...x,
        normalized_unit_cost: x.pack_qty
          ? new Decimal(x.price).div(x.pack_qty).toFixed(6)
          : null,
        comparable:
          Boolean(x.pack_qty) &&
          signatures.size === 1 &&
          new Date(x.valid_until) > new Date(),
        reasons: [
          ...(!x.pack_qty ? ["箱规未知"] : []),
          ...(signatures.size > 1 ? ["币种、单位、质量或费用口径不同"] : []),
          ...(new Date(x.valid_until) <= new Date() ? ["报价过期"] : []),
        ],
      })),
    );
  });
  app.post("/api/v1/supplier-responses/:id/select", async (r) => {
    permission(r.actor, ["owner", "manager", "procurement"]);
    const p = body(z.object({ reason: z.string().min(1) }), r);
    return ok(
      await tx(async (db) => {
        const original = await owned(
          db,
          "supplier_responses",
          params(r).id,
          r.actor,
        );
        await owned(
          db,
          "purchase_rfqs",
          original.purchase_rfq_id,
          r.actor,
          true,
        );
        const v = await owned(
          db,
          "supplier_responses",
          original.id,
          r.actor,
          true,
        );
        ensure(
          v.pack_qty && new Date(v.valid_until) > new Date(),
          "OFFER_INVALID",
          "箱规未知或成本过期",
        );
        await db.query(
          "UPDATE supplier_responses SET selected=false WHERE purchase_rfq_id=$1 AND rfq_line_id=$2",
          [v.purchase_rfq_id, v.rfq_line_id],
        );
        const n = await update(
          db,
          "supplier_responses",
          v.id,
          r.actor,
          v.row_version,
          { selected: true, selection_reason: p.reason },
        );
        await audit(
          db,
          r.actor,
          "supplier.select",
          "supplier_responses",
          v.id,
          p,
        );
        return n;
      }),
    );
  });
  const calc = z.object({
    cost: money,
    quantity: money,
    pack: money.default("1"),
    fees: money.default("0"),
    margin: money,
    fx: money,
    direction: z.enum(["cost_to_quote", "quote_to_cost"]),
  });
  app.post("/api/v1/quotes/calculate", async (r) => {
    permission(r.actor, ["owner", "manager", "procurement", "finance"]);
    return ok(quoteCalculation(body(calc, r)));
  });
  const quoteInput = z.object({
    rfq_id: z.string().uuid(),
    recipient_id: z.string().uuid(),
    currency,
    incoterm: z.string().min(1),
    place: z.string().min(1),
    payment_terms: z.string().min(1),
    valid_until: z.string().datetime(),
    lines: z
      .array(
        z.object({
          response_id: z.string().uuid(),
          quantity: money,
          margin: money,
          fx: money,
          fx_direction: z.enum(["cost_to_quote", "quote_to_cost"]),
          fees: money.default("0"),
        }),
      )
      .min(1),
  });
  async function makeRevision(
    db: any,
    a: Actor,
    p: z.infer<typeof quoteInput>,
    quote: any,
    revision: number,
  ) {
    const rfq = await owned(db, "rfqs", p.rfq_id, a);
    await accountAccess(db, a, rfq.account_id);
    const contact = await owned(db, "contacts", p.recipient_id, a);
    ensure(
      contact.account_id === rfq.account_id,
      "RECIPIENT_MISMATCH",
      "收件人不属于该客户",
    );
    const snapshotLines = [];
    let amount = new Decimal(0);
    const seen = new Set<string>();
    for (const l of p.lines) {
      const offer = await owned(db, "supplier_responses", l.response_id, a);
      const purchase = await owned(
        db,
        "purchase_rfqs",
        offer.purchase_rfq_id,
        a,
      );
      ensure(purchase.rfq_id === rfq.id, "RFQ_MISMATCH", "货源不属于该询盘");
      const line = (
        await db.query("SELECT * FROM rfq_lines WHERE id=$1", [
          offer.rfq_line_id,
        ])
      ).rows[0];
      ensure(!seen.has(line.id), "DUPLICATE_LINE", "不能重复报价同一询盘行");
      seen.add(line.id);
      ensure(
        line.status === "matched" && line.product_id === offer.product_id,
        "FITMENT_UNCONFIRMED",
        "询盘适配未确认",
      );
      ensure(
        offer.selected &&
          offer.pack_qty &&
          new Date(offer.valid_until) > new Date(),
        "COST_EXPIRED",
        "货源未选择、箱规未知或成本过期",
      );
      ensure(
        new Decimal(l.quantity).lte(line.quantity) &&
          new Decimal(l.quantity).gte(offer.moq),
        "INVALID_QUANTITY",
        "数量超过需求或低于MOQ",
      );
      const result = quoteCalculation({
        cost: offer.price,
        quantity: l.quantity,
        pack: offer.pack_qty,
        fees: l.fees,
        margin: l.margin,
        fx: l.fx,
        direction: l.fx_direction,
      });
      amount = amount.plus(result.amount);
      snapshotLines.push({
        ...l,
        ...result,
        product_id: offer.product_id,
        rfq_line_id: line.id,
        cost_snapshot: offer,
      });
    }
    const snapshot = { ...p, lines: snapshotLines };
    const rev = await insert(db, "quote_revisions", a, {
      quote_id: quote.id,
      revision,
      recipient_id: p.recipient_id,
      currency: p.currency,
      incoterm: p.incoterm,
      place: p.place,
      payment_terms: p.payment_terms,
      valid_until: p.valid_until,
      snapshot: JSON.stringify(snapshot),
      snapshot_hash: hash(snapshot),
      amount: amount.toFixed(2),
    });
    await db.query(
      "UPDATE quotes SET revision=$1,current_revision_id=$2,row_version=row_version+1 WHERE id=$3",
      [revision, rev.id, quote.id],
    );
    await audit(db, a, "quote.revise", "quotes", quote.id, { revision });
    return rev;
  }
  app.post("/api/v1/quotes", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    const p = body(quoteInput, r);
    return ok(
      await tx(async (db) => {
        const rfq = await owned(db, "rfqs", p.rfq_id, r.actor);
        const quote = await insert(db, "quotes", r.actor, {
          rfq_id: rfq.id,
          account_id: rfq.account_id,
        });
        return makeRevision(db, r.actor, p, quote, 1);
      }),
    );
  });
  app.post("/api/v1/quotes/:id/revisions", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    const p = body(quoteInput, r);
    return ok(
      await tx(async (db) => {
        const q = await owned(db, "quotes", params(r).id, r.actor, true);
        ensure(q.rfq_id === p.rfq_id, "RFQ_MISMATCH", "不能更换询盘");
        await db.query(
          "UPDATE quote_revisions SET status='superseded' WHERE id=$1 AND status IN('draft','approved')",
          [q.current_revision_id],
        );
        return makeRevision(db, r.actor, p, q, q.revision + 1);
      }),
    );
  });
  function publicQuote(rev: any, a: Actor) {
    if (!["owner", "manager", "procurement", "finance"].includes(a.role)) {
      rev = structuredClone(rev);
      for (const line of rev.snapshot.lines) {
        delete line.cost_snapshot;
        delete line.cost_total;
        delete line.gross_profit;
        delete line.margin;
        delete line.actual_margin;
      }
    }
    return rev;
  }
  app.get("/api/v1/quotes/:id", async (r) => {
    const q = await owned(pool, "quotes", params(r).id, r.actor);
    await accountAccess(pool, r.actor, q.account_id);
    const revisions = (
      await pool.query(
        "SELECT * FROM quote_revisions WHERE quote_id=$1 ORDER BY revision DESC",
        [q.id],
      )
    ).rows;
    return ok({
      ...q,
      revisions: revisions.map((x) => publicQuote(x, r.actor)),
    });
  });
  app.post("/api/v1/quotes/:id/approve", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    const p = body(
      z.object({ row_version: z.number().int(), reason: z.string().min(1) }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const q = await owned(db, "quotes", params(r).id, r.actor, true);
        const rev = await owned(
          db,
          "quote_revisions",
          q.current_revision_id,
          r.actor,
        );
        ensure(
          rev.status === "draft" && new Date(rev.valid_until) > new Date(),
          "QUOTE_INVALID",
          "当前版本不是有效草稿",
        );
        for (const l of rev.snapshot.lines) {
          const offer = await owned(
            db,
            "supplier_responses",
            l.response_id,
            r.actor,
          );
          ensure(
            new Date(offer.valid_until) > new Date(),
            "COST_EXPIRED",
            "成本已失效",
          );
        }
        const policy = (
          await db.query(
            "SELECT * FROM financial_settings WHERE business_entity_id=$1",
            [r.actor.entity],
          )
        ).rows[0];
        if (policy)
          for (const line of rev.snapshot.lines)
            ensure(
              new Decimal(line.actual_margin).gte(policy.margin_floor),
              "MARGIN_BELOW_FLOOR",
              "低于批准毛利底线，不可批准；须另行修订政策或报价",
            );
        const v = await update(
          db,
          "quote_revisions",
          rev.id,
          r.actor,
          p.row_version,
          {
            status: "approved",
            approved_by: r.actor.id,
            approved_hash: rev.snapshot_hash,
          },
        );
        await audit(db, r.actor, "quote.approve", "quotes", q.id, {
          revision: rev.revision,
          reason: p.reason,
        });
        return v;
      }),
    );
  });
  app.get("/api/v1/quotes/:id/export", async (r, reply) => {
    const q = await owned(pool, "quotes", params(r).id, r.actor);
    await accountAccess(pool, r.actor, q.account_id);
    const rev = await owned(
      pool,
      "quote_revisions",
      q.current_revision_id,
      r.actor,
    );
    await audit(pool, r.actor, "quote.export", "quotes", q.id, {
      revision: rev.revision,
    });
    const esc = (x: any) =>
      String(x).replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c]!,
      );
    return reply
      .type("text/html; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="quote-${q.id}-v${rev.revision}.html"`,
      )
      .send(
        `<html lang="en"><meta charset="UTF-8"><title>Quotation</title><h1>${rev.status === "draft" ? "DRAFT — NOT APPROVED" : "APPROVED — NOT SENT"}</h1><p>Entity ${esc(r.actor.entity)} / Revision ${rev.revision} / ${esc(rev.currency)}</p><p>${esc(rev.incoterm)} ${esc(rev.place)} / ${esc(rev.payment_terms)}</p><table><tr><th>Product</th><th>Quantity</th><th>Unit price</th><th>Amount</th></tr>${rev.snapshot.lines.map((l: any) => `<tr><td>${esc(l.product_id)}</td><td>${esc(l.quantity)}</td><td>${esc(l.unit_price)}</td><td>${esc(l.amount)}</td></tr>`).join("")}</table><p>Total ${esc(rev.amount)} ${esc(rev.currency)}</p><p>Valid until ${esc(rev.valid_until)}</p></html>`,
      );
  });
  app.post("/api/v1/orders", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    const p = body(
      z.object({
        quote_id: z.string().uuid(),
        confirmation_source_id: z.string().uuid(),
        purchase_reference: z.string().min(1),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const q = await owned(db, "quotes", p.quote_id, r.actor, true);
        const rev = await owned(
          db,
          "quote_revisions",
          q.current_revision_id,
          r.actor,
        );
        ensure(
          rev.status === "approved" &&
            rev.approved_hash === rev.snapshot_hash &&
            new Date(rev.valid_until) > new Date(),
          "APPROVAL_REQUIRED",
          "需有效批准报价与客户确认依据",
        );
        await owned(db, "sources", p.confirmation_source_id, r.actor);
        const v = await insert(db, "orders", r.actor, {
          account_id: q.account_id,
          quote_revision_id: rev.id,
          confirmation_source_id: p.confirmation_source_id,
          purchase_reference: p.purchase_reference,
          currency: rev.currency,
          amount: rev.amount,
        });
        for (const l of rev.snapshot.lines)
          await db.query(
            "INSERT INTO order_lines(order_id,product_id,quantity,unit_price) VALUES($1,$2,$3,$4)",
            [v.id, l.product_id, l.quantity, l.unit_price],
          );
        await audit(db, r.actor, "order.confirm", "orders", v.id);
        return v;
      }),
    );
  });
  app.get("/api/v1/orders/:id", async (r) => {
    const o = await owned(pool, "orders", params(r).id, r.actor);
    await accountAccess(pool, r.actor, o.account_id);
    return ok({
      ...o,
      lines: (
        await pool.query("SELECT * FROM order_lines WHERE order_id=$1", [o.id])
      ).rows,
      allocations: (
        await pool.query(
          "SELECT id,amount,created_at FROM allocations WHERE order_id=$1",
          [o.id],
        )
      ).rows,
    });
  });
  app.post("/api/v1/orders/:id/shipments", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    const p = body(
      z.object({
        line_id: z.string().uuid(),
        event_key: z.string().min(1),
        quantity: money,
        tracking: z.string().min(1),
        source_id: z.string().uuid(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const o = await owned(db, "orders", params(r).id, r.actor, true);
        await owned(db, "sources", p.source_id, r.actor);
        const old = (
          await db.query(
            "SELECT * FROM shipments WHERE order_id=$1 AND event_key=$2",
            [o.id, p.event_key],
          )
        ).rows[0];
        if (old) {
          ensure(
            new Decimal(old.quantity).eq(p.quantity),
            "IDEMPOTENCY_CONFLICT",
            "同编号发货数量不一致",
            409,
          );
          return old;
        }
        const payment = (
          await db.query("SELECT * FROM payment_policy WHERE account_id=$1", [
            o.account_id,
          ])
        ).rows[0];
        if (payment?.mode === "prepaid") {
          const paid = (
            await db.query(
              "SELECT coalesce(sum(amount),0) AS n FROM allocations WHERE order_id=$1 AND id NOT IN(SELECT allocation_id FROM allocation_reversals)",
              [o.id],
            )
          ).rows[0].n;
          ensure(
            new Decimal(paid).gte(
              new Decimal(o.amount).mul(payment.min_prepaid_ratio),
            ),
            "PAYMENT_REQUIRED",
            "实际核销预付款不足，不能发货",
          );
        }
        const policy = (
          await db.query("SELECT * FROM credit_policies WHERE account_id=$1", [
            o.account_id,
          ])
        ).rows[0];
        if (policy) {
          const exp = (
            await db.query(
              "SELECT * FROM credit_exposures WHERE order_id=$1 AND segment<>'released'",
              [o.id],
            )
          ).rows[0];
          ensure(
            exp && new Date(policy.valid_until) > new Date(),
            "CREDIT_RELEASE_REQUIRED",
            "信用政策已启用，需先有效占用放行",
          );
        }
        const result = await db.query(
          "UPDATE order_lines SET shipped=shipped+$1 WHERE id=$2 AND order_id=$3 AND $1>0 AND shipped+$1<=quantity RETURNING *",
          [p.quantity, p.line_id, o.id],
        );
        ensure(result.rowCount, "OVER_SHIPMENT", "发货数量超出订单剩余数量");
        const v = await insert(db, "shipments", r.actor, {
          order_id: o.id,
          order_line_id: p.line_id,
          event_key: p.event_key,
          quantity: p.quantity,
          tracking: p.tracking,
          source_id: p.source_id,
        });
        const remaining = (
          await db.query(
            "SELECT sum(quantity-shipped) AS n FROM order_lines WHERE order_id=$1",
            [o.id],
          )
        ).rows[0].n;
        await db.query("UPDATE orders SET status=$1 WHERE id=$2", [
          Number(remaining) === 0 ? "shipped" : "partially_shipped",
          o.id,
        ]);
        await audit(db, r.actor, "order.ship", "orders", o.id, {
          shipment_id: v.id,
        });
        return v;
      }),
    );
  });
  app.post("/api/v1/receipts", async (r) => {
    permission(r.actor, ["owner", "manager", "finance"]);
    const p = body(
      z.object({
        account_id: z.string().uuid(),
        amount: money,
        currency,
        source_id: z.string().uuid(),
        event_key: z.string().min(1),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await owned(db, "accounts", p.account_id, r.actor);
        await owned(db, "sources", p.source_id, r.actor);
        const old = (
          await db.query(
            "SELECT * FROM receipts WHERE business_entity_id=$1 AND event_key=$2",
            [r.actor.entity, p.event_key],
          )
        ).rows[0];
        if (old) {
          ensure(
            old.amount === new Decimal(p.amount).toFixed(6) &&
              old.account_id === p.account_id &&
              old.currency === p.currency,
            "IDEMPOTENCY_CONFLICT",
            "重复流水数据不一致",
            409,
          );
          return old;
        }
        return insert(db, "receipts", r.actor, p);
      }),
    );
  });
  app.post("/api/v1/receipts/:id/verify", async (r) => {
    permission(r.actor, ["owner", "finance"]);
    return ok(
      await tx(async (db) => {
        const v = await owned(db, "receipts", params(r).id, r.actor, true);
        const n = await update(db, "receipts", v.id, r.actor, v.row_version, {
          status: "verified",
          verified_by: r.actor.id,
        });
        await audit(db, r.actor, "receipt.verify", "receipts", v.id);
        return n;
      }),
    );
  });
  app.post("/api/v1/receipts/:id/allocate", async (r) => {
    permission(r.actor, ["owner", "finance"]);
    const p = body(
      z.object({
        order_id: z.string().uuid(),
        amount: money,
        event_key: z.string().min(1),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const receipt = await owned(
          db,
          "receipts",
          params(r).id,
          r.actor,
          true,
        );
        const order = await owned(db, "orders", p.order_id, r.actor, true);
        ensure(
          receipt.status === "verified",
          "RECEIPT_UNVERIFIED",
          "水单尚未核实到账",
        );
        ensure(
          receipt.account_id === order.account_id &&
            receipt.currency === order.currency,
          "CURRENCY_OR_CUSTOMER_MISMATCH",
          "客户或币种不一致",
        );
        const old = (
          await db.query(
            "SELECT * FROM allocations WHERE receipt_id=$1 AND event_key=$2",
            [receipt.id, p.event_key],
          )
        ).rows[0];
        if (old) {
          ensure(
            old.order_id === p.order_id && new Decimal(old.amount).eq(p.amount),
            "IDEMPOTENCY_CONFLICT",
            "核销幂等数据不一致",
            409,
          );
          return old;
        }
        const used = (
          await db.query(
            "SELECT coalesce(sum(amount),0) AS n FROM allocations WHERE receipt_id=$1 AND id NOT IN(SELECT allocation_id FROM allocation_reversals)",
            [receipt.id],
          )
        ).rows[0].n;
        const paid = (
          await db.query(
            "SELECT coalesce(sum(amount),0) AS n FROM allocations WHERE order_id=$1 AND id NOT IN(SELECT allocation_id FROM allocation_reversals)",
            [order.id],
          )
        ).rows[0].n;
        ensure(
          new Decimal(used).plus(p.amount).lte(receipt.amount) &&
            new Decimal(paid).plus(p.amount).lte(order.amount),
          "OVER_ALLOCATION",
          "超出可核销金额或订单余额",
        );
        const v = await insert(db, "allocations", r.actor, {
          ...p,
          receipt_id: receipt.id,
        });
        await db.query(
          "UPDATE credit_exposures SET amount=greatest(0,amount-$1) WHERE order_id=$2",
          [p.amount, order.id],
        );
        await audit(db, r.actor, "receipt.allocate", "allocations", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/accounts/:id/credit-policy", async (r) => {
    permission(r.actor, ["owner", "finance"]);
    const p = body(
      z.object({
        currency,
        credit_limit: money,
        valid_until: z.string().datetime(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await owned(db, "accounts", params(r).id, r.actor);
        const v = await insert(db, "credit_policies", r.actor, {
          ...p,
          account_id: params(r).id,
          approved_by: r.actor.id,
        });
        await audit(db, r.actor, "credit.enable", "credit_policies", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/orders/:id/release", async (r) => {
    permission(r.actor, ["owner", "finance"]);
    return ok(
      await tx(async (db) => {
        const o = await owned(db, "orders", params(r).id, r.actor);
        const pol = (
          await db.query(
            "SELECT * FROM credit_policies WHERE account_id=$1 FOR UPDATE",
            [o.account_id],
          )
        ).rows[0];
        ensure(pol, "CREDIT_NOT_ENABLED", "未配置批准信用政策");
        ensure(
          pol.currency === o.currency && new Date(pol.valid_until) > new Date(),
          "CREDIT_POLICY_INVALID",
          "信用币种不同或策略过期",
        );
        const old = (
          await db.query("SELECT * FROM credit_exposures WHERE order_id=$1", [
            o.id,
          ])
        ).rows[0];
        if (old) return old;
        const used = (
          await db.query(
            "SELECT coalesce(sum(amount),0) AS n FROM credit_exposures WHERE account_id=$1 AND segment<>'released'",
            [o.account_id],
          )
        ).rows[0].n;
        const paid = (
          await db.query(
            "SELECT coalesce(sum(amount),0) AS n FROM allocations WHERE order_id=$1 AND id NOT IN(SELECT allocation_id FROM allocation_reversals)",
            [o.id],
          )
        ).rows[0].n;
        const amount = new Decimal(o.amount).minus(paid);
        ensure(
          new Decimal(used).plus(amount).lte(pol.credit_limit),
          "CREDIT_EXCEEDED",
          "剩余额度不足，不能放行",
        );
        const v = await insert(db, "credit_exposures", r.actor, {
          account_id: o.account_id,
          order_id: o.id,
          amount: amount.toFixed(6),
          segment: "commitment",
          currency: o.currency,
        });
        await audit(db, r.actor, "credit.release", "orders", o.id, {
          exposure_id: v.id,
        });
        return v;
      }),
    );
  });
  app.post("/api/v1/orders/:id/recognize-receivable", async (r) => {
    permission(r.actor, ["owner", "finance"]);
    return ok(
      await tx(async (db) => {
        const o = await owned(db, "orders", params(r).id, r.actor);
        const v = (
          await db.query(
            "UPDATE credit_exposures SET segment='receivable' WHERE order_id=$1 AND segment='commitment' RETURNING *",
            [o.id],
          )
        ).rows[0];
        ensure(v, "NO_COMMITMENT", "不存在可转移承诺占用");
        await audit(db, r.actor, "credit.transfer_segment", "orders", o.id);
        return v;
      }),
    );
  });
  app.get("/api/v1/accounts/:id/credit", async (r) => {
    permission(r.actor, ["owner", "manager", "finance"]);
    const a = await owned(pool, "accounts", params(r).id, r.actor);
    return ok({
      policy:
        (
          await pool.query(
            "SELECT * FROM credit_policies WHERE account_id=$1",
            [a.id],
          )
        ).rows[0] || null,
      exposures: (
        await pool.query("SELECT * FROM credit_exposures WHERE account_id=$1", [
          a.id,
        ])
      ).rows,
    });
  });
}
