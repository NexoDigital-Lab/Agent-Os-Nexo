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

boot().catch((e: unknown) => root.render(<BootError message={e instanceof Error ? e.message : String(e)} />));
