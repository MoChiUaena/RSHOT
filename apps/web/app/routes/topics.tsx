import { Link, useLoaderData } from "react-router";
import { apiGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";

interface TopicSummary {
  slug: string;
  name: string;
  group: "company" | "field" | "genre";
  definition: string;
  total: number;
  recent: number;
  indexable: boolean;
  latestAt: string | null;
}

export async function loader({ request }: { request: Request }) {
  const data = await apiGet<{ topics: TopicSummary[] }>("/api/site/topics", { signal: request.signal });
  return { ...data, showAll: new URL(request.url).searchParams.get("all") === "1" };
}

export function meta() {
  return pageMeta({ title: "主题", description: "按机构与平台、遥感方向和内容形态浏览论文、数据、卫星与工程实践。", path: "/topics", image: "/og/pages/topics.png" });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" };
}

const GROUPS = [
  { key: "company", name: "机构与平台", blurb: "追踪机构、观测计划与开源平台的进展" },
  { key: "field", name: "技术方向", blurb: "按遥感方向浏览：SAR、高光谱、LiDAR、变化检测……" },
  { key: "genre", name: "内容形态", blurb: "按内容类型浏览：论文、教程、观点、政策……" },
] as const;

export default function TopicsPage() {
  const { topics, showAll } = useLoaderData<typeof loader>();
  const visible = showAll ? topics : topics.filter((t) => t.total > 0);
  return (
    <div className="pb-10">
      <header className="pb-2 pt-5 lg:pt-1">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">按主题看遥感</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          按机构与平台、技术方向、内容形态浏览，当前 <span className="num">{topics.filter((t) => t.total > 0).length}</span> 个主题已有内容。
        </p>
        <Link to={showAll ? "/topics" : "/topics?all=1"} className="mt-3 inline-block text-[12.5px] font-medium text-accent">{showAll ? "查看已收录主题" : `查看全部 ${topics.length} 个主题（含待收录方向）`}</Link>
      </header>
      {GROUPS.filter((g) => visible.some((t) => t.group === g.key)).map((g) => (
        <section key={g.key} aria-labelledby={`topics-${g.key}`} className="pt-8">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2 id={`topics-${g.key}`} className="text-[15px] font-bold text-ink">
              {g.name}
            </h2>
            <p className="text-[12px] text-ink-4">{g.blurb}</p>
          </div>
          <ul className="mt-3.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible
              .filter((t) => t.group === g.key)
              .map((t) => (
                <li key={t.slug}>
                  <Link
                    to={`/topics/${t.slug}`}
                    prefetch="intent"
                    aria-label={`查看${t.name}相关精选文章`}
                    className="card card-hover group flex h-full flex-col px-5 py-[18px]"
                  >
                    <span className="text-[15px] font-bold text-ink transition-colors group-hover:text-accent">{t.name}</span>
                    <span className="mt-1.5 line-clamp-2 flex-1 text-[12.5px] leading-[1.7] text-ink-3">{t.definition}</span>
                    <span className="mono mt-3 text-[11.5px] text-accent">
                      {t.total ? `查看 ${t.total} 条精选` : "待收录 · 查看方向介绍"} <span className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">→</span>
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
