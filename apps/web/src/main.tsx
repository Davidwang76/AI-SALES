import React, { useState, useEffect, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Globe2,
  CalendarDays,
  Users,
  Inbox,
  ListChecks,
  BookOpen,
  Package,
  FileText,
  Settings,
  ShieldCheck,
  Plus,
  ArrowUpRight,
  Search,
  LogOut,
  ChevronRight,
  Check,
  Upload,
  RefreshCw,
  Menu,
  X,
  Wallet,
} from "lucide-react";
import { api, setEntity, entity, download } from "./api";
import "./style.css";
import { CollectionForm } from "./CollectionForm";
import { CompanyPortal, type Company } from "./CompanyPortal";
import { GoalsWorkspace } from "./GoalsWorkspace";
import { CompanyWorkspace } from "./CompanyWorkspace";
import { Navigation } from "./Navigation";
type Row = Record<string, any>;
const labels: Record<string, string> = {
  owner: "公司系统管理员",
  manager: "管理者",
  sales: "执行者",
  market: "执行者 · 市场",
  procurement: "执行者 · 采购",
  finance: "执行者 · 财务",
  viewer: "只读成员",
  exhibition: "行业展会",
  online: "线上活动",
  draft: "草稿",
  review_pending: "待审核",
  approved: "已批准",
  published: "已登记发布",
  revoked: "已撤回",
  planned: "已计划",
  candidate: "候选展会",
  needs_verification: "待核实",
  converted: "已转客户",
  pending: "待处理",
  in_progress: "进行中",
  waiting_customer: "等待客户",
  waiting_internal: "等待内部",
  completed: "已完成",
  cancelled: "已取消",
  unverified: "待核实",
  unknown: "未知",
  extracted: "提取待核实",
  confirmed: "人工确认",
  inferred: "推断",
  conflicted: "冲突",
  needs_research: "待研究",
  manual: "人工登记 · 未同步",
  not_connected: "未连接",
  configured_unverified: "已配置 · 待联调",
  needs_clarification: "待补资料",
  pending_match: "待匹配",
  matched: "已匹配",
  running: "运行中",
  paused: "已暂停",
  partial: "部分成果",
  needs_manual: "待人工处理",
  needs_review: "结果待复核",
  queued: "排队中",
  received: "已收到",
  withdrawn: "已退订",
  granted: "已许可",
  superseded: "已被新版替代",
  confirmed_order: "已确认",
  partially_shipped: "部分发货",
  shipped: "已发货",
  verified: "已核实到账",
  initial: "初步接触",
  draft_manual: "人工草稿",
};
const L = (x: any) => labels[x] || x || "未知";
const date = (v: any) =>
  v
    ? new Date(v).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "未设置";
function Badge({ value }: { value: string }) {
  return (
    <span
      className={
        "badge " +
        ([
          "approved",
          "converted",
          "confirmed",
          "completed",
          "matched",
          "verified",
        ].includes(value)
          ? "green"
          : ["needs_manual", "conflicted", "withdrawn", "revoked"].includes(
                value,
              )
            ? "red"
            : "")
      }
    >
      {L(value)}
    </span>
  );
}
type Field = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  value?: any;
  hint?: string;
};
function Form({
  title,
  fields,
  onSubmit,
  onClose,
  submit = "保存",
}: {
  title: string;
  fields: Field[];
  onSubmit: (v: Row) => Promise<any>;
  onClose: () => void;
  submit?: string;
}) {
  const [error, err] = useState(""),
    [busy, b] = useState(false);
  const compact = title === "新建展会 / 线上活动";
  const secondaryField = (f: Field) =>
    compact && (f.required === false || f.value !== undefined);
  const renderField = (f: Field) => (
    <label key={f.key}>
      {f.label}
      {f.required !== false && <span className="required"> *</span>}
      {f.type === "textarea" ? (
        <textarea
          name={f.key}
          required={f.required !== false}
          defaultValue={f.value}
          rows={4}
        />
      ) : f.options ? (
        <select
          name={f.key}
          required={f.required !== false}
          defaultValue={f.value || ""}
        >
          <option value="">请选择</option>
          {f.options.map((o) => (
            <option value={o.value} key={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          name={f.key}
          type={f.type || "text"}
          required={f.required !== false}
          defaultValue={f.value}
          step={f.type === "number" ? "any" : undefined}
        />
      )}{" "}
      {f.hint && <small>{f.hint}</small>}
    </label>
  );
  return (
    <div className="overlay">
      <section className="modal">
        <header>
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            b(true);
            err("");
            try {
              await onSubmit(Object.fromEntries(new FormData(e.currentTarget)));
              onClose();
            } catch (e: any) {
              err(e.message);
            } finally {
              b(false);
            }
          }}
        >
          {fields.filter((f) => !secondaryField(f)).map(renderField)}
          {fields.some(secondaryField) && (
            <details
              className="more-fields"
              onInvalidCapture={(e) => {
                e.currentTarget.open = true;
              }}
            >
              <summary>补充资料与默认设置（可展开修改）</summary>
              {fields.filter(secondaryField).map(renderField)}
            </details>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button type="button" className="secondary" onClick={onClose}>
              取消
            </button>
            <button disabled={busy}>{busy ? "保存中…" : submit}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
const opts = (rows: Row[], name = "name") =>
  rows.map((v) => ({ value: v.id, label: v[name] || v.title || v.id }));
const csv = (x: string) =>
  x
    .split(/[,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
const iso = (x: string) => new Date(x).toISOString();
function App({ company }: { company?: Company }) {
  const [offset, O] = useState(0);
  const [session, S] = useState<Row | null>(null),
    [ready, R] = useState(false),
    [section, N] = useState(
      new URLSearchParams(location.search).get("tool") === "goals"
        ? "goals"
        : "home",
    ),
    [rows, D] = useState<Row[]>([]),
    [cache, C] = useState<Record<string, Row[]>>({}),
    [dash, H] = useState<Row | null>(null),
    [detail, V] = useState<Row | null>(null),
    [modal, M] = useState<React.ReactNode>(null),
    [error, E] = useState(""),
    [notice, T] = useState(""),
    [query, Q] = useState(""),
    [mobile, B] = useState(false),
    [loading, loadingSet] = useState(false);
  const [goalsRefresh, setGoalsRefresh] = useState(0);
  const menu = [
    ["home", "经营工作台", LayoutDashboard],
    ["goals", "季月旬目标管理", ListChecks],
    ["sources", "采集资料箱", Inbox],
    ["market-tasks", "市场开发", Globe2],
    ["activities", "展会与推广", CalendarDays],
    ["leads", "线索处理", ListChecks],
    ["accounts", "客户资产", Users],
    ["conversations", "沟通收件箱", Inbox],
    ["rfqs", "标准询盘", FileText],
    ["knowledge", "批准资料", BookOpen],
    ["products", "产品与采购", Package],
    ["quotes", "报价与审批", FileText],
    ["orders", "订单与回款", Wallet],
    ["purchase-rfqs", "采购与回盘", Package],
    ["samples", "样品验证", Package],
    ["trade-documents", "交易单证", FileText],
    ["receipts", "财务核销", Wallet],
    ["aftersales", "售后处理", ShieldCheck],
    ["automation-rules", "内部自动化", ListChecks],
    ["eval-datasets", "质量与发布", ShieldCheck],
    ["members", "团队与权限", Users],
    ["tasks", "任务与工时", ListChecks],
    ["integrations", "连接与运行", Settings],
    ["audit-events", "审计记录", ShieldCheck],
  ] as const;
  useEffect(() => {
    api("session")
      .then(async (s) => {
        const selected = company
          ? s.entities.find((e: Row) => e.id === company.entity_id)
          : s.entities[0];
        if (!selected) return;
        setEntity(selected.id);
        const workspace = await api("company-workspace");
        S({ ...s, workspace });
      })
      .catch(() => {})
      .finally(() => R(true));
  }, []);
  async function refresh() {
    if (!session) return;
    if (section === "goals") {
      E("");
      try {
        const members = await api("members");
        C((v) => ({ ...v, members }));
      } catch (e: any) {
        E(e.message);
      }
      setGoalsRefresh((v) => v + 1);
      return;
    }
    loadingSet(true);
    E("");
    try {
      const resources = [
        "activities",
        "accounts",
        "sources",
        "market-tasks",
        "knowledge",
        "channel-accounts",
        "products",
        "rfqs",
        "members",
        "leads",
        "tasks",
        "contacts",
        "orders",
        "quotes",
        "supplier-responses",
      ];
      const values = await Promise.all(
        resources.map((x) => api(x).catch(() => [])),
      );
      C(Object.fromEntries(resources.map((k, i) => [k, values[i]])));
      if (section === "home")
        H(
          await api(
            "reports/dashboard" +
              (session.entities.find((v: Row) => v.id === entity)?.is_demo
                ? "?demo=true"
                : ""),
          ),
        );
      else
        D(
          await api(
            section +
              `?limit=100&offset=${offset}&q=${encodeURIComponent(query)}`,
          ),
        );
    } catch (e: any) {
      E(e.message);
    } finally {
      loadingSet(false);
    }
  }
  useEffect(() => {
    V(null);
    refresh();
  }, [section, session, offset]);
  function go(key: string) {
    O(0);
    Q("");
    N(key);
    const route = new URL(location.href);
    if (key === "goals") route.searchParams.set("tool", "goals");
    else route.searchParams.delete("tool");
    history.replaceState({}, "", route.pathname + route.search);
    V(null);
    B(false);
  }
  async function act(fn: () => Promise<any>, message = "已保存") {
    E("");
    try {
      const v = await fn();
      T(message);
      setTimeout(() => T(""), 4000);
      await refresh();
      return v;
    } catch (e: any) {
      E(e.message);
    }
  }
  function form(
    title: string,
    fields: Field[],
    submit: (v: Row) => Promise<any>,
  ) {
    M(
      <Form
        title={title}
        fields={fields}
        onClose={() => M(null)}
        onSubmit={async (v) => {
          await submit(v);
          T("已保存到数据库");
          await refresh();
        }}
      />,
    );
  }
  function select(
    key: string,
    label: string,
    resource: string,
    required = true,
  ): Field {
    return { key, label, options: opts(cache[resource] || []), required };
  }
  const sources = () => select("source_id", "原件 / 依据", "sources");
  const addSource = () =>
    form(
      "登记原文依据",
      [
        { key: "name", label: "资料名称" },
        { key: "body", label: "原文内容", type: "textarea" },
        {
          key: "kind",
          label: "来源类型",
          options: ["document", "meeting", "email", "import", "web"].map(
            (x) => ({ value: x, label: x }),
          ),
        },
      ],
      (v) => api("sources", "POST", v),
    );
  function add() {
    if (section === "sources") collect();
    else if (section === "market-tasks")
      form(
        "新建市场开发任务",
        [
          { key: "name", label: "任务名称" },
          { key: "countries", label: "目标国家（逗号分隔）" },
          { key: "categories", label: "品类（逗号分隔）" },
          { key: "makes", label: "品牌 / 车型", required: false },
          { key: "exclusions", label: "排除条件", required: false },
          { key: "budget", label: "费用上限", type: "number", value: 0 },
          { key: "currency", label: "币种", value: "USD" },
        ],
        (v) =>
          api(section, "POST", {
            ...v,
            countries: csv(v.countries),
            categories: csv(v.categories),
            makes: csv(v.makes),
          }),
      );
    else if (section === "activities")
      form(
        "新建展会 / 线上活动",
        [
          { key: "name", label: "活动名称" },
          {
            key: "type",
            label: "活动类型",
            options: [
              { value: "exhibition", label: "行业展会" },
              { value: "online", label: "线上推广" },
            ],
          },
          { key: "country", label: "国家", required: false },
          { key: "city", label: "城市", required: false },
          { key: "timezone", label: "活动时区", value: "Asia/Shanghai" },
          {
            key: "start_at",
            label: "开始日期",
            type: "datetime-local",
            required: false,
          },
          {
            key: "end_at",
            label: "结束日期",
            type: "datetime-local",
            required: false,
          },
          { key: "venue", label: "场馆 / 展位", required: false },
          { key: "budget", label: "计划预算", type: "number", value: 0 },
          { key: "currency", label: "币种", value: "USD" },
          select("market_task_id", "市场任务", "market-tasks", false),
        ],
        (v) =>
          api(section, "POST", {
            ...v,
            start_at: v.start_at ? iso(v.start_at) : null,
            end_at: v.end_at ? iso(v.end_at) : null,
            market_task_id: v.market_task_id || undefined,
          }),
      );
    else if (section === "leads") capture();
    else if (section === "knowledge")
      form(
        "新建待审核资料",
        [
          { key: "name", label: "资料标题" },
          { key: "body", label: "可核对的资料正文", type: "textarea" },
          sources(),
          { key: "valid_until", label: "有效至", type: "datetime-local" },
          {
            key: "share_scope",
            label: "分享范围",
            options: [
              { value: "internal", label: "仅内部" },
              { value: "external", label: "可对客" },
              { value: "public", label: "可公开" },
            ],
          },
        ],
        (v) => api(section, "POST", { ...v, valid_until: iso(v.valid_until) }),
      );
    else if (section === "tasks")
      form(
        "新建跟进任务",
        [
          select("account_id", "客户企业", "accounts"),
          { key: "title", label: "下一步动作" },
          select("owner_id", "负责人", "members"),
          { key: "due_at", label: "截止时间", type: "datetime-local" },
        ],
        (v) => api(section, "POST", { ...v, due_at: iso(v.due_at) }),
      );
    else if (section === "conversations")
      form(
        "登记会话（人工模式）",
        [
          select("account_id", "客户企业", "accounts"),
          {
            key: "contact_id",
            label: "客户联系人",
            options: (cache.contacts || []).map((c) => ({
              value: c.id,
              label: `${c.name} · ${c.email} · ${c.company}`,
            })),
          },
          select("channel_account_id", "本方邮箱", "channel-accounts"),
          { key: "subject", label: "主题" },
          {
            key: "external_thread_id",
            label: "独立会话编号",
            value: crypto.randomUUID(),
          },
        ],
        (v) => api(section, "POST", v),
      );
    else if (section === "products")
      form(
        "新建产品",
        [
          { key: "sku", label: "SKU" },
          { key: "name", label: "品名" },
          { key: "category", label: "品类" },
          { key: "unit", label: "销售单位", value: "piece" },
          { key: "oe", label: "OE号", required: false },
          { key: "fitment", label: "适配依据说明", required: false },
          {
            key: "fitment_status",
            label: "适配状态",
            options: ["unverified", "confirmed", "conflicted"].map((value) => ({
              value,
              label: L(value),
            })),
          },
          sources(),
        ],
        (v) => api(section, "POST", v),
      );
    else if (section === "contents")
      form(
        "新建内容草稿",
        [
          select("activity_id", "活动", "activities"),
          { key: "title", label: "标题" },
          { key: "body", label: "正文", type: "textarea" },
          select("knowledge_id", "批准资料", "knowledge"),
        ],
        (v) =>
          api("contents", "POST", {
            activity_id: v.activity_id,
            title: v.title,
            body: v.body,
            knowledge_ids: [v.knowledge_id],
          }),
      );
    else if (section === "samples")
      form(
        "申请样品",
        [
          select("account_id", "客户", "accounts"),
          select("product_id", "产品", "products"),
          { key: "quantity", label: "数量", type: "number" },
          { key: "purpose", label: "验证目的" },
        ],
        (v) => api("samples", "POST", v),
      );
    else if (section === "aftersales")
      form(
        "建立售后记录",
        [
          select("order_id", "客户采购订单", "orders"),
          select("product_id", "商品", "products"),
          { key: "batch", label: "批次" },
          { key: "problem", label: "问题描述", type: "textarea" },
          sources(),
        ],
        (v) => api("aftersales", "POST", v),
      );
    else if (section === "receipts")
      form(
        "登记到账待核实凭据",
        [
          select("account_id", "客户", "accounts"),
          { key: "amount", label: "金额", type: "number" },
          { key: "currency", label: "币种", value: "USD" },
          sources(),
        ],
        (v) =>
          api("receipts", "POST", { ...v, event_key: crypto.randomUUID() }),
      );
    else if (section === "trade-documents")
      form(
        "从批准交易生成单证",
        [
          select("order_id", "客户采购订单", "orders"),
          {
            key: "kind",
            label: "单证类型",
            options: [
              { value: "pi", label: "形式发票 PI" },
              { value: "invoice", label: "商业发票" },
              { value: "packing_list", label: "装箱单" },
            ],
          },
          {
            key: "shipment_ids",
            label: "装箱单发货批次ID（逗号分隔）",
            required: false,
          },
          {
            key: "box_count",
            label: "实际箱数",
            type: "number",
            required: false,
          },
          {
            key: "gross_weight",
            label: "实际毛重 KG",
            type: "number",
            required: false,
          },
          {
            ...sources(),
            key: "weight_source_id",
            label: "重量箱数依据",
            required: false,
          },
        ],
        (v) =>
          api(`orders/${v.order_id}/documents`, "POST", {
            kind: v.kind,
            shipment_ids: csv(v.shipment_ids),
            box_count: v.box_count ? Number(v.box_count) : undefined,
            gross_weight: v.gross_weight || undefined,
            weight_source_id: v.weight_source_id || undefined,
          }),
      );
    else if (section === "purchase-rfqs")
      form(
        "新建采购询价",
        [
          select("rfq_id", "客户询盘", "rfqs"),
          { key: "name", label: "采购任务名称" },
        ],
        (v) => api("purchase-rfqs", "POST", v),
      );
    else if (section === "members")
      form(
        "创建公司成员",
        [
          { key: "name", label: "姓名" },
          { key: "email", label: "公司邮箱", type: "email" },
          {
            key: "username",
            label: "用户名（可选，字母数字或._-，至少3位）",
            required: false,
          },
          { key: "password", label: "初始密码（至少12位）", type: "password" },
          {
            key: "role",
            label: "角色",
            options: [
              "owner",
              "manager",
              "sales",
              "market",
              "procurement",
              "finance",
              "viewer",
            ].map((value) => ({ value, label: L(value) })),
          },
        ],
        (v) =>
          api("members", "POST", { ...v, username: v.username || undefined }),
      );
    else if (section === "automation-rules")
      form(
        "建立内部规则（默认暂停）",
        [
          { key: "name", label: "规则名称" },
          {
            key: "kind",
            label: "内部动作",
            options: [
              { value: "internal_followup", label: "新线索跟进任务" },
              { value: "internal_review", label: "线索核实任务" },
            ],
          },
          { key: "daily_limit", label: "每日最大任务数", type: "number" },
          select("scope_activity_id", "限定来源活动", "activities"),
        ],
        (v) =>
          api("automation-rules", "POST", {
            ...v,
            daily_limit: Number(v.daily_limit),
          }),
      );
    else if (section === "eval-datasets")
      form(
        "创建固定评测集",
        [
          { key: "name", label: "案例集名称" },
          { key: "adjudicator", label: "裁定人" },
          {
            key: "cases",
            label: "案例JSON数组",
            type: "textarea",
            hint: "kind为quote/score/manual，含id、input、expected、critical，不放客户原件。",
            value: JSON.stringify([
              {
                id: "margin-reference",
                kind: "quote",
                input: {
                  cost: "72",
                  quantity: "100",
                  pack: "1",
                  fees: "0",
                  margin: "0.2",
                  fx: "7.2",
                  direction: "quote_to_cost",
                },
                expected: { amount: "1250.00" },
                critical: true,
              },
            ]),
          },
        ],
        (v) =>
          api("eval-datasets", "POST", {
            ...v,
            fixture_type: "synthetic",
            cases: JSON.parse(v.cases),
          }),
      );
    else if (section === "rfqs") newRfq();
    else if (section === "quotes") quoteForm();
    else if (section === "orders")
      form(
        "依据已批准报价确认订单",
        [
          select("quote_id", "已批准报价", "quotes"),
          sources(),
          { key: "purchase_reference", label: "客户独立采购编号" },
        ],
        (v) =>
          api("orders", "POST", {
            ...v,
            confirmation_source_id: v.source_id,
            source_id: undefined,
          }),
      );
  }
  function collect() {
    M(
      <CollectionForm
        onClose={() => M(null)}
        onSaved={() => {
          go("sources");
          refresh();
          T("原件已保存到资料箱，尚未整理为客户");
        }}
      />,
    );
  }
  function capture(source?: Row) {
    let saved: Row = {};
    try {
      saved = JSON.parse(localStorage.getItem("capture:" + entity) || "{}");
    } catch {}
    if (source) {
      saved.source_id = source.id;
      localStorage.setItem("capture:" + entity, JSON.stringify(saved));
    }
    if (!saved.event_id) {
      saved.event_id = crypto.randomUUID();
      localStorage.setItem("capture:" + entity, JSON.stringify(saved));
    }
    const fields: Field[] = [
      select("activity_id", "来源活动", "activities"),
      { key: "company", label: "客户公司" },
      { key: "contact_name", label: "联系人", required: false },
      { key: "email", label: "邮箱", type: "email", required: false },
      { key: "phone", label: "电话", required: false },
      { key: "country", label: "国家", required: false },
      { key: "notes", label: "会谈 / 原始需求", type: "textarea" },
      {
        key: "permission",
        label: "联系许可",
        options: [
          { value: "unknown", label: "未知 / 待核实" },
          { value: "granted", label: "已取得许可（会谈原文须注明）" },
        ],
      },
    ];
    saved.permission ||= "unknown";
    if (!saved.activity_id && cache.activities?.length === 1)
      saved.activity_id = cache.activities[0].id;
    const event_id = saved.event_id || crypto.randomUUID();
    M(
      <CaptureForm
        fields={fields}
        saved={saved}
        onClose={() => M(null)}
        onSave={async (v) => {
          await api("leads", "POST", { ...v, event_id });
          localStorage.removeItem("capture:" + entity);
          await refresh();
          T("服务器已保存采集记录");
        }}
      />,
    );
  }
  function newRfq(account?: Row) {
    form(
      "整理标准询盘",
      [
        { ...select("account_id", "客户", "accounts"), value: account?.id },
        { key: "title", label: "采购需求标题" },
        sources(),
        { key: "destination", label: "目的地", required: false },
        {
          key: "lines",
          label: "逐行需求：OE,描述,数量,单位,质量",
          type: "textarea",
          hint: "每行一项；未知字段可留空，例如：,滤清器,,piece,",
        },
      ],
      (v) =>
        api("rfqs", "POST", {
          ...v,
          lines: v.lines
            .split("\n")
            .filter(Boolean)
            .map((s: string) => {
              const [oe, description, quantity, unit, quality] = s.split(",");
              return {
                oe: oe || "",
                description: description || oe || "待澄清",
                quantity: quantity || null,
                unit: unit || "",
                quality: quality || "",
              };
            }),
        }),
    );
  }
  function quoteForm(q?: Row) {
    M(
      <QuoteEditor
        existing={q}
        cache={cache}
        onClose={() => M(null)}
        onSaved={async () => {
          await refresh();
          if (q) V(await api("quotes/" + q.id));
          T("报价版本已保存，尚未批准或发送");
        }}
      />,
    );
  }
  async function open(row: Row) {
    if (section === "purchase-rfqs") {
      const rfq = await api("rfqs/" + row.rfq_id);
      V({ ...row, lines: rfq.lines });
    } else if (section === "accounts") V(await api("accounts/" + row.id));
    else if (["rfqs", "quotes", "orders"].includes(section))
      V(await api(section + "/" + row.id));
    else if (section === "conversations")
      V({ ...row, messages: await api(`conversations/${row.id}/messages`) });
    else V(row);
  }
  if (!ready) return <div className="splash">正在连接工作台…</div>;
  if (location.pathname.startsWith("/form/")) return <PublicForm />;
  if (!session)
    return (
      <Login
        company={company}
        onLogin={async (s) => {
          setEntity(company?.entity_id || s.entities[0]?.id || "");
          const workspace = await api("company-workspace");
          S({ ...s, workspace });
        }}
      />
    );
  const title =
    menu.find((v) => v[0] === section)?.[1] ||
    (
      { contents: "内容与发布记录", candidates: "候选客户池" } as Record<
        string,
        string
      >
    )[section] ||
    "业务记录";
  const filtered = rows.filter((x) =>
    JSON.stringify(x).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="shell">
      <aside className={mobile ? "open" : ""}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("home");
          }}
        >
          <span>{company?.display_name || "公司"}</span>
          <div>
            {company?.display_name ||
              (company
                ? `公司入口 ${String(company.slot).padStart(2, "0")}`
                : "公司工作空间")}
            <small>{company?.subtitle || "COMPANY WORKSPACE"}</small>
          </div>
        </a>
        <Navigation
          items={menu.filter(
            ([key]) =>
              [
                "home",
                "goals",
                "members",
                "integrations",
                "audit-events",
              ].includes(key) || session.workspace?.modules.includes(key),
          )}
          section={section}
          onGo={go}
        />
        <div className="sidebar-bottom">
          <span className="live-dot" /> 数据库持久保存
          <br />
          <small>外发关闭 · 人工核对优先</small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="icon mobile-menu"
            onClick={() => B(!mobile)}
            aria-label="打开导航"
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            运营空间 <ChevronRight size={14} /> {title}
          </div>
          <div className="user">
            <a className="company-switch" href="/">
              选择公司
            </a>
            <span className="role-label">
              {L(session.entities.find((v: Row) => v.id === entity)?.role)}
            </span>
            <select
              aria-label="经营主体"
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value);
                V(null);
                S({ ...session });
              }}
            >
              {session.entities
                .filter((v: Row) => !company || v.id === company.entity_id)
                .map((v: Row) => (
                  <option value={v.id} key={v.id}>
                    {v.name}
                  </option>
                ))}
            </select>
            <button
              className="avatar"
              aria-label="修改登录密码"
              onClick={() =>
                form(
                  "修改密码（所有会话将退出）",
                  [
                    {
                      key: "old_password",
                      label: "当前密码",
                      type: "password",
                    },
                    {
                      key: "new_password",
                      label: "新密码（至少12位）",
                      type: "password",
                    },
                  ],
                  async (v) => {
                    await api("account/password", "POST", v);
                    S(null);
                  },
                )
              }
            >
              {session.name.slice(0, 1)}
            </button>
            <button
              className="icon"
              aria-label="退出登录"
              onClick={() =>
                act(async () => {
                  await api("session", "DELETE");
                  S(null);
                })
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        {session.entities.find((v: Row) => v.id === entity)?.is_demo && (
          <div className="demo-banner">
            演示空间 · 仅使用虚构资料，数据不计入正式经营报表
          </div>
        )}
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {company?.display_name || "COMPANY"} / WORKSPACE
              </div>
              <h1>
                {detail ? (
                  <>
                    <button className="text" onClick={() => V(null)}>
                      {title}
                    </button>
                    <ChevronRight size={22} />
                    {detail.name ||
                      detail.title ||
                      detail.subject ||
                      "记录详情"}
                  </>
                ) : (
                  title
                )}
              </h1>
              <p>
                {section === "home"
                  ? "先处理下一步，再看经营结果。所有数字均来自业务记录。"
                  : section === "integrations"
                    ? "连接能力、后台运行与人工处理分开显示。"
                    : "保留来源与历史，让每一次业务推进都有依据。"}
              </p>
            </div>
            <div className="actions">
              <button
                className="secondary"
                onClick={() => {
                  V(null);
                  refresh();
                }}
              >
                <RefreshCw size={15} />
                刷新
              </button>
              {![
                "home",
                "goals",
                "accounts",
                "integrations",
                "audit-events",
                "candidates",
              ].includes(section) &&
                (section !== "members" ||
                  session.entities.find((v: Row) => v.id === entity)?.role ===
                    "owner") && (
                  <button onClick={add}>
                    <Plus size={17} />
                    {section === "leads"
                      ? "现场采集"
                      : section === "sources"
                        ? "收集资料"
                        : "新建"}
                  </button>
                )}
            </div>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              <button className="text" onClick={() => E("")}>
                关闭
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <Check size={16} />
              {notice}
            </div>
          )}
          {section === "home" && (
            <CompanyWorkspace
              config={session.workspace || { purpose: "", modules: [] }}
              admin={
                session.entities.find((v: Row) => v.id === entity)?.role ===
                "owner"
              }
              options={menu
                .filter(
                  ([key]) =>
                    ![
                      "home",
                      "goals",
                      "members",
                      "integrations",
                      "audit-events",
                    ].includes(key),
                )
                .map(([key, label]) => ({ key, label }))}
              onSaved={(workspace) => S({ ...session, workspace })}
            />
          )}
          {section === "home" &&
            dash &&
            Boolean(session.workspace?.modules.length) && (
              <>
                <section className="panel quick-start">
                  <h2>你现在要做什么？</h2>
                  <div className="quick-start-grid">
                    <button className="secondary" onClick={collect}>
                      <Plus size={21} />
                      <span>
                        <b>先收集资料</b>
                        <small>拍照、粘贴截图或原文，不必先填档案</small>
                      </span>
                      <ChevronRight size={17} />
                    </button>
                    <button className="secondary" onClick={() => go("tasks")}>
                      <ListChecks size={21} />
                      <span>
                        <b>处理跟进待办</b>
                        <small>查看已分配的任务，推进下一步</small>
                      </span>
                      <ChevronRight size={17} />
                    </button>
                    <button
                      className="secondary"
                      onClick={() => go("accounts")}
                    >
                      <Users size={21} />
                      <span>
                        <b>查找已有客户</b>
                        <small>打开客户档案，继续沟通或整理询盘</small>
                      </span>
                      <ChevronRight size={17} />
                    </button>
                  </div>
                </section>
                <div className="stats">
                  {[
                    ["leads", "待处理入口", "原始线索"],
                    ["accounts", "统一客户资产", "去重企业"],
                    ["tasks", "需要推进", "未完成任务"],
                    ["rfqs", "采购需求", "标准询盘"],
                  ].map(([k, t, l], i) => (
                    <button className="stat" key={k} onClick={() => go(k)}>
                      <div>
                        {t}
                        <ArrowUpRight size={17} />
                      </div>
                      <strong>{dash.counts[k]}</strong>
                      <small>
                        {l}
                        <span>查看明细 →</span>
                      </small>
                    </button>
                  ))}
                </div>
                <div className="dashboard-grid">
                  <section className="panel">
                    <div className="panel-title">
                      <h2>今天，从这里推进</h2>
                      <span>负责人六问</span>
                    </div>
                    <div className="decision-list">
                      {[
                        [
                          "01",
                          "谁值得开发？",
                          "核对新线索的进口能力与分销依据",
                          "leads",
                        ],
                        [
                          "02",
                          "重点客户下一步是什么？",
                          "查看责任人与截止时间",
                          "tasks",
                        ],
                        [
                          "03",
                          "询盘还缺什么？",
                          "逐行澄清 OE、数量、单位与目的地",
                          "rfqs",
                        ],
                        [
                          "04",
                          "哪些交易需要处理？",
                          "查看已确认订单与回款核实",
                          "orders",
                        ],
                        [
                          "05",
                          "老客户需要补货吗？",
                          "待接入客户库存与独立复购数据",
                          "accounts",
                        ],
                        [
                          "06",
                          "投入带来了什么？",
                          `已登记人工 ${dash.work_minutes} 分钟；毛利与收入未启用正式统计`,
                          "tasks",
                        ],
                      ].map(([n, t, d, k]) => (
                        <button key={n} onClick={() => go(k)}>
                          <span className="step">{n}</span>
                          <div>
                            <b>{t}</b>
                            <small>{d}</small>
                          </div>
                          <ChevronRight size={17} />
                        </button>
                      ))}
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-title">
                      <h2>获客双主链</h2>
                    </div>
                    <div className="chain">
                      <CalendarDays />
                      <h3>行业展会</h3>
                      <p>现场采集 → 核实归属 → 会后跟进</p>
                      <button className="secondary" onClick={() => capture()}>
                        采集一条线索 <ArrowUpRight size={15} />
                      </button>
                    </div>
                    <div className="chain online">
                      <Globe2 />
                      <h3>线上宣传</h3>
                      <p>内容审批 → 留资表单 → 需求澄清</p>
                      <button
                        className="secondary"
                        onClick={() => go("activities")}
                      >
                        管理活动与留资 <ArrowUpRight size={15} />
                      </button>
                    </div>
                  </section>
                </div>
                <section className="panel">
                  <div className="panel-title">
                    <h2>活动来源表现</h2>
                    <span>线索与企业分别计数</span>
                  </div>
                  {dash.channels.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th>活动</th>
                          <th>渠道</th>
                          <th>原始线索</th>
                          <th>关联企业</th>
                          <th>曝光 / 点击</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dash.channels.map((v: Row) => (
                          <tr key={v.id}>
                            <td>{v.name}</td>
                            <td>{L(v.type)}</td>
                            <td>{v.leads}</td>
                            <td>{v.accounts}</td>
                            <td className="muted">未接入</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <Empty
                      text="先新建一次展会或线上活动，再采集第一条线索。"
                      action={() => go("activities")}
                      label="创建活动"
                    />
                  )}
                </section>
              </>
            )}
          {section === "goals" && (
            <GoalsWorkspace
              role={
                session.entities.find((v: Row) => v.id === entity)?.role ||
                "viewer"
              }
              members={cache.members || []}
              refreshKey={goalsRefresh}
            />
          )}
          {section !== "home" && section !== "goals" && !detail && (
            <>
              <div className="toolbar">
                <div className="search">
                  <Search size={17} />
                  <input
                    aria-label="搜索当前列表"
                    placeholder="搜索当前列表…"
                    value={query}
                    onChange={(e) => Q(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        O(0);
                        refresh();
                      }
                    }}
                  />
                  <button
                    className="secondary"
                    onClick={() => {
                      O(0);
                      refresh();
                    }}
                  >
                    查询
                  </button>
                </div>
                <div className="actions">
                  {[
                    "activities",
                    "leads",
                    "knowledge",
                    "rfqs",
                    "products",
                  ].includes(section) && (
                    <button className="secondary" onClick={addSource}>
                      登记原件
                    </button>
                  )}
                  {section === "accounts" && (
                    <button
                      className="secondary"
                      onClick={() =>
                        act(() => download("exports/accounts"), "已生成授权CSV")
                      }
                    >
                      导出客户
                    </button>
                  )}
                  {section === "tasks" && (
                    <button
                      className="secondary"
                      onClick={() =>
                        form(
                          "登记实际工时",
                          [
                            {
                              key: "category",
                              label: "工作类型",
                              options: [
                                "capture",
                                "review",
                                "rework",
                                "maintenance",
                                "follow_up",
                              ].map((value) => ({
                                value,
                                label:
                                  {
                                    capture: "采集",
                                    review: "审核",
                                    rework: "返工",
                                    maintenance: "维护",
                                    follow_up: "跟进",
                                  }[value] || value,
                              })),
                            },
                            { key: "minutes", label: "分钟", type: "number" },
                            { key: "note", label: "说明", required: false },
                          ],
                          (v) =>
                            api("work-logs", "POST", {
                              ...v,
                              minutes: Number(v.minutes),
                            }),
                        )
                      }
                    >
                      记录工时
                    </button>
                  )}
                  {section === "conversations" && (
                    <button
                      className="secondary"
                      onClick={() =>
                        form(
                          "登记本方邮箱（人工模式）",
                          [
                            { key: "name", label: "邮箱名称" },
                            {
                              key: "address",
                              label: "邮箱地址",
                              type: "email",
                            },
                          ],
                          (v) => api("channel-accounts", "POST", v),
                        )
                      }
                    >
                      登记邮箱身份
                    </button>
                  )}
                  {section === "products" && (
                    <button
                      className="secondary"
                      onClick={() =>
                        form(
                          "登记供应商",
                          [
                            { key: "name", label: "供应商名称" },
                            { key: "email", label: "邮箱", type: "email" },
                            { ...sources(), key: "evidence_id" },
                          ],
                          (v) => api("suppliers", "POST", v),
                        )
                      }
                    >
                      供应商
                    </button>
                  )}
                </div>
              </div>
              <section className="panel list-panel">
                {loading ? (
                  <Empty text="正在加载数据库记录…" />
                ) : filtered.length ? (
                  <>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>
                              {section === "integrations"
                                ? "能力 / 提供者"
                                : "业务记录"}
                            </th>
                            <th>状态 / 类型</th>
                            <th>
                              {section === "integrations" ? "实际能力" : "信息"}
                            </th>
                            <th>最近记录</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((v, i) => (
                            <tr
                              key={v.id || i}
                              onClick={() =>
                                section !== "integrations" && open(v)
                              }
                              className={
                                section !== "integrations" ? "clickable" : ""
                              }
                            >
                              <td>
                                <b>
                                  {v.name ||
                                    v.title ||
                                    v.company ||
                                    v.subject ||
                                    v.action ||
                                    v.kind ||
                                    v.id}
                                </b>
                                <small className="row-id">
                                  {v.id?.slice(0, 8) || v.capability}
                                </small>
                              </td>
                              <td>
                                <Badge
                                  value={
                                    v.status ||
                                    v.lifecycle ||
                                    v.classification ||
                                    v.type ||
                                    "unknown"
                                  }
                                />
                              </td>
                              <td>
                                {section === "integrations"
                                  ? v.capability
                                  : v.country ||
                                    v.category ||
                                    v.actor_name ||
                                    v.currency ||
                                    v.email ||
                                    v.error ||
                                    "—"}
                              </td>
                              <td>{date(v.created_at || v.occurred_at)}</td>
                              <td>
                                {section !== "integrations" && (
                                  <ChevronRight size={15} />
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="table-foot">
                      第 {Math.floor(offset / 100) + 1} 页 · 当前{" "}
                      {filtered.length} 条
                      <button
                        className="text"
                        disabled={offset === 0}
                        onClick={() => O(Math.max(0, offset - 100))}
                      >
                        上一页
                      </button>
                      <button
                        className="text"
                        disabled={rows.length < 100}
                        onClick={() => O(offset + 100)}
                      >
                        下一页
                      </button>
                    </div>
                  </>
                ) : (
                  <Empty
                    text={
                      section === "accounts"
                        ? "暂无企业。先采集线索，核实后转为客户；相似名称不会自动合并。"
                        : "暂无记录。点击“新建”开始，资料与外部连接不足会明确提示。"
                    }
                  />
                )}
              </section>
              {section === "integrations" && (
                <section className="panel">
                  <div className="panel-title">
                    <h2>持久化后台任务</h2>
                    <button
                      className="secondary"
                      onClick={() =>
                        act(
                          async () => V({ jobs: await api("jobs") }),
                          "已读取后台任务",
                        )
                      }
                    >
                      查看任务结果
                    </button>
                  </div>
                  <p>
                    外部消息、平台发布、广告投放均关闭。文本模型任务可在原件详情提交；无模型配置时转人工。
                  </p>
                </section>
              )}
            </>
          )}
          {detail && (
            <section className="panel detail">
              <div className="detail-top">
                <Badge
                  value={
                    detail.status ||
                    detail.lifecycle ||
                    detail.type ||
                    "unknown"
                  }
                />
                <span className="muted">
                  编号 <code>{detail.id}</code> · 版本{" "}
                  {detail.row_version || detail.revision || 1}
                </span>
              </div>
              {section === "activities" && (
                <>
                  <h2>{detail.name}</h2>
                  <p>
                    {L(detail.type)} / {detail.country || "国家待填"} /{" "}
                    {detail.timezone}
                  </p>
                  <p>
                    预算 {detail.budget} {detail.currency} · 实际费用另行登记
                  </p>
                  <div className="actions">
                    <button onClick={() => capture()}>采集线索</button>
                    {detail.type === "online" && (
                      <button
                        className="secondary"
                        onClick={() =>
                          window.open(
                            "/form/" + detail.public_key,
                            "_blank",
                            "noopener",
                          )
                        }
                      >
                        打开英文留资表单
                      </button>
                    )}
                    <button
                      className="secondary"
                      onClick={() =>
                        form(
                          "新建宣传内容",
                          [
                            { key: "title", label: "标题" },
                            {
                              key: "body",
                              label: "人工文案",
                              type: "textarea",
                            },
                            select(
                              "knowledge_id",
                              "已批准对外资料",
                              "knowledge",
                            ),
                          ],
                          (v) =>
                            api("contents", "POST", {
                              activity_id: detail.id,
                              title: v.title,
                              body: v.body,
                              knowledge_ids: [v.knowledge_id],
                            }),
                        )
                      }
                    >
                      内容草稿
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        act(async () => {
                          D(await api("contents"));
                          V(null);
                          N("contents");
                        })
                      }
                    >
                      内容与发布记录
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        form(
                          "导入展会 / 线上名录",
                          [
                            {
                              key: "rows",
                              label:
                                "CSV：公司,联系人,邮箱,国家,分类,备注（不含标题行）",
                              type: "textarea",
                              hint: "分类 importer / distributor / supplier / retail / unknown",
                            },
                          ],
                          async (v) => {
                            const data = v.rows
                              .split("\n")
                              .filter(Boolean)
                              .map((s: string) => {
                                const [
                                  company,
                                  contact_name,
                                  email,
                                  country,
                                  classification,
                                  notes,
                                ] = s.split(",");
                                return {
                                  company,
                                  contact_name: contact_name || "",
                                  email: email || "",
                                  country: country || "",
                                  classification: classification || "unknown",
                                  notes: notes || "",
                                };
                              });
                            const preview = await api(
                              "imports/preview",
                              "POST",
                              { activity_id: detail.id, rows: data },
                            );
                            M(null);
                            V({
                              ...detail,
                              importRows: data,
                              preview,
                              importId: crypto.randomUUID(),
                            });
                          },
                        )
                      }
                    >
                      名录导入预览
                    </button>
                  </div>
                  {detail.preview && (
                    <>
                      <h3>导入预览</h3>
                      {detail.preview.map((v: Row) => (
                        <p key={v.line}>
                          第{v.line}行：
                          {v.valid ? "可导入" : v.errors.join("; ")}
                        </p>
                      ))}
                      <button
                        onClick={() =>
                          act(
                            async () =>
                              V({
                                ...detail,
                                importResults: await api(
                                  "imports/commit",
                                  "POST",
                                  {
                                    activity_id: detail.id,
                                    import_id: detail.importId,
                                    rows: detail.importRows,
                                  },
                                ),
                              }),
                            "已执行导入，请核对行级结果",
                          )
                        }
                      >
                        确认导入有效行
                      </button>
                    </>
                  )}
                  {detail.importResults && (
                    <pre>{JSON.stringify(detail.importResults, null, 2)}</pre>
                  )}
                </>
              )}
              {section === "sources" && (
                <>
                  <h2>{detail.name}</h2>
                  <p>
                    {detail.storage_key
                      ? "原件已保存，内容待人工核实"
                      : "原文已保存，可核实并关联为客户线索"}
                  </p>
                  {detail.body && <article>{detail.body}</article>}
                  {detail.storage_key && (
                    <button
                      className="secondary"
                      onClick={() =>
                        act(async () => {
                          const r = await fetch(
                            `/api/v1/files/${detail.id}/download`,
                            { headers: { "X-Entity-Id": entity } },
                          );
                          if (!r.ok) throw new Error("原件下载失败");
                          const url = URL.createObjectURL(await r.blob());
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = detail.name;
                          a.click();
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                        }, "已下载原件")
                      }
                    >
                      下载原件查看
                    </button>
                  )}
                  <p>
                    核对原件后，再补充公司、联系方式和来源活动。图片文字识别尚未接通。
                  </p>
                  {cache.activities?.length ? (
                    <button onClick={() => capture(detail)}>
                      核实并整理为客户线索
                    </button>
                  ) : (
                    <button onClick={() => go("activities")}>
                      先创建来源活动
                    </button>
                  )}
                </>
              )}
              {section === "leads" && (
                <>
                  <h2>{detail.company}</h2>
                  <p>
                    {detail.contact_name} · {detail.email || detail.phone}
                  </p>
                  <article>{detail.notes || "会谈记录待补充"}</article>
                  <p>
                    来源活动：
                    {
                      cache.activities?.find((v) => v.id === detail.activity_id)
                        ?.name
                    }{" "}
                    · 联系许可：{L(detail.permission)}
                  </p>
                  <div className="actions">
                    <button
                      className="secondary"
                      onClick={() =>
                        act(async () => {
                          const s = await api("sources");
                          V({
                            ...detail,
                            source: s.find(
                              (v: Row) => v.id === detail.source_id,
                            ),
                          });
                        })
                      }
                    >
                      核对原件
                    </button>
                    {!detail.account_id && (
                      <button
                        onClick={() =>
                          form(
                            "核实后转入客户库",
                            [
                              {
                                ...select(
                                  "account_id",
                                  "关联已有企业（相同企业时选择）",
                                  "accounts",
                                  false,
                                ),
                                hint: "留空则新建企业。名称相似与公共邮箱均不会自动合并。",
                              },
                              select("owner_id", "负责人", "members"),
                            ],
                            async (v) => {
                              const result = await api(
                                `leads/${detail.id}/convert`,
                                "POST",
                                {
                                  account_id: v.account_id || undefined,
                                  owner_id: v.owner_id,
                                },
                              );
                              V(result);
                            },
                          )
                        }
                      >
                        确认归属并转客户
                      </button>
                    )}
                    {detail.account_id && (
                      <button
                        onClick={() => {
                          go("accounts");
                          api("accounts/" + detail.account_id).then(V);
                        }}
                      >
                        打开客户档案
                      </button>
                    )}
                  </div>
                  {detail.source && (
                    <article>
                      <h3>{detail.source.name}</h3>
                      <p>{detail.source.body || "附件无文本，需人工核对"}</p>
                      {detail.source.storage_key && (
                        <button
                          onClick={() =>
                            act(async () => {
                              const r = await fetch(
                                `/api/v1/files/${detail.source.id}/download`,
                                { headers: { "X-Entity-Id": entity } },
                              );
                              if (!r.ok) throw new Error("附件访问失败");
                              const a = document.createElement("a");
                              a.href = URL.createObjectURL(await r.blob());
                              a.download = detail.source.name;
                              a.click();
                            }, "已下载原件")
                          }
                        >
                          下载私有原件
                        </button>
                      )}
                      <button
                        className="secondary"
                        onClick={() =>
                          act(
                            () =>
                              api("ai-jobs", "POST", {
                                source_id: detail.source.id,
                                kind: "extract",
                              }),
                            "提取任务已入队；结果在连接与运行中查看",
                          )
                        }
                      >
                        提交模型提取
                      </button>
                    </article>
                  )}
                </>
              )}
              {section === "accounts" && (
                <>
                  <h2>{detail.name}</h2>
                  <p>
                    {detail.country || "国家待核实"} · {L(detail.company_type)}{" "}
                    · 当前等级 {L(detail.priority)}
                  </p>
                  <div className="actions">
                    <button onClick={() => newRfq(detail)}>整理询盘</button>
                    <button
                      className="secondary"
                      onClick={() =>
                        form(
                          "记录证据事实",
                          [
                            {
                              key: "field",
                              label: "核实维度",
                              options: [
                                { value: "import", label: "进口能力" },
                                { value: "distribution", label: "分销网络" },
                                { value: "quality", label: "品质要求" },
                                { value: "fit", label: "品类匹配" },
                              ],
                            },
                            {
                              key: "value",
                              label: "事实原文 / 结论",
                              type: "textarea",
                            },
                            {
                              key: "fact_status",
                              label: "核实状态",
                              options: [
                                "unknown",
                                "extracted",
                                "confirmed",
                                "conflicted",
                              ].map((value) => ({ value, label: L(value) })),
                            },
                            sources(),
                            { key: "locator", label: "证据位置 / 原文摘录" },
                          ],
                          async (v) => {
                            await api(`accounts/${detail.id}/facts`, "POST", v);
                            V(await api(`accounts/${detail.id}`));
                          },
                        )
                      }
                    >
                      新增核实事实
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        form(
                          "客户交接",
                          [
                            select("owner_id", "新负责人", "members"),
                            { key: "reason", label: "交接理由" },
                          ],
                          async (v) => {
                            await api(
                              `accounts/${detail.id}/transfer`,
                              "POST",
                              { ...v, row_version: detail.row_version },
                            );
                            V(await api(`accounts/${detail.id}`));
                          },
                        )
                      }
                    >
                      交接负责人
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        form(
                          "人工确认合并企业",
                          [
                            {
                              ...select("to_id", "保留的企业", "accounts"),
                              hint: "来源、联系人与历史都保留；此操作仅负责人可执行。",
                            },
                            { key: "reason", label: "同企业证据与理由" },
                          ],
                          async (v) => {
                            await api("accounts/merge", "POST", {
                              ...v,
                              from_id: detail.id,
                            });
                            V(await api("accounts/" + v.to_id));
                          },
                        )
                      }
                    >
                      合并重复企业
                    </button>
                  </div>
                  <h3>联系人与许可</h3>
                  {detail.contacts.map((v: Row) => (
                    <div className="info-row" key={v.id}>
                      <div>
                        <b>{v.name || "联系人"}</b> · {v.title} ·{" "}
                        {v.email || v.phone}
                        <small className="row-id">{v.id}</small>
                      </div>
                      <Badge value={v.permission} />
                      <button
                        className="text danger"
                        onClick={() =>
                          form(
                            "登记退订 / 禁止联系",
                            [{ key: "reason", label: "原因" }],
                            async (p) => {
                              await api(`contacts/${v.id}/suppress`, "POST", p);
                              V(await api("accounts/" + detail.id));
                            },
                          )
                        }
                      >
                        登记退订
                      </button>
                    </div>
                  ))}
                  <button
                    className="secondary"
                    onClick={() =>
                      form(
                        "新增联系人",
                        [
                          { key: "name", label: "姓名" },
                          { key: "email", label: "邮箱", type: "email" },
                          {
                            key: "title",
                            label: "职务 / 角色",
                            required: false,
                          },
                        ],
                        async (v) => {
                          await api(
                            `accounts/${detail.id}/contacts`,
                            "POST",
                            v,
                          );
                          V(await api("accounts/" + detail.id));
                        },
                      )
                    }
                  >
                    新增联系人
                  </button>
                  <h3>逐项事实 · 未知与冲突独立保留</h3>
                  {detail.facts.length ? (
                    detail.facts.map((v: Row) => (
                      <div className="info-row" key={v.id}>
                        <div>
                          <b>{v.field}</b>
                          <p>{v.value}</p>
                          <small>
                            {v.locator} · 来源 {v.source_id?.slice(0, 8)}
                          </small>
                        </div>
                        <Badge value={v.fact_status} />
                      </div>
                    ))
                  ) : (
                    <p className="muted">
                      进口、分销、品质与匹配均待核实，尚无事实依据。
                    </p>
                  )}
                  <button
                    className="secondary"
                    onClick={() =>
                      form(
                        "证据评分（四维等权建议）",
                        [
                          {
                            key: "import",
                            label: "进口能力分数（0—100，未知留空）",
                            required: false,
                            type: "number",
                          },
                          {
                            key: "distribution",
                            label: "分销网络分数",
                            required: false,
                            type: "number",
                          },
                          {
                            key: "quality",
                            label: "品质诉求分数",
                            required: false,
                            type: "number",
                          },
                          {
                            key: "fit",
                            label: "品类匹配分数",
                            required: false,
                            type: "number",
                          },
                        ],
                        async (v) => {
                          const dimensions = [
                            "import",
                            "distribution",
                            "quality",
                            "fit",
                          ].map((field) => {
                            const fact = detail.facts.find(
                              (f: Row) =>
                                f.field === field &&
                                f.fact_status === "confirmed",
                            );
                            return {
                              field,
                              weight: 1,
                              state: v[field] !== "" ? "known" : "unknown",
                              value: v[field] !== "" ? Number(v[field]) : null,
                              ...(fact ? { fact_id: fact.id } : {}),
                            };
                          });
                          await api(
                            `accounts/${detail.id}/assessments`,
                            "POST",
                            { dimensions },
                          );
                          V(await api("accounts/" + detail.id));
                        },
                      )
                    }
                  >
                    依据已确认事实评分
                  </button>
                  {detail.assessments.map((v: Row) => (
                    <p key={v.id}>
                      已知项得分 <b>{v.known_score ?? "未知"}</b> · 证据覆盖{" "}
                      <b>{v.coverage}%</b> · 人工等级{" "}
                      {v.confirmed_grade || "待核实"}
                    </p>
                  ))}
                  <h3>来源时间线（{detail.touches.length} 次接触）</h3>
                  {detail.touches.map((v: Row) => (
                    <div className="timeline" key={v.id}>
                      <span />
                      {date(v.occurred_at)} · {L(v.channel)} ·{" "}
                      {cache.activities?.find((a) => a.id === v.activity_id)
                        ?.name || v.activity_id}
                    </div>
                  ))}
                  <h3>下一步任务</h3>
                  {detail.tasks.map((v: Row) => (
                    <div className="info-row" key={v.id}>
                      {v.title}
                      <Badge value={v.status} />
                      <small>{date(v.due_at)}</small>
                    </div>
                  ))}
                </>
              )}
              {section === "tasks" && (
                <>
                  <h2>{detail.title}</h2>
                  <p>
                    截止 {date(detail.due_at)} · 责任人{" "}
                    {cache.members?.find((v) => v.id === detail.owner_id)?.name}
                  </p>
                  <p>{detail.result || "尚未填写执行结果"}</p>
                  <button
                    onClick={() =>
                      form(
                        "更新任务进度",
                        [
                          {
                            key: "status",
                            label: "状态",
                            options: [
                              "in_progress",
                              "waiting_customer",
                              "waiting_internal",
                              "completed",
                              "cancelled",
                            ].map((value) => ({ value, label: L(value) })),
                          },
                          {
                            key: "result",
                            label: "执行结果 / 等待原因",
                            type: "textarea",
                          },
                          {
                            key: "check_again_at",
                            label: "下次检查时间（等待状态必填）",
                            type: "datetime-local",
                            required: false,
                          },
                        ],
                        async (v) => {
                          const n = await api(
                            `tasks/${detail.id}/status`,
                            "POST",
                            {
                              ...v,
                              row_version: detail.row_version,
                              check_again_at: v.check_again_at
                                ? iso(v.check_again_at)
                                : undefined,
                            },
                          );
                          V(n);
                        },
                      )
                    }
                  >
                    更新状态与结果
                  </button>
                </>
              )}
              {section === "knowledge" && (
                <>
                  <h2>{detail.name}</h2>
                  <article>{detail.body}</article>
                  <p>
                    有效至 {date(detail.valid_until)} · 外发范围{" "}
                    {detail.share_scope}
                  </p>
                  <div className="actions">
                    {detail.status === "draft" && (
                      <button
                        onClick={() =>
                          act(async () =>
                            V(
                              await api(
                                `knowledge/${detail.id}/approve`,
                                "POST",
                                {},
                              ),
                            ),
                          )
                        }
                      >
                        审核批准
                      </button>
                    )}
                    {detail.status === "approved" && (
                      <button
                        className="secondary"
                        onClick={() =>
                          act(
                            async () =>
                              V(
                                await api(
                                  `knowledge/${detail.id}/revoke`,
                                  "POST",
                                  {},
                                ),
                              ),
                            "资料已撤回，相关待发送草稿需重核",
                          )
                        }
                      >
                        撤回资料
                      </button>
                    )}
                  </div>
                </>
              )}
              {section === "contents" && (
                <>
                  <h2>{detail.title}</h2>
                  <article>{detail.body}</article>
                  <div className="actions">
                    {detail.status === "draft" && (
                      <button
                        onClick={() =>
                          act(async () =>
                            V(
                              await api(
                                `contents/${detail.id}/submit-review`,
                                "POST",
                                {},
                              ),
                            ),
                          )
                        }
                      >
                        提交审核
                      </button>
                    )}
                    {detail.status === "review_pending" && (
                      <button
                        onClick={() =>
                          act(async () =>
                            V(
                              await api(
                                `contents/${detail.id}/approve`,
                                "POST",
                                {},
                              ),
                            ),
                          )
                        }
                      >
                        批准内容
                      </button>
                    )}
                    {detail.status === "approved" && (
                      <button
                        onClick={() =>
                          form(
                            "人工登记实际发布",
                            [{ key: "url", label: "真实发布URL", type: "url" }],
                            async (v) =>
                              V(
                                await api(
                                  `contents/${detail.id}/publications`,
                                  "POST",
                                  v,
                                ),
                              ),
                          )
                        }
                      >
                        登记发布地址
                      </button>
                    )}
                    {detail.publication_url && (
                      <a
                        href={detail.publication_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看发布记录
                      </a>
                    )}
                  </div>
                </>
              )}
              {section === "market-tasks" && (
                <>
                  <h2>{detail.name}</h2>
                  <p>
                    目标国家 {detail.countries.join("、")} · 品类{" "}
                    {detail.categories.join("、")}
                  </p>
                  <p>
                    排除 {detail.exclusions || "未设置"} · 上限 {detail.budget}{" "}
                    {detail.currency}
                  </p>
                  <div className="actions">
                    <button
                      onClick={() =>
                        act(
                          async () =>
                            V({
                              ...detail,
                              run: await api("discovery-runs", "POST", {
                                market_task_id: detail.id,
                                mode: "import",
                              }),
                            }),
                          "已建立授权资料导入运行",
                        )
                      }
                    >
                      开始资料导入发现
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        act(
                          async () =>
                            V({
                              ...detail,
                              run: await api("discovery-runs", "POST", {
                                market_task_id: detail.id,
                                mode: "search",
                              }),
                            }),
                          "已记录查询计划与未连接原因",
                        )
                      }
                    >
                      预览搜索计划
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        form(
                          "修改任务并保存新版本",
                          [
                            {
                              key: "countries",
                              label: "国家，逗号分隔",
                              value: detail.countries.join(","),
                            },
                            {
                              key: "categories",
                              label: "品类，逗号分隔",
                              value: detail.categories.join(","),
                            },
                            {
                              key: "exclusions",
                              label: "排除",
                              required: false,
                              value: detail.exclusions,
                            },
                          ],
                          async (v) =>
                            V(
                              await api(
                                `market-tasks/${detail.id}/revisions`,
                                "POST",
                                {
                                  ...v,
                                  row_version: detail.row_version,
                                  countries: csv(v.countries),
                                  categories: csv(v.categories),
                                },
                              ),
                            ),
                        )
                      }
                    >
                      修改任务版本
                    </button>
                  </div>
                  {detail.run && (
                    <article>
                      <h3>运行计划</h3>
                      <Badge value={detail.run.status} />
                      <p>{detail.run.stop_reason}</p>
                      {detail.run.queries.map((q: Row, i: number) => (
                        <p key={i}>
                          {q.language} · {q.text}
                        </p>
                      ))}
                      {detail.run.mode === "import" && (
                        <div className="actions">
                          <button
                            className="secondary"
                            onClick={() =>
                              form(
                                "导入有来源的候选企业",
                                [
                                  { key: "company", label: "企业名称" },
                                  {
                                    key: "email",
                                    label: "邮箱",
                                    type: "email",
                                    required: false,
                                  },
                                  {
                                    key: "country",
                                    label: "国家",
                                    required: false,
                                  },
                                  sources(),
                                ],
                                (v) =>
                                  api(
                                    `discovery-runs/${detail.run.id}/candidates`,
                                    "POST",
                                    { ...v, entry_key: crypto.randomUUID() },
                                  ),
                              )
                            }
                          >
                            添加候选
                          </button>
                          <button
                            className="secondary"
                            onClick={() =>
                              act(async () =>
                                V({
                                  ...detail,
                                  run: await api(
                                    `discovery-runs/${detail.run.id}/${detail.run.status === "paused" ? "resume" : "pause"}`,
                                    "POST",
                                    {},
                                  ),
                                }),
                              )
                            }
                          >
                            {detail.run.status === "paused" ? "恢复" : "暂停"}
                          </button>
                          <button
                            className="secondary"
                            onClick={() =>
                              act(async () => {
                                D(await api("candidates"));
                                N("candidates");
                                V(null);
                              })
                            }
                          >
                            查看候选池
                          </button>
                        </div>
                      )}
                    </article>
                  )}
                </>
              )}
              {section === "candidates" && (
                <>
                  <h2>{detail.company}</h2>
                  <p>
                    {detail.email} · 原件 {detail.source_id}
                  </p>
                  {!detail.account_id && (
                    <button
                      onClick={() =>
                        form(
                          "将候选转入客户库",
                          [
                            select(
                              "account_id",
                              "关联已有企业（可选）",
                              "accounts",
                              false,
                            ),
                          ],
                          (v) =>
                            api(`candidates/${detail.id}/convert`, "POST", {
                              account_id: v.account_id || undefined,
                            }),
                        )
                      }
                    >
                      核实后转客户
                    </button>
                  )}
                </>
              )}
              {section === "conversations" && (
                <>
                  <h2>{detail.subject}</h2>
                  <p>人工登记 · 未同步远程邮箱 · 不按相同主题自动合并</p>
                  {detail.messages.map((v: Row) => (
                    <article
                      key={v.id}
                      className={
                        "message " + (v.direction === "draft" ? "out" : "")
                      }
                    >
                      <div>
                        <Badge value={v.status} />{" "}
                        {v.direction === "inbound"
                          ? "客户来信（人工登记）"
                          : "人工草稿"}{" "}
                        · {date(v.created_at)}
                      </div>
                      <p>{v.body}</p>
                      <small>
                        {v.classification} · 来源 {v.source_id}
                      </small>
                    </article>
                  ))}
                  <div className="actions">
                    <button
                      onClick={() =>
                        form(
                          "登记客户实际来信",
                          [
                            {
                              key: "body",
                              label: "完整原文",
                              type: "textarea",
                            },
                            {
                              key: "classification",
                              label: "人工分类",
                              options: [
                                "purchase",
                                "clarification",
                                "negotiation",
                                "complaint",
                                "unsubscribe",
                                "auto_reply",
                                "unknown",
                              ].map((value) => ({
                                value,
                                label:
                                  {
                                    purchase: "采购需求",
                                    clarification: "补充资料",
                                    negotiation: "议价",
                                    complaint: "投诉",
                                    unsubscribe: "退订",
                                    auto_reply: "自动回复",
                                    unknown: "待核实",
                                  }[value] || value,
                              })),
                            },
                          ],
                          async (v) => {
                            await api(
                              `conversations/${detail.id}/messages`,
                              "POST",
                              { ...v, event_id: crypto.randomUUID() },
                            );
                            V({
                              ...detail,
                              messages: await api(
                                `conversations/${detail.id}/messages`,
                              ),
                            });
                          },
                        )
                      }
                    >
                      登记来信
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        form(
                          "编写跟进草稿 · 不会发送",
                          [
                            {
                              key: "body",
                              label: "仅引用实际会谈与批准资料",
                              type: "textarea",
                            },
                          ],
                          async (v) => {
                            await api(
                              `conversations/${detail.id}/drafts`,
                              "POST",
                              v,
                            );
                            V({
                              ...detail,
                              messages: await api(
                                `conversations/${detail.id}/messages`,
                              ),
                            });
                          },
                        )
                      }
                    >
                      编写草稿
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        form(
                          "建立人工跟进计划",
                          [
                            {
                              key: "plan",
                              label: "计划 / 停止条件",
                              type: "textarea",
                            },
                            {
                              key: "next_check_at",
                              label: "下次检查",
                              type: "datetime-local",
                            },
                          ],
                          (v) =>
                            api("sequence-enrollments", "POST", {
                              ...v,
                              conversation_id: detail.id,
                              next_check_at: iso(v.next_check_at),
                            }),
                        )
                      }
                    >
                      新跟进计划
                    </button>
                    <button
                      className="secondary"
                      onClick={() => newRfq({ id: detail.account_id })}
                    >
                      整理询盘
                    </button>
                  </div>
                </>
              )}
              {section === "rfqs" && (
                <>
                  <h2>{detail.title}</h2>
                  <p>
                    目的地：{detail.destination || "待补充"} · 原件{" "}
                    {detail.source_id}
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>行</th>
                        <th>OE / 描述</th>
                        <th>数量 / 单位</th>
                        <th>处理状态</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map((v: Row) => (
                        <tr key={v.id}>
                          <td>{v.line_no}</td>
                          <td>
                            {v.oe || "OE待补"}
                            <small className="row-id">{v.description}</small>
                          </td>
                          <td>
                            {v.quantity || "待补"} {v.unit || "单位待补"}
                          </td>
                          <td>
                            <Badge value={v.status} />
                          </td>
                          <td>
                            <button
                              className="text"
                              onClick={() =>
                                form(
                                  "澄清询盘行",
                                  [
                                    {
                                      key: "oe",
                                      label: "OE编号",
                                      value: v.oe,
                                      required: false,
                                    },
                                    {
                                      key: "description",
                                      label: "描述",
                                      value: v.description,
                                    },
                                    {
                                      key: "quantity",
                                      label: "数量",
                                      value: v.quantity || "",
                                      type: "number",
                                      required: false,
                                    },
                                    {
                                      key: "unit",
                                      label: "单位",
                                      value: v.unit,
                                      required: false,
                                    },
                                    {
                                      key: "quality",
                                      label: "质量等级",
                                      value: v.quality,
                                      required: false,
                                    },
                                  ],
                                  async (p) => {
                                    await api(
                                      `rfqs/${detail.id}/lines/${v.id}`,
                                      "POST",
                                      { ...p, quantity: p.quantity || null },
                                    );
                                    V(await api(`rfqs/${detail.id}`));
                                  },
                                )
                              }
                            >
                              补充
                            </button>
                            <button
                              className="text"
                              onClick={() =>
                                form(
                                  "人工确认适配匹配",
                                  [
                                    select(
                                      "product_id",
                                      "已确认适配商品",
                                      "products",
                                    ),
                                  ],
                                  async (p) => {
                                    await api(
                                      `rfqs/${detail.id}/match`,
                                      "POST",
                                      { ...p, line_id: v.id },
                                    );
                                    V(await api(`rfqs/${detail.id}`));
                                  },
                                )
                              }
                            >
                              匹配
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button
                    className="secondary"
                    onClick={() =>
                      form(
                        "发起内部采购询价",
                        [
                          {
                            key: "name",
                            label: "采购任务名称",
                            value: detail.title,
                          },
                        ],
                        async (v) => {
                          const purchase = await api("purchase-rfqs", "POST", {
                            ...v,
                            rfq_id: detail.id,
                          });
                          V({ ...detail, purchase });
                        },
                      )
                    }
                  >
                    采购询价
                  </button>
                  {detail.purchase && (
                    <PurchasePanel
                      purchase={detail.purchase}
                      lines={detail.lines}
                      products={cache.products || []}
                      sources={cache.sources || []}
                      onError={E}
                    />
                  )}
                </>
              )}
              {section === "products" && (
                <>
                  <h2>
                    {detail.sku} · {detail.name}
                  </h2>
                  <p>
                    OE {detail.oe || "待补"} · {detail.unit}
                  </p>
                  <p>
                    {detail.fitment || "适配待核实"} ·{" "}
                    <Badge value={detail.fitment_status} />
                  </p>
                  <p>来源 {detail.source_id}</p>
                </>
              )}
              {section === "quotes" && (
                <>
                  <h2>报价 · {detail.id.slice(0, 8)}</h2>
                  <div className="actions">
                    <button onClick={() => quoteForm(detail)}>
                      新版本重新报价
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        act(
                          () => download(`quotes/${detail.id}/export`),
                          "已导出报价，未标记发送",
                        )
                      }
                    >
                      导出客户报价
                    </button>
                  </div>
                  {detail.revisions.map((v: Row) => (
                    <article key={v.id}>
                      <h3>
                        版本 {v.revision} · <Badge value={v.status} />
                      </h3>
                      <p>
                        {v.amount} {v.currency} · {v.incoterm} {v.place}
                      </p>
                      <p>
                        {v.payment_terms} · 有效至 {date(v.valid_until)}
                      </p>
                      <table>
                        <thead>
                          <tr>
                            <th>数量</th>
                            <th>单价</th>
                            <th>金额</th>
                          </tr>
                        </thead>
                        <tbody>
                          {v.snapshot.lines.map((l: Row, i: number) => (
                            <tr key={i}>
                              <td>{l.quantity}</td>
                              <td>{l.unit_price}</td>
                              <td>{l.amount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {v.status === "draft" && (
                        <button
                          onClick={() =>
                            form(
                              "负责人审批当前精确版本",
                              [
                                {
                                  key: "reason",
                                  label: "审批理由与已核对条件",
                                },
                              ],
                              async (p) => {
                                await api(
                                  `quotes/${detail.id}/approve`,
                                  "POST",
                                  { ...p, row_version: v.row_version },
                                );
                                V(await api(`quotes/${detail.id}`));
                              },
                            )
                          }
                        >
                          审核批准（不发送）
                        </button>
                      )}
                    </article>
                  ))}
                </>
              )}
              {section === "orders" && (
                <>
                  <h2>客户采购 {detail.purchase_reference}</h2>
                  <p>
                    订单 {detail.amount} {detail.currency} ·{" "}
                    <Badge value={detail.status} />
                  </p>
                  <div className="actions">
                    <button
                      className="secondary"
                      onClick={() =>
                        form(
                          "登记水单（不计到账）",
                          [
                            { key: "amount", label: "金额", type: "number" },
                            {
                              key: "currency",
                              label: "币种",
                              value: detail.currency,
                            },
                            sources(),
                          ],
                          async (v) => {
                            const receipt = await api("receipts", "POST", {
                              ...v,
                              account_id: detail.account_id,
                              event_key: crypto.randomUUID(),
                            });
                            V({ ...detail, receipt });
                          },
                        )
                      }
                    >
                      登记收款凭据
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        form(
                          "启用批准信用额度",
                          [
                            {
                              key: "credit_limit",
                              label: "额度",
                              type: "number",
                            },
                            {
                              key: "currency",
                              label: "币种",
                              value: detail.currency,
                            },
                            {
                              key: "valid_until",
                              label: "有效至",
                              type: "datetime-local",
                            },
                          ],
                          (v) =>
                            api(
                              `accounts/${detail.account_id}/credit-policy`,
                              "POST",
                              { ...v, valid_until: iso(v.valid_until) },
                            ),
                        )
                      }
                    >
                      设置信用政策
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        act(
                          () => api(`orders/${detail.id}/release`, "POST", {}),
                          "已原子预留信用占用",
                        )
                      }
                    >
                      信用检查与放行
                    </button>
                  </div>
                  {detail.receipt && (
                    <article>
                      <p>
                        水单 {detail.receipt.amount} {detail.receipt.currency} ·{" "}
                        <Badge value={detail.receipt.status} />
                      </p>
                      <button
                        className="secondary"
                        onClick={() =>
                          act(
                            async () =>
                              V({
                                ...detail,
                                receipt: await api(
                                  `receipts/${detail.receipt.id}/verify`,
                                  "POST",
                                  {},
                                ),
                              }),
                            "财务核实已记录",
                          )
                        }
                      >
                        财务确认实际到账
                      </button>
                      <button
                        className="secondary"
                        onClick={() =>
                          form(
                            "分配已核实款项",
                            [
                              {
                                key: "amount",
                                label: "核销金额",
                                type: "number",
                              },
                            ],
                            (v) =>
                              api(
                                `receipts/${detail.receipt.id}/allocate`,
                                "POST",
                                {
                                  ...v,
                                  order_id: detail.id,
                                  event_key: crypto.randomUUID(),
                                },
                              ),
                          )
                        }
                      >
                        核销到本订单
                      </button>
                    </article>
                  )}
                  <h3>逐行发货</h3>
                  {detail.lines.map((l: Row) => (
                    <div className="info-row" key={l.id}>
                      <div>
                        商品 {l.product_id.slice(0, 8)} · 订单 {l.quantity} ·
                        已发 {l.shipped}
                      </div>
                      <button
                        className="secondary"
                        onClick={() =>
                          form(
                            "登记实际批次发货",
                            [
                              {
                                key: "quantity",
                                label: "本次发货数量",
                                type: "number",
                              },
                              { key: "tracking", label: "物流单号 / 批次" },
                              sources(),
                            ],
                            async (v) => {
                              await api(
                                `orders/${detail.id}/shipments`,
                                "POST",
                                {
                                  ...v,
                                  line_id: l.id,
                                  event_key: crypto.randomUUID(),
                                },
                              );
                              V(await api(`orders/${detail.id}`));
                            },
                          )
                        }
                      >
                        登记发货
                      </button>
                    </div>
                  ))}
                  <h3>核销历史</h3>
                  {detail.allocations.map((v: Row) => (
                    <p key={v.id}>
                      {date(v.created_at)} · {v.amount} {detail.currency}
                    </p>
                  ))}
                </>
              )}
              {detail.jobs && (
                <>
                  {detail.jobs.map((v: Row) => (
                    <article key={v.id}>
                      <h3>
                        {v.kind} · <Badge value={v.status} />
                      </h3>
                      <p>{v.error || "暂无错误"}</p>
                      <p>
                        模型 {v.model || "未连接"} · 费用 {v.cost ?? "未知"}
                      </p>
                      {v.result && (
                        <pre>{JSON.stringify(v.result, null, 2)}</pre>
                      )}
                    </article>
                  ))}
                </>
              )}
              {section === "purchase-rfqs" && (
                <PurchasePanel
                  purchase={detail}
                  lines={detail.lines || []}
                  products={cache.products || []}
                  sources={cache.sources || []}
                  onError={E}
                />
              )}
              {section === "samples" && (
                <>
                  <h2>{detail.purpose}</h2>
                  <p>
                    数量 {detail.quantity} · <Badge value={detail.status} />
                  </p>
                  <p>{detail.feedback}</p>
                  <button
                    onClick={() =>
                      form(
                        "推进样品状态",
                        [
                          {
                            key: "status",
                            label: "下一状态",
                            options: [
                              "approved",
                              "shipped",
                              "received",
                              "validated",
                              "rejected",
                            ].map((value) => ({ value, label: L(value) })),
                          },
                          sources(),
                          {
                            key: "feedback",
                            label: "客户反馈 / 确认依据",
                            type: "textarea",
                            required: false,
                          },
                        ],
                        async (v) =>
                          V(
                            await api(`samples/${detail.id}/status`, "POST", {
                              ...v,
                              row_version: detail.row_version,
                            }),
                          ),
                      )
                    }
                  >
                    登记进度与依据
                  </button>
                </>
              )}
              {section === "aftersales" && (
                <>
                  <h2>批次 {detail.batch} · 售后</h2>
                  <article>{detail.problem}</article>
                  <p>处理方案：{detail.resolution || "待调查"}</p>
                  <p>
                    待批准赔付 / 折让：{detail.compensation}（不代表已退款）
                  </p>
                  <button
                    onClick={() =>
                      form(
                        "处理售后方案",
                        [
                          {
                            key: "resolution",
                            label: "方案",
                            type: "textarea",
                            value: detail.resolution,
                          },
                          {
                            key: "compensation",
                            label: "赔付 / 折让金额",
                            type: "number",
                            value: detail.compensation,
                          },
                          {
                            key: "customer_feedback",
                            label: "客户反馈",
                            type: "textarea",
                            required: false,
                          },
                          {
                            key: "action",
                            label: "操作",
                            options: [
                              { value: "submit", label: "提交审批" },
                              { value: "approve", label: "负责人批准" },
                              { value: "close", label: "依据反馈关闭" },
                            ],
                          },
                        ],
                        async (v) =>
                          V(
                            await api(
                              `aftersales/${detail.id}/resolve`,
                              "POST",
                              { ...v, row_version: detail.row_version },
                            ),
                          ),
                      )
                    }
                  >
                    方案审批与关闭
                  </button>
                </>
              )}
              {section === "trade-documents" && (
                <>
                  <h2>
                    {detail.kind.toUpperCase()} · v{detail.revision}
                  </h2>
                  <p>
                    模板 {detail.template_version} · 导出不代表已发送 / 合同成立
                    / 财务入账
                  </p>
                  <div className="actions">
                    {detail.status === "draft" && (
                      <button
                        onClick={() =>
                          act(async () =>
                            V(
                              await api(
                                `trade-documents/${detail.id}/approve`,
                                "POST",
                                {},
                              ),
                            ),
                          )
                        }
                      >
                        核对批准单证
                      </button>
                    )}
                    <button
                      className="secondary"
                      onClick={() =>
                        act(
                          () => download(`trade-documents/${detail.id}/export`),
                          "已导出单证，未标记发送",
                        )
                      }
                    >
                      导出单证
                    </button>
                  </div>
                  <pre>{JSON.stringify(detail.snapshot, null, 2)}</pre>
                </>
              )}
              {section === "receipts" && (
                <>
                  <h2>
                    收款凭据 {detail.amount} {detail.currency}
                  </h2>
                  <p>
                    状态：
                    <Badge value={detail.status} />
                  </p>
                  <div className="actions">
                    {detail.status === "unverified" && (
                      <button
                        onClick={() =>
                          act(async () =>
                            V(
                              await api(
                                `receipts/${detail.id}/verify`,
                                "POST",
                                {},
                              ),
                            ),
                          )
                        }
                      >
                        财务核实实际到账
                      </button>
                    )}
                    <button
                      className="secondary"
                      onClick={() =>
                        form(
                          "核销到指定订单",
                          [
                            select("order_id", "同客户同币种订单", "orders"),
                            {
                              key: "amount",
                              label: "核销金额",
                              type: "number",
                            },
                          ],
                          (v) =>
                            api(`receipts/${detail.id}/allocate`, "POST", {
                              ...v,
                              event_key: crypto.randomUUID(),
                            }),
                        )
                      }
                    >
                      核销到账
                    </button>
                  </div>
                </>
              )}
              {section === "automation-rules" && (
                <>
                  <h2>{detail.name}</h2>
                  <p>
                    {detail.enabled ? "已启用" : "已暂停"} · 每日上限{" "}
                    {detail.daily_limit} · v{detail.version}
                  </p>
                  <div className="actions">
                    <button
                      className="secondary"
                      onClick={() =>
                        act(
                          async () =>
                            V({
                              ...detail,
                              preview: await api(
                                `automation-rules/${detail.id}/preview`,
                              ),
                            }),
                          "已预览影响对象",
                        )
                      }
                    >
                      预览影响对象
                    </button>
                    <button
                      onClick={() =>
                        act(async () =>
                          V(
                            await api(
                              `automation-rules/${detail.id}/${detail.enabled ? "pause" : "enable"}`,
                              "POST",
                              {},
                            ),
                          ),
                        )
                      }
                    >
                      {detail.enabled ? "暂停规则" : "启用内部规则"}
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        act(
                          () =>
                            api(
                              `automation-rules/${detail.id}/execute`,
                              "POST",
                              {},
                            ),
                          "已执行允许的内部任务，不触发外发",
                        )
                      }
                    >
                      执行受控内部任务
                    </button>
                  </div>
                  {detail.preview && (
                    <pre>{JSON.stringify(detail.preview, null, 2)}</pre>
                  )}
                </>
              )}
              {section === "eval-datasets" && (
                <>
                  <h2>
                    {detail.name} · v{detail.revision}
                  </h2>
                  <p>
                    类型 {detail.fixture_type} · 裁定人 {detail.adjudicator}
                  </p>
                  <button
                    onClick={() =>
                      form(
                        "运行固定案例集",
                        [
                          {
                            key: "config_version",
                            label: "模型 / 知识 / 规则版本",
                          },
                          { key: "code_version", label: "代码提交 / 版本" },
                        ],
                        async (v) =>
                          V({
                            ...detail,
                            run: await api("eval-runs", "POST", {
                              ...v,
                              dataset_id: detail.id,
                            }),
                          }),
                      )
                    }
                  >
                    运行评测
                  </button>
                  <pre>{JSON.stringify(detail.cases, null, 2)}</pre>
                  {detail.run && (
                    <article>
                      <h3>
                        结果 · <Badge value={detail.run.status} />
                      </h3>
                      <pre>{JSON.stringify(detail.run.results, null, 2)}</pre>
                      <button
                        onClick={() =>
                          form(
                            "请求发布配置",
                            [
                              {
                                key: "stage",
                                label: "阶段",
                                options: ["A", "B", "C"].map((value) => ({
                                  value,
                                  label: value,
                                })),
                              },
                              {
                                key: "reason",
                                label: "放行依据（需同时检查部署回归报告）",
                              },
                            ],
                            (v) =>
                              api("release-gates", "POST", {
                                ...v,
                                eval_run_id: detail.run.id,
                              }),
                          )
                        }
                      >
                        校验配置发布门槛
                      </button>
                    </article>
                  )}
                </>
              )}
              {section === "members" && (
                <>
                  <h2>{detail.name}</h2>
                  <p>
                    {detail.email} · {L(detail.role)} ·{" "}
                    {detail.active ? "有效" : "已停用"}
                  </p>
                  {session.entities.find((v: Row) => v.id === entity)?.role ===
                    "owner" &&
                    detail.id !== session.id && (
                      <button
                        className="secondary"
                        onClick={() =>
                          form(
                            "调整公司成员角色",
                            [
                              {
                                key: "role",
                                label: "角色",
                                options: [
                                  "owner",
                                  "manager",
                                  "sales",
                                  "market",
                                  "procurement",
                                  "finance",
                                  "viewer",
                                ].map((value) => ({ value, label: L(value) })),
                                value: detail.role,
                              },
                            ],
                            async (v) => {
                              await api(`members/${detail.id}/role`, "POST", v);
                              V({ ...detail, role: v.role });
                            },
                          )
                        }
                      >
                        调整角色
                      </button>
                    )}
                  {detail.active && (
                    <button
                      className="secondary"
                      onClick={() =>
                        form(
                          "停用成员账号",
                          [{ key: "reason", label: "停用原因" }],
                          async (v) => {
                            await api(
                              `members/${detail.id}/deactivate`,
                              "POST",
                              v,
                            );
                            V(null);
                          },
                        )
                      }
                    >
                      停用账号
                    </button>
                  )}
                </>
              )}
              {section === "audit-events" && (
                <>
                  <h2>{detail.action}</h2>
                  <p>
                    {date(detail.occurred_at)} · {detail.actor_name}
                  </p>
                  <pre>{JSON.stringify(detail.detail, null, 2)}</pre>
                </>
              )}
            </section>
          )}
        </div>
        <footer className="app-footer">
          {company?.display_name || "公司工作空间"}
          {company?.subtitle ? ` · ${company.subtitle}` : ""}{" "}
          <span>北京时间 · 业务状态由服务端校验</span>
        </footer>
      </main>
      {modal}
    </div>
  );
}
function QuoteEditor({
  existing,
  cache,
  onClose,
  onSaved,
}: {
  existing?: Row;
  cache: Record<string, Row[]>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [rfqId, RFQ] = useState(existing?.rfq_id || ""),
    [rfq, R] = useState<Row | null>(null),
    [error, E] = useState(""),
    [busy, B] = useState(false);
  const [picked, P] = useState<Record<string, Row>>({});
  useEffect(() => {
    if (rfqId)
      api("rfqs/" + rfqId)
        .then(R)
        .catch((e) => E(e.message));
    P({});
  }, [rfqId]);
  const offers = (cache["supplier-responses"] || []).filter(
    (o) =>
      o.rfq_id === rfqId && o.selected && new Date(o.valid_until) > new Date(),
  );
  const contacts = (cache.contacts || []).filter(
    (c) => c.account_id === rfq?.account_id,
  );
  function field(id: string, key: string, value: string) {
    P((v) => ({ ...v, [id]: { ...v[id], [key]: value } }));
  }
  return (
    <div className="overlay">
      <section className="modal quote-editor">
        <header>
          <h2>{existing ? "修订报价 · 保留旧版" : "创建客户报价"}</h2>
          <button className="icon" onClick={onClose} aria-label="关闭">
            <X />
          </button>
        </header>
        <p>
          逐行选择已确认适配、已选定且有效的货源。价格由服务端计算，保存后仍需负责人审核。
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            E("");
            B(true);
            try {
              const d = Object.fromEntries(new FormData(e.currentTarget));
              const lines = Object.entries(picked)
                .filter(([_, v]) => v.response_id)
                .map(([_, v]) => v);
              if (!lines.length) throw new Error("请至少选择一行有效货源");
              await api(
                existing ? `quotes/${existing.id}/revisions` : "quotes",
                "POST",
                {
                  ...d,
                  rfq_id: rfqId,
                  valid_until: iso(String(d.valid_until)),
                  lines,
                },
              );
              await onSaved();
              onClose();
            } catch (e: any) {
              E(e.message);
            } finally {
              B(false);
            }
          }}
        >
          <label>
            客户采购需求
            <select
              required
              value={rfqId}
              onChange={(e) => RFQ(e.target.value)}
              disabled={Boolean(existing)}
            >
              <option value="">请选择询盘</option>
              {(cache.rfqs || []).map((v) => (
                <option value={v.id} key={v.id}>
                  {v.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            收件联系人
            <select required name="recipient_id">
              <option value="">请选择该客户的联系人</option>
              {contacts.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name} · {c.email}{" "}
                  {c.permission === "withdrawn" ? "（已退订）" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="quote-grid">
            <label>
              报价币种
              <input
                required
                name="currency"
                maxLength={3}
                placeholder="如 USD"
              />
            </label>
            <label>
              贸易条款
              <input required name="incoterm" placeholder="如 FOB / CIF" />
            </label>
            <label>
              条款地点
              <input required name="place" />
            </label>
            <label>
              有效至
              <input required name="valid_until" type="datetime-local" />
            </label>
          </div>
          <label>
            付款条件
            <input required name="payment_terms" />
          </label>
          {rfq?.lines.map((line: Row) => (
            <article key={line.id}>
              <h3>
                第 {line.line_no} 行 · {line.description} · OE{" "}
                {line.oe || "待补"}
              </h3>
              <p>
                客户数量 {line.quantity || "待补"} {line.unit} ·{" "}
                <Badge value={line.status} />
              </p>
              <label>
                供货方案
                <select
                  value={picked[line.id]?.response_id || ""}
                  onChange={(e) =>
                    P((v) => ({
                      ...v,
                      [line.id]: {
                        response_id: e.target.value,
                        quantity: line.quantity || "",
                        margin: "",
                        fx: "",
                        fx_direction: "quote_to_cost",
                        fees: "0",
                      },
                    }))
                  }
                >
                  <option value="">暂不报价此行</option>
                  {offers
                    .filter((o) => o.rfq_line_id === line.id)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.product_name} · {o.price} {o.currency} / {o.pack_qty}
                        件 · {o.quality}
                      </option>
                    ))}
                </select>
              </label>
              {picked[line.id]?.response_id && (
                <div className="quote-grid">
                  {[
                    ["quantity", "报价数量"],
                    ["margin", "目标毛利率（20%填0.2）"],
                    ["fx", "汇率数值"],
                    ["fees", "本行总分摊费用（采购币种）"],
                  ].map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        required
                        type="number"
                        step="any"
                        value={picked[line.id]?.[key] || ""}
                        onChange={(e) => field(line.id, key, e.target.value)}
                      />
                    </label>
                  ))}
                  <label>
                    汇率方向
                    <select
                      required
                      value={picked[line.id]?.fx_direction}
                      onChange={(e) =>
                        field(line.id, "fx_direction", e.target.value)
                      }
                    >
                      <option value="quote_to_cost">
                        1 报价币种 = 数值 × 采购币种
                      </option>
                      <option value="cost_to_quote">
                        1 采购币种 = 数值 × 报价币种
                      </option>
                    </select>
                  </label>
                </div>
              )}
            </article>
          ))}
          {!offers.length && (
            <p className="draft-note">
              尚无有效的已选货源。请先完成适配匹配、采购回盘和货源选择。
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button className="secondary" type="button" onClick={onClose}>
              取消
            </button>
            <button disabled={busy}>
              {busy ? "计算并保存中…" : "计算并保存报价草稿"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
function PurchasePanel({
  purchase,
  lines,
  products,
  sources,
  onError,
}: {
  purchase: Row;
  lines: Row[];
  products: Row[];
  sources: Row[];
  onError: (s: string) => void;
}) {
  const [modal, M] = useState<React.ReactNode>(null),
    [responses, R] = useState<Row[]>([]),
    [suppliers, S] = useState<Row[]>([]);
  useEffect(() => {
    api("suppliers")
      .then(S)
      .catch((e) => onError(e.message));
  }, []);
  async function load() {
    try {
      R(await api(`purchase-rfqs/${purchase.id}/comparison`));
    } catch (e: any) {
      onError(e.message);
    }
  }
  return (
    <article>
      <h3>{purchase.name} · 采购回盘</h3>
      <button
        className="secondary"
        onClick={() =>
          M(
            <Form
              title="人工登记供应商回盘"
              onClose={() => M(null)}
              fields={[
                {
                  key: "rfq_line_id",
                  label: "需求行",
                  options: lines.map((x) => ({
                    value: x.id,
                    label: `${x.line_no} ${x.description}`,
                  })),
                },
                {
                  key: "supplier_id",
                  label: "供应商",
                  options: opts(suppliers),
                },
                { key: "product_id", label: "商品", options: opts(products) },
                { key: "source_id", label: "回盘原件", options: opts(sources) },
                { key: "price", label: "采购单位价", type: "number" },
                { key: "currency", label: "币种", value: "CNY" },
                {
                  key: "pack_qty",
                  label: "每采购单位包含件数（未知留空）",
                  required: false,
                  type: "number",
                },
                { key: "unit", label: "销售单位", value: "piece" },
                { key: "quality", label: "质量等级" },
                { key: "fee_scope", label: "费用口径 / 含税与运费说明" },
                { key: "moq", label: "MOQ", type: "number", value: 1 },
                { key: "valid_until", label: "有效至", type: "datetime-local" },
              ]}
              onSubmit={async (v) => {
                await api(`purchase-rfqs/${purchase.id}/responses`, "POST", {
                  ...v,
                  pack_qty: v.pack_qty || null,
                  valid_until: iso(v.valid_until),
                });
                await load();
              }}
            />,
          )
        }
      >
        登记回盘
      </button>{" "}
      <button className="secondary" onClick={load}>
        刷新比价
      </button>
      {responses.map((v) => (
        <div className="info-row" key={v.id}>
          <div>
            {v.product_name} · {v.price} {v.currency} · 单件{" "}
            {v.normalized_unit_cost || "不可计算"}
            <small className="row-id">{v.id}</small>
            <p>
              {v.comparable ? "可比" : v.reasons.join("；")} ·{" "}
              {v.selected ? "已选货源" : ""}
            </p>
          </div>
          <button
            className="secondary"
            onClick={() =>
              M(
                <Form
                  title="选择货源（不会下单或付款）"
                  onClose={() => M(null)}
                  fields={[
                    { key: "reason", label: "选择理由（品质 / 交期 / 费用）" },
                  ]}
                  onSubmit={async (p) => {
                    await api(`supplier-responses/${v.id}/select`, "POST", p);
                    await load();
                  }}
                />,
              )
            }
          >
            选择货源
          </button>
        </div>
      ))}
      {modal}
    </article>
  );
}
function Empty({
  text,
  action,
  label,
}: {
  text: string;
  action?: () => void;
  label?: string;
}) {
  return (
    <div className="empty">
      <div>
        <Package size={28} />
      </div>
      <p>{text}</p>
      {action && (
        <button className="secondary" onClick={action}>
          {label}
        </button>
      )}
    </div>
  );
}
function Login({
  onLogin,
  company,
}: {
  onLogin: (s: Row) => void | Promise<void>;
  company?: Company;
}) {
  const [error, E] = useState(""),
    [busy, B] = useState(false);
  return (
    <div className="login">
      <div className="login-story">
        <span className="login-logo">SRR</span>
        <h1>
          各自经营，
          <br />
          共同成长。
        </h1>
        <p>属于本公司的账号、业务与工作空间。</p>
        <div>客户归公司 · 判断有依据 · 跟进有责任</div>
      </div>
      <section>
        <div className="eyebrow">SALES OPERATING SYSTEM</div>
        <h2>登录经营工作台</h2>
        <p>
          {company?.display_name ||
            (company
              ? `公司入口 ${String(company.slot).padStart(2, "0")}`
              : "使用已授权的公司账号")}
        </p>
        {company?.subtitle && (
          <p className="login-company-subtitle">{company.subtitle}</p>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            B(true);
            E("");
            const d = Object.fromEntries(new FormData(e.currentTarget));
            try {
              if (company && !company.entity_id)
                throw new Error("该公司入口尚未开通，请联系管理员。");
              await onLogin(
                await api("session", "POST", {
                  ...d,
                  ...(company?.entity_id
                    ? { entity_id: company.entity_id }
                    : {}),
                }),
              );
            } catch (e: any) {
              E(e.message);
            } finally {
              B(false);
            }
          }}
        >
          <label>
            用户名
            <input
              name="username"
              type="text"
              autoComplete="username"
              required
              placeholder="用户名或公司邮箱"
            />
          </label>
          <label>
            密码
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy}>
            {busy ? "登录中…" : "登录工作台"} <ArrowUpRight size={17} />
          </button>
        </form>
        <small>使用本公司的管理员、管理者或执行者账号登录。</small>
      </section>
    </div>
  );
}
function CaptureForm({
  fields,
  saved,
  onClose,
  onSave,
}: {
  fields: Field[];
  saved: Row;
  onClose: () => void;
  onSave: (v: Row) => Promise<void>;
}) {
  const [error, E] = useState(""),
    [file, F] = useState<File | null>(null),
    [busy, B] = useState(false);
  const renderField = (f: Field) => (
    <label key={f.key}>
      {f.label}
      {f.options ? (
        <select name={f.key} defaultValue={saved[f.key] || ""} required>
          <option value="">请选择</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : f.type === "textarea" ? (
        <textarea
          rows={4}
          name={f.key}
          defaultValue={saved[f.key]}
          required={f.required !== false}
        />
      ) : (
        <input
          name={f.key}
          type={f.type || "text"}
          defaultValue={saved[f.key]}
          required={f.required !== false}
        />
      )}
    </label>
  );
  return (
    <div className="overlay">
      <section className="modal">
        <header>
          <h2>展会现场 / 线上采集</h2>
          <button className="icon" onClick={onClose} aria-label="关闭">
            <X />
          </button>
        </header>
        <p className="draft-note">
          本机草稿不等于服务器保存。网络恢复后再提交。
        </p>
        <form
          onChange={(e) => {
            const form = e.currentTarget;
            const data = Object.fromEntries(new FormData(form));
            localStorage.setItem(
              "capture:" + entity,
              JSON.stringify({
                ...JSON.parse(
                  localStorage.getItem("capture:" + entity) || "{}",
                ),
                ...data,
                event_id: saved.event_id || crypto.randomUUID(),
              }),
            );
          }}
          onSubmit={async (e) => {
            e.preventDefault();
            B(true);
            E("");
            const data = Object.fromEntries(new FormData(e.currentTarget));
            try {
              if (
                !String(data.email || "").trim() &&
                !String(data.phone || "").trim()
              )
                throw new Error("邮箱或电话至少填写一项，方便后续跟进。");
              let source_id =
                JSON.parse(localStorage.getItem("capture:" + entity) || "{}")
                  .source_id || saved.source_id;
              if (file && !source_id) {
                const form = new FormData();
                form.append("file", file);
                const response = await fetch("/api/v1/files", {
                  method: "POST",
                  headers: { "X-Entity-Id": entity },
                  body: form,
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error.message);
                source_id = result.data.id;
                localStorage.setItem(
                  "capture:" + entity,
                  JSON.stringify({
                    ...data,
                    event_id: saved.event_id || crypto.randomUUID(),
                    source_id,
                  }),
                );
              }
              await onSave({ ...data, ...(source_id ? { source_id } : {}) });
              onClose();
            } catch (e: any) {
              E("未上传成功，已保留本机文字草稿。" + e.message);
            } finally {
              B(false);
            }
          }}
        >
          <p>
            先记下公司、邮箱或电话，以及客户原话。联系人、国家等可展开补充。
          </p>
          {fields
            .filter((f) =>
              ["activity_id", "company", "email", "phone", "notes"].includes(
                f.key,
              ),
            )
            .map(renderField)}
          <details className="more-fields">
            <summary>补充联系人、国家与联系许可</summary>
            <small>默认联系许可为待核实，不代表客户已同意联系。</small>
            {fields
              .filter(
                (f) =>
                  ![
                    "activity_id",
                    "company",
                    "email",
                    "phone",
                    "notes",
                  ].includes(f.key),
              )
              .map(renderField)}
          </details>
          <label>
            名片 / 需求原件（可选，25MB以内）
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf,text/plain,text/csv,audio/webm"
              onChange={(e) => F(e.target.files?.[0] || null)}
            />
          </label>
          <small>
            照片 / 录音不会离线缓存；提交前保留原文件。模糊内容需人工核实。
          </small>
          {error && <p className="error">{error}</p>}
          <footer>
            <button type="button" className="secondary" onClick={onClose}>
              保留未上传草稿
            </button>
            <button disabled={busy}>
              {busy ? "正在上传并保存…" : "提交到服务器"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
function PublicForm() {
  const key = location.pathname.split("/")[2],
    [info, I] = useState<Row | null>(null),
    [error, E] = useState(""),
    [done, D] = useState(false);
  const [eventId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    api("public/forms/" + key)
      .then(I)
      .catch((e) => E(e.message));
  }, []);
  return (
    <div className="public-page">
      <section className="panel">
        <span className="login-logo">SRR</span>
        <h1>Tell us what you need</h1>
        <p>{info?.name || "Auto Parts Enquiry"}</p>
        {info?.is_demo && (
          <p className="demo-banner">
            Demonstration form — fictional data only
          </p>
        )}
        {error && <p className="error">{error}</p>}
        {done ? (
          <article>
            <h2>Thank you.</h2>
            <p>
              Your enquiry was received. No order or payment has been created.
            </p>
          </article>
        ) : (
          info && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const d = Object.fromEntries(new FormData(e.currentTarget));
                try {
                  await api(`public/forms/${key}/submissions`, "POST", {
                    ...d,
                    event_id: eventId,
                    permission: d.permission === "on" ? "granted" : "unknown",
                    utm: Object.fromEntries(
                      new URLSearchParams(location.search),
                    ),
                  });
                  D(true);
                } catch (e: any) {
                  E(e.message);
                }
              }}
            >
              <label>
                Company
                <input required name="company" maxLength={200} />
              </label>
              <label>
                Country
                <input name="country" maxLength={100} />
              </label>
              <label>
                Contact name
                <input name="contact_name" maxLength={100} />
              </label>
              <label>
                Business email
                <input required type="email" name="email" />
              </label>
              <label>
                Your enquiry
                <textarea required name="notes" rows={5} maxLength={10000} />
              </label>
              <input
                className="honeypot"
                name="website_trap"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
              />
              <label className="checkbox">
                <input type="checkbox" name="permission" />
                You may contact me about this business enquiry.
              </label>
              <p className="muted">
                We use these details to review and respond to your enquiry.
                Please do not submit sensitive personal or payment information.
              </p>
              <button>Submit enquiry</button>
            </form>
          )
        )}
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  location.pathname.startsWith("/form/") ? (
    <App />
  ) : (
    <CompanyPortal
      renderCompany={(company) => (
        <App key={company.entity_id || company.slot} company={company} />
      )}
    />
  ),
);
