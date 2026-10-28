import { useState } from "react";
import { Building2, Settings } from "lucide-react";
import { api } from "./api";
type Workspace = { purpose: string; modules: string[] };
export function CompanyWorkspace({
  config,
  admin,
  options,
  onSaved,
}: {
  config: Workspace;
  admin: boolean;
  options: { key: string; label: string }[];
  onSaved: (v: Workspace) => void;
}) {
  const [editing, setEditing] = useState(false),
    [purpose, setPurpose] = useState(config.purpose),
    [picked, setPicked] = useState(config.modules),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel company-welcome">
      <Building2 size={30} />
      <h2>本公司的独立工作空间</h2>
      <p>
        {config.purpose ||
          "业务需求尚未配置。这里不会默认套用其他公司的销售流程。"}
      </p>
      {!config.modules.length && (
        <p>账号与权限可以先管理。业务模块按本公司的实际问题分别配置或开发。</p>
      )}
      {admin && !editing && (
        <button className="secondary" onClick={() => setEditing(true)}>
          <Settings size={16} />
          配置本公司工作空间
        </button>
      )}
      {editing && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const v = await api("company-workspace", "POST", {
                purpose,
                modules: picked,
              });
              onSaved(v);
              setEditing(false);
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            本公司希望解决的问题
            <textarea
              value={purpose}
              maxLength={3000}
              onChange={(e) => setPurpose(e.target.value)}
              rows={3}
              placeholder="可以先记录目标，具体流程后续按本公司单独开发。"
            />
          </label>
          <details className="more-fields">
            <summary>按需选用已有业务模块</summary>
            <p>以下是现有销售系统的能力，可不选择；不适用的公司无需启用。</p>
            <div className="module-options">
              {options.map((v) => (
                <label className="check" key={v.key}>
                  <input
                    type="checkbox"
                    checked={picked.includes(v.key)}
                    onChange={(e) =>
                      setPicked((old) =>
                        e.target.checked
                          ? [...old, v.key]
                          : old.filter((k) => k !== v.key),
                      )
                    }
                  />
                  {v.label}
                </label>
              ))}
            </div>
          </details>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <footer>
            <button
              type="button"
              className="secondary"
              onClick={() => setEditing(false)}
            >
              取消
            </button>
            <button disabled={busy}>
              {busy ? "保存中…" : "保存本公司配置"}
            </button>
          </footer>
        </form>
      )}
    </section>
  );
}
