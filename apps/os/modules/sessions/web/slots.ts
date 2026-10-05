// Slots of a session tab. Other modules contribute items; sessions renders them.
import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { Ev, Tab } from "./api";
import type { TabStream } from "./chat/useTabStream";

/** What a tab view gets: its tab and a way to move to another view or prefill the chat. */
export interface TabViewProps {
  tab: Tab;
  /** Switch this tab to another view ("chat", "editor"…). */
  go: (view: string) => void;
  /** Put text in the chat composer and switch to the chat. */
  draft: (text: string) => void;
  /** Free-form hand-off between views of the same tab (e.g. "practice this task", "open this file"). */
  handoff: Handoff;
}

/** A per-tab mailbox views use to pass work along: the sender sets it and switches view, the receiver takes it. */
export interface Handoff {
  take: <T>(key: string) => T | undefined;
  give: (key: string, value: unknown) => void;
}

/** "tab.views": a view of a tab next to the chat (editor, terminal, git, architecture). */
export interface TabViewDef {
  id: string;
  label: string;
  icon: LucideIcon;
  order?: number;
  component: ComponentType<TabViewProps>;
  /** Only for some tabs (e.g. not for SSH consoles). */
  when?: (tab: Tab) => boolean;
}

export interface SidePanelProps {
  tab: Tab;
  stream: TabStream;
}

/** "tab.side": a panel in the chat's right column (agents, changes, review, commits…). */
export interface TabSideDef {
  id: string;
  label: string;
  order?: number;
  component: ComponentType<SidePanelProps>;
  /** A small number on the panel's button (e.g. pending review comments). */
  useBadge?: (tab: Tab, stream: TabStream) => number | null;
  when?: (tab: Tab) => boolean;
}

/** "tab.sideReplace": a module that owns the whole right column for some tabs (the SSH console). */
export interface TabSideReplacement {
  id: string;
  when: (tab: Tab) => boolean;
  component: ComponentType<SidePanelProps>;
  /** Hide the view switcher (chat only) for these tabs. */
  chatOnly?: boolean;
  /** Short label shown instead of the view switcher. */
  label?: (tab: Tab) => string;
}

/** "tab.overlay": floats over some views of a tab (the architecture assistant). */
export interface TabOverlayDef {
  id: string;
  component: ComponentType<TabViewProps & { view: string }>;
}

/** "chat.events": renders a module's events in the chat ({ kind: "module", module, type }). */
export interface ChatEventRenderer {
  module: string;
  type: string;
  component: ComponentType<{ tab: Tab; ev: Extract<Ev, { kind: "module" }> }>;
}

/** "composer.actions": an extra button next to Send for some work modes (e.g. Practice this). */
export interface ComposerAction {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Shown only in this work mode. */
  workMode?: string;
  primary?: boolean;
  run: (props: TabViewProps, prompt: string) => void;
}

/** "tab.badges": small marks on a tab in the tab bar (e.g. ssh's key and "the agent sees the console"). */
export interface TabBadge {
  id: string;
  component: ComponentType<{ tab: Tab }>;
}
