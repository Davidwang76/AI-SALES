import { useEffect, useState, useRef } from "react";
import { ChevronDown, ChevronRight, Plus, Target } from "lucide-react";
import { api } from "./api";
import {
  goalPeriodLabel,
  goalPeriodRange,
} from "../../../packages/domain/goal-periods";
type Goal = Record<string, any>;
const states: Record<string, string> = {
  planned: "待开始",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消",
};
function currentPeriod() {
  const p = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    timeZone: "Asia/Shanghai",
  }).formatToParts(new Date());
  return {
    year: Number(p.find((v) => v.type === "year")!.value),
    quarter:
      Math.floor((Number(p.find((v) => v.type === "month")!.value) - 1) / 3) +
      1,
  };
}
export function GoalsWorkspace({
  role,
  members,
  refreshKey,
}: {
  role: string;
  members: Goal[];
  refreshKey: number;
}) {
  const now = currentPeriod();
  const [year, Y] = useState(now.year),
    [quarter, Q] = useState(now.quarter),
    [goals, G] = useState<Goal[]>([]),
    [error, E] = useState(""),
    [loading, L] = useState(true),
    [editor, M] = useState<{ parent?: Goal; goal?: Goal } | null>(null),
    [busy, B] = useState(false);
  const requestId = useRef(0);
  const writable = role !== "viewer",
    manager = ["owner", "manager"].includes(role);
  async function load() {
    const id = ++requestId.current;
    L(true);
    E("");
    try {
      const rows = await api(`goals?year=${year}&quarter=${quarter}`);
      if (id === requestId.current) G(rows);
    } catch (e: any) {
      if (id === requestId.current) E(e.message);
    } finally {
      if (id === requestId.current) L(false);
    }
  }
  useEffect(() => {
    load();
    return () => {
      requestId.current++;
    };
  }, [year, quarter, refreshKey]);
  async function change(goal: Goal, status: string, note?: string) {
    B(true);
    E("");
    try {
      await api(`goals/${goal.id}/state`, "POST", {
        row_version: goal.row_version,
        status,
        ...(note === undefined ? {} : { result_note: note }),
      });
      await load();
      return true;
    } catch (e: any) {
      E(e.message);
      return false;
    } finally {
      B(false);
    }
  }
  function row(goal: Goal, parentClosed = false) {
    return (
      <GoalCard
        key={goal.id}
        goal={goal}
        childrenGoals={goals.filter((v) => v.parent_id === goal.id)}
        render={(child) =>
          row(
            child,
            parentClosed || ["completed", "cancelled"].includes(goal.status),
          )
        }
        writable={writable && !parentClosed}
        busy={busy}
        onAdd={() => M({ parent: goal })}
        onNote={() => M({ goal })}
        onState={(s) => change(goal, s)}
      />
    );
  }
  return (
    <section className="goals-workspace">
      <div className="goal-toolbar">
        <div className="goal-filters">
          <label>
            年份
            <select
              aria-label="目标年份"
              disabled={busy}
              value={year}
              onChange={(e) => Y(Number(e.target.value))}
            >
              {Array.from({ length: 201 }, (_, i) => 2000 + i).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            季度
            <select
              aria-label="目标季度"
              disabled={busy}
              value={quarter}
              onChange={(e) => Q(Number(e.target.value))}
            >
              {[1, 2, 3, 4].map((v) => (
                <option key={v} value={v}>
                  第{v}季度
                </option>
              ))}
            </select>
          </label>
        </div>
        {writable && (
          <button disabled={busy} onClick={() => M({})}>
            <Plus size={17} />
            新建季度目标
          </button>
        )}
      </div>
      <p>
        季度目标 → 月度分解 → 上中下旬执行。
        {manager
          ? "管理员和管理者可查看本公司的目标。"
          : "这里只显示分配给你的目标。"}
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
          <button className="text" onClick={load}>
            重新加载
          </button>
        </div>
      )}
      {loading ? (
        <p role="status">正在加载目标…</p>
      ) : goals.length ? (
        <div className="goal-tree">
          {goals.filter((v) => !v.parent_id).map((v) => row(v))}
        </div>
      ) : (
        !error && (
          <section className="panel goal-empty">
            <Target size={34} />
            <h2>先定下这个季度最重要的目标</h2>
            <p>只需一个目标名称，保存后再逐月、逐旬分解。</p>
            {writable && (
              <button disabled={busy} onClick={() => M({})}>
                建立第一个季度目标
              </button>
            )}
          </section>
        )
      )}
      {editor && (
        <GoalEditor
          key={editor.goal?.id || editor.parent?.id || "new"}
          editor={editor}
          year={year}
          quarter={quarter}
          members={members}
          manager={manager}
          onClose={() => M(null)}
          onSave={async (value) => {
            if (editor.goal) {
              if (
                !(await change(
                  editor.goal,
                  editor.goal.status,
                  value.result_note,
                ))
              )
                throw new Error("保存失败，请查看工作台提示后重试");
            } else {
              await api("goals", "POST", value);
              await load();
            }
            M(null);
          }}
        />
      )}
    </section>
  );
}
function GoalCard({
  goal,
  childrenGoals,
  render,
  writable,
  busy,
  onAdd,
  onNote,
  onState,
}: {
  goal: Goal;
  childrenGoals: Goal[];
  render: (goal: Goal) => React.ReactNode;
  writable: boolean;
  busy: boolean;
  onAdd: () => void;
  onNote: () => void;
  onState: (status: string) => void;
}) {
  const [open, O] = useState(true);
  const closed = ["completed", "cancelled"].includes(goal.status);
  const range = goalPeriodRange(goal as any);
  return (
    <article className={`goal-card goal-${goal.level}`}>
      <div className="goal-heading">
        <div>
          <small>
            {goalPeriodLabel(goal as any)} · {range.start}—{range.end}
          </small>
          <h2>{goal.title}</h2>
          <small>
            {goal.owner_name} · {states[goal.status]}
            {childrenGoals.length
              ? ` · 下级已结束 ${childrenGoals.filter((v) => ["completed", "cancelled"].includes(v.status)).length}/${childrenGoals.length}`
              : ""}
          </small>
        </div>
        {childrenGoals.length > 0 && (
          <button
            className="icon"
            aria-label={`${open ? "收起" : "展开"}${goal.title}的分解目标`}
            aria-expanded={open}
            onClick={() => O(!open)}
          >
            {open ? <ChevronDown /> : <ChevronRight />}
          </button>
        )}
      </div>
      {goal.result_note && <p className="goal-note">{goal.result_note}</p>}
      {writable && (
        <div className="actions goal-actions">
          {!closed && goal.level !== "ten_day" && (
            <button className="secondary" disabled={busy} onClick={onAdd}>
              <Plus size={15} />
              {goal.level === "quarter" ? "分解到月" : "分解到旬"}
            </button>
          )}
          {!closed && goal.status === "planned" && (
            <button
              className="text"
              disabled={busy}
              onClick={() => onState("in_progress")}
            >
              开始
            </button>
          )}
          {!closed && (
            <button
              className="text"
              disabled={busy}
              onClick={() => onState("completed")}
            >
              完成
            </button>
          )}
          {!closed && (
            <button className="text" disabled={busy} onClick={onNote}>
              记录进展
            </button>
          )}
          {closed ? (
            <button
              className="text"
              disabled={busy}
              onClick={() => onState("planned")}
            >
              重新打开
            </button>
          ) : (
            <button
              className="text muted"
              disabled={busy}
              onClick={() => onState("cancelled")}
            >
              取消目标
            </button>
          )}
        </div>
      )}
      {open && childrenGoals.length > 0 && (
        <div className="goal-children">{childrenGoals.map(render)}</div>
      )}
    </article>
  );
}
function GoalEditor({
  editor,
  year,
  quarter,
  members,
  manager,
  onClose,
  onSave,
}: {
  editor: { parent?: Goal; goal?: Goal };
  year: number;
  quarter: number;
  members: Goal[];
  manager: boolean;
  onClose: () => void;
  onSave: (v: Goal) => Promise<void>;
}) {
  const [error, E] = useState(""),
    [busy, B] = useState(false);
  const { parent, goal } = editor;
  return (
    <div className="overlay">
      <section className="modal">
        <header>
          <h2>
            {goal
              ? "记录目标进展"
              : parent
                ? parent.level === "quarter"
                  ? "分解为月度目标"
                  : "分解为旬目标"
                : "新建季度目标"}
          </h2>
          <button className="text" disabled={busy} onClick={onClose}>
            关闭
          </button>
        </header>
        {parent && (
          <p>
            上级：{parent.title} · {goalPeriodLabel(parent as any)} ·
            负责人沿用上级
          </p>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            B(true);
            E("");
            const d = Object.fromEntries(new FormData(e.currentTarget));
            try {
              await onSave(
                goal
                  ? { result_note: d.result_note }
                  : {
                      title: d.title,
                      ...(parent
                        ? { parent_id: parent.id }
                        : {
                            year,
                            quarter,
                            ...(d.owner_id ? { owner_id: d.owner_id } : {}),
                          }),
                      ...(d.month ? { month: Number(d.month) } : {}),
                      ...(d.ten_day ? { ten_day: Number(d.ten_day) } : {}),
                    },
              );
            } catch (e: any) {
              E(e.message);
            } finally {
              B(false);
            }
          }}
        >
          {goal ? (
            <label>
              进展或完成结果
              <textarea
                name="result_note"
                rows={4}
                maxLength={5000}
                defaultValue={goal.result_note}
              />
            </label>
          ) : (
            <>
              {!parent && (
                <p>
                  {year}年第{quarter}季度 · 可在工作台切换年份和季度
                </p>
              )}
              <label>
                目标名称
                <input
                  name="title"
                  required
                  maxLength={300}
                  autoFocus
                  placeholder="这个周期要达成什么？"
                />
              </label>
              {parent?.level === "quarter" && (
                <label>
                  目标月份
                  <select name="month" required>
                    {Array.from(
                      { length: 3 },
                      (_, i) => (parent.quarter - 1) * 3 + i + 1,
                    ).map((v) => (
                      <option key={v} value={v}>
                        {v}月
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {parent?.level === "month" && (
                <label>
                  执行旬
                  <select name="ten_day" required>
                    <option value="1">上旬（1—10日）</option>
                    <option value="2">中旬（11—20日）</option>
                    <option value="3">下旬（21日—月末）</option>
                  </select>
                </label>
              )}
              {!parent && manager && (
                <label>
                  负责人
                  <select name="owner_id">
                    <option value="">我自己</option>
                    {members
                      .filter((v) => v.active)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </>
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
            <button disabled={busy}>{busy ? "保存中…" : "保存目标"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
