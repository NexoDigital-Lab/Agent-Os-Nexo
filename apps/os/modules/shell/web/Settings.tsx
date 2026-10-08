// Settings: the language here, everything else from the modules ("settings.sections").
import { useState } from "react";
import { LANGUAGES, isLanguage, language, t } from "@os/i18n";
import { hostApi } from "@os/lib/http";
import { slot } from "@os/registry";
import type { SettingsSection } from "./slots";

function LanguagePicker() {
  const [lang, setLang] = useState(language());
  return (
    <div className="settings-row">
      <label htmlFor="ui-language">{t("Interface language")}</label>
      <select
        id="ui-language"
        className="field"
        style={{ maxWidth: 240 }}
        value={lang}
        onChange={async (e) => {
          const next = e.target.value;
          if (!isLanguage(next)) return;
          setLang(next);
          await hostApi.savePrefs({ language: next });
          location.reload(); // every module's text is read at render: a reload is the honest way to switch
        }}
      >
        {Object.entries(LANGUAGES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select>
      <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>{t("Agents answer in the language you write in; this only changes the app's text.")}</p>
    </div>
  );
}

export function Settings() {
  const sections: SettingsSection[] = [
    { id: "language", label: "Language", order: 0, component: LanguagePicker },
    ...slot<SettingsSection>("settings.sections"),
  ].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  return (
    <div className="page settings">
      <h1>{t("Settings")}</h1>
      <p className="sub">{t("Saved in this environment (os/data), so every build of agent-os-nexo keeps them.")}</p>
      {sections.map((s) => (
        <section key={s.id} className="settings-section" aria-labelledby={`settings-${s.id}`}>
          <h2 id={`settings-${s.id}`}>{t(s.label)}</h2>
          <s.component />
        </section>
      ))}
    </div>
  );
}
