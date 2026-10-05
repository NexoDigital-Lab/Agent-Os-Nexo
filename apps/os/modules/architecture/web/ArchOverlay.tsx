// "tab.overlay": the floating Architect over the Architecture and Editor views of a project tab. Above the editor's
// bottom panel, and the files it names open in the Editor.
import type { TabViewProps } from "../../sessions/web/slots";
import { openInEditor, usePanelHeight } from "../../editor/web/bus";
import { ArchAssistant } from "./ArchAssistant";

export function ArchOverlay(props: TabViewProps & { view: string }) {
  const { tab, view } = props;
  const panelH = usePanelHeight(tab.id);
  if (!tab.project || (view !== "arch" && view !== "editor")) return null;
  return <ArchAssistant key={tab.id} tab={tab} lift={view === "editor" ? panelH : 0} onOpenFile={(path, line) => openInEditor(props, path, line)} />;
}
