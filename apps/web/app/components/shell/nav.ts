// Site navigation, one place for the desktop sidebar, the mobile tab bar and the mobile "更多" page.
import { SIDEBAR_DATA, TABBAR_DATA, type NavIcon } from "./nav-data";
import type { ReactNode } from "react";
import {
  IconApps, IconBolt, IconBookmark, IconChart, IconDoc, IconFlame, IconGrid, IconHeart, IconHistory, IconList, IconMessage, IconPlug,
} from "../icons";

export interface NavItem {
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  /** Match the path exactly (the home page). */
  end?: boolean;
  /** Shows the unread dot while the changelog has news. */
  changelog?: boolean;
}

const icons: Record<NavIcon, NavItem["icon"]> = { bolt: IconBolt, list: IconList, flame: IconFlame, doc: IconDoc,
  grid: IconGrid, bookmark: IconBookmark, chart: IconChart, history: IconHistory, plug: IconPlug,
  heart: IconHeart, message: IconMessage, apps: IconApps };
export const SIDEBAR: Array<{ title: string; items: NavItem[] }> = SIDEBAR_DATA.map((section) => ({ ...section,
  items: section.items.map((item) => ({ ...item, icon: icons[item.icon] })) }));
export const TABBAR: NavItem[] = TABBAR_DATA.map((item) => ({ ...item, icon: icons[item.icon] }));

/** Pages reached from the mobile "更多" tab keep that tab highlighted. */
export const MORE_PATHS = ["/more", "/hot", "/topics", "/starred", "/leaderboard", "/codex-reset", "/agent", "/about", "/changelog", "/feedback", "/terms", "/privacy"];

export function tabIsActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.to;
  if (item.to === "/more") return MORE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (item.to === "/daily") return /^\/(daily|weekly|monthly)(\/|$)/.test(pathname);
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
