// "Images" section of the Docker view: local images, delete, and pull.
import { useState } from "react";
import { Download } from "lucide-react";
import { t } from "@os/i18n";
import { ConfirmDelete } from "@os/lib/ConfirmDelete";
import { dockerApi as api, type Image } from "./api";

export function DockerImages({ images, reload, fail }: { images: Image[]; reload: () => Promise<unknown>; fail: (msg: string) => void }) {
  const [ref, setRef] = useState("");
  const [pulling, setPulling] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function pull() {
    const image = ref.trim();
    if (!image || pulling) return;
    setPulling(true);
    try {
      await api.pullImage(image);
      setRef("");
      await reload();
    } catch (e) {
      fail((e as Error).message);
    } finally {
      setPulling(false);
    }
  }

  async function remove(img: Image) {
    setBusy(img.id);
    try {
      await api.removeImage(img.id);
      await reload();
    } catch (e) {
      fail((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="dk-section">
      <div className="dk-section-head">
        <h2>{t("Images")}</h2>
        <form className="dk-pull" onSubmit={(e) => (e.preventDefault(), pull())}>
          <input className="field mono" placeholder="python:3.12" aria-label={t("Image to pull (image:tag)")} value={ref} disabled={pulling} onChange={(e) => setRef(e.target.value)} />
          <button className="btn sm" disabled={pulling || !ref.trim()}>
            {pulling ? <span className="spin" /> : <Download size={14} />}
            {pulling ? t("Pulling… it may take a while") : t("Pull")}
          </button>
        </form>
      </div>
      {images.length === 0 ? (
        <p className="empty">{t("No images.")}</p>
      ) : (
        <div className="dk-rows">
          {images.map((img) => (
            <div key={`${img.id}-${img.repo}-${img.tag}`} className="dk-row dk-img">
              <span className="mono dk-name" title={`${img.repo}:${img.tag}`}>{img.repo}:{img.tag}</span>
              <span className="faint">{img.size}</span>
              <span className="faint">{img.created}</span>
              <span>{img.inUse && <span className="pill info">{t("in use")}</span>}</span>
              <span className="dk-actions">
                {busy === img.id ? <span className="spin" /> : <ConfirmDelete name={`${img.repo}:${img.tag}`} title={img.inUse ? t("A container uses it") : t("Delete image")} disabled={img.inUse} onConfirm={() => remove(img)} />}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
