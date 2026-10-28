import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, Building2, Heart, ArrowLeft } from "lucide-react";
import { api } from "./api";
import { PracticePortal } from "./PracticePortal";
export type Company = {
  slot: number;
  display_name: string;
  subtitle: string;
  entity_id: string | null;
};
export function CompanyPortal({
  renderCompany,
}: {
  renderCompany: (company: Company) => ReactNode;
}) {
  const [entries, setEntries] = useState<Company[]>([]);
  const [path, setPath] = useState(location.pathname);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    setError("");
    try {
      setEntries(await api("public/company-portals"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    const back = () => setPath(location.pathname);
    addEventListener("popstate", back);
    return () => removeEventListener("popstate", back);
  }, []);
  function go(next: string) {
    history.pushState({}, "", next);
    setPath(next);
  }
  const match = path.match(/^\/company\/(\d{2})$/);
  const company = match
    ? entries.find((v) => v.slot === Number(match[1]))
    : undefined;
  if (company)
    return (
      <>
        <a
          className="portal-back"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            go("/");
          }}
        >
          <ArrowLeft size={16} />
          返回公司选择
        </a>
        {renderCompany(company)}
      </>
    );
  if (path === "/practice" || path.startsWith("/practice/"))
    return <PracticePortal path={path} onGo={go} />;
  return (
    <div className="portal-page">
      <header className="portal-header">
        <span className="portal-wordmark">工作与生活</span>
        <span>公司经营 · 个人成长 · 家庭共修</span>
      </header>
      <section className="portal-intro">
        <span className="eyebrow">从这里开始</span>
        <h1>选择你的公司</h1>
        <p>进入所属公司，再使用用户名和密码登录。</p>
      </section>
      {loading ? (
        <p role="status">正在加载公司入口…</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <button onClick={load}>重新加载</button>
        </div>
      ) : (
        <div className="company-grid" aria-label="公司入口">
          {entries.map((v) => (
            <button
              className="company-card"
              key={v.slot}
              aria-label={`公司入口${String(v.slot).padStart(2, "0")}${v.display_name ? " · " + v.display_name : ""}`}
              onClick={() => go(`/company/${String(v.slot).padStart(2, "0")}`)}
            >
              <span className="company-card-top">
                <Building2 size={24} />
                <span>{String(v.slot).padStart(2, "0")}</span>
              </span>
              <span className="company-name">
                {v.display_name || <span aria-hidden="true">&nbsp;</span>}
              </span>
              <span className="company-subtitle">
                {v.subtitle || <span aria-hidden="true">&nbsp;</span>}
              </span>
              <span className="company-card-bottom">
                进入公司
                <ArrowUpRight size={19} />
              </span>
            </button>
          ))}
        </div>
      )}
      <button className="practice-card" onClick={() => go("/practice")}>
        <span className="practice-icon">
          <Heart size={26} />
        </span>
        <span>
          <b>个人修炼＋家庭修炼</b>
          <small>留一点时间，给自己和家人</small>
        </span>
        <ArrowUpRight size={22} />
      </button>
      <footer className="portal-footer">
        请选择自己所属的公司 · 各公司账号与业务权限独立
      </footer>
    </div>
  );
}
