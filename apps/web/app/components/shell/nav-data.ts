// Shared by the full site and the static preview; rendering chooses React or inline SVG icons.
import { withSubject } from "@aihot/industry/site";
import { FEATURES } from "@aihot/industry/features";
export type NavIcon = "bolt" | "list" | "flame" | "doc" | "grid" | "bookmark" | "chart" | "history" | "plug" | "heart" | "message" | "apps";
export interface NavData { to: string; label: string; icon: NavIcon; end?: boolean; changelog?: boolean }
export const SIDEBAR_DATA: Array<{ title: string; items: NavData[] }> = [
  { title: "内容", items: [
    { to: "/", label: "精选", icon: "bolt", end: true },
    { to: "/all", label: `全部${withSubject("动态")}`, icon: "list" },
    { to: "/hot", label: "热点榜", icon: "flame" },
    { to: "/daily", label: withSubject("日报"), icon: "doc" },
    { to: "/topics", label: "主题", icon: "grid" },
    { to: "/starred", label: "收藏", icon: "bookmark" },
  ] },
  ...(FEATURES.leaderboard || FEATURES.codexResetMonitor ? [{ title: "模型", items: [
    ...(FEATURES.leaderboard ? [{ to: "/leaderboard", label: "模型榜", icon: "chart" as const }] : []),
    ...(FEATURES.codexResetMonitor ? [{ to: "/codex-reset", label: "Tibo重置监控", icon: "history" as const }] : []),
  ] }] : []),
  { title: "更多", items: [
    { to: "/agent", label: "Agent 接入", icon: "plug" },
    { to: "/about", label: "关于", icon: "heart" },
    { to: "/changelog", label: "更新日志", icon: "history", changelog: true },
    { to: "/feedback", label: "反馈", icon: "message" },
  ] },
];
export const TABBAR_DATA: NavData[] = [
  { to: "/", label: "精选", icon: "bolt", end: true },
  { to: "/all", label: "全部", icon: "list" },
  { to: "/daily", label: "日报", icon: "doc" },
  { to: "/more", label: "更多", icon: "apps", changelog: true },
];
