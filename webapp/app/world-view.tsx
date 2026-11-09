"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { BotCard } from "@/lib/board";
import type { Board } from "@/lib/board-read";
import {
  animOf,
  BULLETIN,
  desk,
  dialogue,
  figures,
  downtimeLine,
  lookOf,
  MAILBOX,
  answerBody,
  bedOf,
  confirmText,
  dayPhase,
  DESK_W,
  MAX_DESKS,
  newSim,
  MONITOR,
  deskScreen,
  screenForm,
  SCREEN,
  nowLines,
  NAMEPLATE,
  newBubbles,
  nextPrompt,
  panelNext,
  type Panel,
  type PanelTab,
  restUntil,
  simPoll,
  simStep,
  stormOf,
  TILE,
  type Bubble,
  type Action,
  type PauseFor,
  type Pt,
  week7Lines,
  directorStep,
  insetSource,
  lapseHour,
  newDirector,
  recStart,
  recTick,
  savedVideo,
  saveVideo,
  tickerScroll,
  tickerText,
  videoLayout,
  type Rec,
  type VideoOpts,
} from "@/lib/world";
import Portrait from "./portrait";
import { chime, click, pageFlip, rememberSound, soundState, soundWanted, unlockSound } from "./world-sound";
import { useDecisionAnswer } from "./decision-actions";
import { FeedTab, ScreenTab } from "./member-tabs";
import { READ_ONLY } from "./world-mode";
import {
  drawBubble,
  drawChair,
  drawCup,
  drawFigure,
  drawClock,
  drawDesk,
  drawDeskScreen,
  drawMatNote,
  setScreenFace,
  drawLampGlow,
  drawMarker,
  drawPaper,
  drawMat,
  drawPerson,
  drawRoom,
  drawShh,
  drawSign,
  drawSofaBack,
  drawSofaFront,
  drawStorm,
  drawZzz,
  drawInsetFrame,
  drawStrip,
  drawTicker,
  H,
  text,
  W,
  type Pose,
} from "./world-draw";

// The office world (2026-10-30): the running members at their desks, the owner-stopped ones asleep
// in the corner, all driven by /api/board (the poll in family-board.tsx). The canvas animates between polls; a click,
// a tap or the arrow keys pick a member and the text box under the room says what it is doing.

const STORM_MS = 60_000;
const NOISE_MS = 4000; // the monitor shows static for the first seconds of a model failure
const MAX_CSS = 2400; // the world fits the window's width: a wide window gives bigger screens

type Hit = { kind: "member" | "sleeper"; slug: string; x: number; y: number };
type Window = { kind: "member" | "sleeper"; slug: string } | { kind: "bulletin" } | { kind: "mailbox" };

const feet = (p: Pt, onSofa: boolean) => ({ x: p.x * TILE + 8, y: onSofa ? 11 * TILE + 6 : p.y * TILE + 16 });

export default function World({ data }: { data: Board }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState({ k: 2, dpr: 1, css: 640 });
  // which desk each member's screen stands at, in tiles (from the animation loop, only when it changes): its HTML box
  const [slots, setSlots] = useState<Record<string, { x: number; y: number }>>({});
  const slotsKey = useRef("");
  // the screens' face: JetBrains Mono, loaded by the layout as --font-screen; the canvas uses it once the browser has it
  useEffect(() => {
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-screen");
    setScreenFace(family);
    if (family.trim()) for (const f of [`14px ${family}`, `bold 14px ${family}`]) void document.fonts?.load(f).catch(() => undefined);
  }, []);
  const [win, setWin] = useState<Window | null>(null);
  const [latest, setLatest] = useState<{ name: string; text: string } | null>(null);
  // The member panel: right of the room on desktop, under it on a phone; tabs Info, Screen, Feed.
  const wide = useSyncExternalStore(subscribeWide, isWide, () => false);
  const [panel, setPanel] = useState<Panel>({ open: true, tab: "info" });
  const move = (ev: Parameters<typeof panelNext>[1]) => setPanel((p) => panelNext(p, ev));
  const close = () => (wide ? move("close") : setWin(null));
  const [sound, setSound] = useState(false); // off by default; remembered per browser, started from the toggle
  const soundRef = useRef(false);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);
  useEffect(() => {
    const t = setTimeout(() => setSound(soundWanted()), 0);
    return () => clearTimeout(t);
  }, []);
  const toggleSound = () => {
    const on = !sound;
    setSound(on);
    rememberSound(on);
    if (on) unlockSound();
  };
  // Made for video: a director's inset, a ticker, a time-lapse and "Record 60 s". All off by default and remembered
  // per browser; with all off the room draws exactly as before.
  const [video, setVideo] = useState<VideoOpts>({ director: false, ticker: false, lapse: false });
  const videoRef = useRef(video);
  useEffect(() => {
    videoRef.current = video;
  }, [video]);
  useEffect(() => {
    const t = setTimeout(() => setVideo(savedVideo()), 0);
    return () => clearTimeout(t);
  }, []);
  const toggleVideo = (k: keyof VideoOpts) =>
    setVideo((v) => {
      const n = { ...v, [k]: !v[k] };
      saveVideo(n);
      return n;
    });
  const director = useRef(newDirector());
  const acted = useRef<string[]>([]); // members with a new accepted action since the last frame: the director cuts to them
  const tickerX = useRef(0);
  const tickerHover = useRef(false);
  const lapse = useRef<{ h: number; t: number } | null>(null);
  const offscreen = useRef<HTMLCanvasElement | null>(null);
  // "Record 60 s": the canvas (inset and ticker included) to a WebM download; nothing leaves this browser
  const [rec, setRec] = useState<Rec>({ state: "idle", until: 0 });
  const recorder = useRef<MediaRecorder | null>(null);
  const startRec = () => {
    const cv = canvas.current;
    const supported = !!cv && typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.("video/webm") && typeof cv.captureStream === "function";
    const next = recStart(rec, Date.now(), supported);
    setRec(next);
    if (!supported || next === rec || !cv) return;
    const chunks: Blob[] = [];
    const mr = new MediaRecorder(cv.captureStream(30), { mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm" });
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mr.onstop = () => {
      const url = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `office-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      recorder.current = null;
    };
    mr.start(1000);
    recorder.current = mr;
  };
  // the recording stops itself at 60 s; the "needs Chrome" note goes after a few seconds
  useEffect(() => {
    if (rec.state === "idle") return;
    const id = setInterval(() => {
      const { rec: n, stop } = recTick(rec, Date.now());
      if (stop && recorder.current?.state === "recording") recorder.current.stop();
      if (n !== rec) setRec(n);
    }, 500);
    return () => clearInterval(id);
  }, [rec]);
  // for a check from the browser that nothing plays between events
  useEffect(() => {
    (window as unknown as { __worldSound?: () => string }).__worldSound = soundState;
  }, []);
  const sim = useRef(newSim()); // who stands where, and walks where (lib/world.ts: simPoll, simStep, figures)
  const bubbles = useRef<Bubble[]>([]);
  const storms = useRef(new Map<string, number>());
  const stormStart = useRef(new Map<string, number>());
  const hits = useRef<Hit[]>([]);
  const hoverDesk = useRef<number | null>(null); // the desk under the pointer: its monitor's text may scroll
  const papers = useRef<{ slug: string; at: number }[]>([]); // drafts flying from the Writer's desk to the mailbox
  const flashUntil = useRef(0); // the bulletin board's CEO note flashes when a proposal arrives
  const prevProposals = useRef<number | null>(null);
  const prev = useRef<BotCard[] | null>(null);
  const live = useRef({ data, win });
  useEffect(() => {
    live.current = { data, win };
  }, [data, win]);
  const router = useRouter();

  const members = useMemo(() => data.cards.slice(0, MAX_DESKS), [data.cards]);
  const order = useMemo(() => [...members.map((c) => ({ kind: "member" as const, slug: c.slug })), ...data.stopped.map((s) => ({ kind: "sleeper" as const, slug: s.slug }))], [members, data.stopped]);

  // A new poll: into the room's simulation (debounced there), speech bubbles for new accepted actions, a minute of storm
  // for a failing provider.
  useEffect(() => {
    const now = performance.now();
    simPoll(sim.current, data.cards, data.stopped, now);
    const fresh = newBubbles(prev.current, data.cards, now);
    bubbles.current = [...bubbles.current.filter((b) => b.until > now && !fresh.some((f) => f.slug === b.slug)), ...fresh];
    for (const f of fresh) acted.current.push(f.slug); // a new accepted action: the director cuts to it
    if (fresh.length) {
      // a page-flip and a paper to the mailbox for a draft, else a soft click; one sound per poll at most
      const draft = fresh.find((f) => data.cards.find((c) => c.slug === f.slug)?.last?.words.startsWith("drafted"));
      if (draft) papers.current.push({ slug: draft.slug, at: now });
      if (soundRef.current) {
        if (draft) pageFlip();
        else click();
      }
      const f = fresh[fresh.length - 1];
      setLatest({ name: data.cards.find((c) => c.slug === f.slug)?.name ?? f.slug, text: f.text });
    }
    const proposals = data.counts?.proposals ?? 0;
    if (prevProposals.current !== null && proposals > prevProposals.current) {
      flashUntil.current = now + 4000;
      if (soundRef.current) setTimeout(() => chime(), 800);
    }
    prevProposals.current = proposals;
    for (const c of data.cards) {
      if (!stormOf(c.state)) continue;
      if ((storms.current.get(c.slug) ?? 0) < now) stormStart.current.set(c.slug, now);
      storms.current.set(c.slug, now + STORM_MS);
    }
    prev.current = data.cards;
  }, [data.cards, data.stopped, data.counts?.proposals]);

  // Scale: a whole number of device pixels per room pixel, as wide as fits.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const css = Math.min(el.clientWidth, MAX_CSS);
      // the room fills the width it has; the canvas draws at a whole number of device pixels per room pixel, at or above it
      setScale({ k: Math.max(1, Math.ceil((css * dpr) / W)), dpr, css: Math.floor(css) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The animation loop.
  useEffect(() => {
    const cv = canvas.current;
    const c = cv?.getContext("2d");
    if (!cv || !c) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();
    // draw only while the room is on screen and the tab is visible (the browser stops frames in a hidden tab)
    let onScreen = true;
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      if (onScreen && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    });
    io.observe(cv);
    const frame = (t: number) => {
      if (!onScreen) {
        raf = 0;
        return;
      }
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      const { data: d, win: w } = live.current;
      const quiet = [...sim.current.members.values()].some((m) => m.anim === "quiet"); // debounced, as the walks
      const clock = new Date();
      const v = videoRef.current;
      // the director's time-lapse: day and night at 10x from now (visual only)
      if (v.director && v.lapse) lapse.current ??= { h: clock.getHours() + clock.getMinutes() / 60, t };
      else lapse.current = null;
      const lh = lapse.current ? lapseHour(lapse.current.h, lapse.current.t, t) : null;
      const day = lh !== null ? dayPhase(Math.floor(lh), Math.floor((lh % 1) * 60)) : dayPhase(clock.getHours(), clock.getMinutes());
      c.setTransform(scale.k, 0, 0, scale.k, 0, 0);
      c.imageSmoothingEnabled = false;
      const L = videoLayout(v); // the video parts get a strip under the room, never over it
      c.clearRect(0, 0, W, L.height);
      drawRoom(c, { day, flash: flashUntil.current > t, quiet, decisions: d.counts?.decisions ?? 0, proposals: d.counts?.proposals ?? 0, requests: d.counts?.requests ?? 0, drafts: d.week?.drafts ?? d.team?.unsent ?? null, t });
      drawSofaBack(c);

      type Item = { key: number; draw: () => void };
      const items: Item[] = [];
      const overlays: (() => void)[] = [];
      const hitList: Hit[] = [];
      const S = sim.current;
      const quietNow = quiet;
      simStep(S, t, dt, { quiet: quietNow, still });
      const card = (slug: string) => d.cards.find((m) => m.slug === slug);
      // desks: one per member that holds one, with its live monitor
      const slotsNow: Record<string, { x: number; y: number }> = {};
      const drawnAt = new Map<string, { x: number; y: number }>(); // each figure's feet as drawn: the director's focus
      for (const m of S.members.values()) {
        const c0 = card(m.slug);
        const dk = desk(m.desk).desk;
        slotsNow[m.slug] = { x: dk.x, y: dk.y };
        const storm = stormStart.current.get(m.slug);
        const handle = c0?.handle || c0?.name.slice(0, 5) || m.slug.slice(0, 5);
        const hover = hoverDesk.current === m.desk;
        // the big screen behind the seat (drawn before the member who sits in front of it), then the desk
        if (c0) {
          const big = deskScreen(c0, { noise: storm !== undefined && t - storm < NOISE_MS });
          items.push({ key: dk.y * TILE + SCREEN.y + SCREEN.h, draw: () => drawDeskScreen(c, dk.x, dk.y, big, t, { hover, cssPerRoom: scale.css / W, k: scale.k, postsOnly: true }) });
        }
        items.push({ key: dk.y * TILE + 12, draw: () => drawDesk(c, dk.x, dk.y, handle, day.lamps) });
      }
      const slotKey = JSON.stringify(slotsNow);
      if (slotKey !== slotsKey.current) {
        slotsKey.current = slotKey;
        setSlots(slotsNow);
      }
      for (const g of figures(S, t, { quiet: quietNow, still })) {
        const m = S.members.get(g.slug)!;
        const c0 = card(g.slug);
        const anim = m.anim;
        const walking = g.pose === "walk";
        const onSofa = g.where === "sofa";
        const fp = feet(g.pos, onSofa);
        const p = { x: fp.x, y: fp.y - (walking && Math.floor(t / 160) % 2 ? 1 : 0) }; // a small bob as it walks
        const look = lookOf(g.slug);
        const grey = anim === "lost";
        const fr = Math.floor(t / (g.pose === "type" || g.pose === "use" ? 220 : 160));
        if (g.where === "desk") items.push({ key: p.y - 0.5, draw: () => drawChair(c, p.x + 1, p.y) });
        items.push({ key: p.y, draw: () => drawFigure(c, p.x, p.y, look, g.pose as Pose, still ? 0 : fr, grey, g.facing, !onSofa && g.where !== "desk") });
        hitList.push({ kind: "member", slug: g.slug, x: p.x, y: p.y });
        drawnAt.set(g.slug, p);
        const head = p.y - (look.accessory === "crown" || look.accessory === "beanie" ? 24 : 21);
        if (!walking && anim === "resting") {
          items.push({ key: p.y + 1, draw: () => drawCup(c, p.x + 7, p.y - 3, t) });
          overlays.push(() => {
            drawZzz(c, p.x + 3, head - 1, t);
            const until = c0 ? restUntil(c0.state) : "";
            if (until) drawClock(c, p.x, head - 9 - (Math.floor(t / 600) % 2), until); // floats gently over the sleeper
          });
        }
        if (!walking && anim === "blocked") overlays.push(() => drawSign(c, p.x, head, "!"));
        if (!walking && c0?.state.word === "paused") overlays.push(() => drawSign(c, p.x, head, "II"));
        if (anim === "lost") overlays.push(() => drawSign(c, p.x, head, "?"));
        if ((storms.current.get(g.slug) ?? 0) > t) overlays.push(() => drawStorm(c, p.x, head - (anim === "blocked" ? 11 : 1), t));
        const bub = bubbles.current.find((b) => b.slug === g.slug && b.until > t);
        if (bub) overlays.push(() => drawBubble(c, p.x, head - 4, bub.text));
        if (w && w.kind === "member" && w.slug === g.slug) overlays.push(() => drawMarker(c, p.x, head - (bub ? 14 : 2), t));
      }
      items.push({ key: 11 * TILE + 17, draw: () => drawSofaFront(c) });
      // the sleeping corner: every confirmed sleeper on its own mat
      for (const slug of S.beds) {
        if (S.members.has(slug)) continue; // still walking there
        const s0 = d.stopped.find((x) => x.slug === slug);
        if (!s0) continue;
        const b = bedOf(S, slug);
        const x = b.x * TILE + 13;
        const y = Math.round(b.y * TILE + 4);
        items.push({
          key: y + 20,
          draw: () => {
            drawMat(c, x, y, !!s0.retired);
            drawPerson(c, x, y, lookOf(slug), "lie", 0);
            text(c, s0.name.split(/[\s-]/)[0], x, y - 7, { size: 4, color: "#5b4f6b" }); // a retired one's grey mat carries an "R"
            // the owner's Stop: "owner 12:32: <reason>" under the mat, from the STOP file's first line
            if (s0.by === "owner") drawMatNote(c, `owner ${s0.at ?? ""}: ${s0.reason ?? ""}`, x, y + 11, 44);
          },
        });
        const i = S.beds.indexOf(slug);
        overlays.push(() => drawZzz(c, x + 6, y - 9, t + i * 500));
        hitList.push({ kind: "sleeper", slug, x, y: y + 4 });
        if (w && w.kind === "sleeper" && w.slug === slug) overlays.push(() => drawMarker(c, x, y - 12, t));
      }
      items.sort((a, b) => a.key - b.key).forEach((it) => it.draw());
      if (day.dark > 0) {
        c.fillStyle = `rgba(12, 16, 40, ${day.dark})`;
        c.fillRect(0, 0, W, H);
      }
      if (day.lamps) for (const m of sim.current.members.values()) drawLampGlow(c, desk(m.desk).desk.x, desk(m.desk).desk.y);
      if (quiet) {
        c.fillStyle = "rgba(12, 14, 32, 0.38)";
        c.fillRect(0, 0, W, H);
        drawShh(c);
      }
      // drafts on their way to the mailbox (1.4 s each)
      papers.current = papers.current.filter((p) => t - p.at < 1400);
      for (const p of papers.current) {
        const m = sim.current.members.get(p.slug);
        if (!m) continue;
        const dk = desk(m.desk).desk;
        overlays.push(() => drawPaper(c, { x: dk.x * TILE + 15, y: dk.y * TILE - 14 }, { x: MAILBOX.x * TILE + 8, y: 17 }, (t - p.at) / 1400));
      }
      overlays.forEach((o) => o());
      // made for video: the strip under the room (it also hides anything drawn past the room's front edge, as the
      // canvas edge did), the director's 2x inset on its left with who it shows and what that member just did beside
      // it, the ticker along the bottom
      if (L.height > H) {
        const focus = director.current.focus ? card(director.current.focus) : undefined;
        const lines = focus
          ? [focus.name, focus.state.word, focus.last ? `${focus.last.words} · ${focus.last.ago}` : ""]
          : ["The office, live", `${String(clock.getHours()).padStart(2, "0")}:${String(clock.getMinutes()).padStart(2, "0")} · ${d.cards.length} at work`, "nobody acting: a slow pan along the desks"];
        drawStrip(c, H, L.height, L.caption, lines.filter(Boolean));
      }
      if (v.director && L.inset) {
        director.current = directorStep(director.current, t, acted.current.splice(0), [...S.members.keys()]);
        const fs = director.current.focus;
        const src = insetSource(fs ? (drawnAt.get(fs) ?? null) : null, t);
        const dst = L.inset;
        const off = (offscreen.current ??= document.createElement("canvas"));
        if (off.width !== cv.width || off.height !== cv.height) Object.assign(off, { width: cv.width, height: cv.height });
        off.getContext("2d")?.drawImage(cv, 0, 0);
        c.save();
        c.beginPath();
        c.roundRect(dst.x, dst.y, dst.w, dst.h, 4);
        c.clip();
        c.drawImage(off, src.x * scale.k, src.y * scale.k, src.w * scale.k, src.h * scale.k, dst.x, dst.y, dst.w, dst.h);
        c.restore();
        drawInsetFrame(c, dst, fs ? (card(fs)?.name ?? "") : "");
      } else acted.current.length = 0;
      if (v.ticker && L.ticker) {
        const pass = drawTicker(c, tickerText(d.cards), tickerX.current, L.ticker);
        tickerX.current = tickerScroll(tickerX.current, still ? 0 : dt, tickerHover.current, pass);
      }
      hits.current = hitList;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [scale]);

  // A click or tap (on click, not pointer-down: a window opened on pointer-down would take the tap's click): a member or sleeper (nearest within its sprite), a nameplate (its Work plan row), the bulletin board or the mailbox.
  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * videoLayout(video).height;
    const hit = hits.current
      .map((h) => ({ h, d: Math.hypot(h.x - x, h.y - 9 - y) }))
      .filter(({ h, d }) => d < (h.kind === "sleeper" ? 14 : 12))
      .sort((a, b) => a.d - b.d)[0]?.h;
    if (hit) {
      setWin({ kind: hit.kind, slug: hit.slug });
      return move("member");
    }
    for (const sm of sim.current.members.values()) {
      const dk = desk(sm.desk).desk;
      const px = dk.x * TILE + NAMEPLATE.x;
      const py = dk.y * TILE + NAMEPLATE.y;
      if (x >= px - 1 && x <= px + NAMEPLATE.w + 1 && y >= py - 1 && y <= py + NAMEPLATE.h + 1) {
        // the read-only world (READ_ONLY) has no Work plan to open: the nameplate opens the member instead
        if (READ_ONLY) setWin({ kind: "member", slug: sm.slug });
        else router.push(`/work-plan#${sm.slug}`);
        return;
      }
      // the rest of the desk, monitor included: look over the member's shoulder
      if (x >= dk.x * TILE && x <= dk.x * TILE + DESK_W && y >= dk.y * TILE + MONITOR.y && y <= dk.y * TILE + 14) {
        setWin({ kind: "member", slug: sm.slug });
        move("desk");
        return;
      }
    }
    const inBox = (b: { x: number; y: number; w: number; h: number }, pad = 0) =>
      x >= b.x * TILE - pad && x <= (b.x + b.w) * TILE + pad && y >= b.y * TILE - pad - 12 && y <= (b.y + b.h) * TILE + pad;
    if (inBox(BULLETIN)) {
      setWin({ kind: "bulletin" });
      return move("member");
    }
    if (inBox(MAILBOX, 4)) {
      setWin({ kind: "mailbox" });
      return move("member");
    }
    setWin(null);
  };

  const cycle = (dir: 1 | -1) => {
    if (!order.length) return;
    const at = win && (win.kind === "member" || win.kind === "sleeper") ? order.findIndex((o) => o.slug === win.slug) : -1;
    const next = at < 0 ? (dir === 1 ? 0 : order.length - 1) : (at + dir + order.length) % order.length;
    setWin(order[next]);
    move("next");
  };
  const onKey = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      cycle(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      cycle(-1);
    } else if (e.key === "Escape") close();
    else if (e.key === "Tab") {
      // Tab walks the family while the room has focus; past the last (or before the first) it leaves the room.
      const at = win && (win.kind === "member" || win.kind === "sleeper") ? order.findIndex((o) => o.slug === win.slug) : -1;
      const next = at + (e.shiftKey ? -1 : 1);
      if (next >= 0 && next < order.length) {
        e.preventDefault();
        setWin(order[next]);
      }
    }
  };
  // "/#mailbox" and "/#bulletin" open that panel
  useEffect(() => {
    const open = () => {
      const h = window.location.hash;
      if (h !== "#mailbox" && h !== "#bulletin") return;
      setWin({ kind: h === "#mailbox" ? "mailbox" : "bulletin" });
      setPanel((p) => panelNext(p, "member"));
      wrap.current?.scrollIntoView({ block: "start" });
    };
    const t = setTimeout(open, 0);
    window.addEventListener("hashchange", open);
    return () => {
      clearTimeout(t);
      window.removeEventListener("hashchange", open);
    };
  }, []);
  useEffect(() => {
    if (!win) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (wide ? setPanel((p) => panelNext(p, "close")) : setWin(null));
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [win, wide]);

  const cssW = scale.css;
  const memberSlug = win && win.kind === "member" ? win.slug : null;
  const tabbed = (
    <MemberTabs tab={memberSlug ? panel.tab : "info"} onTab={(t) => setPanel((p) => ({ ...p, tab: t }))} show={!!memberSlug}>
      {memberSlug && panel.tab !== "info" && !(READ_ONLY && panel.tab === "screen") ? (
        <Frame onClose={close}>
          {panel.tab === "screen" ? <ScreenTab slug={memberSlug} tick={data.at} last={data.cards.find((c) => c.slug === memberSlug)?.last ?? null} /> : <FeedTab slug={memberSlug} tick={data.at} />}
        </Frame>
      ) : (
        <TextBox data={data} win={win} latest={latest} onClose={close} />
      )}
    </MemberTabs>
  );
  return (
    <div className="mt-3 lg:flex lg:items-start lg:gap-3">
      <div ref={wrap} className="min-w-0 flex-1">
        <div className="mx-auto" style={{ maxWidth: cssW }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <p className="min-w-0 text-xs text-muted">{downtimeLine(data.down)}</p>
            {/* wraps under the line on a phone instead of pushing the page sideways */}
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            {(["director", "ticker", "lapse"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => toggleVideo(k)}
                aria-pressed={video[k]}
                disabled={k === "lapse" && !video.director}
                title={k === "director" ? "A 2x inset on whoever acts" : k === "ticker" ? "Live numbers along the bottom" : "Day and night at 10x (director mode)"}
                className="rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-40"
                style={video[k] ? { background: "#ff6600", color: "#1a0d00" } : undefined}
              >
                {k === "director" ? "Director" : k === "ticker" ? "Ticker" : "Time-lapse"}
              </button>
            ))}
            <button type="button" onClick={startRec} disabled={rec.state === "recording"} className="flex items-center gap-1.5 rounded-full bg-fill-3 px-3 py-1 text-xs font-semibold text-ink" title="The room for 60 s, as a WebM download; nothing is uploaded">
              {rec.state === "recording" ? <span className="h-2 w-2 animate-pulse rounded-full bg-[#d63b3b]" aria-hidden /> : null}
              {rec.state === "recording" ? "Recording…" : "Record 60 s"}
            </button>
            {rec.state === "unsupported" ? <span className="text-xs text-muted">Recording needs Chrome.</span> : null}
            <button type="button" onClick={toggleSound} aria-pressed={sound} className="flex shrink-0 items-center gap-1.5 rounded-full bg-fill-3 px-3 py-1 text-xs font-semibold text-ink">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" stroke="none" />
                {sound ? <path d="M11 5.5c1 .8 1 4.2 0 5M12.8 4c1.8 1.6 1.8 6.4 0 8" strokeLinecap="round" /> : <path d="M11 5.5l4 5M15 5.5l-4 5" strokeLinecap="round" />}
              </svg>
              {sound ? "Sound: on" : "Sound: off"}
            </button>
            </div>
          </div>
          <div className="relative" style={{ width: cssW, maxWidth: "100%" }}>
          <canvas
            ref={canvas}
            width={W * scale.k}
            height={Math.ceil(videoLayout(video).height * scale.k)}
            style={{ width: cssW, height: (cssW * videoLayout(video).height) / W, imageRendering: "pixelated" }}
            className="block max-w-full cursor-pointer rounded-xl ring-1 ring-line focus-visible:ring-2 focus-visible:ring-[#ff6600] focus-visible:outline-none"
            tabIndex={0}
            role="application"
            aria-label={`The office: ${members.length} members at work, ${data.stopped.length} asleep. Arrow keys or Tab pick a member, Escape closes.`}
            onClick={pick}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * W;
            const y = ((e.clientY - r.top) / r.height) * videoLayout(video).height;
            hoverDesk.current = null;
            const tk = videoLayout(video).ticker;
            tickerHover.current = !!tk && y >= tk.y; // the ticker pauses under the pointer
            for (const m of sim.current.members.values()) {
              const dk = desk(m.desk).desk;
              if (x >= dk.x * TILE && x <= dk.x * TILE + DESK_W && y >= dk.y * TILE + MONITOR.y && y <= dk.y * TILE + 14) hoverDesk.current = m.desk;
            }
          }}
          onPointerLeave={() => {
            hoverDesk.current = null;
            tickerHover.current = false;
          }}
            onKeyDown={onKey}
          />
          <ScreenLayer
            slots={slots}
            cards={data.cards}
            f={cssW / W}
            onOpen={(slug) => {
              setWin({ kind: "member", slug });
              move("member");
            }}
          />
          </div>
          {wide ? null : tabbed}
        </div>
      </div>
      {wide ? (
        // one panel that eases between open (380 px) and a thin strip; the room rescales as it goes
        <aside
          aria-label="Member panel"
          data-panel={panel.open ? "open" : "collapsed"}
          className={`sticky top-20 flex max-h-[calc(100vh-6rem)] shrink-0 flex-col overflow-hidden transition-[width] duration-300 ease-out motion-reduce:transition-none ${panel.open ? "w-[380px]" : "w-10"}`}
        >
          {panel.open ? (
            <div className="min-h-0 w-[380px] overflow-y-auto">{tabbed}</div>
          ) : (
            <button type="button" onClick={() => move("expand")} aria-label="Open the member panel" className="flex h-40 w-10 items-center justify-center rounded-xl border-4 border-[#1a0d00] bg-white text-lg font-bold text-[#1a0d00]">
              ‹
            </button>
          )}
        </aside>
      ) : null}
    </div>
  );
}

/** Desktop width: room and panel side by side (the 1400 px shell, Tailwind's lg). */
const WIDE = "(min-width: 1024px)";
function subscribeWide(cb: () => void) {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
const isWide = () => window.matchMedia(WIDE).matches;


/** The text box under the room: a member's dialogue, a sleeper's line, the bulletin board or the mailbox; with nothing
 *  picked, the newest speech bubble (read out to screen readers) and a hint. */
function TextBox({ data, win, latest, onClose }: { data: Board; win: Window | null; latest: { name: string; text: string } | null; onClose: () => void }) {
  const [ask, setAsk] = useState<{ action: Action; choice?: PauseFor } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ slug: string; ok: boolean; text: string } | null>(null);
  const target = win && (win.kind === "member" || win.kind === "sleeper") ? win.slug : null;
  const [seen, setSeen] = useState(target);
  if (seen !== target) {
    // another member picked: start its controls afresh
    setSeen(target);
    setAsk(null);
    setReason("");
  }
  async function send() {
    if (!ask || !target) return;
    setBusy(true);
    try {
      const res = await fetch("/api/controls", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bot: target, action: ask.action, for: ask.choice, reason }) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; text?: string; error?: string };
      setResult({ slug: target, ok: res.ok && body.ok !== false, text: body.text ?? body.error ?? `HTTP ${res.status}` });
    } catch {
      setResult({ slug: target, ok: false, text: "could not reach the dashboard" });
    } finally {
      setBusy(false);
      setAsk(null);
      setReason("");
    }
  }
  const [span, setSpan] = useState<"today" | "week">("today");
  let title = "";
  let lines: string[] = [];
  let links: { href: string; label: string }[] = [];
  let slug: string | null = null;
  let grey = false;
  let now: ReturnType<typeof nowLines> | null = null;
  if (win?.kind === "member") {
    const c = data.cards.find((x) => x.slug === win.slug);
    if (c) {
      const d = dialogue(c);
      now = nowLines(c);
      title = d.title;
      lines = span === "today" ? d.lines : week7Lines(data.week7?.[c.slug]);
      links = READ_ONLY ? [] : [{ href: d.href, label: "Goal and rules" }];
      slug = c.slug;
      grey = animOf(c.state) === "lost";
    }
  } else if (win?.kind === "sleeper") {
    const s = data.stopped.find((x) => x.slug === win.slug);
    if (s) {
      title = s.name;
      lines = [s.retired ? `Retired by the owner${s.since ? `, ${s.since}` : ""}. It has no launch agents until it is brought back.` : s.by === "owner" ? `Stopped by the owner, ${s.since.slice(5)} ${s.at ?? ""}: ${s.reason ?? ""}` : `Asleep: stopped by the owner, since ${s.since.slice(5)}.`];
      slug = s.slug;
    }
  } else if (win?.kind === "bulletin") {
    if (!READ_ONLY) return <BulletinPrompt data={data} onClose={onClose} />;
    title = "Bulletin board";
    lines = ["The owner's decisions and the CEO's proposals are answered on the dashboard; they are not shown here."];
  } else if (win?.kind === "mailbox") {
    title = "Mailbox";
    const w = data.week;
    lines = w
      ? [`${w.drafts} drafts waiting to be sent.`, `${w.sent} sent this week, ${w.replies} repl${w.replies === 1 ? "y" : "ies"} this week.`]
      : [data.team?.ready ? `${data.team.unsent ?? "—"} drafts waiting to be sent.` : "The Leads board numbers are not in yet."];
  }
  return (
    <div className="rounded-xl border-4 border-[#1a0d00] bg-white px-4 py-3 font-sans text-sm text-[#1a0d00] shadow-[0_3px_0_#1a0d00] dark:bg-[#fffaf0]" aria-live="polite">
      {win && title ? (
        <div className="flex gap-3">
          {slug ? <Portrait slug={slug} grey={grey} /> : null}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="font-mono font-bold">{title}</p>
              {win.kind === "member" ? (
                <span role="group" aria-label="Period" className="ml-auto flex gap-1 text-xs">
                  {(["today", "week"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setSpan(k)}
                      aria-pressed={span === k}
                      className="rounded px-1.5 py-0.5 font-bold"
                      style={span === k ? { background: "#ff6600", color: "#1a0d00" } : undefined}
                    >
                      {k === "today" ? "Today" : "7 days"}
                    </button>
                  ))}
                </span>
              ) : null}
              <button type="button" onClick={onClose} className="-mt-1 -mr-1 rounded px-1.5 text-base leading-none hover:bg-black/5" aria-label="Close">
                ×
              </button>
            </div>
            {now ? <NowBlock now={now} /> : null}
            {target && !READ_ONLY ? (
              <Controls
                name={data.cards.find((c) => c.slug === target)?.name ?? data.stopped.find((s) => s.slug === target)?.name ?? target}
                stopped={win.kind === "sleeper"}
                retired={!!data.stopped.find((s) => s.slug === target)?.retired}
                paused={data.cards.find((c) => c.slug === target)?.state.word === "paused"}
                ask={ask}
                setAsk={setAsk}
                reason={reason}
                setReason={setReason}
                busy={busy}
                onYes={() => void send()}
                result={result?.slug === target ? result : null}
              />
            ) : null}
            <ul className="mt-1 space-y-1">
              {lines.map((l, i) => (
                <li key={i} className="break-words">
                  {l}
                </li>
              ))}
            </ul>
            {links.length ? (
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {links.map((l) => (
                  <a key={l.href} href={l.href} className="font-bold underline decoration-[#ff6600] decoration-2 underline-offset-2">
                    {l.label} →
                  </a>
                ))}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="break-words">
          {latest ? (
            <>
              <b>{latest.name}:</b> {latest.text}
              <span className="mt-1 block text-xs opacity-70">Tap a member, the bulletin board or the mailbox.</span>
            </>
          ) : (
            "Tap a member to see what they are working on, or the bulletin board and the mailbox."
          )}
        </p>
      )}
    </div>
  );
}

/** The member panel's tabs over its box: Info (the text box), Screen (what the bot sees), Feed (its last 20 actions). */
function MemberTabs({ tab, onTab, show, children }: { tab: PanelTab; onTab: (t: PanelTab) => void; show: boolean; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      {show ? (
        <div role="tablist" aria-label="Member" className="mb-1 flex gap-1 font-mono text-xs font-bold">
          {/* the read-only world: Info and Feed only (no Screen: a lead's own web page) */}
          {(READ_ONLY ? (["info", "feed"] as const) : (["info", "screen", "feed"] as const)).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => onTab(t)}
              className="rounded-t-md border-2 border-b-0 border-[#1a0d00] px-3 py-1"
              style={tab === t ? { background: "#ff6600", color: "#1a0d00" } : { background: "#ffffff", color: "#1a0d00" }}
            >
              {t === "info" ? "Info" : t === "screen" ? "Screen" : "Feed"}
            </button>
          ))}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** The text box's frame, for the Screen and Feed tabs. */
function Frame({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="relative rounded-xl border-4 border-[#1a0d00] bg-white px-4 py-3 text-sm text-[#1a0d00] shadow-[0_3px_0_#1a0d00] dark:bg-[#fffaf0]">
      <button type="button" onClick={onClose} className="absolute top-1 right-1.5 rounded px-1.5 text-base leading-none hover:bg-black/5" aria-label="Close">
        ×
      </button>
      {children}
    </div>
  );
}

/** The owner's hand on a bot: Pause (30 min, 2 h, until tomorrow) or Resume, and Stop, for a member
 *  at work; Start for one asleep in the corner. Each asks first, Yes / No, with a one-line reason for the log; the
 *  result line is what the fleet script printed. */
function Controls(p: {
  name: string;
  stopped: boolean;
  retired: boolean;
  paused: boolean;
  ask: { action: Action; choice?: PauseFor } | null;
  setAsk: (a: { action: Action; choice?: PauseFor } | null) => void;
  reason: string;
  setReason: (r: string) => void;
  busy: boolean;
  onYes: () => void;
  result: { ok: boolean; text: string } | null;
}) {
  const btn = "rounded-md border-2 border-[#1a0d00] px-2 py-0.5 text-xs font-bold disabled:opacity-50";
  if (p.busy)
    return <p className="mt-2 text-xs">{p.ask?.action === "start" || p.ask?.action === "bringback" ? "Starting… this can take up to two minutes." : "Working…"}</p>;
  if (p.ask)
    return (
      <div className="mt-2 rounded-md bg-[#fff5e8] p-2">
        <p className="font-bold">{confirmText(p.ask.action, p.name, p.ask.choice)}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <input value={p.reason} onChange={(e) => p.setReason(e.target.value)} maxLength={300} placeholder={p.ask?.action === "stop" ? "Reason (optional; shown on its mat)" : "Reason (one line, for the log)"} className="h-8 min-w-0 flex-1 rounded border-2 border-[#1a0d00] bg-white px-2 text-xs" />
          <BoxButton onClick={p.onYes}>▶ Yes</BoxButton>
          <button type="button" onClick={() => p.setAsk(null)} className={btn}>
            No
          </button>
        </div>
      </div>
    );
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {p.stopped ? (
          <button type="button" onClick={() => p.setAsk({ action: p.retired ? "bringback" : "start" })} className={btn}>
            {p.retired ? "Bring back" : "Start"}
          </button>
        ) : (
          <>
            {p.paused ? (
              <button type="button" onClick={() => p.setAsk({ action: "resume" })} className={btn}>
                Resume
              </button>
            ) : (
              <>
                <span className="font-bold">Pause:</span>
                {(["30m", "2h", "tomorrow"] as const).map((c) => (
                  <button key={c} type="button" onClick={() => p.setAsk({ action: "pause", choice: c })} className={btn}>
                    {c === "30m" ? "30 min" : c === "2h" ? "2 h" : "until tomorrow"}
                  </button>
                ))}
              </>
            )}
            <button type="button" onClick={() => p.setAsk({ action: "stop" })} className={`${btn} ml-auto`}>
              Stop
            </button>
          </>
        )}
      </div>
      {p.result ? <p className={`mt-1.5 text-xs break-words ${p.result.ok ? "" : "text-[#b42318]"}`}>{p.result.text}</p> : null}
    </div>
  );
}

/** The bulletin board as a prompt: each open CEO proposal in turn with Yes / No and a note,
 *  answered with the same POST as the proposals box; then each open decision with its options, Done and Later, answered
 *  with the same POST as the decisions box. */
function BulletinPrompt({ data, onClose }: { data: Board; onClose: () => void }) {
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const prompt = nextPrompt({ proposals: data.proposals ?? [], decisions: data.decisions ?? [] }, answered);
  const done = (id: string) => setAnswered((s) => new Set(s).add(id));
  const router = useRouter();
  const decision = useDecisionAnswer(() => {
    done(prompt.id);
    setNote("");
    router.refresh(); // the decisions box under the banner
  });
  async function answer(yes: boolean) {
    if (prompt.kind !== "proposal") return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/ceo-proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(answerBody(prompt.id, yes, note)) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        done(prompt.id);
        setNote("");
      } else setError(body.error ?? `could not save (${res.status})`);
    } catch {
      setError("could not reach the dashboard");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-xl border-4 border-[#1a0d00] bg-white px-4 py-3 font-mono text-sm text-[#1a0d00] shadow-[0_3px_0_#1a0d00] dark:bg-[#fffaf0]" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold">{prompt.title}</p>
        <button type="button" onClick={onClose} className="-mt-1 -mr-1 rounded px-1.5 text-base leading-none hover:bg-black/5" aria-label="Close">
          ×
        </button>
      </div>
      <ul className="mt-1 max-h-64 space-y-1 overflow-y-auto">
        {prompt.lines.map((l, i) => (
          <li key={i} className="break-words">
            {l}
          </li>
        ))}
      </ul>
      {prompt.kind === "proposal" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="Note (optional)"
            className="h-8 min-w-0 flex-1 rounded border-2 border-[#1a0d00] bg-white px-2 text-xs"
            disabled={busy}
          />
          <BoxButton onClick={() => void answer(true)} disabled={busy}>
            ▶ Yes
          </BoxButton>
          <button type="button" onClick={() => void answer(false)} disabled={busy} className="rounded-md border-2 border-[#1a0d00] px-2.5 py-1 text-xs font-bold disabled:opacity-50">
            No
          </button>
        </div>
      ) : prompt.kind === "decision" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {prompt.link ? (
            <a href={prompt.link.href} className="w-full text-xs font-bold underline underline-offset-2">
              {prompt.link.label}
            </a>
          ) : null}
          {prompt.options.map((o) => (
            <BoxButton key={o} onClick={() => void decision.answer(prompt.id, "choose", note, o)} disabled={decision.busy !== null}>
              ▶ {o}
            </BoxButton>
          ))}
          {(["done", "later"] as const).map((a) => (
            <button key={a} type="button" onClick={() => void decision.answer(prompt.id, a, note)} disabled={decision.busy !== null} className="rounded-md border-2 border-[#1a0d00] px-2.5 py-1 text-xs font-bold disabled:opacity-50" title={a === "later" ? "Hide it for three days" : undefined}>
              {a === "done" ? "Done" : "Later"}
            </button>
          ))}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="Note (optional)"
            aria-label="Note"
            className="h-8 min-w-0 flex-1 rounded border-2 border-[#1a0d00] bg-white px-2 text-xs"
            disabled={decision.busy !== null}
          />
          {decision.error ? <p className="w-full text-xs text-[#b42318]">{decision.error}</p> : null}
        </div>
      ) : null}
      {error ? <p className="mt-1 text-xs text-[#b42318]">{error}</p> : null}
    </div>
  );
}

function BoxButton({ onClick, children, disabled = false }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="rounded-md px-2.5 py-1 text-xs font-bold text-[#1a0d00] disabled:opacity-50" style={{ background: "#ff6600" }}>
      {children}
    </button>
  );
}

/** The member's four lines (output and goal, the item it is on, provider and freshness, the last 30 minutes' allowed
 *  actions) in JetBrains Mono at 14 px, and its refused share over a thin meter. */
function NowBlock({ now }: { now: ReturnType<typeof nowLines> }) {
  const pct = now.refused === null ? null : Math.round(now.refused * 100);
  return (
    <div className="mt-2 rounded-lg bg-[#fbf6ee] px-3 py-2 text-[14px] leading-normal" style={{ fontFamily: "var(--font-screen), ui-monospace, Menlo, monospace" }}>
      {now.word !== "working" ? <p className="mb-1 inline-block rounded-md bg-[#ff6600] px-2 py-0.5 font-bold text-[#1a0d00]">{now.word}</p> : null}
      {now.lines.map((l, i) => (
        <p key={i} className={`truncate ${i === 1 ? "font-bold" : ""}`} title={l}>
          {l}
        </p>
      ))}
      {pct !== null ? (
        <>
          <p className="mt-1">{pct}% refused</p>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#e6dfd3]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Share of actions refused today">
            <div className="h-full rounded-full bg-[#ff6600]" style={{ width: `${pct}%` }} />
          </div>
        </>
      ) : null}
    </div>
  );
}

/** The desks' screens as HTML over the canvas, so their text stays sharp at any window size (canvas text at 14 px
 *  came out at about 7 px and blurred). Each box stands at its desk's room coordinates times the canvas's CSS scale:
 *  the name tab on top (a state other than working as an orange badge), the four lines and the refused share over a
 *  meter, in JetBrains Mono at 14 px (13 px in the narrow forms, never smaller). By width (screenForm): full, compact
 *  (the tab and the item; the four lines on hover or focus) or tiny (phone). The whole box opens the member's card. */
function ScreenLayer({ slots, cards, f, onOpen }: { slots: Record<string, { x: number; y: number }>; cards: Board["cards"]; f: number; onOpen: (slug: string) => void }) {
  const w = SCREEN.w * f;
  const h = SCREEN.h * f;
  const { form, lines: fit } = screenForm(w, h);
  const compact = form !== "full";
  const tiny = form === "tiny";
  return (
    <div className="pointer-events-none absolute inset-0" style={{ fontFamily: "var(--font-screen), ui-monospace, Menlo, monospace" }}>
      {cards.map((c) => {
        const at = slots[c.slug];
        if (!at) return null;
        const sc = deskScreen(c);
        const lines = sc.lines;
        const dark = sc.mode === "dark";
        const bg = dark ? "#1b2030" : sc.mode === "alert" ? "#fde8e6" : sc.mode === "dim" ? "#e6e3dc" : "#fbfaf6";
        const ink = dark ? "#e6e9f2" : sc.mode === "alert" ? "#8a1c13" : "#1a0d00";
        const soft = dark ? "#aab3cc" : "#4d4d4d";
        const pct = sc.share === null ? null : Math.round(sc.share * 100);
        const mark = sc.mark === "web" ? "#d63b3b" : sc.mark === "search" ? "#ff6600" : "";
        const row = (l: string, i: number, all = false) => (
          <p key={i} className={`truncate leading-[1.2] ${i === 1 ? "font-bold" : ""}`} style={{ color: i === 1 ? ink : soft }} title={all ? undefined : l}>
            {i === 1 && mark ? <span aria-hidden className="mr-1 inline-block size-[7px] align-middle" style={{ background: mark }} /> : null}
            {l}
          </p>
        );
        return (
          <button
            key={c.slug}
            type="button"
            onClick={() => onOpen(c.slug)}
            aria-label={`${c.name}, ${sc.word}: ${lines.join(", ")}. Open its card.`}
            className="group pointer-events-auto absolute text-left focus-visible:outline-2 focus-visible:outline-[#ff6600]"
            style={{ left: (at.x * TILE + SCREEN.x) * f, top: (at.y * TILE + SCREEN.y) * f, width: w, ...(tiny ? { height: h } : { minHeight: h }) }}
          >
            <span className="absolute bottom-full left-[-2px] mb-[2px] flex max-w-[calc(100%+4px)] items-stretch border-2 border-[#26282e] bg-[#fbfaf6] font-bold text-[#1a0d00]" style={{ fontSize: compact ? 13 : 14, lineHeight: 1.25 }}>
              <span className="truncate px-1" style={tiny && sc.word !== "working" ? { boxShadow: "inset 0 -3px 0 #ff6600" } : undefined}>
                {c.name}
              </span>
              {sc.word !== "working" && !tiny ? <span className="shrink-0 truncate bg-[#ff6600] px-1 text-[#1a0d00]">{sc.word}</span> : null}
            </span>
            <span className={`block overflow-hidden border-2 border-[#26282e] ${tiny ? "h-full px-1 py-0.5" : "px-1.5 py-1"}`} style={{ background: bg, fontSize: compact ? 13 : 14, ...(tiny ? {} : { minHeight: h }) }}>
              {compact ? (
                <span className="font-bold leading-[1.2] [overflow-wrap:normal]" style={{ color: ink, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: tiny ? fit : 3, overflow: "hidden" }}>
                  {mark ? <span aria-hidden className="mr-1 inline-block size-[7px] align-middle" style={{ background: mark }} /> : null}
                  {lines[1] ?? lines[0] ?? ""}
                </span>
              ) : (
                lines.map((l, i) => row(l, i))
              )}
              {!compact && pct !== null ? (
                <>
                  <span className="block truncate leading-[1.2]" style={{ color: soft }}>
                    {pct}% refused
                  </span>
                  <span className="mt-0.5 block h-[3px] w-full" style={{ background: dark ? "#3a4258" : "#e2dccf" }}>
                    <span className="block h-full bg-[#ff6600]" style={{ width: `${pct}%` }} />
                  </span>
                </>
              ) : null}
            </span>
            {compact ? (
              <span className="absolute top-full left-0 z-20 mt-1 hidden w-[220px] max-w-[80vw] border-2 border-[#26282e] px-2 py-1 text-[13px] shadow-lg group-hover:block group-focus-visible:block" style={{ background: bg }}>
                {lines.map((l, i) => row(l, i, true))}
                {pct !== null ? <span className="block leading-[1.2]" style={{ color: soft }}>{pct}% refused</span> : null}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
