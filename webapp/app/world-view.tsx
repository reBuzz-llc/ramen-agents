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
  monitorOf,
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
} from "@/lib/world";
import Portrait from "./portrait";
import { chime, click, pageFlip, rememberSound, soundState, soundWanted, unlockSound } from "./world-sound";
import { useDecisionAnswer } from "./decision-actions";
import { FeedTab, ScreenTab } from "./member-tabs";
import {
  drawBubble,
  drawChair,
  drawCup,
  drawFigure,
  drawClock,
  drawDesk,
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
const MAX_CSS = 1040;

type Hit = { kind: "member" | "sleeper"; slug: string; x: number; y: number };
type Window = { kind: "member" | "sleeper"; slug: string } | { kind: "bulletin" } | { kind: "mailbox" };

const feet = (p: Pt, onSofa: boolean) => ({ x: p.x * TILE + 8, y: onSofa ? 11 * TILE + 6 : p.y * TILE + 16 });

export default function World({ data }: { data: Board }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState({ k: 2, dpr: 1, css: 640 });
  const [win, setWin] = useState<Window | null>(null);
  const [latest, setLatest] = useState<{ name: string; text: string } | null>(null);
  // The member panel (queues 24, 25): right of the room on desktop, under it on a phone; tabs Info, Screen, Feed.
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
      const day = dayPhase(clock.getHours(), clock.getMinutes());
      c.setTransform(scale.k, 0, 0, scale.k, 0, 0);
      c.imageSmoothingEnabled = false;
      c.clearRect(0, 0, W, H);
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
      for (const m of S.members.values()) {
        const c0 = card(m.slug);
        const dk = desk(m.desk).desk;
        const storm = stormStart.current.get(m.slug);
        const screen = c0 ? monitorOf(c0, { compact: scale.css / W < 2, noise: storm !== undefined && t - storm < NOISE_MS }) : { mode: "dim" as const, bar: "", lines: [] };
        const handle = c0?.handle || c0?.name.slice(0, 5) || m.slug.slice(0, 5);
        const hover = hoverDesk.current === m.desk;
        items.push({ key: dk.y * TILE + 12, draw: () => drawDesk(c, dk.x, dk.y, handle, screen, t, day.lamps, hover) });
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
    const y = ((e.clientY - r.top) / r.height) * H;
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
        router.push(`/work-plan#${sm.slug}`);
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
  // "/#mailbox" and "/#bulletin" open that panel (queue 31: a decision's link lands on the mailbox)
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
      {memberSlug && panel.tab !== "info" ? (
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
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="min-w-0 text-xs text-muted">{downtimeLine(data.down)}</p>
            <button type="button" onClick={toggleSound} aria-pressed={sound} className="flex shrink-0 items-center gap-1.5 rounded-full bg-fill-3 px-3 py-1 text-xs font-semibold text-ink">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" stroke="none" />
                {sound ? <path d="M11 5.5c1 .8 1 4.2 0 5M12.8 4c1.8 1.6 1.8 6.4 0 8" strokeLinecap="round" /> : <path d="M11 5.5l4 5M15 5.5l-4 5" strokeLinecap="round" />}
              </svg>
              {sound ? "Sound: on" : "Sound: off"}
            </button>
          </div>
          <canvas
            ref={canvas}
            width={W * scale.k}
            height={H * scale.k}
            style={{ width: cssW, height: (cssW * H) / W, imageRendering: "pixelated" }}
            className="block max-w-full cursor-pointer rounded-xl ring-1 ring-line focus-visible:ring-2 focus-visible:ring-[#ff6600] focus-visible:outline-none"
            tabIndex={0}
            role="application"
            aria-label={`The office: ${members.length} members at work, ${data.stopped.length} asleep. Arrow keys or Tab pick a member, Escape closes.`}
            onClick={pick}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * W;
            const y = ((e.clientY - r.top) / r.height) * H;
            hoverDesk.current = null;
            for (const m of sim.current.members.values()) {
              const dk = desk(m.desk).desk;
              if (x >= dk.x * TILE && x <= dk.x * TILE + DESK_W && y >= dk.y * TILE + MONITOR.y && y <= dk.y * TILE + 14) hoverDesk.current = m.desk;
            }
          }}
          onPointerLeave={() => (hoverDesk.current = null)}
            onKeyDown={onKey}
          />
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
  if (win?.kind === "member") {
    const c = data.cards.find((x) => x.slug === win.slug);
    if (c) {
      const d = dialogue(c);
      title = d.title;
      lines = span === "today" ? d.lines : week7Lines(data.week7?.[c.slug]);
      links = [{ href: d.href, label: "Goal and rules" }];
      slug = c.slug;
      grey = animOf(c.state) === "lost";
    }
  } else if (win?.kind === "sleeper") {
    const s = data.stopped.find((x) => x.slug === win.slug);
    if (s) {
      title = s.name;
      lines = [s.retired ? `Retired by the owner${s.since ? `, ${s.since}` : ""}. It has no launch agents until it is brought back.` : `Asleep: stopped by the owner, since ${s.since.slice(5)}.`];
      slug = s.slug;
    }
  } else if (win?.kind === "bulletin") {
    return <BulletinPrompt data={data} onClose={onClose} />;
  } else if (win?.kind === "mailbox") {
    title = "Mailbox";
    const w = data.week;
    lines = w
      ? [`${w.drafts} drafts waiting to be sent.`, `${w.sent} sent this week, ${w.replies} repl${w.replies === 1 ? "y" : "ies"} this week.`]
      : [data.team?.ready ? `${data.team.unsent ?? "—"} drafts waiting to be sent.` : "The Leads board numbers are not in yet."];
  }
  return (
    <div className="rounded-xl border-4 border-[#1a0d00] bg-white px-4 py-3 font-mono text-sm text-[#1a0d00] shadow-[0_3px_0_#1a0d00] dark:bg-[#fffaf0]" aria-live="polite">
      {win && title ? (
        <div className="flex gap-3">
          {slug ? <Portrait slug={slug} grey={grey} /> : null}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="font-bold">{title}</p>
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
            {target ? (
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
          {(["info", "screen", "feed"] as const).map((t) => (
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
          <input value={p.reason} onChange={(e) => p.setReason(e.target.value)} maxLength={300} placeholder="Reason (one line, for the log)" className="h-8 min-w-0 flex-1 rounded border-2 border-[#1a0d00] bg-white px-2 text-xs" />
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
 *  with the same POST as the decisions box (queue 32). */
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
