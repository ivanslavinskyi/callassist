"use client";

import { useEffect, useRef, useState } from "react";
import { fallbackOgImagePath, ogImagePath, OG_UPLOAD_MAX_BYTES, uiLocaleRegistry, type OgImageVersion, type OgLocaleState, type OgUploadInput, type UiLocale } from "@callassist/contracts";
import { ApiError, generateOgImage, getAdminOgImages, getOgPreview, publishOgImage, uploadOgImage } from "@/lib/api";
import styles from "./admin-og-console.module.css";

const errorMessages: Record<string, string> = {
  OG_REVISION_CONFLICT: "This locale was changed in another session. Refresh before trying again.",
  OG_SLOGAN_TOO_LONG: "Shorten the slogan so it fits within two readable lines.",
  OG_UNSUPPORTED_CHARACTERS: "Use Latin or Cyrillic text and standard punctuation. This font does not support one of the characters.",
  OG_INVALID_SLOGAN: "Enter a slogan of 1–100 characters on a single line.",
  OG_IMAGE_TOO_LARGE: "The image must be no larger than 5 MB.",
  OG_INVALID_IMAGE: "This image could not be decoded. Choose a valid PNG, JPEG or WebP under 24 megapixels.",
  OG_UNSUPPORTED_IMAGE: "Choose a still PNG, JPEG or WebP image.",
  OG_INVALID_CROP: "The selected area must be at least 600 × 315 pixels. Reduce the zoom or choose a larger image.",
  OG_BUSY: "The image generator is busy. Try again shortly.",
  RATE_LIMITED: "Too many image changes. Wait a minute and try again.",
  AUTHENTICATION_REQUIRED: "Your session has ended. Sign in again.",
  CONTENT_ACTION_FORBIDDEN: "Your account cannot manage content."
};
function errorText(error: unknown) {
  return error instanceof ApiError ? errorMessages[error.code] ?? "Unable to save the image. Your published image is unchanged." : "Unable to complete the request. Please try again.";
}

export function AdminOgConsole({ onPublished }: { onPublished: () => void }) {
  const [states, setStates] = useState<OgLocaleState[]>([]);
  const [locale, setLocale] = useState<UiLocale>("de");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const mounted = useRef(true);
  const lock = useRef(false);
  async function refresh() {
    const response = await getAdminOgImages();
    if (mounted.current) setStates(response.locales);
  }
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(error => { if (mounted.current) setError(errorText(error)); });
    return () => { mounted.current = false; };
  }, []);
  function replace(state: OgLocaleState) {
    if (mounted.current) setStates(previous => previous.map(row => row.locale === state.locale ? state : row));
  }
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null); setStatus("");
    try { await action(); } catch (error) { if (mounted.current) setError(errorText(error)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function generateAll() {
    const failures: string[] = [];
    let generated = 0, skipped = 0;
    for (const state of states) {
      if (!mounted.current) break;
      const latest = state.draft ?? state.published;
      if (latest?.source === "uploaded") { skipped++; continue; }
      try {
        setStatus(`Generating ${state.locale.toUpperCase()}…`);
        replace(await generateOgImage(state.locale, latest?.slogan ?? uiLocaleRegistry[state.locale].slogan, state.revision));
        generated++;
      } catch (error) { failures.push(`${state.locale.toUpperCase()}: ${errorText(error)}`); }
    }
    if (mounted.current) {
      setStatus(`${generated} drafts ready. ${skipped} manual images preserved. Review and publish each locale when ready.`);
      if (failures.length) setError(failures.join(" "));
    }
  }
  const state = states.find(row => row.locale === locale);
  return <section className={styles.panel} aria-labelledby="og-heading">
    <header className={styles.heading}>
      <div><h2 id="og-heading">Homepage social images</h2><p>One image per language for Open Graph and Twitter. 1200 × 630 px.</p></div>
      <div className={styles.actions}>
        <button className="secondary-button" disabled={busy || !states.length} onClick={() => void run(generateAll)}>Generate all templates</button>
        <button className="secondary-button" disabled={busy} onClick={() => void run(refresh)}>Refresh</button>
      </div>
    </header>
    <div className={styles.locales} aria-label="Image language">{states.map(row => <button key={row.locale} aria-pressed={locale === row.locale}
      disabled={busy} onClick={() => setLocale(row.locale)}>{row.locale.toUpperCase()}{row.draft ? " · Draft" : ""}</button>)}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {status && <p className={styles.status} role="status">{status}</p>}
    {!state && !error && <p role="status">Loading image settings…</p>}
    {state && <LocaleEditor key={`${locale}:${state.revision}`} state={state} busy={busy} run={run}
      onSaved={next => { replace(next); setStatus("Draft saved. Review the preview, then publish."); }}
      onPublished={next => { replace(next); setStatus(`${next.locale.toUpperCase()} image published. Social platforms may retain previously shared previews until they fetch the page again.`); onPublished(); }} />}
  </section>;
}

function LocaleEditor({ state, busy, run, onSaved, onPublished }: {
  state: OgLocaleState; busy: boolean; run: (action: () => Promise<void>) => Promise<void>;
  onSaved: (state: OgLocaleState) => void; onPublished: (state: OgLocaleState) => void;
}) {
  const latest = state.draft ?? state.published;
  const [mode, setMode] = useState<"generated" | "uploaded">(latest?.source ?? "generated");
  const [slogan, setSlogan] = useState(latest?.slogan ?? uiLocaleRegistry[state.locale].slogan);
  const [selected, setSelected] = useState<OgImageVersion | null>(state.draft);
  const [upload, setUpload] = useState<{ image: string; url: string; width: number; height: number } | null>(null);
  const [alt, setAlt] = useState(`SHPROHLI — ${uiLocaleRegistry[state.locale].slogan}`);
  const [x, setX] = useState(0.5), [y, setY] = useState(0.5), [zoom, setZoom] = useState(1);
  const ratio = 1200 / 630;
  const cropWidth = upload ? Math.min(1, upload.height * ratio / upload.width) / zoom : 1;
  const cropHeight = upload ? Math.min(1, upload.width / ratio / upload.height) / zoom : 1;
  const crop: OgUploadInput["crop"] = { x: (1 - cropWidth) * x, y: (1 - cropHeight) * y, width: cropWidth, height: cropHeight };
  async function chooseFile(file: File) {
    if (file.size > OG_UPLOAD_MAX_BYTES) throw new ApiError("OG_IMAGE_TOO_LARGE", 413);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new ApiError("OG_UNSUPPORTED_IMAGE", 400);
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const width = bitmap.width, height = bitmap.height; bitmap.close();
    if (width * height > 24_000_000) throw new ApiError("OG_INVALID_IMAGE", 400);
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
    });
    setUpload({ image: url.split(",")[1], url, width, height }); setX(0.5); setY(0.5); setZoom(1);
  }
  return <div className={styles.columns}>
    <div className={styles.column}>
      <h3>{uiLocaleRegistry[state.locale].nativeName} · Published</h3>
      {/* Public immutable image, or the bundled locale fallback before first publication. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.preview} src={state.published ? ogImagePath(state.published) : fallbackOgImagePath(state.locale)}
        alt={state.published?.alt ?? `SHPROHLI — ${uiLocaleRegistry[state.locale].slogan}`} width={1200} height={630} />
      <p className={styles.help}>{state.published ? `${state.published.source === "uploaded" ? "Manual upload" : "Generated template"} · Version ${state.published.id.slice(0, 8)}` : "Default template. Ready to share."}</p>
      {state.previous && <button className="secondary-button" disabled={busy} onClick={() => setSelected(state.previous)}>Preview previous version</button>}
      {state.history.length > 0 && <details className={styles.history}><summary>Version history ({state.history.length})</summary>
        {state.history.map(version => <button className="secondary-button" disabled={busy} key={version.id} onClick={() => setSelected(version)}>
          {version.source === "uploaded" ? "Upload" : "Template"} · {new Date(version.createdAt).toLocaleString()} · {version.id.slice(0, 8)}
        </button>)}
      </details>}
    </div>
    <div className={styles.column}>
      <h3>Create a new image</h3>
      <label className="field"><span>Image source</span><select disabled={busy} value={mode} onChange={event => setMode(event.target.value as typeof mode)}>
        <option value="generated">Brand template</option><option value="uploaded">Manual upload</option>
      </select></label>
      {mode === "generated" ? <>
        <label className="field"><span>Slogan</span><input disabled={busy} maxLength={100} value={slogan} onChange={event => setSlogan(event.target.value)} /></label>
        <p className={styles.help}>Large logo with a readable slogan. Text is checked to fit within two lines.</p>
        <button className="secondary-button" disabled={busy || !slogan.trim()} onClick={() => void run(async () => onSaved(await generateOgImage(state.locale, slogan, state.revision)))}>Generate preview</button>
      </> : <>
        <label className="field"><span>Image file</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(() => chooseFile(file)); }} /></label>
        <p className={styles.help}>PNG, JPEG or WebP, up to 5 MB and 24 megapixels. Adjust the crop before saving.</p>
        <label className="field"><span>Image description</span><input disabled={busy} maxLength={240} value={alt} onChange={event => setAlt(event.target.value)} /></label>
        {upload && <>
          <div className={styles.crop} aria-label="Upload crop preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={alt} src={upload.url} style={{ width: `${100 / crop.width}%`, height: `${100 / crop.height}%`, left: `${-crop.x / crop.width * 100}%`, top: `${-crop.y / crop.height * 100}%` }} />
          </div>
          <div className={styles.sliders}>
            <label>Horizontal<input aria-label="Horizontal crop position" disabled={busy} type="range" min={0} max={1} step={0.01} value={x} onChange={e => setX(Number(e.target.value))} /></label>
            <label>Vertical<input aria-label="Vertical crop position" disabled={busy} type="range" min={0} max={1} step={0.01} value={y} onChange={e => setY(Number(e.target.value))} /></label>
            <label>Zoom<input aria-label="Crop zoom" disabled={busy} type="range" min={1} max={3} step={0.05} value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label>
          </div>
          <button className="secondary-button" disabled={busy || !alt.trim()} onClick={() => void run(async () => onSaved(await uploadOgImage(state.locale, { image: upload.image, crop, alt, expectedRevision: state.revision })))}>Save upload preview</button>
        </>}
      </>}
      {selected && <>
        <h3>{selected.id === state.draft?.id ? "Draft preview" : "Version preview"}</h3>
        <PrivatePreview version={selected} />
        <p className={styles.help}>{selected.source === "uploaded" ? "Manual upload" : selected.slogan} · {selected.id.slice(0, 8)}</p>
        <button className="primary-button" disabled={busy || selected.id === state.published?.id}
          onClick={() => void run(async () => onPublished(await publishOgImage(state.locale, selected.id, state.revision)))}>
          {selected.id === state.published?.id ? "Currently published" : selected.id === state.draft?.id ? "Publish this image" : "Restore this version"}
        </button>
      </>}
    </div>
  </div>;
}

function PrivatePreview({ version }: { version: OgImageVersion }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true, objectUrl = "";
    setUrl(""); setError(false);
    void getOgPreview(version).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [version]);
  return url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className={styles.preview} src={url} alt={version.alt} width={1200} height={630} />
    : <div className={styles.placeholder} role="status">{error ? "Preview unavailable. Refresh and try again." : "Loading preview…"}</div>;
}
