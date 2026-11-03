"use client";
// The Files page: drop or pick PDFs (and PNG/JPG for logos), up to 25 MB each; they go straight to
// the bucket. The list: name, tag (a package from the board, or any word), size, who uploaded it and when, and how many
// leads it is attached to; preview, download, rename, retag and delete (the owner, managers, or the uploader).
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { btnOutline, btnPrimary, btnText, control } from "@/lib/ui-classes";

export type FileItem = { id: string; name: string; size: number; type: string; tag: string; uploader: string; at: string; attachedTo: number; canChange: boolean };
type Upload = { key: string; name: string; progress: number; error: string; done: boolean };

const ACCEPT = "application/pdf,image/png,image/jpeg";
const MAX = 25 * 1024 * 1024;
const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });

async function api(url: string, body: object): Promise<{ ok: boolean; error?: string; id?: string; upload?: { url: string; headers: Record<string, string> } }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await r.json();
  } catch {
    return { ok: false, error: "No answer from the server." };
  }
}

/** PUT the bytes with progress (fetch has no upload progress). */
function put(url: string, headers: Record<string, string>, file: File, onProgress: (k: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => resolve(x.status >= 200 && x.status < 300);
    x.onerror = () => resolve(false);
    x.send(file);
  });
}

function FileIcon({ type }: { type: string }) {
  const pdf = type === "application/pdf";
  return (
    <span aria-hidden className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${pdf ? "bg-bad/15 text-bad" : "bg-accent-tint text-accent-ink"}`}>
      {pdf ? "PDF" : type === "image/png" ? "PNG" : "JPG"}
    </span>
  );
}

export default function FilesView({ files, packages, ready }: { files: FileItem[]; packages: string[]; ready: boolean }) {
  const router = useRouter();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [tag, setTag] = useState("");
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<FileItem | null>(null);
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const patch = (key: string, p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const send = async (list: FileList | File[]) => {
    const picked = [...list];
    for (const f of picked) {
      const key = `${f.name}-${f.size}-${Date.now()}-${Math.random()}`;
      setUploads((u) => [...u, { key, name: f.name, progress: 0, error: "", done: false }]);
      if (!ACCEPT.split(",").includes(f.type)) {
        patch(key, { error: "PDFs, PNG and JPG only." });
        continue;
      }
      if (f.size > MAX) {
        patch(key, { error: `${size(f.size)}: the limit is 25 MB.` });
        continue;
      }
      const start = await api("/api/files", { name: f.name, size: f.size, type: f.type, tag });
      if (!start.ok || !start.id || !start.upload) {
        patch(key, { error: start.error ?? "Could not start the upload." });
        continue;
      }
      const ok = await put(start.upload.url, start.upload.headers, f, (k) => patch(key, { progress: k }));
      if (!ok) {
        patch(key, { error: "The upload did not go through; try again." });
        continue;
      }
      const done = await api(`/api/files/${start.id}`, { action: "done" });
      patch(key, done.ok ? { done: true, progress: 1 } : { error: done.error ?? "Not saved." });
    }
    router.refresh();
  };

  const shown = files.filter((f) => !q || `${f.name} ${f.tag} ${f.uploader}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">Files</h1>
      <p className="mt-1 text-[0.9375rem] text-muted">PDFs and logos to attach to the emails. Attach them to a lead from its drawer on the Leads page; &quot;Copy draft&quot; then names them.</p>

      {!ready ? (
        <p role="status" className="mt-6 rounded-2xl border border-accent bg-accent-tint p-4 text-sm">
          File storage is not set up yet: the owner provisions the bucket (Neon Object Storage) and adds its four AWS_* variables. Uploads open as soon as it is.
        </p>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            if (e.dataTransfer.files.length) void send(e.dataTransfer.files);
          }}
          className={`mt-6 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${over ? "border-accent bg-accent-tint" : "border-line bg-panel"}`}
        >
          <p className="text-base font-semibold">Drop PDFs or logos here</p>
          <p className="mt-1 text-sm text-muted">PDF, PNG or JPG, up to 25 MB each</p>
          <div className="mx-auto mt-4 flex max-w-md flex-wrap items-center justify-center gap-2">
            <input value={tag} onChange={(e) => setTag(e.target.value)} list="file-tags" placeholder="Tag (a package, or any word)" aria-label="Tag for these files" className={`${control} max-w-64`} />
            <button type="button" onClick={() => input.current?.click()} className={btnPrimary}>
              Choose files
            </button>
            <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => e.target.files && void send(e.target.files)} />
          </div>
          {uploads.length ? (
            <ul className="mx-auto mt-4 max-w-md space-y-2 text-left text-sm">
              {uploads.map((u) => (
                <li key={u.key}>
                  <div className="flex justify-between gap-2">
                    <span className="truncate">{u.name}</span>
                    <span className={u.error ? "text-bad" : "text-muted"}>{u.error ? "failed" : u.done ? "uploaded" : `${Math.round(u.progress * 100)} %`}</span>
                  </div>
                  {u.error ? <p className="text-xs text-bad">{u.error}</p> : <div className="mt-1 h-1.5 rounded-full bg-line"><div className="h-1.5 rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(u.progress * 100)}%` }} /></div>}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      <datalist id="file-tags">
        {packages.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {files.length} {files.length === 1 ? "file" : "files"}
        </h2>
        {files.length > 5 ? <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="name, tag, who" aria-label="Search files" className={`${control} max-w-64`} /> : null}
      </div>
      {!files.length ? (
        <p className="mt-3 rounded-2xl border border-line bg-panel p-6 text-sm text-muted">No files yet. {ready ? "Drop the first PDF above." : ""}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-panel">
          {shown.map((f) => (
            <FileRowView key={f.id} f={f} onPreview={() => setPreview(f)} />
          ))}
        </ul>
      )}
      {preview ? <Preview f={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}

function FileRowView({ f, onPreview }: { f: FileItem; onPreview: () => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState<"" | "name" | "tag">("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act = async (body: object) => {
    setBusy(true);
    setError("");
    const r = await api(`/api/files/${f.id}`, body);
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "That failed.");
    setEditing("");
    router.refresh();
  };
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <FileIcon type={f.type} />
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act(editing === "name" ? { action: "rename", name: value } : { action: "tag", tag: value });
            }}
          >
            <input value={value} onChange={(e) => setValue(e.target.value)} list={editing === "tag" ? "file-tags" : undefined} aria-label={editing === "name" ? "File name" : "Tag"} className={control} />
            <button disabled={busy} className={btnOutline}>
              Save
            </button>
            <button type="button" onClick={() => setEditing("")} className={btnText}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <p className="truncate font-medium">{f.name}</p>
            <p className="text-xs text-muted">
              {f.tag ? <span className="mr-2 rounded-full bg-accent-tint px-2 py-0.5 text-accent-ink">{f.tag}</span> : null}
              {size(f.size)} · {f.uploader || "someone"} · {when(f.at)}
              {f.attachedTo ? ` · on ${f.attachedTo} ${f.attachedTo === 1 ? "lead" : "leads"}` : ""}
            </p>
          </>
        )}
        {error ? <p className="text-xs text-bad">{error}</p> : null}
      </div>
      {!editing ? (
        <div className="flex flex-wrap items-center gap-x-3">
          <button type="button" onClick={onPreview} className={btnText}>
            Preview
          </button>
          <a href={`/api/files/${f.id}/download`} className={btnText}>
            Download
          </a>
          {f.canChange ? (
            <>
              <button type="button" onClick={() => (setEditing("name"), setValue(f.name))} className={btnText}>
                Rename
              </button>
              <button type="button" onClick={() => (setEditing("tag"), setValue(f.tag))} className={btnText}>
                Tag
              </button>
              <button type="button" disabled={busy} onClick={() => window.confirm(`Delete ${f.name}? It comes off every lead it is attached to.`) && void act({ action: "delete" })} className="inline-flex min-h-11 items-center text-sm font-medium text-bad hover:underline">
                Delete
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Preview({ f, onClose }: { f: FileItem; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const src = `/api/files/${f.id}/download?inline=1`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-ink/40" />
      <div role="dialog" aria-modal="true" aria-label={f.name} className="relative flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-panel shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
          <p className="truncate font-medium">{f.name}</p>
          <div className="flex items-center gap-3">
            <a href={`/api/files/${f.id}/download`} className={btnText}>
              Download
            </a>
            <button type="button" onClick={onClose} className={btnText}>
              Close
            </button>
          </div>
        </div>
        {f.type === "application/pdf" ? (
          <iframe src={src} title={f.name} className="h-full w-full bg-bg" />
        ) : (
          // a short signed link to the bucket: next/image cannot proxy it, and it is one picture shown once
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={f.name} className="m-auto max-h-full max-w-full object-contain p-4" />
        )}
      </div>
    </div>
  );
}
