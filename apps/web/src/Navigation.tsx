import { useEffect, useState } from "react";
import { ChevronRight, Search, X, type LucideIcon } from "lucide-react";

type Item = readonly [string, string, LucideIcon];
const groups = [
  {
    name: "日常工作",
    keys: [
      "goals",
      "sources",
      "tasks",
      "leads",
      "accounts",
      "conversations",
      "rfqs",
    ],
  },
  { name: "获客与推广", keys: ["activities", "market-tasks", "knowledge"] },
  {
    name: "交易与履约",
    keys: [
      "products",
      "quotes",
      "purchase-rfqs",
      "orders",
      "samples",
      "trade-documents",
      "receipts",
      "aftersales",
    ],
  },
  {
    name: "团队与设置",
    keys: [
      "members",
      "integrations",
      "audit-events",
      "automation-rules",
      "eval-datasets",
    ],
  },
];
const aliases: Record<string, string> = {
  goals: "季度 月度 旬 目标 计划 执行 分解",
  sources: "拍照 截图 粘贴 原文 采集 资料箱 文件 上传",
  tasks: "待办 跟进 工时",
  leads: "采集 名片 录入",
  accounts: "客户 企业 联系人",
  conversations: "邮件 邮箱 沟通",
  rfqs: "询价 需求",
  activities: "展会 活动 宣传 表单 留资",
  "market-tasks": "市场 开发",
  knowledge: "资料 知识库",
  products: "商品 产品 供应商",
  quotes: "报价 审批",
  "purchase-rfqs": "采购 询价 供应商",
  orders: "订单 发货 回款",
  samples: "样品",
  "trade-documents": "单证 合同",
  receipts: "财务 收款 核销",
  aftersales: "售后 退货",
  members: "员工 账号 权限 角色 成员",
  integrations: "模型 AI 连接 配置",
  "audit-events": "日志 审计 操作记录",
  "automation-rules": "自动化 规则",
  "eval-datasets": "质量 测试 发布",
};
export function Navigation({
  items,
  section,
  onGo,
}: {
  items: readonly Item[];
  section: string;
  onGo: (key: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string[]>(["日常工作"]);
  useEffect(() => {
    const group = groups.find((g) => g.keys.includes(section));
    if (group)
      setExpanded((v) => (v.includes(group.name) ? v : [...v, group.name]));
  }, [section]);
  const term = query.trim().toLowerCase();
  function entry([key, label, Icon]: Item) {
    return (
      <button
        key={key}
        className={section === key ? "active" : ""}
        aria-current={section === key ? "page" : undefined}
        onClick={() => {
          setQuery("");
          onGo(key);
        }}
      >
        <Icon size={18} />
        {label}
        {section === key && <span className="nav-dot" />}
      </button>
    );
  }
  const found = items.filter(([key, label]) =>
    `${label} ${aliases[key] || ""}`.toLowerCase().includes(term),
  );
  return (
    <nav aria-label="功能导航">
      <div className="nav-search">
        <Search size={16} />
        <input
          aria-label="找功能"
          placeholder="找功能，如员工、收款"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button aria-label="清除功能搜索" onClick={() => setQuery("")}>
            <X size={15} />
          </button>
        )}
      </div>
      {term ? (
        <div className="nav-results">
          <small role="status">找到 {found.length} 个功能</small>
          {found.map(entry)}
          {!found.length && <p>换个词试试，如客户、采购、员工。</p>}
        </div>
      ) : (
        <>
          {items.filter(([key]) => key === "home").map(entry)}
          {groups
            .filter((group) =>
              group.keys.some((key) => items.some((item) => item[0] === key)),
            )
            .map((group) => (
              <div className="nav-group" key={group.name}>
                <button
                  className="nav-group-toggle"
                  aria-label={group.name}
                  aria-expanded={expanded.includes(group.name)}
                  aria-controls={`nav-${group.keys[0]}`}
                  onClick={() =>
                    setExpanded((v) =>
                      v.includes(group.name)
                        ? v.filter((n) => n !== group.name)
                        : [...v, group.name],
                    )
                  }
                >
                  <ChevronRight
                    size={15}
                    className={expanded.includes(group.name) ? "expanded" : ""}
                  />
                  {group.name}
                  <small>
                    {
                      group.keys.filter((key) =>
                        items.some((item) => item[0] === key),
                      ).length
                    }
                  </small>
                </button>
                <div
                  id={`nav-${group.keys[0]}`}
                  hidden={!expanded.includes(group.name)}
                >
                  {group.keys
                    .map((key) => items.find((item) => item[0] === key))
                    .filter((item): item is Item => Boolean(item))
                    .map(entry)}
                </div>
              </div>
            ))}
        </>
      )}
    </nav>
  );
}
