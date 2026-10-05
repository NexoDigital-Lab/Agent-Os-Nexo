// Today's estimated spend, at the bottom of the rail.
import { useEffect, useState } from "react";
import { t } from "@os/i18n";
import { usd } from "@os/lib/format";
import { monitorApi } from "./api";

export function TodayCost() {
  const [cost, setCost] = useState<number | null>(null);
  useEffect(() => {
    const load = () => void monitorApi.summary(1).then((s) => setCost(s.today.cost), () => {});
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);
  if (cost === null) return null;
  return (
    <div className="cost" title={t("Spent today from agent-os")}>
      {t("today")}
      <b>{usd(cost)}</b>
    </div>
  );
}
