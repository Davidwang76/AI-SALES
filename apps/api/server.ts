import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { randomBytes, createHash } from "node:crypto";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import { z, ZodError } from "zod";
import Decimal from "decimal.js";
import { pool, tx } from "../../packages/db/index.js";
import {
  BusinessError,
  ensure,
  hash,
  checkPassword,
  scoreDimensions,
  safeCsv,
  criticalTokens,
} from "../../packages/domain/rules.js";
import {
  owned,
  insert,
  update,
  permission,
  audit,
  body,
  params,
  member,
  elevated,
  accountAccess,
  type Actor,
} from "./context.js";
import { leadInput, captureLead, convertLead } from "./leads.js";
import { registerOperations } from "./operations.js";
import { registerTrade } from "./trade.js";
export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL || "warn" },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: false,
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  });
  app.setErrorHandler((e: any, r, reply) => {
    const status =
      e instanceof ZodError
        ? 400
        : e instanceof BusinessError
          ? e.status
          : e.code === "23505"
            ? 409
            : e.statusCode || 500;
    reply.code(status).send({
      error: {
        code:
          e instanceof ZodError
            ? "VALIDATION_ERROR"
            : e.code || "INTERNAL_ERROR",
        message:
          e instanceof ZodError
            ? "请检查必填字段、格式和长度"
            : status < 500
              ? e.message
              : "服务暂时异常，请稍后重试",
      },
      meta: { trace_id: r.id },
    });
  });
  app.addHook("onRequest", async (r, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "same-origin")
      .header("X-Frame-Options", "DENY");
    if (!r.url.startsWith("/api/")) return;
    if (!["GET", "HEAD", "OPTIONS"].includes(r.method) && r.headers.origin) {
      const origin = new URL(r.headers.origin);
      ensure(
        origin.host === r.headers.host,
        "CSRF_BLOCKED",
        "请求来源不匹配",
        403,
      );
    }
    if (
      r.url.startsWith("/api/v1/public/") ||
      r.url.startsWith("/api/v1/session") ||
      r.url === "/api/health"
    )
      return;
    const token = r.cookies.session;
    ensure(token, "UNAUTHORIZED", "请先登录", 401);
    const u = (
      await pool.query(
        "SELECT u.id,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active",
        [hash(token)],
      )
    ).rows[0];
    ensure(u, "UNAUTHORIZED", "登录已失效", 401);
    const entity = z.string().uuid().parse(r.headers["x-entity-id"]);
    const m = (
      await pool.query(
        "SELECT m.role,e.organization_id,e.is_demo FROM memberships m JOIN entities e ON e.id=m.entity_id WHERE m.user_id=$1 AND e.id=$2",
        [u.id, entity],
      )
    ).rows[0];
    ensure(m, "FORBIDDEN", "无此经营主体权限", 403);
    r.actor = {
      id: u.id,
      name: u.name,
      entity,
      organization: m.organization_id,
      role: m.role,
      demo: m.is_demo,
    };
  });
  const ok = (data: unknown) => ({ data });
  async function rate(key: string, max: number) {
    const v = (
      await pool.query(
        "INSERT INTO rate_limits(key,count,window_at) VALUES($1,1,now()) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.window_at<now()-interval '1 minute' THEN 1 ELSE rate_limits.count+1 END,window_at=CASE WHEN rate_limits.window_at<now()-interval '1 minute' THEN now() ELSE rate_limits.window_at END RETURNING count",
        [hash(key)],
      )
    ).rows[0];
    ensure(v.count <= max, "RATE_LIMIT", "请求过于频繁，请稍后重试", 429);
  }
  app.get("/api/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok", version: "0.1.0" };
  });
  app.post("/api/v1/session", async (r, reply) => {
    await rate(`login:${r.ip}`, 10);
    const p = body(
      z.object({ email: z.email(), password: z.string().min(1).max(200) }),
      r,
    );
    const u = (
      await pool.query("SELECT * FROM users WHERE email=$1 AND active", [
        p.email.toLowerCase(),
      ])
    ).rows[0];
    ensure(
      u && checkPassword(p.password, u.password_hash),
      "INVALID_LOGIN",
      "邮箱或密码不正确",
      401,
    );
    const token = randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO sessions VALUES($1,$2,now()+interval '12 hours')",
      [hash(token), u.id],
    );
    reply.setCookie("session", token, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 43200,
    });
    return ok({
      id: u.id,
      name: u.name,
      entities: (
        await pool.query(
          "SELECT e.*,m.role FROM memberships m JOIN entities e ON e.id=m.entity_id WHERE m.user_id=$1",
          [u.id],
        )
      ).rows,
    });
  });
  app.get("/api/v1/session", async (r) => {
    const u = (
      await pool.query(
        "SELECT u.id,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now() AND u.active",
        [hash(r.cookies.session || "")],
      )
    ).rows[0];
    ensure(u, "UNAUTHORIZED", "请先登录", 401);
    return ok({
      ...u,
      entities: (
        await pool.query(
          "SELECT e.*,m.role FROM memberships m JOIN entities e ON e.id=m.entity_id WHERE m.user_id=$1",
          [u.id],
        )
      ).rows,
    });
  });
  app.delete("/api/v1/session", async (r, reply) => {
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      hash(r.cookies.session || ""),
    ]);
    reply.clearCookie("session", { path: "/" });
    return ok({ logged_out: true });
  });
  app.get("/api/v1/members", async (r) =>
    ok(
      (
        await pool.query(
          "SELECT u.id,u.name,u.email,u.active,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.entity_id=$1",
          [r.actor.entity],
        )
      ).rows,
    ),
  );
  app.post("/api/v1/members/:id/deactivate", async (r) => {
    permission(r.actor, ["owner"]);
    const id = z.string().uuid().parse(params(r).id);
    ensure(id !== r.actor.id, "SELF_DEACTIVATION", "不能停用当前账号");
    return ok(
      await tx(async (db) => {
        await member(db, r.actor, id);
        const other = await db.query(
          "SELECT 1 FROM memberships WHERE user_id=$1 AND entity_id<>$2",
          [id, r.actor.entity],
        );
        ensure(
          !other.rowCount,
          "MULTI_ENTITY_USER",
          "该用户属于多个主体，需由身份管理员处理",
        );
        await db.query("UPDATE users SET active=false WHERE id=$1", [id]);
        await db.query("DELETE FROM sessions WHERE user_id=$1", [id]);
        await audit(db, r.actor, "user.deactivate", "users", id);
        return { id };
      }),
    );
  });
  const tables = [
    "market_tasks",
    "activities",
    "leads",
    "accounts",
    "tasks",
    "opportunities",
    "knowledge",
    "contents",
    "channel_accounts",
    "conversations",
    "rfqs",
    "discovery_runs",
    "candidates",
    "jobs",
    "work_logs",
    "feedback",
    "sources",
  ];
  for (const table of tables)
    app.get("/api/v1/" + table.replaceAll("_", "-"), async (r) => {
      const q = z
        .object({
          limit: z.coerce.number().int().min(1).max(200).default(100),
          offset: z.coerce.number().int().min(0).default(0),
          q: z.string().max(200).default(""),
        })
        .parse(r.query);
      const a = r.actor;
      let extra =
        table === "accounts"
          ? " AND t.archived_at IS NULL AND t.merged_into IS NULL"
          : "";
      const values: any[] = [a.entity, q.limit, q.offset];
      if (!elevated(a) && ["sales", "market"].includes(a.role)) {
        if (table === "accounts") extra += " AND t.owner_id=$4";
        else if (["leads"].includes(table)) extra = " AND t.assigned_to=$4";
        else if (
          ["conversations", "rfqs", "opportunities", "tasks", "facts"].includes(
            table,
          )
        )
          extra =
            " AND (t.account_id IS NULL OR EXISTS(SELECT 1 FROM accounts a WHERE a.id=t.account_id AND a.owner_id=$4))";
        if (
          [
            "sources",
            "jobs",
            "knowledge",
            "discovery_runs",
            "candidates",
            "work_logs",
            "feedback",
          ].includes(table)
        )
          extra =
            table === "sources"
              ? ` AND (t.created_by=$4 OR t.id IN(SELECT source_id FROM leads WHERE account_id IN(SELECT id FROM accounts WHERE owner_id=$4 AND business_entity_id=$1)) OR t.id IN(SELECT source_id FROM rfqs WHERE account_id IN(SELECT id FROM accounts WHERE owner_id=$4 AND business_entity_id=$1)))`
              : " AND t.created_by=$4";
        if (extra) values.push(a.id);
      }
      if (q.q) {
        values.push("%" + q.q + "%");
        extra += ` AND to_jsonb(t)::text ILIKE $${values.length}`;
      }
      const rows = (
        await pool.query(
          `SELECT t.* FROM ${table} t WHERE t.business_entity_id=$1 ${extra} ORDER BY t.created_at DESC LIMIT $2 OFFSET $3`,
          values,
        )
      ).rows;
      return {
        data: rows,
        meta: { limit: q.limit, offset: q.offset },
      };
    });
  app.post("/api/v1/sources", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        name: z.string().min(1).max(200),
        body: z.string().min(1).max(100000),
        kind: z
          .enum(["meeting", "document", "email", "import", "web"])
          .default("document"),
        allowed_use: z
          .enum(["internal", "external", "public"])
          .default("internal"),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const v = await insert(db, "sources", r.actor, p);
        await audit(db, r.actor, "source.create", "sources", v.id);
        return v;
      }),
    );
  });
  const storage = path.resolve(process.env.STORAGE_DIR || ".local/files");
  app.post("/api/v1/files", async (r) => {
    permission(r.actor);
    const f = await r.file();
    ensure(f, "FILE_REQUIRED", "请选择文件");
    const allowed = [
      "image/jpeg",
      "image/png",
      "application/pdf",
      "text/plain",
      "text/csv",
      "audio/webm",
    ];
    ensure(
      allowed.includes(f.mimetype),
      "FILE_TYPE_BLOCKED",
      "仅支持JPEG/PNG/PDF/文本/CSV/WebM",
    );
    const data = await f.toBuffer();
    ensure(data.length > 0, "EMPTY_FILE", "文件为空");
    if (f.mimetype === "application/pdf")
      ensure(
        data.subarray(0, 5).toString() === "%PDF-",
        "INVALID_FILE",
        "PDF文件内容不合法",
      );
    if (f.mimetype === "image/png")
      ensure(
        data.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
        "INVALID_FILE",
        "PNG内容不合法",
      );
    if (f.mimetype === "image/jpeg")
      ensure(
        data.subarray(0, 3).toString("hex") === "ffd8ff",
        "INVALID_FILE",
        "JPEG内容不合法",
      );
    const key = randomBytes(24).toString("hex");
    await mkdir(storage, { recursive: true, mode: 0o700 });
    await writeFile(path.join(storage, key), data, { mode: 0o600, flag: "wx" });
    return ok(
      await tx(async (db) => {
        const v = await insert(db, "sources", r.actor, {
          name: path.basename(f.filename),
          kind: "file",
          body: f.mimetype.startsWith("text/") ? data.toString("utf8") : "",
          storage_key: key,
          mime: f.mimetype,
          sha256: createHash("sha256").update(data).digest("hex"),
          size: data.length,
        });
        await audit(db, r.actor, "file.upload", "sources", v.id);
        return v;
      }),
    );
  });
  app.get("/api/v1/files/:id/download", async (r, reply) => {
    const f = await owned(pool, "sources", params(r).id, r.actor);
    ensure(f.storage_key, "NO_FILE", "该来源无附件", 404);
    await audit(pool, r.actor, "file.download", "sources", f.id);
    return reply
      .type(f.mime)
      .header(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(f.name)}"`,
      )
      .send(await readFile(path.join(storage, f.storage_key)));
  });
  app.post("/api/v1/market-tasks", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        name: z.string().min(1).max(200),
        countries: z.array(z.string().min(1)).min(1),
        categories: z.array(z.string().min(1)).min(1),
        makes: z.array(z.string()).default([]),
        languages: z.array(z.string()).default(["en"]),
        exclusions: z.string().default(""),
        goal: z.number().int().positive().default(20),
        budget: z
          .string()
          .regex(/^\d+(\.\d{1,6})?$/)
          .default("0"),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .default("USD"),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const v = await insert(db, "market_tasks", r.actor, {
          ...p,
          owner_id: r.actor.id,
        });
        await db.query(
          "INSERT INTO market_revisions(task_id,revision,snapshot) VALUES($1,1,$2)",
          [v.id, JSON.stringify(v)],
        );
        await audit(db, r.actor, "market.create", "market_tasks", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/market-tasks/:id/revisions", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        row_version: z.number().int(),
        countries: z.array(z.string()).min(1),
        categories: z.array(z.string()).min(1),
        exclusions: z.string().default(""),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const v = await owned(db, "market_tasks", params(r).id, r.actor, true);
        const n = await update(
          db,
          "market_tasks",
          v.id,
          r.actor,
          p.row_version,
          {
            countries: p.countries,
            categories: p.categories,
            exclusions: p.exclusions,
            revision: v.revision + 1,
            status: "draft",
          },
        );
        await db.query(
          "INSERT INTO market_revisions(task_id,revision,snapshot) VALUES($1,$2,$3)",
          [n.id, n.revision, JSON.stringify(n)],
        );
        await audit(db, r.actor, "market.revise", "market_tasks", n.id);
        return n;
      }),
    );
  });
  app.get("/api/v1/market-tasks/:id/revisions", async (r) => {
    await owned(pool, "market_tasks", params(r).id, r.actor);
    return ok(
      (
        await pool.query(
          "SELECT * FROM market_revisions WHERE task_id=$1 ORDER BY revision DESC",
          [params(r).id],
        )
      ).rows,
    );
  });
  app.post("/api/v1/activities", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        name: z.string().min(1).max(200),
        type: z.enum(["exhibition", "online"]),
        country: z.string().default(""),
        city: z.string().default(""),
        timezone: z.string().default("Asia/Shanghai"),
        start_at: z.string().datetime().nullable().optional(),
        end_at: z.string().datetime().nullable().optional(),
        venue: z.string().default(""),
        website: z.string().default(""),
        budget: z
          .string()
          .regex(/^\d+(\.\d{1,6})?$/)
          .default("0"),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .default("USD"),
        market_task_id: z.string().uuid().optional(),
        status: z.enum(["candidate", "planned"]).default("planned"),
      }),
      r,
    );
    try {
      new Intl.DateTimeFormat("en", { timeZone: p.timezone });
    } catch {
      throw new BusinessError("INVALID_TIMEZONE", "时区无效");
    }
    return ok(
      await tx(async (db) => {
        const { market_task_id, ...d } = p;
        let revision;
        if (market_task_id) {
          const m = await owned(db, "market_tasks", market_task_id, r.actor);
          revision = (
            await db.query(
              "SELECT id FROM market_revisions WHERE task_id=$1 AND revision=$2",
              [m.id, m.revision],
            )
          ).rows[0].id;
        }
        const v = await insert(db, "activities", r.actor, {
          ...d,
          owner_id: r.actor.id,
          market_revision_id: revision || null,
        });
        await audit(db, r.actor, "activity.create", "activities", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/activities/:id/select", async (r) => {
    permission(r.actor);
    return ok(
      await tx(async (db) => {
        const v = await owned(db, "activities", params(r).id, r.actor, true);
        ensure(v.status === "candidate", "INVALID_STATE", "不是候选展会");
        const n = await update(db, "activities", v.id, r.actor, v.row_version, {
          status: "planned",
        });
        await audit(db, r.actor, "activity.select", "activities", v.id);
        return n;
      }),
    );
  });
  app.post("/api/v1/activities/:id/costs", async (r) => {
    permission(r.actor, ["owner", "manager", "finance"]);
    const p = body(
      z.object({
        category: z.string().min(1),
        amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
        currency: z.string().regex(/^[A-Z]{3}$/),
        source_id: z.string().uuid(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await owned(db, "activities", params(r).id, r.actor);
        await owned(db, "sources", p.source_id, r.actor);
        const v = await insert(db, "activity_costs", r.actor, {
          ...p,
          activity_id: params(r).id,
        });
        await audit(db, r.actor, "cost.record", "activity_costs", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/leads", async (r) => {
    permission(r.actor);
    return ok(await tx((db) => captureLead(db, r.actor, body(leadInput, r))));
  });
  app.post("/api/v1/leads/:id/convert", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        account_id: z.string().uuid().optional(),
        owner_id: z.string().uuid().optional(),
      }),
      r,
    );
    return ok(await tx((db) => convertLead(db, r.actor, params(r).id, p)));
  });
  app.get("/api/v1/public/forms/:key", async (r) => {
    const key = z.string().uuid().parse(params(r).key);
    const v = (
      await pool.query(
        "SELECT name,is_demo FROM activities WHERE public_key=$1 AND type='online' AND status='planned'",
        [key],
      )
    ).rows[0];
    ensure(v, "NOT_FOUND", "Form not found", 404);
    return ok(v);
  });
  app.post("/api/v1/public/forms/:key/submissions", async (r) => {
    await rate(`public:${r.ip}`, 20);
    const key = z.string().uuid().parse(params(r).key);
    const p = body(
      leadInput
        .omit({ activity_id: true, classification: true, source_id: true })
        .extend({ website_trap: z.string().max(0).default("") }),
      r,
    );
    const activity = (
      await pool.query(
        "SELECT a.*,e.organization_id FROM activities a JOIN entities e ON e.id=a.business_entity_id WHERE public_key=$1 AND type='online' AND status='planned'",
        [key],
      )
    ).rows[0];
    ensure(activity, "NOT_FOUND", "Form not found", 404);
    const a: Actor = {
      id: activity.owner_id,
      entity: activity.business_entity_id,
      organization: activity.organization_id,
      role: "market",
      demo: activity.is_demo,
      name: "public form",
    };
    const { website_trap, ...data } = p;
    const v = await tx((db) =>
      captureLead(db, a, {
        ...data,
        activity_id: activity.id,
        classification: "unknown",
      }),
    );
    return ok({ submission_id: v.id, status: "received" });
  });
  app.get("/api/v1/accounts/:id", async (r) => {
    const a = r.actor,
      v = await owned(pool, "accounts", params(r).id, a);
    const queries = await Promise.all(
      [
        "contacts",
        "facts",
        "assessments",
        "touches",
        "tasks",
        "opportunities",
        "rfqs",
        "conversations",
      ].map((t) =>
        pool.query(
          `SELECT * FROM ${t} WHERE account_id=$1 AND business_entity_id=$2 ORDER BY created_at DESC`,
          [v.id, a.entity],
        ),
      ),
    );
    return ok({
      ...v,
      ...Object.fromEntries(
        [
          "contacts",
          "facts",
          "assessments",
          "touches",
          "tasks",
          "opportunities",
          "rfqs",
          "conversations",
        ].map((k, i) => [k, queries[i].rows]),
      ),
    });
  });
  app.post("/api/v1/accounts/:id/facts", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        field: z.string().min(1).max(100),
        value: z.string().max(4000),
        fact_status: z.enum([
          "unknown",
          "extracted",
          "inferred",
          "confirmed",
          "conflicted",
        ]),
        source_id: z.string().uuid().optional(),
        locator: z.string().max(200).default(""),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await owned(db, "accounts", params(r).id, r.actor);
        if (p.fact_status !== "unknown")
          ensure(
            p.source_id && p.locator,
            "EVIDENCE_REQUIRED",
            "请填写原件及页码/摘录定位",
          );
        if (p.source_id) await owned(db, "sources", p.source_id, r.actor);
        const v = await insert(db, "facts", r.actor, {
          ...p,
          account_id: params(r).id,
          confirmed_by: p.fact_status === "confirmed" ? r.actor.id : null,
        });
        await audit(db, r.actor, "fact.record", "accounts", params(r).id, {
          fact_id: v.id,
          status: v.fact_status,
        });
        return v;
      }),
    );
  });
  app.post("/api/v1/accounts/:id/contacts", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        name: z.string().min(1),
        email: z.email(),
        title: z.string().default(""),
        phone: z.string().default(""),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await accountAccess(db, r.actor, params(r).id);
        const suppressed = (
          await db.query(
            "SELECT 1 FROM suppressions WHERE business_entity_id=$1 AND endpoint=$2",
            [r.actor.entity, p.email.toLowerCase()],
          )
        ).rowCount;
        return insert(db, "contacts", r.actor, {
          ...p,
          email: p.email.toLowerCase(),
          account_id: params(r).id,
          permission: suppressed ? "withdrawn" : "unknown",
        });
      }),
    );
  });
  app.post("/api/v1/accounts/:id/transfer", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    const p = body(
      z.object({
        owner_id: z.string().uuid(),
        row_version: z.number().int(),
        reason: z.string().min(1),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const previous = await owned(
          db,
          "accounts",
          params(r).id,
          r.actor,
          true,
        );
        await member(db, r.actor, p.owner_id);
        const v = await update(
          db,
          "accounts",
          params(r).id,
          r.actor,
          p.row_version,
          { owner_id: p.owner_id },
        );
        await audit(db, r.actor, "account.transfer", "accounts", v.id, {
          reason: p.reason,
          new_owner: p.owner_id,
          previous_owner: previous.owner_id,
        });
        return v;
      }),
    );
  });
  app.post("/api/v1/accounts/merge", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    const p = body(
      z.object({
        from_id: z.string().uuid(),
        to_id: z.string().uuid(),
        reason: z.string().min(1),
      }),
      r,
    );
    ensure(p.from_id !== p.to_id, "SELF_MERGE", "不能合并同一企业");
    return ok(
      await tx(async (db) => {
        for (const id of [p.from_id, p.to_id].sort())
          await owned(db, "accounts", id, r.actor, true);
        const from = await owned(db, "accounts", p.from_id, r.actor),
          to = await owned(db, "accounts", p.to_id, r.actor);
        ensure(
          !from.merged_into && !to.merged_into,
          "ALREADY_MERGED",
          "企业已被合并",
        );
        for (const t of ["credit_policies", "payment_policy"]) {
          const count = Number(
            (
              await db.query(
                `SELECT count(*) AS n FROM ${t} WHERE account_id=ANY($1::uuid[])`,
                [[from.id, to.id]],
              )
            ).rows[0].n,
          );
          ensure(
            count <= 1,
            "POLICY_MERGE_CONFLICT",
            "双方均有金融政策，需先财务复核后合并",
          );
        }
        for (const t of [
          "quotes",
          "orders",
          "receipts",
          "samples",
          "aftersales",
          "account_relationships",
          "development_plans",
          "credit_exposures",
          "credit_policies",
          "payment_policy",
          "leads",
          "touches",
          "facts",
          "assessments",
          "tasks",
          "opportunities",
          "conversations",
          "rfqs",
          "candidates",
        ])
          await db.query(
            `UPDATE ${t} SET account_id=$1 WHERE account_id=$2 AND business_entity_id=$3`,
            [to.id, from.id, r.actor.entity],
          );
        await db.query(
          "UPDATE contacts SET account_id=$1 WHERE account_id=$2",
          [to.id, from.id],
        );
        await update(db, "accounts", from.id, r.actor, from.row_version, {
          merged_into: to.id,
        });
        await audit(db, r.actor, "account.merge", "accounts", to.id, p);
        return to;
      }),
    );
  });
  app.post("/api/v1/accounts/:id/assessments", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        dimensions: z
          .array(
            z.object({
              field: z.string(),
              state: z.enum(["known", "unknown", "conflicted"]),
              value: z.number().min(0).max(100).nullable(),
              weight: z.number().positive(),
              fact_id: z.string().uuid().optional(),
            }),
          )
          .min(1)
          .max(20),
        confirmed_grade: z.string().max(20).optional(),
        reason: z.string().default(""),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await owned(db, "accounts", params(r).id, r.actor);
        for (const d of p.dimensions)
          if (d.state === "known") {
            ensure(
              d.fact_id,
              "EVIDENCE_REQUIRED",
              "已知维度必须引用人工确认事实",
            );
            const f = await owned(db, "facts", d.fact_id, r.actor);
            ensure(
              f.account_id === params(r).id && f.fact_status === "confirmed",
              "EVIDENCE_REQUIRED",
              "事实未确认或不属于该客户",
            );
          }
        const score = scoreDimensions(p.dimensions);
        if (p.confirmed_grade) {
          permission(r.actor, ["owner", "manager"]);
          ensure(
            p.reason && score.coverage === 100,
            "GRADE_REVIEW_REQUIRED",
            "正式等级需完整证据及复核理由",
          );
        }
        const v = await insert(db, "assessments", r.actor, {
          account_id: params(r).id,
          dimensions: JSON.stringify(p.dimensions),
          ...score,
          confirmed_grade: p.confirmed_grade || null,
          reason: p.reason,
        });
        await audit(db, r.actor, "assessment.create", "assessments", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/tasks", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        account_id: z.string().uuid(),
        title: z.string().min(1).max(300),
        kind: z.string().default("follow_up"),
        owner_id: z.string().uuid().optional(),
        due_at: z.string().datetime(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await accountAccess(db, r.actor, p.account_id);
        await member(db, r.actor, p.owner_id || r.actor.id);
        const v = await insert(db, "tasks", r.actor, {
          ...p,
          owner_id: p.owner_id || r.actor.id,
        });
        await audit(db, r.actor, "task.create", "tasks", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/tasks/:id/status", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        row_version: z.number().int(),
        status: z.enum([
          "pending",
          "in_progress",
          "waiting_customer",
          "waiting_internal",
          "completed",
          "cancelled",
        ]),
        result: z.string().default(""),
        check_again_at: z.string().datetime().optional(),
      }),
      r,
    );
    ensure(
      p.status !== "completed" || p.result.trim(),
      "RESULT_REQUIRED",
      "完成任务需填写结果",
    );
    ensure(
      !p.status.startsWith("waiting_") || p.check_again_at,
      "CHECK_DATE_REQUIRED",
      "等待任务需设置下次检查时间",
    );
    return ok(
      await tx(async (db) => {
        const v = await owned(db, "tasks", params(r).id, r.actor);
        if (v.account_id) await accountAccess(db, r.actor, v.account_id);
        const { row_version, ...d } = p;
        const n = await update(db, "tasks", v.id, r.actor, row_version, d);
        await audit(db, r.actor, "task.status", "tasks", v.id, {
          status: p.status,
        });
        return n;
      }),
    );
  });
  app.post("/api/v1/opportunities", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        account_id: z.string().uuid(),
        name: z.string().min(1),
        need: z.string().default(""),
        primary_activity_id: z.string().uuid().optional(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await accountAccess(db, r.actor, p.account_id);
        if (p.primary_activity_id)
          await owned(db, "activities", p.primary_activity_id, r.actor);
        return insert(db, "opportunities", r.actor, {
          ...p,
          owner_id: r.actor.id,
        });
      }),
    );
  });
  app.post("/api/v1/opportunities/:id/transitions", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        row_version: z.number().int(),
        stage: z.enum(["initial", "needs_confirmed", "rfq", "on_hold", "lost"]),
        reason: z.string().min(1),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const v = await owned(db, "opportunities", params(r).id, r.actor);
        await accountAccess(db, r.actor, v.account_id);
        ensure(
          p.stage !== "needs_confirmed" || v.need,
          "NEED_REQUIRED",
          "尚无明确需求证据",
        );
        const n = await update(
          db,
          "opportunities",
          v.id,
          r.actor,
          p.row_version,
          { stage: p.stage },
        );
        await audit(
          db,
          r.actor,
          "opportunity.transition",
          "opportunities",
          v.id,
          p,
        );
        return n;
      }),
    );
  });
  app.post("/api/v1/contacts/:id/suppress", async (r) => {
    permission(r.actor);
    const p = body(z.object({ reason: z.string().min(1) }), r);
    return ok(
      await tx(async (db) => {
        const c = await owned(db, "contacts", params(r).id, r.actor);
        await accountAccess(db, r.actor, c.account_id);
        await db.query(
          "INSERT INTO suppressions(business_entity_id,endpoint,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [r.actor.entity, c.email.toLowerCase(), p.reason],
        );
        await db.query(
          "UPDATE contacts SET permission='withdrawn',row_version=row_version+1 WHERE business_entity_id=$1 AND lower(email)=$2",
          [r.actor.entity, c.email.toLowerCase()],
        );
        await db.query(
          "UPDATE enrollments SET status='paused_by_policy',stopped_reason='退订' WHERE contact_id IN(SELECT id FROM contacts WHERE business_entity_id=$1 AND lower(email)=$2)",
          [r.actor.entity, c.email.toLowerCase()],
        );
        await audit(db, r.actor, "contact.suppress", "contacts", c.id, p);
        return { status: "withdrawn" };
      }),
    );
  });
  app.post("/api/v1/knowledge", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        name: z.string().min(1),
        kind: z.string().default("company"),
        body: z.string().min(1).max(30000),
        source_id: z.string().uuid(),
        valid_until: z.string().datetime(),
        share_scope: z
          .enum(["internal", "external", "public"])
          .default("internal"),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await owned(db, "sources", p.source_id, r.actor);
        const v = await insert(db, "knowledge", r.actor, p);
        await audit(db, r.actor, "knowledge.create", "knowledge", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/knowledge/:id/:action", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    const { id, action } = params(r);
    ensure(
      ["approve", "revoke"].includes(action),
      "NOT_FOUND",
      "操作不存在",
      404,
    );
    return ok(
      await tx(async (db) => {
        const v = await owned(db, "knowledge", id, r.actor, true);
        ensure(
          action !== "approve" || new Date(v.valid_until) > new Date(),
          "EXPIRED",
          "资料已过期",
        );
        const n = await update(db, "knowledge", id, r.actor, v.row_version, {
          status: action === "approve" ? "approved" : "revoked",
          approved_by: r.actor.id,
        });
        if (action === "revoke") {
          await db.query(
            "UPDATE contents SET status='review_pending',row_version=row_version+1 WHERE business_entity_id=$1 AND $2=ANY(knowledge_ids) AND status IN ('approved','review_pending')",
            [r.actor.entity, id],
          );
          await db.query(
            "UPDATE messages SET status='invalidated',row_version=row_version+1 WHERE business_entity_id=$1 AND direction='draft' AND $2=ANY(knowledge_ids)",
            [r.actor.entity, id],
          );
        }
        await audit(db, r.actor, `knowledge.${action}`, "knowledge", id);
        return n;
      }),
    );
  });
  async function knowledgeCheck(db: any, a: Actor, ids: string[]) {
    for (const id of ids) {
      const v = await owned(db, "knowledge", id, a);
      ensure(
        v.status === "approved" &&
          v.share_scope !== "internal" &&
          new Date(v.valid_until) > new Date(),
        "KNOWLEDGE_UNAVAILABLE",
        "引用资料尚未批准、已过期、撤回或不可外发",
      );
    }
  }
  app.post("/api/v1/contents", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        activity_id: z.string().uuid(),
        title: z.string().min(1),
        body: z.string().min(1),
        language: z.string().default("en"),
        knowledge_ids: z.array(z.string().uuid()).default([]),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await owned(db, "activities", p.activity_id, r.actor);
        await knowledgeCheck(db, r.actor, p.knowledge_ids);
        const v = await insert(db, "contents", r.actor, p);
        await audit(db, r.actor, "content.create", "contents", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/contents/:id/:action", async (r) => {
    permission(r.actor);
    const { id, action } = params(r);
    const p = body(z.object({ url: z.url().optional() }), r);
    return ok(
      await tx(async (db) => {
        const v = await owned(db, "contents", id, r.actor, true);
        let status;
        if (action === "submit-review") {
          ensure(v.status === "draft", "INVALID_STATE", "仅草稿可提交");
          status = "review_pending";
        } else if (action === "approve") {
          permission(r.actor, ["owner", "manager"]);
          ensure(
            v.status === "review_pending",
            "INVALID_STATE",
            "请先提交审核",
          );
          ensure(
            v.knowledge_ids.length,
            "EVIDENCE_REQUIRED",
            "宣传内容需关联有效对外资料",
          );
          await knowledgeCheck(db, r.actor, v.knowledge_ids);
          status = "approved";
        } else if (action === "publications") {
          ensure(
            v.status === "approved" && p.url,
            "APPROVAL_REQUIRED",
            "需先批准并填写真实发布地址",
          );
          await knowledgeCheck(db, r.actor, v.knowledge_ids);
          status = "published";
        } else throw new BusinessError("NOT_FOUND", "操作不存在", 404);
        const n = await update(db, "contents", id, r.actor, v.row_version, {
          status,
          ...(status === "approved" ? { approved_by: r.actor.id } : {}),
          ...(status === "published"
            ? { publication_url: p.url, published_at: new Date().toISOString() }
            : {}),
        });
        await audit(db, r.actor, `content.${action}`, "contents", id);
        return n;
      }),
    );
  });
  app.post("/api/v1/channel-accounts", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    const p = body(
      z.object({
        name: z.string().min(1),
        address: z.email(),
        channel: z.literal("email").default("email"),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const v = await insert(db, "channel_accounts", r.actor, p);
        await audit(
          db,
          r.actor,
          "channel.register_manual",
          "channel_accounts",
          v.id,
        );
        return v;
      }),
    );
  });
  app.post("/api/v1/conversations", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        account_id: z.string().uuid(),
        contact_id: z.string().uuid(),
        channel_account_id: z.string().uuid(),
        subject: z.string().min(1),
        external_thread_id: z.string().min(1).max(200),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await accountAccess(db, r.actor, p.account_id);
        const c = await owned(db, "contacts", p.contact_id, r.actor);
        ensure(
          c.account_id === p.account_id,
          "CONTACT_MISMATCH",
          "联系人不属于该客户",
        );
        await owned(db, "channel_accounts", p.channel_account_id, r.actor);
        return insert(db, "conversations", r.actor, p);
      }),
    );
  });
  app.get("/api/v1/conversations/:id/messages", async (r) => {
    const c = await owned(pool, "conversations", params(r).id, r.actor);
    await accountAccess(pool, r.actor, c.account_id);
    return ok(
      (
        await pool.query(
          "SELECT * FROM messages WHERE conversation_id=$1 ORDER BY created_at",
          [c.id],
        )
      ).rows,
    );
  });
  app.post("/api/v1/conversations/:id/messages", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        event_id: z.string().min(1),
        body: z.string().min(1).max(30000),
        classification: z
          .enum([
            "purchase",
            "clarification",
            "negotiation",
            "complaint",
            "unsubscribe",
            "auto_reply",
            "unknown",
          ])
          .default("unknown"),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const c = await owned(db, "conversations", params(r).id, r.actor, true);
        await accountAccess(db, r.actor, c.account_id);
        const old = (
          await db.query(
            "SELECT * FROM messages WHERE conversation_id=$1 AND event_id=$2",
            [c.id, p.event_id],
          )
        ).rows[0];
        if (old) {
          ensure(
            old.body === p.body,
            "IDEMPOTENCY_CONFLICT",
            "消息编号重复且内容不同",
            409,
          );
          return old;
        }
        const s = await insert(db, "sources", r.actor, {
          name: c.subject,
          kind: "email",
          body: p.body,
        });
        const v = await insert(db, "messages", r.actor, {
          ...p,
          conversation_id: c.id,
          direction: "inbound",
          source_id: s.id,
          status: "received",
        });
        await db.query(
          "UPDATE conversations SET last_inbound_at=now(),row_version=row_version+1 WHERE id=$1",
          [c.id],
        );
        await db.query(
          "UPDATE enrollments SET status='paused_by_inbound',stopped_reason='收到回复，需建立新计划' WHERE conversation_id=$1 AND status='active'",
          [c.id],
        );
        await db.query(
          "UPDATE messages SET status='invalidated' WHERE conversation_id=$1 AND direction='draft' AND status='approved'",
          [c.id],
        );
        if (p.classification === "unsubscribe") {
          const contact = await owned(db, "contacts", c.contact_id, r.actor);
          await db.query(
            "INSERT INTO suppressions(business_entity_id,endpoint,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [r.actor.entity, contact.email.toLowerCase(), "客户来信退订"],
          );
          await db.query(
            "UPDATE contacts SET permission='withdrawn' WHERE business_entity_id=$1 AND lower(email)=$2",
            [r.actor.entity, contact.email.toLowerCase()],
          );
          await db.query(
            "UPDATE enrollments SET status='paused_by_policy',stopped_reason='退订' WHERE contact_id IN (SELECT id FROM contacts WHERE business_entity_id=$1 AND lower(email)=$2)",
            [r.actor.entity, contact.email.toLowerCase()],
          );
        }
        await insert(db, "tasks", r.actor, {
          account_id: c.account_id,
          title: `处理客户回复：${c.subject}`,
          kind: "reply",
          owner_id: r.actor.id,
          due_at: new Date(Date.now() + 86400000).toISOString(),
        });
        await audit(db, r.actor, "message.inbound_manual", "messages", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/conversations/:id/drafts", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        body: z.string().min(1).max(30000),
        knowledge_ids: z.array(z.string().uuid()).default([]),
        translation_of: z.string().uuid().optional(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const c = await owned(db, "conversations", params(r).id, r.actor);
        await accountAccess(db, r.actor, c.account_id);
        await knowledgeCheck(db, r.actor, p.knowledge_ids);
        if (p.translation_of) {
          const orig = await owned(db, "messages", p.translation_of, r.actor);
          ensure(
            orig.conversation_id === c.id &&
              criticalTokens(orig.body) === criticalTokens(p.body),
            "TRANSLATION_DRIFT",
            "翻译关键数字、OE或币种变化，请核对",
          );
        }
        const v = await insert(db, "messages", r.actor, {
          conversation_id: c.id,
          event_id: randomBytes(16).toString("hex"),
          direction: "draft",
          body: p.body,
          status: "draft",
          knowledge_ids: p.knowledge_ids,
        });
        await audit(db, r.actor, "draft.manual", "messages", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/sequence-enrollments", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        conversation_id: z.string().uuid(),
        plan: z.string().min(1),
        next_check_at: z.string().datetime(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const c = await owned(db, "conversations", p.conversation_id, r.actor);
        await accountAccess(db, r.actor, c.account_id);
        const contact = await owned(db, "contacts", c.contact_id, r.actor);
        ensure(
          contact.permission !== "withdrawn",
          "SUPPRESSED",
          "该联系人已退订",
        );
        const v = await insert(db, "enrollments", r.actor, {
          ...p,
          contact_id: c.contact_id,
        });
        await audit(db, r.actor, "sequence.create_manual", "enrollments", v.id);
        return v;
      }),
    );
  });
  app.get("/api/v1/sequence-enrollments", async (r) =>
    ok(
      (
        await pool.query(
          "SELECT e.* FROM enrollments e JOIN conversations c ON c.id=e.conversation_id JOIN accounts a ON a.id=c.account_id WHERE e.business_entity_id=$1 AND ($2::boolean OR a.owner_id=$3)",
          [r.actor.entity, elevated(r.actor), r.actor.id],
        )
      ).rows,
    ),
  );
  app.post("/api/v1/rfqs", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        account_id: z.string().uuid(),
        contact_id: z.string().uuid().optional(),
        source_id: z.string().uuid(),
        title: z.string().min(1),
        destination: z.string().default(""),
        lines: z
          .array(
            z.object({
              oe: z.string().default(""),
              description: z.string().min(1),
              quantity: z
                .string()
                .regex(/^\d+(\.\d{1,6})?$/)
                .nullable(),
              unit: z.string().default(""),
              quality: z.string().default(""),
            }),
          )
          .min(1)
          .max(2000),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await accountAccess(db, r.actor, p.account_id);
        await owned(db, "sources", p.source_id, r.actor);
        if (p.contact_id) {
          const c = await owned(db, "contacts", p.contact_id, r.actor);
          ensure(
            c.account_id === p.account_id,
            "CONTACT_MISMATCH",
            "联系人不属于该企业",
          );
        }
        const { lines, ...d } = p;
        const v = await insert(db, "rfqs", r.actor, d);
        for (const [i, l] of lines.entries())
          await db.query(
            "INSERT INTO rfq_lines(rfq_id,line_no,oe,description,quantity,unit,quality,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              v.id,
              i + 1,
              l.oe,
              l.description,
              l.quantity,
              l.unit,
              l.quality,
              !l.oe || !l.quantity || !l.unit || !p.destination
                ? "needs_clarification"
                : "pending_match",
            ],
          );
        await audit(db, r.actor, "rfq.create", "rfqs", v.id);
        return v;
      }),
    );
  });
  app.get("/api/v1/rfqs/:id", async (r) => {
    const v = await owned(pool, "rfqs", params(r).id, r.actor);
    await accountAccess(pool, r.actor, v.account_id);
    return ok({
      ...v,
      lines: (
        await pool.query(
          "SELECT * FROM rfq_lines WHERE rfq_id=$1 ORDER BY line_no",
          [v.id],
        )
      ).rows,
    });
  });
  app.post("/api/v1/discovery-runs", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        market_task_id: z.string().uuid(),
        mode: z.enum(["import", "search"]),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const m = await owned(db, "market_tasks", p.market_task_id, r.actor);
        const rev = (
          await db.query(
            "SELECT id FROM market_revisions WHERE task_id=$1 AND revision=$2",
            [m.id, m.revision],
          )
        ).rows[0];
        const queries = m.languages.flatMap((language: string) =>
          m.countries.map((country: string) => ({
            language,
            text: `${m.makes.join(" ")} ${m.categories.join(" ")} importer distributor ${country}`,
          })),
        );
        const v = await insert(db, "discovery_runs", r.actor, {
          market_revision_id: rev.id,
          mode: p.mode,
          status: p.mode === "search" ? "partial" : "running",
          stop_reason:
            p.mode === "search" ? "搜索服务未连接；可使用授权资料导入" : null,
          queries: JSON.stringify(queries),
          currency: m.currency,
          cost: p.mode === "import" ? "0" : null,
        });
        await audit(db, r.actor, "discovery.create", "discovery_runs", v.id);
        return v;
      }),
    );
  });
  app.post("/api/v1/discovery-runs/:id/:action", async (r) => {
    permission(r.actor);
    const { id, action } = params(r);
    ensure(
      ["pause", "resume", "complete"].includes(action),
      "NOT_FOUND",
      "操作不存在",
      404,
    );
    return ok(
      await tx(async (db) => {
        const v = await owned(db, "discovery_runs", id, r.actor, true);
        ensure(
          v.mode === "import",
          "NOT_CONNECTED",
          "搜索服务未连接，不能恢复自动检索",
          503,
        );
        ensure(
          action === "resume" ? v.status === "paused" : v.status === "running",
          "INVALID_STATE",
          "当前状态不能执行此操作",
        );
        const n = await update(
          db,
          "discovery_runs",
          id,
          r.actor,
          v.row_version,
          {
            status:
              action === "pause"
                ? "paused"
                : action === "resume"
                  ? "running"
                  : "completed",
          },
        );
        await audit(db, r.actor, `discovery.${action}`, "discovery_runs", id);
        return n;
      }),
    );
  });
  app.post("/api/v1/discovery-runs/:id/candidates", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        entry_key: z.string().min(1),
        company: z.string().min(1),
        email: z.union([z.email(), z.literal("")]).default(""),
        country: z.string().default(""),
        website: z.string().default(""),
        source_id: z.string().uuid(),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const run = await owned(
          db,
          "discovery_runs",
          params(r).id,
          r.actor,
          true,
        );
        ensure(
          run.status === "running" && run.mode === "import",
          "RUN_NOT_RUNNING",
          "导入运行未启动或已暂停",
        );
        await owned(db, "sources", p.source_id, r.actor);
        const old = (
          await db.query(
            "SELECT * FROM candidates WHERE run_id=$1 AND entry_key=$2",
            [run.id, p.entry_key],
          )
        ).rows[0];
        if (old) return old;
        const v = await insert(db, "candidates", r.actor, {
          ...p,
          run_id: run.id,
        });
        await db.query(
          "UPDATE discovery_runs SET checkpoint=checkpoint+1 WHERE id=$1",
          [run.id],
        );
        return v;
      }),
    );
  });
  app.post("/api/v1/candidates/:id/convert", async (r) => {
    permission(r.actor);
    const p = body(z.object({ account_id: z.string().uuid().optional() }), r);
    return ok(
      await tx(async (db) => {
        const v = await owned(db, "candidates", params(r).id, r.actor, true);
        if (v.account_id) return v;
        let a;
        if (p.account_id)
          a = await owned(db, "accounts", p.account_id, r.actor);
        else
          a = await insert(db, "accounts", r.actor, {
            name: v.company,
            country: v.country,
            website: v.website,
            owner_id: r.actor.id,
          });
        if (v.email)
          await insert(db, "contacts", r.actor, {
            account_id: a.id,
            name: "待核实联系人",
            email: v.email,
          });
        await db.query("UPDATE candidates SET account_id=$1 WHERE id=$2", [
          a.id,
          v.id,
        ]);
        await audit(db, r.actor, "candidate.convert", "accounts", a.id, {
          candidate_id: v.id,
        });
        return { ...v, account_id: a.id };
      }),
    );
  });
  app.post("/api/v1/market-tasks/:id/budget/reserve", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        action_key: z.string().min(1),
        amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const t = await owned(db, "market_tasks", params(r).id, r.actor, true);
        const old = (
          await db.query(
            "SELECT * FROM budget_reservations WHERE task_id=$1 AND action_key=$2",
            [t.id, p.action_key],
          )
        ).rows[0];
        if (old) {
          ensure(
            Number(old.reserved) === Number(p.amount),
            "IDEMPOTENCY_CONFLICT",
            "预留金额不一致",
            409,
          );
          return old;
        }
        const sum = (
          await db.query(
            "SELECT coalesce(sum(CASE WHEN status='reserved' THEN reserved WHEN status='settled' THEN actual ELSE 0 END),0)::text AS used FROM budget_reservations WHERE task_id=$1",
            [t.id],
          )
        ).rows[0];
        ensure(
          new Decimal(sum.used).plus(p.amount).lte(t.budget),
          "BUDGET_EXCEEDED",
          "预算不足，运行停止",
        );
        const v = (
          await db.query(
            "INSERT INTO budget_reservations(task_id,action_key,reserved) VALUES($1,$2,$3) RETURNING *",
            [t.id, p.action_key, p.amount],
          )
        ).rows[0];
        await audit(db, r.actor, "budget.reserve", "market_tasks", t.id, {
          reservation_id: v.id,
        });
        return v;
      }),
    );
  });
  app.post("/api/v1/market-tasks/:id/budget/:reservation/settle", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        actual: z
          .string()
          .regex(/^\d+(\.\d{1,6})?$/)
          .nullable(),
        cancel: z.boolean().default(false),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        await owned(db, "market_tasks", params(r).id, r.actor, true);
        const v = (
          await db.query(
            "SELECT * FROM budget_reservations WHERE id=$1 AND task_id=$2 FOR UPDATE",
            [params(r).reservation, params(r).id],
          )
        ).rows[0];
        ensure(v, "NOT_FOUND", "预留不存在", 404);
        if (v.status !== "reserved") return v;
        ensure(
          p.cancel || p.actual !== null,
          "COST_UNKNOWN",
          "费用未知，保持预留并转人工核查",
        );
        ensure(
          p.cancel || new Decimal(p.actual || "0").lte(v.reserved),
          "COST_EXCEEDS_RESERVATION",
          "实际费用超出预留，需人工处理",
        );
        return (
          await db.query(
            "UPDATE budget_reservations SET status=$1,actual=$2 WHERE id=$3 RETURNING *",
            [
              p.cancel ? "released" : "settled",
              p.cancel ? "0" : p.actual,
              v.id,
            ],
          )
        ).rows[0];
      }),
    );
  });
  app.post("/api/v1/ai-jobs", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        source_id: z.string().uuid(),
        kind: z.enum(["extract", "draft"]),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const s = await owned(db, "sources", p.source_id, r.actor);
        ensure(
          s.body,
          "TEXT_REQUIRED",
          "原件无文本；OCR/语音未连接，请先人工转写",
        );
        const v = await insert(db, "jobs", r.actor, {
          ...p,
          input_version: s.row_version,
        });
        await audit(db, r.actor, "ai.enqueue", "jobs", v.id);
        return v;
      }),
    );
  });
  app.get("/api/v1/integrations", async () =>
    ok([
      {
        name: "模型 · OpenAI兼容接口",
        capability: "文本结构化提取 / 草稿",
        status:
          process.env.MODEL_API_KEY && process.env.MODEL_NAME
            ? "configured_unverified"
            : "not_connected",
        missing: "MODEL_API_KEY / MODEL_NAME；需批准数据处理范围",
        outbound: false,
      },
      {
        name: "邮件",
        status: "manual",
        capability: "人工录入多邮箱、会话与原件；未同步、未发送",
      },
      {
        name: "WhatsApp / 搜索 / OCR / ERP / 广告",
        status: "not_connected",
        capability: "需要分别接入官方授权；外发及广告扣费关闭",
      },
    ]),
  );
  app.post("/api/v1/actions/send", async () => {
    throw new BusinessError(
      "OUTBOUND_DISABLED",
      "当前外发功能关闭，仅支持草稿与人工登记",
      503,
    );
  });
  app.post("/api/v1/imports/preview", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        activity_id: z.string().uuid(),
        rows: z.array(z.record(z.string(), z.unknown())).max(2000),
      }),
      r,
    );
    await owned(pool, "activities", p.activity_id, r.actor);
    return ok(
      p.rows.map((row, i) => {
        const parsed = leadInput.safeParse({
          ...row,
          activity_id: p.activity_id,
          event_id: row.event_id || `row-${i + 1}`,
        });
        return {
          line: i + 1,
          valid: parsed.success,
          data: parsed.success ? parsed.data : null,
          errors: parsed.success
            ? []
            : parsed.error.issues.map(
                (x) => `${x.path.join(".")}: ${x.message}`,
              ),
        };
      }),
    );
  });
  app.post("/api/v1/imports/commit", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        import_id: z.string().uuid(),
        activity_id: z.string().uuid(),
        rows: z.array(z.record(z.string(), z.unknown())).max(2000),
      }),
      r,
    );
    await owned(pool, "activities", p.activity_id, r.actor);
    const results = [];
    for (const [i, row] of p.rows.entries()) {
      try {
        const data = leadInput.parse({
          ...row,
          activity_id: p.activity_id,
          event_id: `${p.import_id}:${i + 1}`,
        });
        const v = await tx((db) => captureLead(db, r.actor, data));
        results.push({ line: i + 1, status: "saved", id: v.id });
      } catch (e) {
        results.push({
          line: i + 1,
          status: "error",
          error: e instanceof BusinessError ? e.message : "字段格式不正确",
        });
      }
    }
    await audit(pool, r.actor, "import.commit", "activities", p.activity_id, {
      import_id: p.import_id,
      saved: results.filter((x) => x.status === "saved").length,
    });
    return ok(results);
  });
  app.get("/api/v1/exports/accounts", async (r, reply) => {
    permission(r.actor, ["owner", "manager"]);
    const rows = (
      await pool.query(
        "SELECT id,name,country,company_type,priority FROM accounts WHERE business_entity_id=$1 AND merged_into IS NULL",
        [r.actor.entity],
      )
    ).rows;
    await audit(pool, r.actor, "export.accounts", "entities", r.actor.entity, {
      count: rows.length,
    });
    return reply
      .type("text/csv; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="accounts.csv"')
      .send(
        "\uFEFF" +
          [
            "编号,企业,国家,类型,等级",
            ...rows.map((v) => Object.values(v).map(safeCsv).join(",")),
          ].join("\r\n"),
      );
  });
  app.post("/api/v1/work-logs", async (r) => {
    permission(r.actor);
    const p = body(
      z.object({
        category: z.enum([
          "capture",
          "review",
          "rework",
          "maintenance",
          "follow_up",
        ]),
        minutes: z.number().int().positive(),
        note: z.string().default(""),
      }),
      r,
    );
    return ok(
      await tx(async (db) => {
        const v = await insert(db, "work_logs", r.actor, p);
        await audit(db, r.actor, "work.record", "work_logs", v.id);
        return v;
      }),
    );
  });
  app.get("/api/v1/audit-events", async (r) => {
    permission(r.actor, ["owner", "manager"]);
    return ok(
      (
        await pool.query(
          "SELECT a.*,u.name AS actor_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE business_entity_id=$1 ORDER BY occurred_at DESC LIMIT 200",
          [r.actor.entity],
        )
      ).rows,
    );
  });
  app.get("/api/v1/reports/dashboard", async (r) => {
    const a = r.actor;
    const demo = (r.query as any).demo === "true";
    const scope = `business_entity_id=$1 AND is_demo=$2`;
    const counts: any = {};
    for (const t of ["leads", "accounts", "tasks", "rfqs", "contents"]) {
      let filter =
        t === "accounts"
          ? " AND merged_into IS NULL"
          : t === "tasks"
            ? " AND status NOT IN ('completed','cancelled')"
            : "";
      const args: any[] = [a.entity, demo];
      if (!elevated(a) && ["sales", "market"].includes(a.role)) {
        if (t === "accounts") filter += " AND owner_id=$3";
        else if (t === "leads") filter += " AND assigned_to=$3";
        else if (["tasks", "rfqs"].includes(t))
          filter +=
            " AND (account_id IS NULL OR account_id IN(SELECT id FROM accounts WHERE owner_id=$3))";
        if (filter.includes("$3")) args.push(a.id);
      }
      counts[t] = Number(
        (
          await pool.query(
            `SELECT count(*) FROM ${t} WHERE ${scope}${filter}`,
            args,
          )
        ).rows[0].count,
      );
    }
    const channels = (
      await pool.query(
        `SELECT a.id,a.name,a.type,count(l.id)::int AS leads,count(DISTINCT l.account_id)::int AS accounts FROM activities a LEFT JOIN leads l ON l.activity_id=a.id AND l.is_demo=$2 WHERE a.business_entity_id=$1 AND a.is_demo=$2 AND ($3::boolean OR a.owner_id=$4) GROUP BY a.id ORDER BY a.created_at DESC`,
        [a.entity, demo, elevated(a), a.id],
      )
    ).rows;
    return ok({
      counts,
      channels,
      mode: demo ? "demo" : "formal",
      updated_at: new Date().toISOString(),
      exposure: null,
      clicks: null,
      revenue: null,
      gross_profit: null,
      channel_cost_per_customer: null,
      downstream_status: "订单、回款、复购尚未启用正式经营统计",
      work_minutes: Number(
        (
          await pool.query(
            `SELECT coalesce(sum(minutes),0) AS total FROM work_logs WHERE ${scope}`,
            [a.entity, demo],
          )
        ).rows[0].total,
      ),
    });
  });
  await registerTrade(app);
  await registerOperations(app);
  try {
    await access(path.resolve("dist/web/index.html"));
    await app.register(fastifyStatic, {
      root: path.resolve("dist/web"),
      prefix: "/",
    });
    app.setNotFoundHandler((r, reply) =>
      r.url.startsWith("/api/")
        ? reply
            .code(404)
            .send({ error: { code: "NOT_FOUND", message: "接口不存在" } })
        : reply.sendFile("index.html"),
    );
  } catch {}
  return app;
}
if (process.argv[1]?.endsWith("server.ts")) {
  const app = await buildApp();
  await app.listen({
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || "127.0.0.1",
  });
  console.log("AI-SALES running on port", process.env.PORT || 3000);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await app.close();
      await pool.end();
      process.exit(0);
    });
}
