// Slots the shell renders; other modules contribute items to them (see host/web/src/registry.ts).
import type { ComponentType } from "react";

/** "settings.sections": a block in the Settings view. */
export interface SettingsSection {
  id: string;
  /** English title, translated with t(). */
  label: string;
  order?: number;
  component: ComponentType;
}

/** "rail.footer": something small at the bottom of the rail (usage meter, today's cost). */
export interface RailItem {
  id: string;
  order?: number;
  component: ComponentType;
}

/** "shell.banners": a strip above the active view (e.g. "a new version is ready, restart to load it"). */
export interface BannerItem {
  id: string;
  component: ComponentType;
}

/** "shell.overlays": always mounted (dialogs a module opens from anywhere, notification watchers). */
export interface OverlayItem {
  id: string;
  component: ComponentType;
}
