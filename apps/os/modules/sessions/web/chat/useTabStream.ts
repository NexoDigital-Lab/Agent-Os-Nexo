// A tab's live Claude session: the SSE event stream, what's derived from it (tool results, permissions,
// subagents, activity, model) and the working-tree diff, refreshed as edits land.
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { sessionsApi as api, type Diff, type Ev, type TaskEv } from "../api";

export type TabStream = ReturnType<typeof useTabStream>;

// The conversation lives in a module-level per-tab store, NOT in component state: TabView (and so the hook)
// unmounts whenever you leave the workspace or switch tab, and component state died with it — the chat came
// back empty until the SSE replay re-arrived (or never, if the connection queued behind other streams).
// Now the last known events stay on screen across remounts; reconnecting replays the server's full history
// into a buffer that atomically replaces them (the server ends every replay with a `status` event).
type State = { events: Ev[]; running: boolean; diff: Diff | null };
const stores = new Map<string, { state: State; listeners: Set<() => void> }>();
const EMPTY: State = { events: [], running: false, diff: null };

function store(tabId: string) {
  let s = stores.get(tabId);
  if (!s) stores.set(tabId, (s = { state: EMPTY, listeners: new Set() }));
  return s;
}
function patch(tabId: string, p: Partial<State>) {
  const s = store(tabId);
  s.state = { ...s.state, ...p };
  s.listeners.forEach((l) => l());
}

export function useTabStream(tabId: string) {
  const subscribe = useCallback((l: () => void) => {
    const s = store(tabId);
    s.listeners.add(l);
    return () => void s.listeners.delete(l);
  }, [tabId]);
  const { events, running, diff } = useSyncExternalStore(subscribe, () => store(tabId).state);
  const diffTimer = useRef<number>(0);

  const refreshDiff = useCallback(
    () => api.tabDiff(tabId).then((d) => patch(tabId, { diff: d })).catch(() => patch(tabId, { diff: { files: [], untracked: [], diff: "", commits: [] } })),
    [tabId],
  );

  useEffect(() => {
    const es = new EventSource(`/api/tabs/${tabId}/stream`);
    // The server replays the whole history on every (re)connect and ends it with `replay_done`: buffer the replay
    // and swap it in at once (the 120 ms quiet-timer only covers an older server without the marker).
    let replay: Ev[] | null = [];
    let settle = 0;
    const flush = () => {
      if (!replay) return;
      let running = store(tabId).state.running;
      const events: Ev[] = [];
      for (const e of replay) (e.kind === "status" ? (running = e.running) : events.push(e));
      patch(tabId, { events, running });
      replay = null;
    };
    es.onopen = () => { replay = []; clearTimeout(settle); settle = window.setTimeout(flush, 120); };
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data) as Ev;
      if (ev.kind === "replay_done") {
        clearTimeout(settle);
        flush();
        return;
      }
      if (replay) {
        replay.push(ev);
        clearTimeout(settle);
        settle = window.setTimeout(flush, 120);
        return;
      }
      if (ev.kind === "status") patch(tabId, { running: ev.running });
      else patch(tabId, { events: [...store(tabId).state.events, ev] });
      // Edits land on disk as tool results arrive — keep the diff live, debounced.
      if (ev.kind === "tool_result" || (ev.kind === "status" && !ev.running)) {
        clearTimeout(diffTimer.current);
        diffTimer.current = window.setTimeout(refreshDiff, 400);
      }
    };
    refreshDiff();
    return () => { es.close(); clearTimeout(settle); clearTimeout(diffTimer.current); };
  }, [tabId, refreshDiff]);

  const results = useMemo(() => {
    const m = new Map<string, Extract<Ev, { kind: "tool_result" }>>();
    for (const e of events) if (e.kind === "tool_result") m.set(e.id, e);
    return m;
  }, [events]);
  const permDone = useMemo(() => new Map(events.flatMap((e) => (e.kind === "perm_done" ? [[e.id, e.allow] as const] : []))), [events]);
  // Latest state per task id, in first-seen order.
  const tasks = useMemo(() => {
    const m = new Map<string, TaskEv>();
    for (const e of events) if (e.kind === "task") m.set(e.id, { ...(m.get(e.id) ?? {}), ...e });
    return [...m.values()];
  }, [events]);
  const last = <K extends Ev["kind"]>(kind: K) => [...events].reverse().find((e) => e.kind === kind) as Extract<Ev, { kind: K }> | undefined;

  return {
    events,
    running,
    diff,
    refreshDiff,
    results,
    permDone,
    pendingPerms: events.filter((e) => e.kind === "perm" && !permDone.has(e.id)).length,
    tasks,
    runningTasks: tasks.filter((t) => t.status === "running" && t.type !== "local_bash").length,
    activity: last("activity")?.tool ?? null,
    liveModel: last("init")?.model ?? null,
  };
}
