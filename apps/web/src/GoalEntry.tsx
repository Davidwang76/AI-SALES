import { ArrowLeft, ArrowUpRight, Target } from "lucide-react";
import type { Company } from "./CompanyPortal";
export function GoalEntry({
  companies,
  onGo,
  loading,
  error,
  onRetry,
}: {
  companies: Company[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onGo: (path: string) => void;
}) {
  return (
    <div className="portal-page">
      <header className="portal-header">
        <span className="portal-wordmark">工作与生活</span>
        <button className="text" onClick={() => onGo("/")}>
          <ArrowLeft size={16} />
          返回首页
        </button>
      </header>
      <section className="portal-intro">
        <span className="eyebrow">常用功能</span>
        <h1>季月旬目标管理</h1>
        <p>
          上级、下级、秘书共同讨论，AI起草，三方依次确认，再逐级分解与旬末复盘。
        </p>
      </section>
      <section className="panel">
        <Target size={28} />
        <h2>先选择目标所属公司</h2>
        <p>登录后进入该公司的目标工作台，各公司的目标分别保存。</p>
        {loading && <p role="status">正在加载公司入口…</p>}
        {error && (
          <div className="error" role="alert">
            {error}
            <button className="text" onClick={onRetry}>
              重新加载
            </button>
          </div>
        )}
        <div className="goal-company-list">
          {companies.map((company) => (
            <button
              key={company.slot}
              className="secondary"
              onClick={() =>
                onGo(
                  `/company/${String(company.slot).padStart(2, "0")}?tool=goals`,
                )
              }
            >
              <span>
                {String(company.slot).padStart(2, "0")} ·{" "}
                {company.display_name || "未命名公司"}
              </span>
              <ArrowUpRight size={17} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
