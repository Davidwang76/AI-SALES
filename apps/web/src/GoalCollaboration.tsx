import { useEffect, useRef, useState } from "react";
import {
  Plus,
  MessageSquare,
  Clipboard,
  FileText,
  ArrowLeft,
  RefreshCw,
  Sparkles,
  Check,
  Upload,
} from "lucide-react";
import { api, entity } from "./api";
import {
  goalPeriodLabel,
  goalPeriodRange,
} from "../../../packages/domain/goal-periods";
import { GoalsWorkspace } from "./GoalsWorkspace";
type Row = Record<string, any>;
const voices = ["superior", "subordinate", "secretary"];
const voiceName: Row = {
  superior: "上级",
  subordinate: "下级",
  secretary: "秘书",
};
const phases: Row = {
  discussion: "三方讨论",
  drafting: "草案任务处理中",
  awaiting_superior: "待上级确认",
  awaiting_subordinate: "待下级确认",
  awaiting_secretary: "待秘书确认",
  confirmed: "三方已确认",
};
const jobError: Row = {
  MODEL_NOT_CONNECTED: "模型尚未连接",
  MODEL_PROVIDER_ERROR: "模型服务未成功响应，请检查连接后重试",
  INVALID_GOAL_EVIDENCE: "AI引用未通过原文核验，结果未采用",
  GOAL_EVIDENCE_MISSING: "AI草案缺少三方依据，结果未采用",
  WORKER_INTERRUPTED: "后台起草中断，可以重新起草",
  ACTOR_INACTIVE: "发起人账号已停用，请由有效参与人重新发起",
};
export function GoalCollaboration({
  role,
  userId,
  members,
  refreshKey,
}: {
  role: string;
  userId: string;
  members: Row[];
  refreshKey: number;
}) {
  const [plans, P] = useState<Row[]>([]),
    [selected, S] = useState(""),
    [detail, D] = useState<Row | null>(null),
    [error, E] = useState(""),
    [busy, B] = useState(false),
    [loaded, L] = useState(false),
    [modal, M] = useState<React.ReactNode>(null),
    [legacy, H] = useState(false);
  const [tab, setTab] = useState("discussion");
  useEffect(() => {
    const p = detail?.plan;
    if (p)
      setTab(
        p.workflow === "discussion"
          ? "discussion"
          : p.workflow === "confirmed" && p.level === "ten_day"
            ? "review"
            : "draft",
      );
  }, [selected, detail?.plan.workflow]);
  const generation = useRef(0);
  const canCreate = role !== "viewer";
  async function refresh(id = selected) {
    const seq = ++generation.current;
    try {
      const [list, d] = await Promise.all([
        api("goal-plans"),
        id ? api("goal-plans/" + id) : Promise.resolve(null),
      ]);
      if (seq === generation.current) {
        P(list);
        D(d);
        L(true);
      }
    } catch (e: any) {
      if (seq === generation.current) {
        E(e.message);
        L(true);
      }
    }
  }
  useEffect(() => {
    D((previous) => (previous?.plan.id === selected ? previous : null));
    E("");
    refresh(selected);
    const timer = setInterval(() => {
      if (!document.hidden) refresh(selected);
    }, 5000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [selected, refreshKey]);
  async function run(fn: () => Promise<any>) {
    B(true);
    E("");
    try {
      const result = await fn();
      await refresh();
      return result;
    } catch (e: any) {
      E(e.message);
      return null;
    } finally {
      B(false);
    }
  }
  async function create(parent?: Row) {
    B(true);
    E("");
    try {
      const latestMembers = await api("members");
      M(
        <CycleForm
          members={latestMembers}
          userId={userId}
          parent={parent}
          onClose={() => M(null)}
          onSave={async (data) => {
            const p = await api("goal-plans", "POST", data);
            M(null);
            S(p.id);
            await refresh(p.id);
          }}
        />,
      );
    } catch (e: any) {
      E(e.message);
    } finally {
      B(false);
    }
  }
  function revise() {
    if (!detail) return;
    M(
      <TextForm
        title="退回讨论 / 发起目标调整"
        label="需要调整的原因"
        onClose={() => M(null)}
        onSave={async (reason) => {
          await api(`goal-plans/${selected}/revise`, "POST", { reason });
          M(null);
          await refresh();
        }}
      />,
    );
  }
  function edit() {
    if (!detail) return;
    const rev = detail.revisions.find(
      (v: Row) => v.id === detail.plan.current_revision_id,
    );
    M(
      <TextForm
        title="修订草案（保存为新版本，三方重新确认）"
        label="目标草案"
        initial={rev?.proposal || ""}
        onClose={() => M(null)}
        onSave={async (proposal) => {
          await api(`goal-plans/${selected}/edit`, "POST", {
            revision_id: rev.id,
            proposal,
          });
          M(null);
          await refresh();
        }}
      />,
    );
  }
  if (legacy)
    return (
      <>
        <button className="text" onClick={() => H(false)}>
          <ArrowLeft size={16} />
          返回三方目标制定
        </button>
        <p>旧版目标仅供历史查询，不代表已经完成三方确认。</p>
        <GoalsWorkspace
          role={role}
          members={members}
          refreshKey={refreshKey}
          readOnly
        />
      </>
    );
  const plan = detail?.plan;
  const voice = plan ? voices.find((v) => plan[v + "_id"] === userId) : null;
  const staleParent =
    detail?.parent_issue ||
    (detail?.parent &&
      (detail.parent.workflow !== "confirmed" ||
        detail.parent.confirmed_revision_id !== plan?.parent_revision_id));
  const current = detail?.revisions.find(
    (v: Row) => v.id === plan?.current_revision_id,
  );
  const confirmed = detail?.revisions.find(
    (v: Row) => v.id === plan?.confirmed_revision_id,
  );
  const latest = detail?.revisions.at(-1);
  const shown = current || confirmed || latest;
  return (
    <div className="goal-collaboration">
      <div className="collab-intro">
        <h2>共同制定目标，再逐级确认</h2>
        <p>
          上级表达方向，下级提出可行性，秘书整理纪要与数据，AI汇总为可讨论的草案。
        </p>
        <div className="collab-steps">
          <span>01 三方留言与资料</span>
          <span>02 AI起草</span>
          <span>03 上级 → 下级 → 秘书确认</span>
          <span>04 分解与旬末复盘</span>
        </div>
      </div>
      <div className="collab-toolbar">
        {canCreate && (
          <button onClick={() => create()}>
            <Plus size={17} />
            发起季度目标讨论
          </button>
        )}
        <button className="secondary" onClick={() => refresh()}>
          <RefreshCw size={15} />
          刷新讨论
        </button>
        <button className="text" onClick={() => H(true)}>
          旧版目标（只读）
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loaded ? (
        <p role="status">正在加载目标议题…</p>
      ) : (
        <div className="collab-layout">
          <aside className="cycle-list" aria-label="目标周期议题">
            <h3>目标周期</h3>
            {!plans.length && (
              <p>
                {canCreate
                  ? "先指定三位不同的参与人，发起一次季度目标讨论。"
                  : "等待上级发起议题，并指定你参与。"}
              </p>
            )}
            {plans.map((p) => (
              <button
                key={p.id}
                className={selected === p.id ? "selected" : ""}
                onClick={() => S(p.id)}
              >
                <small>
                  {goalPeriodLabel(p as any)} · {phases[p.workflow]}
                </small>
                <b>{p.title}</b>
                <small>
                  上级 {p.superior_name} · 下级 {p.subordinate_name} · 秘书{" "}
                  {p.secretary_name}
                </small>
              </button>
            ))}
          </aside>
          <section className="cycle-detail">
            {!detail ? (
              <div className="panel">
                <MessageSquare size={34} />
                <h2>
                  {selected
                    ? "正在加载讨论…"
                    : "选择一个目标周期，查看三方讨论"}
                </h2>
                <p>
                  已确认的季度目标才能分解为月度目标，月度目标确认后再制定当月的旬目标。
                </p>
              </div>
            ) : (
              <>
                <section className="panel cycle-summary">
                  <small>
                    {goalPeriodLabel(plan as any)} ·{" "}
                    {goalPeriodRange(plan as any).start}—
                    {goalPeriodRange(plan as any).end}
                  </small>
                  <h2>{plan.title}</h2>
                  <p>
                    <b>{phases[plan.workflow]}</b> ·{" "}
                    {voice
                      ? `你在本议题中是${voiceName[voice]}`
                      : "公司管理员查看，当前未被指定为三方参与人"}
                  </p>
                  <div className="participant-grid">
                    {voices.map((v) => (
                      <div key={v}>
                        <small>{voiceName[v]}</small>
                        <b>
                          {
                            detail.participants.find(
                              (u: Row) => u.id === plan[v + "_id"],
                            )?.name
                          }
                        </b>
                        <small>
                          {
                            detail.messages.filter((m: Row) => m.voice === v)
                              .length
                          }{" "}
                          条本周期留言
                        </small>
                      </div>
                    ))}
                  </div>
                  {detail.parent && (
                    <p>
                      依据上级目标：
                      <button
                        className="text"
                        onClick={() => S(detail.parent.id)}
                      >
                        {detail.parent.title}
                      </button>{" "}
                      · 继承该已确认版本中的意见与资料
                    </p>
                  )}
                  {detail.input_changed && !staleParent && (
                    <p className="error">
                      上一旬复盘或上级依据已有更新，当前草案不能确认，请重新起草。
                    </p>
                  )}
                  {staleParent && (
                    <p className="error">
                      上级目标已调整或正在调整，请先确认上级目标，再在本议题发起调整并重新起草。
                    </p>
                  )}
                  {plan.level === "ten_day" &&
                    plan.workflow === "confirmed" &&
                    detail.days_to_end <= 3 && (
                      <p className="review-prompt">
                        {detail.days_to_end < 0
                          ? `已过旬末 ${-detail.days_to_end} 天`
                          : `距旬末 ${detail.days_to_end} 天`}
                        ，请复盘实际结果，并讨论下一旬的调整。
                      </p>
                    )}
                  <div className="actions">
                    {voice &&
                      plan.workflow === "confirmed" &&
                      plan.level !== "ten_day" &&
                      !staleParent && (
                        <button onClick={() => create(plan)}>
                          <Plus size={16} />
                          {plan.level === "quarter"
                            ? "制定月度目标"
                            : "制定当月旬目标"}
                        </button>
                      )}
                    {voice && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={revise}
                      >
                        {plan.workflow === "confirmed"
                          ? "发起目标调整"
                          : "退回讨论 / 补充调整原因"}
                      </button>
                    )}
                  </div>
                </section>
                <div className="collab-tabs" aria-label="目标制定工作区">
                  <button
                    className={tab === "discussion" ? "" : "secondary"}
                    aria-pressed={tab === "discussion"}
                    onClick={() => setTab("discussion")}
                  >
                    讨论与资料
                  </button>
                  <button
                    className={tab === "draft" ? "" : "secondary"}
                    aria-pressed={tab === "draft"}
                    onClick={() => setTab("draft")}
                  >
                    草案与确认
                  </button>
                  {plan.level === "ten_day" && (
                    <button
                      className={tab === "review" ? "" : "secondary"}
                      aria-pressed={tab === "review"}
                      onClick={() => setTab("review")}
                    >
                      旬复盘与调整
                    </button>
                  )}
                </div>
                {detail.previous_reviews?.length > 0 && (
                  <section className="panel">
                    <h3>上一旬复盘：本次调整的依据</h3>
                    {detail.previous_reviews.map((r: Row) => (
                      <article key={r.id}>
                        <p>
                          <b>实际结果：</b>
                          {r.results}
                        </p>
                        <p>
                          <b>下一旬调整：</b>
                          {r.adjustments}
                        </p>
                      </article>
                    ))}
                  </section>
                )}
                <div hidden={tab !== "discussion"}>
                  <section className="panel">
                    <h3>
                      <MessageSquare size={18} /> 三方留言板
                    </h3>
                    <div className="message-timeline">
                      {detail.messages.length ? (
                        detail.messages.map((m: Row) => (
                          <article key={m.id}>
                            <small>
                              {voiceName[m.voice]} · {m.author_name} ·{" "}
                              {new Date(m.created_at).toLocaleString("zh-CN", {
                                timeZone: "Asia/Shanghai",
                              })}
                            </small>
                            <p>{m.content}</p>
                          </article>
                        ))
                      ) : (
                        <p>
                          还没有本周期留言。上级谈方向和要求，下级谈数据、资源及可行性。
                        </p>
                      )}
                    </div>
                    {voice && (
                      <MessageComposer
                        disabled={busy}
                        voice={voiceName[voice]}
                        onSend={async (content) =>
                          Boolean(
                            await run(() =>
                              api(`goal-plans/${selected}/messages`, "POST", {
                                content,
                              }),
                            ),
                          )
                        }
                      />
                    )}
                    <small>
                      新增留言会使正在确认的草案失效，需要重新起草；已确认版本会保留，调整须另行发起。
                    </small>
                  </section>
                  <section className="panel">
                    <h3>
                      <Clipboard size={18} /> 秘书黏贴板
                    </h3>
                    <p>
                      会议纪要、数据表格和原件统一放在这里。表格可从 Excel
                      直接复制为文本，或上传 CSV。
                    </p>
                    {detail.materials.map((m: Row) => (
                      <details key={m.id} className="material-item">
                        <summary>
                          {m.title} ·{" "}
                          {m.content ? "含可读文本" : "原件已存，尚无可读文字"}
                        </summary>
                        {m.content && <pre>{m.content}</pre>}
                        <p>
                          {m.excluded
                            ? "未纳入本次AI起草"
                            : "纳入本次AI起草（有可读文本时）"}
                        </p>
                        {voice === "secretary" && (
                          <button
                            className="text"
                            disabled={busy}
                            onClick={() =>
                              run(() =>
                                api(
                                  `goal-plans/${selected}/materials/${m.id}/use`,
                                  "POST",
                                  { include: m.excluded },
                                ),
                              )
                            }
                          >
                            {m.excluded ? "纳入本次起草" : "暂不纳入起草"}
                          </button>
                        )}
                        {m.source_id && (
                          <button
                            className="text"
                            onClick={() =>
                              run(async () => {
                                const r = await fetch(
                                  `/api/v1/goal-plans/${selected}/materials/${m.id}/download`,
                                  { headers: { "X-Entity-Id": entity } },
                                );
                                if (!r.ok) throw new Error("原件下载失败");
                                const url = URL.createObjectURL(await r.blob());
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = m.title;
                                a.click();
                                setTimeout(
                                  () => URL.revokeObjectURL(url),
                                  1000,
                                );
                              })
                            }
                          >
                            下载原件
                          </button>
                        )}
                      </details>
                    ))}
                    {voice === "secretary" && (
                      <MaterialComposer
                        key={selected}
                        onSend={async (p) =>
                          Boolean(
                            await run(() =>
                              api(
                                `goal-plans/${selected}/materials`,
                                "POST",
                                p,
                              ),
                            ),
                          )
                        }
                      />
                    )}
                    {voice !== "secretary" && !detail.materials.length && (
                      <p>
                        由本议题秘书提交材料。下级周期也可沿用已确认上级目标的资料。
                      </p>
                    )}
                  </section>
                </div>
                <div hidden={tab !== "draft"}>
                  <section className="panel">
                    <h3>
                      <Sparkles size={18} /> AI草案与确认
                    </h3>
                    <p>
                      {detail.ai_configured
                        ? "模型已配置，调用结果以后台任务为准。"
                        : "AI模型尚未配置；可以先讨论和保存资料，连接模型后再起草。"}
                    </p>
                    <p>
                      起草依据：上级观点＋下级观点＋秘书可读资料；下级周期还会引用已确认的上级目标，下一旬引用上一旬复盘。
                    </p>
                    {voice && plan.workflow !== "confirmed" && (
                      <button
                        disabled={
                          busy ||
                          plan.workflow === "drafting" ||
                          Boolean(staleParent) ||
                          !detail.ai_configured
                        }
                        onClick={() =>
                          run(() =>
                            api(`goal-plans/${selected}/generate`, "POST", {}),
                          )
                        }
                      >
                        <Sparkles size={16} />
                        {plan.workflow === "drafting"
                          ? "AI正在起草…"
                          : current
                            ? "请AI重新起草"
                            : "请AI拟定目标草案"}
                      </button>
                    )}
                    {detail.jobs.at(-1)?.status === "queued" && (
                      <p>草案任务已排队，等待后台起草服务处理。</p>
                    )}
                    {detail.jobs.at(-1) &&
                      ["needs_manual", "stale"].includes(
                        detail.jobs.at(-1).status,
                      ) && (
                        <p className="error">
                          {detail.jobs.at(-1).status === "stale"
                            ? "起草期间输入有变化，旧结果未采用，请重新起草。"
                            : `AI起草未成功：${jobError[detail.jobs.at(-1).error] || "模型响应格式或连接异常，请重试"}。没有生成已确认目标。`}
                        </p>
                      )}
                    {shown && (
                      <>
                        <div className="draft-meta">
                          <b>第 {shown.revision} 版</b>
                          <span>
                            {shown.origin === "human_edit"
                              ? "AI草案经人工修订"
                              : "AI生成草案"}
                            {shown.model ? " · " + shown.model : ""}
                          </span>
                          {shown.id === plan.confirmed_revision_id && (
                            <span>已确认存档</span>
                          )}
                          {!current && plan.workflow !== "confirmed" && (
                            <span>历史版本，当前不能确认</span>
                          )}
                        </div>
                        <article className="goal-proposal">
                          {shown.proposal}
                        </article>
                        <details>
                          <summary>查看引用依据、待核实项与风险</summary>
                          {shown.evidence.map((e: Row, i: number) => {
                            const ref = shown.input_snapshot.refs.find(
                              (r: Row) => r.id === e.ref_id,
                            );
                            return (
                              <blockquote key={i}>
                                <small>{ref?.title || e.ref_id}</small>
                                <p>{e.quote}</p>
                              </blockquote>
                            );
                          })}
                          {shown.unknowns.length > 0 && (
                            <>
                              <h4>待核实 / 待决定</h4>
                              <ul>
                                {shown.unknowns.map((s: string, i: number) => (
                                  <li key={i}>{s}</li>
                                ))}
                              </ul>
                            </>
                          )}
                          {shown.risks.length > 0 && (
                            <>
                              <h4>风险与分歧</h4>
                              <ul>
                                {shown.risks.map((s: string, i: number) => (
                                  <li key={i}>{s}</li>
                                ))}
                              </ul>
                            </>
                          )}
                        </details>
                        {current &&
                          voice &&
                          plan.workflow !== "confirmed" &&
                          plan.workflow !== "drafting" && (
                            <div className="actions confirmation-actions">
                              <button
                                className="secondary"
                                disabled={
                                  busy ||
                                  Boolean(staleParent) ||
                                  detail.input_changed
                                }
                                onClick={edit}
                              >
                                修订为新版本
                              </button>
                              {plan.workflow === "awaiting_" + voice && (
                                <button
                                  disabled={
                                    busy ||
                                    Boolean(staleParent) ||
                                    detail.input_changed
                                  }
                                  onClick={() =>
                                    run(() =>
                                      api(
                                        `goal-plans/${selected}/confirm`,
                                        "POST",
                                        { revision_id: current.id, note: "" },
                                      ),
                                    )
                                  }
                                >
                                  <Check size={16} />以{voiceName[voice]}
                                  身份确认此版本
                                </button>
                              )}
                            </div>
                          )}
                      </>
                    )}
                    <div className="confirm-chain">
                      {voices.map((v) => {
                        const vote = detail.confirmations.find(
                          (c: Row) =>
                            c.revision_id === plan.current_revision_id &&
                            c.voice === v,
                        );
                        return (
                          <div key={v} className={vote ? "done" : ""}>
                            <b>{voiceName[v]}</b>
                            <small>
                              {vote
                                ? "已确认"
                                : plan.workflow === "awaiting_" + v
                                  ? "等待确认"
                                  : "尚未确认"}
                            </small>
                          </div>
                        );
                      })}
                    </div>
                    {detail.revisions.length > 1 && (
                      <details>
                        <summary>
                          历史草案与确认记录（{detail.revisions.length} 版）
                        </summary>
                        {detail.revisions.map((v: Row) => (
                          <details key={v.id}>
                            <summary>
                              第{v.revision}版 ·{" "}
                              {v.origin === "model" ? "AI草案" : "人工修订"} ·{" "}
                              {detail.confirmations
                                .filter((c: Row) => c.revision_id === v.id)
                                .map((c: Row) => voiceName[c.voice] + "已确认")
                                .join("、") || "未确认"}
                            </summary>
                            <article className="goal-proposal">
                              {v.proposal}
                            </article>
                          </details>
                        ))}
                      </details>
                    )}
                  </section>
                </div>
                <div hidden={tab !== "review"}>
                  {plan.level === "ten_day" && (
                    <section className="panel">
                      <h3>本旬复盘 → 下一旬调整与确认</h3>
                      {detail.reviews.map((r: Row) => (
                        <article key={r.id}>
                          <small>
                            {r.author_name} ·{" "}
                            {new Date(r.created_at).toLocaleString("zh-CN", {
                              timeZone: "Asia/Shanghai",
                            })}
                          </small>
                          <p>
                            <b>实际结果：</b>
                            {r.results}
                          </p>
                          <p>
                            <b>下一旬调整建议：</b>
                            {r.adjustments}
                          </p>
                        </article>
                      ))}
                      {voice &&
                      plan.workflow === "confirmed" &&
                      !staleParent ? (
                        <ReviewComposer
                          key={selected}
                          nextMonths={detail.next_months}
                          hasReview={detail.reviews.some(
                            (r: Row) =>
                              r.confirmed_revision_id ===
                              plan.confirmed_revision_id,
                          )}
                          onReview={async (p) =>
                            Boolean(
                              await run(() =>
                                api(
                                  `goal-plans/${selected}/reviews`,
                                  "POST",
                                  p,
                                ),
                              ),
                            )
                          }
                          onNext={async (next_month_plan_id) => {
                            const next = await run(() =>
                              api(`goal-plans/${selected}/next-cycle`, "POST", {
                                next_month_plan_id:
                                  next_month_plan_id || undefined,
                              }),
                            );
                            if (next) S(next.id);
                          }}
                        />
                      ) : (
                        <p>
                          本旬目标完成三方确认后，可以提交复盘和下一旬调整建议。
                        </p>
                      )}
                    </section>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {modal}
    </div>
  );
}
function MessageComposer({
  voice,
  disabled,
  onSend,
}: {
  voice: string;
  disabled: boolean;
  onSend: (s: string) => Promise<boolean>;
}) {
  const [text, T] = useState("");
  return (
    <form
      className="message-composer"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSend(text)) T("");
      }}
    >
      <label>
        以{voice}身份留言
        <textarea
          required
          disabled={disabled}
          maxLength={20000}
          rows={3}
          value={text}
          onChange={(e) => T(e.target.value)}
          placeholder="表达你的观点、约束、数据与建议…"
        />
      </label>
      <button disabled={disabled || !text.trim()}>发表观点</button>
    </form>
  );
}
function MaterialComposer({
  onSend,
}: {
  onSend: (p: Row) => Promise<boolean>;
}) {
  const [text, T] = useState(""),
    [file, F] = useState<File | null>(null),
    [source, S] = useState(""),
    [error, E] = useState(""),
    [busy, B] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  function choose(files: File[]) {
    if (busy) return;
    if (files.length !== 1) {
      E("每次提交一份原件");
      return;
    }
    if (files[0].size > 25 * 1024 * 1024) {
      E("文件不能超过25MB");
      return;
    }
    F(files[0]);
    S("");
    E("");
  }
  return (
    <form
      className="secretary-board"
      onPaste={(e) => {
        if (e.clipboardData.files.length) {
          e.preventDefault();
          choose(Array.from(e.clipboardData.files));
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        choose(Array.from(e.dataTransfer.files));
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        B(true);
        E("");
        try {
          let source_id = source;
          if (file && !source_id) {
            const form = new FormData();
            form.append("file", file);
            const r = await fetch("/api/v1/files", {
              method: "POST",
              headers: { "X-Entity-Id": entity },
              body: form,
            });
            const v = await r.json();
            if (!r.ok) throw new Error(v.error?.message || "上传失败");
            source_id = v.data.id;
            S(source_id);
          }
          if (
            await onSend({
              title:
                file?.name.slice(0, 200) ||
                text.trim().split("\n")[0].slice(0, 80) ||
                "会议纪要",
              content: text,
              source_id: source_id || undefined,
            })
          ) {
            T("");
            F(null);
            S("");
          }
        } catch (e: any) {
          E(e.message);
        } finally {
          B(false);
        }
      }}
    >
      <label>
        粘贴会议纪要、表格数据或原件补充说明
        <textarea
          rows={5}
          disabled={busy}
          maxLength={80000}
          value={text}
          onChange={(e) => T(e.target.value)}
          placeholder="直接粘贴会议纪要或从 Excel 复制的表格；也可以粘贴截图、拖入文件。"
        />
      </label>
      <input
        ref={picker}
        type="file"
        hidden
        accept="text/plain,text/csv,text/tab-separated-values,application/pdf,image/png,image/jpeg"
        onChange={(e) => {
          if (e.target.files?.length) choose(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
      <div className="actions">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => picker.current?.click()}
        >
          <Upload size={16} />
          选择原件 / 表格
        </button>
        {file && (
          <span>
            {file.name}
            <button
              type="button"
              className="text"
              disabled={busy}
              onClick={() => {
                F(null);
                S("");
              }}
            >
              移除
            </button>
          </span>
        )}
      </div>
      <small>
        CSV、文本和粘贴内容可供AI读取。PDF、照片、截图仅保存原件，尚未接通OCR；请同时补充可读文字。Excel文件请先复制表格内容或另存为CSV。
      </small>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button disabled={busy || (!file && !text.trim())}>
        {busy ? "提交中…" : "提交到秘书黏贴板"}
      </button>
    </form>
  );
}
function TextForm({
  title,
  label,
  initial = "",
  onClose,
  onSave,
}: {
  title: string;
  label: string;
  initial?: string;
  onClose: () => void;
  onSave: (s: string) => Promise<void>;
}) {
  const [text, T] = useState(initial),
    [error, E] = useState(""),
    [busy, B] = useState(false);
  return (
    <div className="overlay">
      <section className="modal">
        <header>
          <h2>{title}</h2>
        </header>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            B(true);
            E("");
            try {
              await onSave(text);
            } catch (e: any) {
              E(e.message);
            } finally {
              B(false);
            }
          }}
        >
          <label>
            {label}
            <textarea
              required
              rows={initial ? 12 : 4}
              maxLength={initial ? 50000 : 20000}
              value={text}
              onChange={(e) => T(e.target.value)}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </button>
            <button disabled={busy}>保存</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
function CycleForm({
  members,
  userId,
  parent,
  onClose,
  onSave,
}: {
  members: Row[];
  userId: string;
  parent?: Row;
  onClose: () => void;
  onSave: (p: Row) => Promise<void>;
}) {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }),
  );
  const [error, E] = useState(""),
    [busy, B] = useState(false);
  const eligible = members.filter((m) => m.active && m.role !== "viewer");
  return (
    <div className="overlay">
      <section className="modal">
        <header>
          <h2>
            {parent
              ? parent.level === "quarter"
                ? "建立月度目标讨论"
                : "建立本月旬目标讨论"
              : "发起季度目标讨论"}
          </h2>
        </header>
        <p>
          {parent
            ? "沿用上级已确认版本和三位参与人。"
            : "上级、下级、秘书是本议题的三种参与身份，必须指定三位不同同事。"}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            B(true);
            E("");
            const d = Object.fromEntries(new FormData(e.currentTarget));
            try {
              await onSave({
                title: d.title,
                ...(parent
                  ? { parent_id: parent.id }
                  : {
                      year: Number(d.year),
                      quarter: Number(d.quarter),
                      superior_id: d.superior_id,
                      subordinate_id: d.subordinate_id,
                      secretary_id: d.secretary_id,
                    }),
                ...(d.month ? { month: Number(d.month) } : {}),
                ...(d.ten_day ? { ten_day: Number(d.ten_day) } : {}),
              });
            } catch (e: any) {
              E(e.message);
            } finally {
              B(false);
            }
          }}
        >
          <label>
            讨论主题
            <input
              name="title"
              required
              maxLength={300}
              defaultValue={
                parent
                  ? parent.level === "quarter"
                    ? "月度目标制定"
                    : "旬目标制定"
                  : "季度目标制定"
              }
            />
          </label>
          {!parent && (
            <>
              <div className="quote-grid">
                <label>
                  年份
                  <input
                    name="year"
                    type="number"
                    min={2000}
                    max={2200}
                    required
                    defaultValue={now.getFullYear()}
                  />
                </label>
                <label>
                  季度
                  <select
                    name="quarter"
                    aria-label="季度"
                    defaultValue={Math.floor(now.getMonth() / 3) + 1}
                  >
                    {[1, 2, 3, 4].map((v) => (
                      <option value={v} key={v}>
                        第{v}季度
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {voices.map((v) => (
                <label key={v}>
                  {voiceName[v]}
                  <select
                    name={v + "_id"}
                    aria-label={voiceName[v]}
                    required
                    defaultValue={v === "superior" ? userId : ""}
                  >
                    <option value="">请选择同事</option>
                    {eligible
                      .filter(
                        (m) =>
                          v !== "superior" ||
                          ["owner", "manager"].includes(m.role),
                      )
                      .map((m) => (
                        <option value={m.id} key={m.id}>
                          {m.name} · {m.email}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
              {eligible.length < 3 && (
                <p className="draft-note">
                  请先在“团队与权限”建立至少三位不同的有效成员账号。
                </p>
              )}
            </>
          )}
          {parent?.level === "quarter" && (
            <label>
              目标月份
              <select name="month" aria-label="目标月份">
                {Array.from(
                  { length: 3 },
                  (_, i) => (parent.quarter - 1) * 3 + i + 1,
                ).map((v) => (
                  <option value={v} key={v}>
                    {v}月
                  </option>
                ))}
              </select>
            </label>
          )}
          {parent?.level === "month" && (
            <label>
              目标旬
              <select name="ten_day" aria-label="目标旬">
                <option value="1">上旬（1—10日）</option>
                <option value="2">中旬（11—20日）</option>
                <option value="3">下旬（21日—月末）</option>
              </select>
            </label>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </button>
            <button disabled={busy}>建立讨论</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
function ReviewComposer({
  nextMonths,
  hasReview,
  onReview,
  onNext,
}: {
  nextMonths: Row[];
  hasReview: boolean;
  onReview: (p: Row) => Promise<boolean>;
  onNext: (id: string) => Promise<void>;
}) {
  const [results, R] = useState(""),
    [adjustments, A] = useState(""),
    [next, N] = useState(""),
    [busy, B] = useState(false);
  return (
    <>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          B(true);
          try {
            if (await onReview({ results, adjustments })) {
              R("");
              A("");
            }
          } finally {
            B(false);
          }
        }}
      >
        <label>
          本旬实际结果与差距
          <textarea
            required
            rows={3}
            maxLength={20000}
            value={results}
            onChange={(e) => R(e.target.value)}
          />
        </label>
        <label>
          下一旬需要调整什么
          <textarea
            required
            rows={3}
            maxLength={20000}
            value={adjustments}
            onChange={(e) => A(e.target.value)}
          />
        </label>
        <button disabled={busy}>提交旬末复盘</button>
      </form>
      {hasReview && (
        <div className="next-cycle">
          <h4>下一旬调整</h4>
          {nextMonths.length ? (
            <>
              <label>
                下一旬所属的已确认月度目标
                <select
                  value={next || nextMonths[0].id}
                  onChange={(e) => N(e.target.value)}
                >
                  {nextMonths.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.year}年{m.month}月 · {m.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={busy}
                onClick={async () => {
                  B(true);
                  try {
                    await onNext(next || nextMonths[0].id);
                  } finally {
                    B(false);
                  }
                }}
              >
                引用复盘，建立下一旬调整讨论
              </button>
              <small>下一旬仍需AI起草并由三方依次确认，不会自动生效。</small>
            </>
          ) : (
            <p>
              下一旬所属月度目标尚未确认。请先制定并确认该月度目标，再回来建立下一旬讨论。
            </p>
          )}
        </div>
      )}
    </>
  );
}
