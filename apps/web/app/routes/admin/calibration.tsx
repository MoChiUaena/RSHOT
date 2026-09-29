import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { SITE } from "@aihot/industry/site";
import type { CalibrationBatch, CalibrationBatchSummary, CalibrationCase, CalibrationDecision } from "@aihot/contracts/calibration";
import type { Route } from "./+types/calibration";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Badge, Button, Card, Empty, Select, Textarea } from "../../features/admin/ui";
import { bj } from "../../features/admin/format";

export async function loader({ request }: Route.LoaderArgs) {
  const { batches } = await adminGet<{ batches: CalibrationBatchSummary[] }>(request, "/api/admin/calibration");
  const id = new URL(request.url).searchParams.get("batch") || batches[0]?.id;
  const batch = id ? await adminGet<CalibrationBatch>(request, `/api/admin/calibration/${encodeURIComponent(id)}`) : null;
  return { batches, batch };
}
export const meta: Route.MetaFunction = () => [{ title: `精选标注 · ${SITE.name} 后台` }];
export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
const labels: Record<CalibrationDecision, string> = { select: "值得精选", reject: "不精选", either: "拿不准" };
const scopes: Record<string, string> = { abstract: "论文摘要", "article-text": "原文材料", "feed-content": "订阅内容", "feed-summary": "订阅摘要", "listing-title": "来源标题" };
const titleOf = (row: CalibrationCase) => row.titleZh || (/^v?\d+\.\d+/.test(row.title) ? `${row.sourceName.split("·")[0]!.trim()} ${row.title}` : row.title);

export default function Calibration({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  return <AdminPage title="精选偏好标注" subtitle="按你的阅读需求判断。点选后自动保存，可以回来修改；拿不准时不必勉强作答。"
    actions={loaderData.batches.length > 1 ? <Select aria-label="标注批次" value={loaderData.batch?.summary.id ?? ""} onChange={(event) => navigate(`?batch=${encodeURIComponent(event.target.value)}`)}>
      {loaderData.batches.map((b) => <option key={b.id} value={b.id}>{b.label} · {b.completed}/{b.total}</option>)}
    </Select> : undefined}>
    {loaderData.batch ? <AnnotationBatch key={loaderData.batch.summary.id} batch={loaderData.batch} /> : <Card><Empty>还没有待标注材料。准备首批样本后即可开始。</Empty></Card>}
  </AdminPage>;
}

function AnnotationBatch({ batch }: { batch: CalibrationBatch }) {
  const [cases, setCases] = useState(batch.cases);
  const [index, setIndex] = useState(() => Math.max(0, batch.cases.findIndex((r) => r.decision === null)));
  const [notes, setNotes] = useState(cases[index]?.notes ?? "");
  const { run, busy } = useAdminAction();
  useEffect(() => setCases(batch.cases), [batch]);
  const row = cases[index]!;
  useEffect(() => setNotes(row.notes), [row.caseId, row.notes]);
  const completed = cases.filter((c) => c.decision !== null).length;
  const remaining = cases.length - completed;
  async function save(decision: CalibrationDecision | null, advance = false) {
    const result = await run<CalibrationCase>("PATCH", `/api/admin/calibration/${encodeURIComponent(batch.summary.id)}/cases/${encodeURIComponent(row.caseId)}`,
      { decision, notes, version: row.version }, { success: decision ? `已保存：${labels[decision]}` : "已保存", revalidate: false });
    if (!result) return false;
    const updated = cases.map((c) => c.caseId === result.caseId ? result : c);
    setCases(updated);
    if (advance) {
      const next = updated.findIndex((c, i) => i > index && c.decision === null);
      const first = updated.findIndex((c) => c.decision === null);
      if (next >= 0 || first >= 0) { setIndex(next >= 0 ? next : first); window.scrollTo({ top: 0, behavior: "smooth" }); }
    }
    return true;
  }
  async function go(next: number) {
    if (notes !== row.notes && !(await save(row.decision))) return;
    setIndex(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  return <div className="space-y-5 pb-10">
    <Card pad={false}>
      <div className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="min-w-[200px] flex-1">
          <div className="mb-2 flex items-center justify-between gap-3 text-[13px]"><span className="font-medium text-ink">{completed} / {cases.length} 已完成</span><span className="text-ink-3">{remaining ? `剩余 ${remaining} 条` : "这一批已全部标注"}</span></div>
          <progress className="h-2 w-full accent-accent" value={completed} max={cases.length} aria-label="标注进度" />
        </div>
        <div className="flex flex-wrap items-center gap-2"><Badge>科研 {batch.summary.research}</Badge><Badge>工程 {batch.summary.engineering}</Badge>
          {completed ? <a className="rounded-control bg-ink px-3 py-2 text-[13px] font-medium text-bg" href={`/api/admin/calibration/${encodeURIComponent(batch.summary.id)}/export`}>下载已标注样本</a> : <span className="text-[12px] text-ink-4">保存判断后可下载样本</span>}
        </div>
      </div>
    </Card>
    {!remaining && <div role="status" className="rounded-panel bg-accent-soft p-4 text-[13px] text-accent">首批判断已保存。接下来用这些样本检查自动精选的错例；你仍可以逐条修改。</div>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_240px]">
      <div className="space-y-4">
        <Card pad={false}>
          <div className="space-y-4 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]"><div className="flex items-center gap-2"><Badge tone="accent">{row.focus === "research" ? "科研" : "工程"}</Badge><span className="text-ink-3">第 {index + 1} / {cases.length} 条</span></div>{row.decision && <Badge tone="ok">已保存 · {labels[row.decision]}</Badge>}</div>
            <h2 className="text-[21px] font-semibold leading-snug tracking-tight text-ink">{titleOf(row)}</h2>
            {row.titleZh && row.titleZh !== row.title && <p className="text-[13px] leading-relaxed text-ink-3">{row.title}</p>}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-ink-3"><span>{row.sourceName}</span>{row.publishedAt && <time dateTime={row.publishedAt}>{bj(row.publishedAt, true)}</time>}<a className="font-medium text-accent hover:underline" href={row.sourceUrl} target="_blank" rel="noopener noreferrer">打开原文 ↗</a></div>
            {row.guideZh && <div className="rounded-control bg-bg-sunk p-4"><div className="mb-2 text-[11px] font-medium text-ink-3">中文导读 · 助手整理，判断以来源材料为准</div><p className="whitespace-pre-wrap text-[14px] leading-7 text-ink-2">{row.guideZh}</p></div>}
            <details open={!row.guideZh} className="rounded-control border border-line p-3"><summary className="cursor-pointer text-[13px] font-medium text-ink-2">查看{scopes[row.materialScope] ?? "来源材料"}</summary><p className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-7 text-ink-2">{row.bodyOriginal || row.bodyZh || "目前只有标题，请打开原文核验。"}</p></details>
          </div>
        </Card>
        <Card>
          <label className="block text-[12.5px] text-ink-3">备注（可选）<Textarea className="mt-2" disabled={busy} value={notes} maxLength={2000} placeholder="为什么值得关注，或哪里信息不足？" onChange={(event) => setNotes(event.target.value)} /></label>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><div className="flex gap-2"><Button size="sm" disabled={busy || index === 0} onClick={() => go(index - 1)}>上一条</Button><Button size="sm" disabled={busy || index === cases.length - 1} onClick={() => go(index + 1)}>下一条</Button></div><div className="flex gap-2">{row.decision && <Button size="sm" disabled={busy} onClick={() => save(null)}>清除判断</Button>}<Button size="sm" disabled={busy || notes === row.notes} onClick={() => save(row.decision)}>保存备注</Button></div></div>
          <p className="mt-3 text-[11.5px] text-ink-4" aria-live="polite">{busy ? "正在保存，请稍候…" : notes !== row.notes ? "备注尚未保存；选择判断或切换材料时会保存。" : "判断保存在本地后台，刷新后可继续。"}</p>
        </Card>
      </div>
      <Card title="本批材料" pad={false}><div className="max-h-[680px] overflow-y-auto py-1">{cases.map((c, i) => <button key={c.caseId} disabled={busy} onClick={() => go(i)} aria-current={index === i ? "step" : undefined} className={`flex w-full items-start gap-2 border-b border-line/70 px-3 py-3 text-left text-[12px] last:border-0 ${index === i ? "bg-accent-soft" : "hover:bg-bg-sunk"}`}><span className={`mt-0.5 w-5 shrink-0 text-center font-medium ${c.decision ? "text-accent" : "text-ink-4"}`}>{c.decision ? "✓" : i + 1}</span><span className="min-w-0"><span className="line-clamp-2 leading-relaxed text-ink-2">{titleOf(c)}</span><span className="mt-1 block text-[10.5px] text-ink-4">{c.focus === "research" ? "科研" : "工程"} · {c.decision ? labels[c.decision] : "待判断"}</span></span></button>)}</div></Card>
    </div>
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 shadow-lg backdrop-blur lg:left-[216px]">
      <div className="mx-auto flex max-w-[1260px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
        <div><h3 className="text-[13px] font-semibold text-ink">第 {index + 1} 条值得进入精选吗？</h3><p className="mt-1 hidden text-[11.5px] text-ink-3 sm:block">考虑科研或工程价值；普通维护、泛泛宣传也可以不精选。</p></div>
        <div className="grid grid-cols-3 gap-2 sm:min-w-[390px]">{(["select", "reject", "either"] as const).map((decision) => <Button key={decision} disabled={busy} onClick={() => save(decision, true)} className={`min-h-11 justify-center ${row.decision === decision ? "ring-2 ring-accent" : ""}`}>{labels[decision]}</Button>)}</div>
      </div>
    </div>
  </div>;
}
