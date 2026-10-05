// One tab: the chat (an AI session) plus the views other modules add (editor, terminal, git, architecture).
// SSH-style tabs can take over the right column and hide the view switcher.
import { MessageSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { t } from "@os/i18n";
import { slot } from "@os/registry";
import type { Skill, Tab } from "./api";
import { ChatLog } from "./chat/ChatLog";
import { ChatSide } from "./chat/ChatSide";
import { Composer } from "./chat/Composer";
import { useTabStream } from "./chat/useTabStream";
import type { TabOverlayDef, TabSideReplacement, TabViewDef, TabViewProps } from "./slots";
import { handoffFor } from "./tabs/handoff";
import { takeDraft, useTabs } from "./tabs/store";

export function TabView({ tab, skills, openFeature, initialView }: { tab: Tab; skills: Skill[]; openFeature: string | null; initialView?: string }) {
  const views = slot<TabViewDef>("tab.views")
    .filter((v) => !v.when || v.when(tab))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  const replace = slot<TabSideReplacement>("tab.sideReplace").find((r) => r.when(tab));
  const overlays = slot<TabOverlayDef>("tab.overlay");
  const [view, setView] = useState(initialView && views.some((v) => v.id === initialView) ? initialView : "chat");
  const [prompt, setPrompt] = useState("");
  const stream = useTabStream(tab.id);
  const { tabs } = useTabs(); // re-render when a draft arrives (draftTo refreshes the store)

  useEffect(() => {
    const d = takeDraft(tab.id);
    if (!d) return;
    setPrompt((p) => (p.trim() && p !== d ? `${p}\n\n${d}` : d));
    setView("chat"); // a draft is meant to be read and sent from the chat
  }, [tab.id, tabs]);

  const props: TabViewProps = useMemo(
    () => ({
      tab,
      go: setView,
      draft: (text: string) => {
        setPrompt((p) => (p.trim() ? `${p}\n\n${text}` : text));
        setView("chat");
      },
      handoff: handoffFor(tab.id),
    }),
    [tab],
  );
  const Active = views.find((v) => v.id === view)?.component;
  const Side = replace?.component;

  return (
    <div className="tabwrap">
      <div className="viewbar">
        {replace?.chatOnly ? (
          <span className="faint mono" style={{ fontSize: 12 }}>{replace.label?.(tab) ?? tab.title}</span>
        ) : (
          <>
            <div className="seg" role="tablist" aria-label={t("Tab views")}>
              <button role="tab" aria-selected={view === "chat"} className={view === "chat" ? "on" : ""} onClick={() => setView("chat")}><MessageSquare size={16} /> {t("Chat")}</button>
              {views.map((v) => (
                <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? "on" : ""} onClick={() => setView(v.id)}>
                  <v.icon size={16} /> {t(v.label)}
                </button>
              ))}
            </div>
            <span className="faint mono" style={{ fontSize: 12 }}>
              {tab.project}
              {tab.worktree ? ` ↳ worktree ${tab.worktree}` : ""}
            </span>
          </>
        )}
      </div>
      {view !== "chat" && Active ? (
        <Active {...props} />
      ) : (
        <div className={`tabview${Side ? " ssh" : ""}`}>
          <section className="chat">
            <ChatLog tab={tab} stream={stream} />
            <Composer tab={tab} skills={skills} running={stream.running} prompt={prompt} setPrompt={setPrompt} view={props} />
          </section>
          {Side ? <Side tab={tab} stream={stream} /> : <ChatSide tab={tab} stream={stream} openFeature={openFeature} />}
        </div>
      )}
      {overlays.map((o) => <o.component key={o.id} {...props} view={view} />)}
    </div>
  );
}
