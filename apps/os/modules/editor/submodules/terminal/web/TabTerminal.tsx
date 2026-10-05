// The tab's Terminal view: the editor's bottom panel at full height. Same server-side terminals as the editor
// (switching views doesn't kill them). Other modules can add a bar on top ("terminal.bar"): docker shows the
// project's dev container there.
import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "@os/lib/http";
import { slot } from "@os/registry";
import type { TabViewProps } from "../../../../sessions/web/slots";
import { Panel, type ContainerInfo, type PanelApi, type PanelView } from "../../../web/Panel";
import type { TerminalBar } from "./slots";

export function TabTerminal({ tab }: TabViewProps) {
  const [view, setView] = useState<PanelView>("terms");
  const [container, setContainer] = useState<ContainerInfo | null>(null);
  const [focusTerm, setFocusTerm] = useState<string>();
  const apiRef = useRef<PanelApi | null>(null);
  const bars = slot<TerminalBar>("terminal.bar");
  const latest = useRef(tab.id); // a slow response for the previous tab must not overwrite this one
  latest.current = tab.id;

  const reload = useCallback(() => {
    const id = tab.id;
    return call<ContainerInfo>("GET", `/api/tabs/${id}/devenv`).then(
      (d) => void (latest.current === id && setContainer(d)),
      () => void (latest.current === id && setContainer(null)),
    );
  }, [tab.id]);
  useEffect(() => void reload(), [reload]);

  return (
    <div className="dk-termwrap">
      {bars.map((b) => <b.component key={b.id} tab={tab} onChanged={reload} onTerm={setFocusTerm} />)}
      <Panel tab={tab} view={view} setView={setView} apiRef={apiRef} devenv={container} focusTerm={focusTerm} />
    </div>
  );
}
