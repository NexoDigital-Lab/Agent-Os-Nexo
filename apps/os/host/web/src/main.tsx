// Boot: ask the server which modules are active, load their web entries, pick the language, then let the
// shell module render the app.
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import { addMessages, isLanguage, setLanguage, t } from "./i18n";
import { hostApi } from "./lib/http";
import { loadModules } from "./registry";
import { es } from "./messages";

const root = createRoot(document.getElementById("root")!);

function BootError({ message }: { message: string }) {
  return (
    <div className="boot-error">
      <h1>{t("agent-os could not start")}</h1>
      <pre>{message}</pre>
    </div>
  );
}

async function boot() {
  addMessages({ es });
  const [info, rows, prefs] = await Promise.all([hostApi.info(), hostApi.modules(), hostApi.prefs()]);
  const browser = navigator.language.slice(0, 2);
  const lang = [prefs.language, info.language, browser].find(isLanguage) ?? "en";
  setLanguage(lang);
  const active = rows.filter((r) => r.active).map((r) => r.id);
  const loaded = await loadModules(active);
  const shell = loaded.find((m) => m.module.root);
  if (!shell?.module.root) throw new Error(t("No active module provides the app frame (shell)."));
  const Root = shell.module.root;
  root.render(<Root />);
}

/** No access cookie for this run: say how to get in (the link is printed by `nexo os start`, opened by `nexo os open`). */
function AccessNeeded() {
  return (
    <div className="boot-error">
      <h1>{t("Open agent-os with its access link")}</h1>
      <p>{t("Each run of agent-os has its own access link, so no other program on this computer can use it.")}</p>
      <pre>nexo os open</pre>
      <p className="faint">{t("The link is also printed by `nexo os start`. The desktop app opens it by itself.")}</p>
    </div>
  );
}

boot().catch(async (e: unknown) => {
  addMessages({ es });
  // /api/os/info needs no access: it still tells the language to explain things in.
  const info = await hostApi.info().catch(() => null);
  const lang = [info?.language, navigator.language.slice(0, 2)].find(isLanguage);
  if (lang) setLanguage(lang);
  root.render((e as { access?: boolean }).access ? <AccessNeeded /> : <BootError message={e instanceof Error ? e.message : String(e)} />);
});
