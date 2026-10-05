import type { ComponentType } from "react";
import type { Tab } from "../../../../sessions/web/api";

/** "terminal.bar": a strip above the Terminal view (docker's dev container controls). */
export interface TerminalBar {
  id: string;
  component: ComponentType<{ tab: Tab; onChanged: () => void; onTerm: (termId: string) => void }>;
}
