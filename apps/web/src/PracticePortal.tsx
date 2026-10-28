import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Brain,
  Heart,
  MessageCircle,
  ShieldCheck,
  Target,
  Users,
  UserRound,
  type LucideIcon,
} from "lucide-react";

type Entry = {
  slug: string;
  title: string;
  description: string;
  icon: LucideIcon;
};
const personal: Entry[] = [
  {
    slug: "management",
    title: "管理",
    description: "管理修炼",
    icon: Users,
  },
  {
    slug: "skills",
    title: "技能",
    description: "技能修炼",
    icon: BookOpen,
  },
  {
    slug: "communication",
    title: "沟通",
    description: "沟通修炼",
    icon: MessageCircle,
  },
  {
    slug: "goals",
    title: "目标",
    description: "目标修炼",
    icon: Target,
  },
];
const dimensions: Entry[] = [
  { slug: "eq", title: "EQ", description: "家庭修炼 · EQ", icon: Heart },
  { slug: "iq", title: "IQ", description: "家庭修炼 · IQ", icon: Brain },
  { slug: "rq", title: "RQ", description: "家庭修炼 · RQ", icon: ShieldCheck },
];
const family: Entry[] = [
  { slug: "6q", title: "6Q教育", description: "查看各维度入口", icon: Users },
  ...dimensions,
];
export function PracticePortal({
  path,
  onGo,
}: {
  path: string;
  onGo: (path: string) => void;
}) {
  const parts = path.split("/").filter(Boolean);
  const area = parts[1];
  const isPersonal = area === "personal",
    isFamily = area === "family";
  const category = isPersonal ? "个人修炼" : "家庭修炼";
  const root = area === undefined;
  const topic = (isPersonal ? personal : family).find(
    (v) => v.slug === parts[2],
  );
  const isOverview = isFamily && topic?.slug === "6q";
  const known =
    root ||
    ((isPersonal || isFamily) && parts.length === 2) ||
    Boolean(topic && parts.length === 3);
  const title = !known
    ? "这个栏目还没有建立"
    : root
      ? "个人修炼＋家庭修炼"
      : topic?.title || category;
  function cards(entries: Entry[], base: string) {
    return (
      <div className="practice-grid">
        {entries.map(({ slug, title, description, icon: Icon }) => (
          <button
            className="practice-entry"
            key={slug}
            onClick={() => onGo(base + "/" + slug)}
          >
            <Icon size={27} />
            <span>
              <b>{title}</b>
              <small>{description}</small>
            </span>
            <ArrowUpRight size={21} />
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="portal-page practice-page">
      <header className="portal-header">
        <span className="portal-wordmark">工作与生活</span>
        <button className="text" onClick={() => onGo("/")}>
          返回首页
        </button>
      </header>
      <nav className="practice-breadcrumb" aria-label="修炼路径">
        <button className="text" onClick={() => onGo("/practice")}>
          个人与家庭
        </button>
        {(isPersonal || isFamily) && (
          <>
            <span>/</span>
            <button className="text" onClick={() => onGo("/practice/" + area)}>
              {category}
            </button>
          </>
        )}
        {topic && (
          <>
            <span>/</span>
            <span aria-current="page">{topic.title}</span>
          </>
        )}
      </nav>
      <section className="portal-intro">
        <span className="eyebrow">
          {isPersonal
            ? "Human 3.0 L3个人进化系统"
            : isFamily
              ? "家庭共修"
              : "成长空间"}
        </span>
        <h1>{title}</h1>
        <p>
          {root
            ? "先选择修炼方向，再进入具体栏目。"
            : isPersonal && !topic
              ? "管理、技能、沟通、目标，分别进入。"
              : isFamily && !topic
                ? "从6Q教育总入口，或直接进入具体维度。"
                : isOverview
                  ? "目前先列出 EQ、IQ、RQ；其余维度待补充。"
                  : ""}
        </p>
      </section>
      {!known ? (
        <button className="secondary" onClick={() => onGo("/practice")}>
          <ArrowLeft size={17} />
          返回修炼入口
        </button>
      ) : root ? (
        cards(
          [
            {
              slug: "personal",
              title: "个人修炼入口",
              description: "管理 · 技能 · 沟通 · 目标",
              icon: UserRound,
            },
            {
              slug: "family",
              title: "家庭修炼入口",
              description: "6Q教育 · EQ · IQ · RQ",
              icon: Heart,
            },
          ],
          "/practice",
        )
      ) : !topic ? (
        cards(isPersonal ? personal : family, "/practice/" + area)
      ) : isOverview ? (
        <>
          {cards(dimensions, "/practice/family")}
          <p className="practice-pending">
            6Q的完整维度与定义待补充，先保留已明确的三个入口。
          </p>
        </>
      ) : (
        <section className="panel practice-content">
          <topic.icon size={32} />
          <h2>{topic.title}修炼</h2>
          <p>
            {isPersonal
              ? "栏目已建立，具体内容待接入 Human 3.0 L3个人进化系统。"
              : "栏目已建立，具体定义、教育内容与练习待补充。"}
          </p>
          <button
            className="secondary"
            onClick={() => onGo("/practice/" + area)}
          >
            <ArrowLeft size={16} />
            返回{category}
          </button>
        </section>
      )}
      <footer className="portal-footer">
        当前为栏目导航，尚未接入修炼内容与个人、家庭数据。
      </footer>
    </div>
  );
}
