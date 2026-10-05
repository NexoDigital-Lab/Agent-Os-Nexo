// The app frame: rail on the left, the chosen view on the right, banners above it and notices below.
import { useEffect, useState } from "react";
import { t } from "@os/i18n";
import { DialogHost } from "@os/lib/dialog";
import { readStr, writeStr } from "@os/lib/storage";
import { slot, views as allViews } from "@os/registry";
import { onNavigate, onNotice } from "./nav";
import { Rail } from "./Rail";
import type { BannerItem, OverlayItem } from "./slots";

export function App() {
  const views = allViews();
  const [view, setView] = useState(() => {
    const saved = readStr("view");
    return views.some((v) => v.id === saved) ? saved! : (views[0]?.id ?? "settings");
  });
  const [notice, setNotice] = useState("");

  useEffect(() => writeStr("view", view), [view]);
  useEffect(() => onNavigate((v) => views.some((x) => x.id === v) && setView(v)), [views]);
  useEffect(() => onNotice(setNotice), []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(id);
  }, [notice]);

  const active = views.find((v) => v.id === view);
  const banners = slot<BannerItem>("shell.banners");
  const overlays = slot<OverlayItem>("shell.overlays");
  return (
    <div className="shell">
      <Rail views={views} view={view} setView={setView} />
      <main>
        {banners.map((b) => <b.component key={b.id} />)}
        {active ? <active.component /> : <div className="empty">{t("No views are active. Turn modules on in Settings.")}</div>}
      </main>
      {overlays.map((o) => <o.component key={o.id} />)}
      <DialogHost />
      {notice && (
        <div className="toast" role="status" onClick={() => setNotice("")}>
          {notice}
        </div>
      )}
    </div>
  );
}
