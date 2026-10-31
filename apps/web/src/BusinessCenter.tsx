import { useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BriefcaseBusiness,
  FileText,
  Layers3,
  LogOut,
} from "lucide-react";
import type { Company } from "./CompanyPortal";

const businessEntries = [
  {
    slug: "services",
    title: "服务介绍",
    description: "经营系统搭建 · AI+企业赋能 · 培训与咨询",
    icon: BriefcaseBusiness,
  },
  {
    slug: "products",
    title: "产品介绍",
    description: "了解服务包、软件产品与适用场景",
    icon: Layers3,
  },
  {
    slug: "quotes",
    title: "商务报价",
    description: "选择所属公司，进入独立报价工作页面",
    icon: FileText,
  },
] as const;

export function BusinessEntries() {
  return (
    <aside className="business-center" aria-labelledby="business-heading">
      <div className="portal-section-heading">
        <span className="eyebrow">商务服务</span>
        <h2 id="business-heading">商务服务中心</h2>
        <p>了解服务与产品，按需开展合作。</p>
      </div>
      <nav className="business-entry-list" aria-label="商务服务入口">
        {businessEntries.map(({ slug, title, description, icon: Icon }) => (
          <a className="business-entry" href={`/business/${slug}`} key={slug}>
            <span className="business-entry-top">
              <Icon size={24} aria-hidden="true" />
              <ArrowUpRight size={19} aria-hidden="true" />
            </span>
            <b>{title}</b>
            <span>{description}</span>
          </a>
        ))}
      </nav>
      <p className="business-note">
        服务介绍可直接浏览；内部报价须登录所属公司。
      </p>
    </aside>
  );
}

const services = [
  {
    title: "企业经营系统搭建",
    description:
      "梳理经营目标、业务流程、岗位责任与数据，连接日常工作与管理决策。",
    scope: "需求梳理、流程设计、系统实施与使用辅导。",
  },
  {
    title: "AI+企业赋能",
    description:
      "从实际业务问题出发，寻找适合引入 AI 的工作场景，逐步验证效果。",
    scope: "场景诊断、知识与流程梳理、应用方案及落地辅导。",
  },
  {
    title: "企业培训及咨询",
    description: "围绕管理、业务与 AI 应用，结合团队现状开展培训和专题咨询。",
    scope: "需求访谈、课程或咨询方案、团队研讨与后续行动建议。",
  },
];

export function BusinessPortal({
  area,
  companies,
  loading,
  error,
  onRetry,
}: {
  area: string;
  companies: Company[];
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  const entry = businessEntries.find((item) => item.slug === area)!;
  return (
    <main className="portal-page business-page">
      <header className="portal-header">
        <span className="portal-wordmark">工作与生活</span>
        <a className="business-text-link" href="/">
          <ArrowLeft size={16} aria-hidden="true" />
          返回首页
        </a>
      </header>
      <nav className="business-tabs" aria-label="商务服务导航">
        {businessEntries.map(({ slug, title }) => (
          <a
            key={slug}
            href={`/business/${slug}`}
            aria-current={area === slug ? "page" : undefined}
          >
            {title}
          </a>
        ))}
      </nav>
      <section className="portal-intro">
        <span className="eyebrow">商务服务中心</span>
        <h1>{entry.title}</h1>
        <p>
          {area === "quotes"
            ? "先选择报价所属公司，再使用现有公司账号登录。"
            : entry.description}
        </p>
      </section>
      {area === "services" ? (
        <>
          <div className="business-content-grid">
            {services.map((service) => (
              <section
                className="panel business-content-card"
                key={service.title}
              >
                <h2>{service.title}</h2>
                <p>{service.description}</p>
                <p className="muted">可咨询范围：{service.scope}</p>
                <a className="business-text-link" href="#consultation">
                  咨询此项服务
                  <ArrowUpRight size={16} aria-hidden="true" />
                </a>
              </section>
            ))}
          </div>
          <div className="business-content-grid business-content-grid-two">
            <section className="panel business-content-card">
              <h2>案例介绍</h2>
              <p>案例资料整理中，取得客户授权后发布。</p>
            </section>
            <section className="panel business-content-card" id="consultation">
              <h2>服务咨询</h2>
              <p>
                请通过你与我们的既有联系渠道，说明企业情况、希望解决的问题、时间安排与预算范围。
              </p>
              <p className="muted">
                公开咨询联系方式待补充，当前页面不收集或提交咨询资料。
              </p>
              <a className="business-text-link" href="/business/products">
                了解产品分类
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </section>
          </div>
        </>
      ) : area === "products" ? (
        <>
          <div className="business-content-grid business-content-grid-two">
            <section className="panel business-content-card">
              <Layers3 size={26} aria-hidden="true" />
              <h2>服务包</h2>
              <p>
                经营系统搭建、AI 赋能、企业培训及咨询，可根据实际需求组合服务。
              </p>
              <details>
                <summary>适用企业与交付范围</summary>
                <p>
                  适合需要梳理经营流程、探索 AI
                  应用或提升团队能力的企业。具体服务内容、参与人员、实施周期与交付成果，在需求沟通后确认。
                </p>
              </details>
            </section>
            <section className="panel business-content-card">
              <BriefcaseBusiness size={26} aria-hidden="true" />
              <h2>软件产品</h2>
              <p>面向企业经营与业务协作的软件产品分类。</p>
              <details>
                <summary>适用企业与功能范围</summary>
                <p>
                  适合希望用系统支持日常经营与团队协作的企业。具体产品、功能清单、使用条件及交付范围，将随正式产品资料发布。
                </p>
              </details>
            </section>
          </div>
          <section className="panel business-content-card">
            <h2>产品目录整理中</h2>
            <p>当前展示分类介绍，正式产品资料与价格尚未发布。</p>
            <a
              className="business-text-link"
              href="/business/services#consultation"
            >
              咨询适合的方案
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </section>
        </>
      ) : (
        <section className="panel business-content-card">
          <h2>选择报价所属公司</h2>
          <p>各公司的账号与业务权限独立。商务报价功能将分阶段开放。</p>
          {loading ? (
            <p role="status">正在加载公司入口…</p>
          ) : error ? (
            <div role="alert">
              <p>{error}</p>
              <button onClick={onRetry}>重新加载</button>
            </div>
          ) : (
            <div className="business-company-list">
              {companies.map((company) => (
                <a
                  className="business-company-link"
                  key={company.slot}
                  href={`/company/${String(company.slot).padStart(2, "0")}?tool=business-quotes`}
                >
                  <span>
                    {String(company.slot).padStart(2, "0")} ·{" "}
                    {company.display_name || "未命名公司"}
                  </span>
                  <ArrowUpRight size={17} aria-hidden="true" />
                </a>
              ))}
            </div>
          )}
        </section>
      )}
      <footer className="portal-footer">工作与生活 · 商务服务中心</footer>
    </main>
  );
}

// Rendered by App only after the existing session and company membership checks.
// This is the phase-one workspace, separate from the existing auto-parts quotes.
export function BusinessQuoteWorkspace({
  company,
  userName,
  onLogout,
}: {
  company: Company;
  userName: string;
  onLogout: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="portal-page business-page business-quote-workspace">
      <header className="portal-header">
        <span className="portal-wordmark">商务报价</span>
        <div className="business-account">
          <span>{userName}</span>
          <button
            className="text"
            disabled={busy}
            onClick={async () => {
              setError("");
              setBusy(true);
              try {
                await onLogout();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <LogOut size={16} aria-hidden="true" />
            {busy ? "正在退出…" : "退出登录"}
          </button>
        </div>
      </header>
      <section className="portal-intro">
        <span className="eyebrow">
          {company.display_name ||
            `公司 ${String(company.slot).padStart(2, "0")}`}
        </span>
        <h1>商务报价工作台</h1>
        <p>已进入本公司独立工作页面，商务报价业务功能待开放。</p>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="panel business-content-card">
        <h2>报价功能将分阶段开放</h2>
        <p>
          后续提供客户与价格管理、报价计算与审批、PDF
          报价单、客户确认及历史版本管理。
        </p>
        <p className="muted">
          当前尚不能在此创建、审批或发送商务报价。原公司业务中的报价与审批继续保留。
        </p>
        <div className="business-actions">
          <a
            className="business-text-link"
            href={`/company/${String(company.slot).padStart(2, "0")}`}
          >
            返回公司工作台
            <ArrowUpRight size={16} aria-hidden="true" />
          </a>
          <a className="business-text-link" href="/business/quotes">
            切换报价所属公司
          </a>
        </div>
      </section>
      <footer className="portal-footer">
        报价所属公司与签约主体将在正式报价业务中分别确认。
      </footer>
    </main>
  );
}
