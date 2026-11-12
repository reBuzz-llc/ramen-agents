"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { WebData } from "@/lib/board";
import type { Board } from "@/lib/board-read";
import {
  animOf,
  BULLETIN,
  dialogue,
  figures,
  downtimeLine,
  lookOf,
  screenFor,
  placeOf,
  carouselFrames,
  SKY_BAND_BOTTOM,
  WAKE_HOLD_MS,
  carouselStep,
  newCarousel,
  pageCard,
  SCREEN,
  MAILBOX,
  TERMINAL_BOX,
  webTitle,
  hasChat,
  savedTab,
  saveTab,
  unreadReplies,
  answerBody,
  bedOf,
  confirmText,
  dayPhase,
  MAX_DESKS,
  newSim,
  actAnim,
  airPoll,
  airStep,
  aloft,
  AIR_MAX,
  LANDING_MS,
  separate,
  wanderAt,
  wingColor,
  cardRect,
  insectAt,
  insectCard,
  flyerOf,
  beeBob,
  insectPose,
  newAir,
  takeoffLeg,
  TAKEOFF_MS,
  type AirMsg,
  errandOf,
  isStuck,
  newActs,
  newFlags,
  planeTo,
  simErrand,
  weatherOf,
  type ActAnim,
  nextPrompt,
  panelNext,
  type Panel,
  type PanelTab,
  restUntil,
  simPoll,
  simWeb,
  terminalShows,
  simStep,
  stormOf,
  TILE,
  type Bubble,
  type Action,
  type PauseFor,
  type Pt,
  week7Lines,
  figureKey,
  placeDrawn,
  screenKey,
  wallKey,
  binCount,
  moveOf,
  paceOffset,
  personaRects,
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
  boatOut,
  gagFigure,
  newPranks,
  busyOf,
  betweenSteps,
  betweenWhy,
  gagWhy,
  prankStep,
  screenFoot,
  screenForm,
  screenFeed,
  type FeedLine,
} from "@/lib/world";
import { usePoll } from "./hooks";
import { READ_ONLY } from "./world-mode";
import Portrait from "./portrait";
import { chime, playCue, rememberSound, soundState, soundWanted, unlockSound } from "./world-sound";
import { actCue, ambientDue, armUnlock, newSoundPlan, pickCue, woke, type Cue } from "@/lib/sound-plan";
import { useChatSeen } from "./chat-seen";
import { useDecisionAnswer } from "./decision-actions";
import { ChatTab, FeedTab, ScreenTab, WebTab } from "./member-tabs";
import {
  drawBigScreen,
  drawBird,
  drawBee,
  drawInsectCard,
  drawButterfly,
  drawFlash,
  drawProp,
  drawRain,
  drawFloating,
  drawBubble,
  drawScene,
  drawWall,
  drawBin,
  drawGag,
  drawInsetFrame,
  drawTicker,
  drawStrip,
  drawFigure,
  drawClock,
  drawMarker,
  drawReplyDot,
  drawMat,
  drawPerson,
  drawMatNote,
  BADGE_GOOD,
  setScreenFace,
  drawShh,
  drawSign,
  drawStorm,
  drawZzz,
  H,
  text,
  W,
  type Pose,
} from "./world-draw";

// The lakeside world (queue 37; the office of queue 17 before it): the running members at their big screens on the
// terrace, the owner-stopped ones asleep under the tree, all driven by /api/board (the poll in family-board.tsx). The
// canvas animates between polls; a click, a tap or the arrow keys pick a member and the panel says what it is doing.

const STORM_MS = 60_000;
const NOISE_MS = 4000; // the screen shows static for the first seconds of a model failure
const MAX_CSS = 2400; // the world fits the window's width (queue 258): a wide window gives bigger screens

type Hit = { kind: "member" | "sleeper"; slug: string; x: number; y: number };
type Window = { kind: "member" | "sleeper"; slug: string } | { kind: "bulletin" } | { kind: "mailbox" } | { kind: "web" };

const feet = (p: Pt) => ({ x: p.x * TILE + 8, y: p.y * TILE + 16 });
const inRect = (b: { x: number; y: number; w: number; h: number }, x: number, y: number) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
/** A member's screen on the canvas, in room pixels: clicked, it opens the member's Screen tab. */
const screenBox = (sim: ReturnType<typeof newSim>, slug: string) => {
  const sc = placeOf(sim, slug).screen;
  return { x: sc.x * TILE, y: sc.y * TILE, w: SCREEN.w, h: SCREEN.h };
};

export default function World({ data, below }: { data: Board; below?: React.ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState({ k: 2, dpr: 1, css: 640 });
  // where each member's screen is, in room px (from the animation loop, only when it changes): its HTML box (queue 258)
  const [slots, setSlots] = useState<Record<string, { x: number; y: number; flag?: string }>>({});
  const slotsKey = useRef("");
  // the screens' face (queue 232): JetBrains Mono, loaded by the layout as --font-screen; the canvas draws with it once
  // the browser has it (until then the monospace fallback)
  useEffect(() => {
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-screen");
    setScreenFace(family);
    if (family.trim()) for (const f of [`14px ${family}`, `bold 14px ${family}`]) void document.fonts?.load(f).catch(() => undefined);
  }, []);
  const [win, setWin] = useState<Window | null>(null);
  const [latest, setLatest] = useState<{ name: string; text: string } | null>(null);
  // The member panel (queues 24, 25): right of the room on desktop, under it on a phone; tabs Info, Screen, Feed.
  const wide = useSyncExternalStore(subscribeWide, isWide, () => false);
  const [panel, setPanel] = useState<Panel>({ open: true, tab: "info" });
  // the last tab comes back after a reload (queue 36), read after mount like the sound setting
  const restored = useRef(false); // save only after the remembered tab is back, never the first render's "info"
  useEffect(() => {
    const t = setTimeout(() => {
      setPanel((p) => ({ ...p, tab: savedTab() }));
      restored.current = true;
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (restored.current) saveTab(panel.tab);
  }, [panel.tab]);
  const move = (ev: Parameters<typeof panelNext>[1]) => setPanel((p) => panelNext(p, ev));
  const close = () => (wide ? move("close") : setWin(null));
  const [sound, setSound] = useState(false); // off by default; remembered per browser, started from the toggle
  const soundRef = useRef(false);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);
  useEffect(() => {
    const t = setTimeout(() => setSound(soundWanted()), 0);
    // a restored "on" starts audio on the first click or key anywhere (queue 59: it stayed silent until toggled)
    const disarm = armUnlock(window, soundWanted(), unlockSound);
    return () => {
      clearTimeout(t);
      disarm();
    };
  }, []);
  // which sound when (queue 59): one cue a poll, a refusal's thud once a minute, an ambient one-shot every 90-120 s
  const soundPlan = useRef(newSoundPlan(5959, 0));
  const states = useRef(new Map<string, string>());
  useEffect(() => {
    soundPlan.current.ambientAt = Math.max(soundPlan.current.ambientAt, performance.now() + 90_000);
    const t = setInterval(() => {
      if (!soundRef.current) {
        soundPlan.current.ambientAt = Math.max(soundPlan.current.ambientAt, performance.now() + 90_000); // never one the moment it is switched on
        return;
      }
      const k = ambientDue(soundPlan.current, performance.now());
      if (k) playCue(k);
    }, 5000);
    return () => clearInterval(t);
  }, []);
  // queue 47 part 5: made for video. All off by default and remembered per browser.
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
  const acted = useRef<string[]>([]);
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
      a.download = `lakeside-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      recorder.current = null;
    };
    mr.start(1000);
    recorder.current = mr;
  };
  useEffect(() => {
    if (rec.state === "idle") return;
    const id = setInterval(() => {
      const { rec: n, stop } = recTick(rec, Date.now());
      if (stop && recorder.current?.state === "recording") recorder.current.stop();
      if (n !== rec) setRec(n);
    }, 500);
    return () => clearInterval(id);
  }, [rec]);
  const toggleSound = () => {
    const on = !sound;
    setSound(on);
    rememberSound(on);
    if (on) unlockSound();
  };
  // for checks from the browser: nothing plays between events
  useEffect(() => {
    (window as unknown as { __worldSound?: () => string }).__worldSound = soundState;
    // and that the WEB terminal shows a visitor's domain (queue 33)
    (window as unknown as { __worldTerminal?: () => string | null }).__worldTerminal = () => terminalShows(sim.current);
    // and to record a walk (queue 45): send a member to the post box or the notice board, as an output would
    (window as unknown as { __worldErrand?: (slug: string, to: "post" | "notice") => void }).__worldErrand = (slug, to) => simErrand(sim.current, slug, to);
    // and where the butterflies and bees are (queue 51: to hover one in a check)
    (window as unknown as { __worldInsects?: () => { x: number; y: number; id: string }[] }).__worldInsects = () => butterfliesShown.current;
    // and a gag (queue 47): the spacing and the 5-minute rests cleared, the seeded scheduler picks the next one as it would
    (window as unknown as { __worldPrank?: () => void }).__worldPrank = () => Object.assign(pranks.current, { lastGag: -Infinity, gag: null, recent: {} });
    (window as unknown as { __worldGag?: () => unknown }).__worldGag = () => pranks.current.gag; // the gag playing, for a check
  }, []);
  const sim = useRef(newSim()); // who stands where, and walks where (lib/world.ts: simPoll, simStep, figures)
  const bubbles = useRef<Bubble[]>([]);
  const storms = useRef(new Map<string, number>());
  const stormStart = useRef(new Map<string, number>());
  const hits = useRef<Hit[]>([]);
  const hoverSlot = useRef<string | null>(null); // the member whose screen is under the pointer: its long lines scroll
  // the floating screens over the lake (queue 39): the carousel's state, whether the pointer pauses it, the pictures
  const carousel = useRef(newCarousel());
  const hoverFloat = useRef(false);
  // The panes wake while the pointer is over the sky and lake band and for WAKE_HOLD_MS after; a tap wakes them too.
  const wakeUntil = useRef(0);
  const wake = useRef(0); // 0 asleep (one small pane) .. 1 awake (three panes), eased
  const shots = useRef(new Map<string, HTMLImageElement>());
  const floats = useRef<{ rect: { x: number; y: number; w: number; h: number }; url: string }[]>([]);
  // queue 40: the newest action seen per bot, the animation playing at each, birds in flight, and who turned to the camera
  // for the owner's message; queue 46 and 51: the butterflies and bees carrying the family's messages
  const seenActs = useRef(new Map<string, number>());
  const air = useRef(newAir());
  const seenFlags = useRef(new Map<string, string>());
  const fx = useRef(new Map<string, { kind: ActAnim; start: number; until: number }>());
  const birds = useRef<{ slug: string; text: string; start: number }[]>([]);
  const butterfliesShown = useRef<{ x: number; y: number; id: string }[]>([]);
  // queue 51: the card of the butterfly or bee under the pointer, or tapped (under 1024 px, for 4 s)
  const hoverInsect = useRef<string | null>(null);
  const tapInsect = useRef<{ id: string; until: number } | null>(null);
  // queue 47 part 4: the filler gags, seeded so a replay plays the same ones; a real action ends one at once
  const pranks = useRef(newPranks(4747, 0));
  const realPlayed = useRef<string[]>([]); // who acted since the last frame: a gag with one of them as an actor ends
  const alerted = useRef(new Map<string, number>());
  const flashUntil = useRef(0); // the bulletin board's CEO note flashes when a proposal arrives
  const prevProposals = useRef<number | null>(null);
  // The family's web activity (queue 33): who opened or searched what, for the WEB terminal; same 12 s as the board.
  const web = usePoll<WebData>("web", 12000).data;
  // agents whose reply to the owner is not read yet (queue 35): a speech-bubble dot over them, a dot on the Chat tab
  const seen = useChatSeen();
  const unread = useMemo(() => new Set(unreadReplies(data.replies, seen)), [data.replies, seen]);
  const live = useRef({ data, win, web, unread, wide });
  useEffect(() => {
    // why no gag starts now, per member and for the room (queue 57)
    (window as unknown as { __worldGagWhy?: () => unknown }).__worldGagWhy = () => {
      const d = live.current.data;
      if (!d) return null;
      return gagWhy(
        pranks.current,
        performance.now(),
        [...sim.current.members.values()].map((m) => {
          const c1 = d.cards.find((x) => x.slug === m.slug);
          return { slug: m.slug, anim: m.anim, between: c1 ? betweenWhy(c1.act?.ts, c1.cycleSec, Date.now()) : "no card" };
        }),
      );
    };
  }, []);
  useEffect(() => {
    live.current = { data, win, web, unread, wide };
  }, [data, win, web, unread, wide]);
  useEffect(() => {
    if (web) simWeb(sim.current, web.perBot);
  }, [web]);

  const members = useMemo(() => data.cards.slice(0, MAX_DESKS), [data.cards]);
  const order = useMemo(() => [...members.map((c) => ({ kind: "member" as const, slug: c.slug })), ...data.stopped.map((s) => ({ kind: "sleeper" as const, slug: s.slug }))], [members, data.stopped]);

  // A new poll: into the room's simulation (debounced there); what really happened since the last one, animated (queue
  // 40: one animation per bot per poll, from its newest action, its chat and its Validator flags); a minute of storm for
  // a failing provider.
  useEffect(() => {
    const now = performance.now();
    simPoll(sim.current, data.cards, data.stopped);
    const acts = newActs(seenActs.current, data.cards);
    const cues: Cue[] = [];
    for (const { slug, act } of acts) {
      const kind = actAnim(act);
      if (kind) {
        fx.current.set(slug, { kind, start: now, until: now + (kind === "puff" ? 2000 : 2600) });
        realPlayed.current.push(slug); // a real action by an actor stops its gag at once (queue 57: only the actors)
        acted.current.push(slug); // and the director cuts to it
      }
      if (act.verdict === "allowed" && act.thought) bubbles.current = [...bubbles.current.filter((b) => b.slug !== slug), { slug, text: act.thought.slice(0, 60), until: now + 3000 }];
      if (kind === "flag") cues.push("chime");
      const ac = actCue(act);
      if (ac) cues.push(ac);
      const errand = errandOf(slug, act);
      if (errand) {
        realPlayed.current.push(slug);
        simErrand(sim.current, slug, errand);
        if (errand === "post") cues.push("flip");
      }
      const c = data.cards.find((x) => x.slug === slug);
      if (c && act.verdict === "allowed") setLatest({ name: c.name, text: act.thought || c.last?.words || act.type });
    }
    // a new message takes off (queue 46); reduced motion and quiet skip the flight
    const quietNow = [...sim.current.members.values()].some((m) => m.anim === "quiet");
    const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches || quietNow;
    const landingBefore = new Set(air.current.flights.filter((f) => f.phase === "landing").map((f) => f.msg.id));
    for (const msg of airPoll(air.current, data.messages ?? [], now, { instant })) {
      cues.push("click");
      const to = planeTo(msg.to, data.cards);
      if (msg.from === "Owner" && to.kind === "member") alerted.current.set(to.slug, now + 2000 + 3000); // turns to the camera with a "!" when it lands
    }
    for (const f of newFlags(seenFlags.current, data.flags)) birds.current.push({ slug: f.slug, text: f.text, start: now });
    // a bee that starts landing buzzes as it touches down
    for (const f of air.current.flights)
      if (f.phase === "landing" && !landingBefore.has(f.msg.id) && flyerOf(f.msg) === "bee" && soundRef.current) setTimeout(() => playCue("buzz"), LANDING_MS);
    // a member waking from a rest
    for (const c of data.cards) {
      if (woke(states.current.get(c.slug), c.state.word)) cues.push("rise");
      states.current.set(c.slug, c.state.word);
    }
    if (soundRef.current) {
      const cue = pickCue(soundPlan.current, now, cues);
      if (cue) playCue(cue);
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
  }, [data.cards, data.stopped, data.counts?.proposals, data.messages, data.flags]);

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
      const { data: d, win: w, web: wb, unread: un, wide: wd } = live.current;
      const quiet = [...sim.current.members.values()].some((m) => m.anim === "quiet"); // debounced, as the walks
      const clock = new Date();
      // window.__worldHour (a number) sets the scene's hour, for day and night screenshots; the Mac's clock otherwise
      const hourSet = (window as unknown as { __worldHour?: number }).__worldHour;
      const v = videoRef.current;
      // the director's time-lapse: day and night at 10x from now (visual only)
      if (v.director && v.lapse) lapse.current ??= { h: clock.getHours() + clock.getMinutes() / 60, t };
      else lapse.current = null;
      const lh = lapse.current ? lapseHour(lapse.current.h, lapse.current.t, t) : null;
      const day = typeof hourSet === "number" ? dayPhase(hourSet) : lh !== null ? dayPhase(Math.floor(lh), Math.floor((lh % 1) * 60)) : dayPhase(clock.getHours(), clock.getMinutes());
      c.setTransform(scale.k, 0, 0, scale.k, 0, 0);
      c.imageSmoothingEnabled = false;
      const L = videoLayout(v); // queue 50: the video parts get a strip under the scene, never over it
      c.clearRect(0, 0, W, L.height);
      drawScene(c, { day, flash: flashUntil.current > t, decisions: d.counts?.decisions ?? 0, proposals: d.counts?.proposals ?? 0, requests: d.counts?.requests ?? 0, drafts: d.week?.drafts ?? d.team?.unsent ?? null, web: wb ? { opens: wb.today.opens, shows: terminalShows(sim.current) } : null, t, boat: { out: boatOut(pranks.current.gag, t), rower: pranks.current.gag?.kind === "boat" && gagFigure(pranks.current.gag, pranks.current.gag.actors[0], t).hide ? lookOf(pranks.current.gag.actors[0]) : null } });
      // night falls on the scene only: the screens and the people stay readable
      if (day.dark > 0) {
        c.fillStyle = `rgba(12, 16, 40, ${day.dark})`;
        c.fillRect(0, 0, W, H);
      }
      // the family's last valid pages, floating over the lake
      const pages = wb?.recent_pages ?? [];
      const single = !wd;
      carousel.current = carouselStep(carousel.current, dt * 1000, { count: pages.length, paused: hoverFloat.current, quiet, still, single });
      const shown: typeof floats.current = [];
      const awakeNow = performance.now() < wakeUntil.current || hoverFloat.current;
      wake.current = still ? (awakeNow ? 1 : 0) : Math.max(0, Math.min(1, wake.current + (awakeNow ? dt : -dt) / 0.3));
      for (const f of carouselFrames(carousel.current, pages.length, single, wake.current)) {
        const pg = pages[f.index];
        let img: HTMLImageElement | null = null;
        if (pg.shot) {
          let el = shots.current.get(pg.shot);
          if (!el) {
            el = new Image();
            el.src = pg.shot;
            shots.current.set(pg.shot, el);
          }
          img = el.complete && el.naturalWidth > 0 ? el : null;
        }
        drawFloating(c, f, pageCard(pg), img, day.phase === "night");
        if (f.role !== "out") shown.push({ rect: f.rect, url: pg.url });
      }
      floats.current = shown;

      type Item = { key: number; draw: () => void };
      const items: Item[] = [];
      const overlays: (() => void)[] = [];
      const hitList: Hit[] = [];
      const S = sim.current;
      const quietNow = quiet;
      simStep(S, t, dt, { quiet: quietNow, still });
      const gag = prankStep(
        pranks.current,
        t,
        [...S.members.values()].map((m) => {
          const c1 = d.cards.find((x) => x.slug === m.slug);
          return { slug: m.slug, anim: m.anim, pos: m.pos, atShore: m.shore !== null && !m.path.length, between: !!c1 && betweenSteps(c1.act?.ts, c1.cycleSec, Date.now()) };
        }),
        { real: realPlayed.current, quiet: quietNow, still, rain: weatherOf(d) === "rain", day: day.phase === "day" },
        S.beds.filter((slug) => !S.members.has(slug)).map((slug) => ({ slug, pos: bedOf(S, slug) })),
      );
      realPlayed.current = [];
      const card = (slug: string) => d.cards.find((m) => m.slug === slug);
      const rain = weatherOf(d) === "rain"; // the Onion Reader's umbrella opens
      // the big screens: one per member that holds a slot, on posts over its low wall; the screen is an HTML box (queue 258)
      const slotsNow: Record<string, { x: number; y: number; flag?: string }> = {};
      for (const m of S.members.values()) {
        const c0 = card(m.slug);
        if (!c0) continue;
        const sc = placeOf(S, m.slug);
        const storm = stormStart.current.get(m.slug);
        // two larger lines when the scene is small: under 1024 px, or drawn under 2x (the panel beside it)
        const compact = !wd || scale.css / W < 2;
        const big = screenFor(c0, { compact, noise: storm !== undefined && t - storm < NOISE_MS });
        const hover = hoverSlot.current === m.slug;
        const working = m.anim === "working" && !quiet && !still;
        const px = sc.screen.x * TILE;
        const py = sc.screen.y * TILE;
        const drawn = placeDrawn(sc);
        // a new Validator flag's red line, for 10 s once the bird has landed
        const bird = birds.current.find((bd) => bd.slug === m.slug && t - bd.start >= 1600 && t - bd.start < 11_600);
        // depth (queue 45): the screen goes over a figure whose feet are above its bottom edge, the wall under every
        // figure standing at or below it
        items.push({ key: screenKey(sc), draw: () => drawBigScreen(c, px, py, big, t, { hover, working, compact, strip: bird ? `flag: ${bird.text}` : undefined, cssPerRoom: scale.css / W, k: scale.k, postsOnly: true }) });
        slotsNow[m.slug] = { x: px, y: py, ...(bird ? { flag: bird.text } : {}) };
        items.push({ key: wallKey(sc), draw: () => drawWall(c, px, drawn.wall.y) });
        // the Writer's bin by its wall: a ball per accepted draft today (queue 47)
        if (m.slug === "outreach-writer") items.push({ key: wallKey(sc) + 0.5, draw: () => drawBin(c, px + 56, drawn.wall.y - 4, binCount(c0)) });
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
        const fp = feet(g.pos);
        // a small bob as it walks; the CEO paces at its screen while it works (queue 47)
        const pace = !walking && !still && !quietNow && g.where === "spot" ? paceOffset(g.slug, t, anim === "working") : 0;
        const gf = gagFigure(gag, g.slug, t);
        if (gf.hide) continue; // out in the boat
        const p = { x: fp.x + pace + gf.dx, y: fp.y - (walking && Math.floor(t / 160) % 2 ? 1 : 0) };
        const look = lookOf(g.slug);
        const grey = anim === "lost";
        // what really happened (queue 40): a prop for its newest action; three refusals in a row sit it on its wall,
        // stuck; stalled sleeps standing; the owner's message turns it to the camera
        const stuck = !walking && g.where === "spot" && !!c0 && isStuck(c0);
        const effect = fx.current.get(g.slug);
        const playing = !walking && !quietNow && effect && effect.until > t ? effect : null;
        // between its real actions a working member keeps at it with its own prop (queue 53); any real action, gag or
        // other state wins
        const receiver = c0?.act?.type === "message" ? d.cards.find((x) => x.name === c0.act?.to) : undefined;
        const rm = receiver ? S.members.get(receiver.slug) : undefined;
        const busy =
          !walking && g.where === "spot" && !stuck && !gf.hide
            ? busyOf({ slug: g.slug, anim, actType: c0?.act?.type, t, still: still || quietNow, playing: !!playing || !!gag?.actors.includes(g.slug), toward: rm ? (rm.pos.x < g.pos.x ? -1 : 1) : undefined })
            : null;
        if (busy?.dx) p.x += busy.dx;
        const facing = (alerted.current.get(g.slug) ?? 0) > t ? 1 : (busy?.facing ?? g.facing);
        const pose: Pose = stuck ? "sit" : anim === "lost" && !walking ? "stand" : playing?.kind === "puff" ? "glance" : busy ? (busy.pose as Pose) : (g.pose as Pose);
        // the Writer types fast (queue 47); every member carries its props, in the hand unless a signature move has them
        const fr = Math.floor(t / (pose === "type" || pose === "use" ? (g.slug === "outreach-writer" ? 90 : 220) : 160));
        const move = playing ? moveOf(g.slug, playing.kind) : null;
        const gear = personaRects(g.slug, pose, { rain: rain || gf.umbrella, held: !move && !busy?.prop });
        items.push({ key: figureKey(g.pos), draw: () => drawFigure(c, p.x, p.y, look, pose, still ? 0 : fr, grey, facing, pose !== "sit", gear) });
        hitList.push({ kind: "member", slug: g.slug, x: p.x, y: p.y });
        const head = p.y - (look.accessory === "crown" || look.accessory === "beanie" ? 24 : 21);
        if (!walking && anim === "resting") {
          overlays.push(() => {
            drawZzz(c, p.x + 3, head - 1, t);
            const until = c0 ? restUntil(c0.state) : "";
            if (until) drawClock(c, p.x, head - 9 - (Math.floor(t / 600) % 2), until); // floats gently over the one resting
          });
        }
        if (!walking && anim === "blocked") overlays.push(() => drawSign(c, p.x, head, "!"));
        if (gf.sign) {
          const sign = gf.sign;
          overlays.push(() => drawSign(c, p.x, head - 2, sign));
        }
        if (!walking && c0?.state.word === "paused") overlays.push(() => drawSign(c, p.x, head, "II"));
        if (anim === "lost") overlays.push(() => drawZzz(c, p.x + 3, head - 1, t)); // stalled: asleep on its feet
        // "stuck" (three refusals in a row) is a grey badge on the member's HTML screen tab now (queue 261), not a label
        // floating beside its seat
        if (busy?.prop) {
          const sc = placeOf(S, g.slug).screen;
          const bp = busy.prop;
          const bk = busy.k;
          overlays.push(() => drawProp(c, bp, p.x, head, bk, t, { x: sc.x * TILE, y: sc.y * TILE }));
        }
        if (playing && (move || (playing.kind !== "propose" && playing.kind !== "plane"))) {
          const sc = placeOf(S, g.slug).screen;
          const k = (t - playing.start) / (playing.until - playing.start);
          overlays.push(() => drawProp(c, move ?? playing.kind, p.x, head, k, t, { x: sc.x * TILE, y: sc.y * TILE }));
        }
        if ((alerted.current.get(g.slug) ?? 0) > t && (alerted.current.get(g.slug) ?? 0) - t < 3000) overlays.push(() => drawSign(c, p.x, head, "!"));
        if ((storms.current.get(g.slug) ?? 0) > t) overlays.push(() => drawStorm(c, p.x, head - (anim === "blocked" ? 11 : 1), t));
        const bub = bubbles.current.find((b) => b.slug === g.slug && b.until > t);
        if (bub) overlays.push(() => drawBubble(c, p, bub.text));
        if (w && w.kind === "member" && w.slug === g.slug) overlays.push(() => drawMarker(c, p.x, head - 2, t));
        // an unread reply: the dot rides on the member's HTML screen box (queue 258)
      }
      // the gag between its actors (queue 47 part 4)
      if (gag && gag.kind !== "boat" && gag.kind !== "umbrella") {
        const ma = S.members.get(gag.actors[0]);
        const mb = gag.actors[1] ? S.members.get(gag.actors[1]) : undefined;
        // the one dozing may be asleep on its mat under the tree (queue 52)
        const bed = gag.actors[1] && !mb && S.beds.includes(gag.actors[1]) ? bedOf(S, gag.actors[1]) : null;
        if (ma) {
          const k = (t - gag.start) / (gag.until - gag.start);
          const fa = feet(ma.pos);
          const fb = mb ? feet(mb.pos) : bed ? { x: bed.x * TILE + 13, y: bed.y * TILE + 14 } : null;
          overlays.push(() => drawGag(c, gag.kind, fa, fb, k, t, gag.skips));
        }
      }
      // under the tree: every confirmed sleeper on its own mat
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
            drawPerson(c, x, y, lookOf(slug), "lie", 0, false, personaRects(slug, "lie"));
            // a retired one's grey mat carries an "R"; a script's STOP with a reason (a migration's) puts its first word by
            // the name ("Desk: migration"); the owner's Stop (queue 238) a second line under it: "owner 12:32: <reason>"
            const tag = s0.reason && s0.by !== "owner" ? s0.reason.split(/[:,;]/)[0].trim().slice(0, 12) : "";
            text(c, `${s0.name.split(/[\s-]/)[0]}${tag ? `: ${tag}` : ""}`, x, y - 7, { size: 4, color: "#5b4f6b" });
            if (s0.by === "owner") drawMatNote(c, `owner ${s0.at ?? ""}: ${s0.reason ?? ""}`, x, y + 11, 44);
          },
        });
        const i = S.beds.indexOf(slug);
        const woke = gagFigure(gag, slug, t).sign; // poked awake (queue 52)
        overlays.push(() => (woke ? drawSign(c, x, y - 12, woke) : drawZzz(c, x + 6, y - 9, t + i * 500)));
        hitList.push({ kind: "sleeper", slug, x, y: y + 4 });
        if (w && w.kind === "sleeper" && w.slug === slug) overlays.push(() => drawMarker(c, x, y - 12, t));
        if (un.has(slug)) overlays.push(() => drawReplyDot(c, x + 10, y - 6));
      }
      items.sort((a, b) => a.key - b.key).forEach((it) => it.draw());
      if (quiet) {
        c.fillStyle = "rgba(12, 14, 32, 0.38)";
        c.fillRect(0, 0, W, H);
        drawShh(c);
      }
      // the messages in the air (queue 46, 51: bees and butterflies): up to three wander the scene, the oldest with a
      // small orange dot (lands next); a new one flies from its sender to its receiver, touches it (the screen's frame
      // flashes) and lifts into free flight; the oldest glides down to its own receiver and is gone
      airStep(air.current, t);
      const at = (name: string) => {
        const card0 = d.cards.find((x) => x.name === name);
        const m = card0 ? sim.current.members.get(card0.slug) : null;
        return m ? { x: m.pos.x * TILE + 8, y: m.pos.y * TILE } : null;
      };
      const endOf = (msg: AirMsg, from: { x: number; y: number } | null) => {
        const to = planeTo(msg.to, d.cards);
        if (to.kind === "board") return { pt: { x: (BULLETIN.x + BULLETIN.w / 2) * TILE, y: BULLETIN.y * TILE + 10 }, screen: null };
        if (to.kind === "sky" || !sim.current.members.has(to.slug)) return { pt: { x: (from?.x ?? W / 2) + 30, y: -10 }, screen: null };
        const sb = screenBox(sim.current, to.slug);
        return { pt: { x: sb.x + sb.w / 2, y: sb.y + 4 }, screen: sb };
      };
      const up = aloft(air.current);
      const shownButterflies: { x: number; y: number; id: string }[] = [];
      // a flight between two points on an arc; the nose points along it
      const lerpPt = (a: { x: number; y: number }, b: { x: number; y: number }, k: number, lift = 14) => {
        const at2 = (q: number) => {
          const e = q < 0.5 ? 2 * q * q : 1 - (-2 * q + 2) ** 2 / 2;
          return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e - Math.sin(Math.PI * e) * lift };
        };
        const p0 = at2(k);
        const p1 = at2(Math.min(1, k + 0.02));
        const p2 = k + 0.02 > 1 ? at2(k - 0.02) : p0;
        const angle = k + 0.02 > 1 ? Math.atan2(p0.y - p2.y, p0.x - p2.x) : Math.atan2(p1.y - p0.y, p1.x - p0.x);
        return { ...p0, angle: Number.isFinite(angle) ? angle : 0 };
      };
      const night = day.phase === "night";
      // free flight (owner, 14:50): each on its own wandering path, a tile apart from the others
      const flying = air.current.flights.filter((f) => f.phase === "loop");
      const spread = separate(flying.map((f) => wanderAt(f.wander, t, still)));
      for (const f of air.current.flights) {
        const rank = up.indexOf(f);
        let p: { x: number; y: number; angle: number };
        const i = flying.indexOf(f);
        if (i >= 0) p = { ...wanderAt(f.wander, t, still), x: spread[i].x, y: spread[i].y };
        else if (f.phase === "landing") {
          const k = Math.min(1, (t - f.start) / LANDING_MS);
          p = lerpPt(wanderAt(f.wander, f.start, still), endOf(f.msg, null).pt, k, 4);
        } else {
          const from = f.msg.from === "Owner" ? null : at(f.msg.from);
          const end = endOf(f.msg, from);
          const start = from ?? { x: end.pt.x, y: -8 };
          const leg = takeoffLeg((t - f.start) / TAKEOFF_MS);
          if (leg.leg === "out") p = lerpPt(start, end.pt, leg.k);
          else if (leg.leg === "touch") {
            p = { ...end.pt, angle: 0 };
            const sb = end.screen;
            if (sb && Math.floor(leg.k * 4) % 2 === 0) overlays.push(() => drawFlash(c, sb));
          } else p = lerpPt(end.pt, wanderAt(f.wander, t, still), leg.k);
        }
        const next = f.phase === "loop" && rank === 0 && up.length >= AIR_MAX;
        // a bee for the owner's lines and replies to the owner, a butterfly for the family's own messages (queue 51)
        if (flyerOf(f.msg) === "bee") {
          const pose = insectPose(p.angle);
          p = { ...p, y: p.y + (still ? 0 : beeBob(f.wander.seed, t)) };
          const at2 = p;
          overlays.push(() => drawBee(c, at2, { ...pose, next, night, t: still ? null : t }));
        } else {
          const color = wingColor(f.msg.from, d.cards);
          const at2 = p;
          const seed = f.wander.seed;
          overlays.push(() => drawButterfly(c, at2, { color, next, night, t: still ? null : t, seed }));
        }
        shownButterflies.push({ x: p.x, y: p.y, id: f.msg.id });
      }
      butterfliesShown.current = shownButterflies;
      // its card, following it: the one under the pointer, or the one tapped in the last 4 s
      const cardId = hoverInsect.current ?? (tapInsect.current && tapInsect.current.until > t ? tapInsect.current.id : null);
      const carded = cardId ? shownButterflies.find((b) => b.id === cardId) : undefined;
      const cardMsg = cardId ? air.current.flights.find((f) => f.msg.id === cardId)?.msg : undefined;
      if (carded && cardMsg) {
        const at3 = { x: carded.x, y: carded.y };
        overlays.push(() => drawInsectCard(c, insectCard(cardMsg), (h) => cardRect(at3, h), at3));
      }
      // a bird from the mountains brings a new Validator flag's note to the bot's screen (1.6 s), which then shows it in
      // red for 10 s
      birds.current = birds.current.filter((bd) => t - bd.start < 1600 + 10_000);
      for (const bd of birds.current) {
        if (!sim.current.members.has(bd.slug) || t - bd.start >= 1600) continue;
        const sb = screenBox(sim.current, bd.slug);
        overlays.push(() => drawBird(c, { x: 186, y: 18 }, { x: sb.x + sb.w / 2, y: sb.y + 4 }, (t - bd.start) / 1600, t));
      }
      if (weatherOf(d) === "rain") drawRain(c, t);
      overlays.forEach((o) => o());
      // made for video (queue 47 part 5, queue 50): the strip under the scene, the director's 2x inset on its left with
      // who it shows and what that member just did beside it, the ticker along the bottom
      if (L.height > H) {
        const focus = director.current.focus ? d.cards.find((x) => x.slug === director.current.focus) : undefined;
        const lines = focus
          ? [focus.name, focus.state.word, focus.last ? `${focus.last.words} · ${focus.last.ago}` : ""]
          : ["The lakeside, live", `${String(clock.getHours()).padStart(2, "0")}:${String(clock.getMinutes()).padStart(2, "0")} · ${d.cards.length} at work`, "nobody acting: a slow pan along the terrace"];
        drawStrip(c, H, L.height, L.caption, lines.filter(Boolean));
      }
      if (v.director && L.inset) {
        director.current = directorStep(director.current, t, acted.current.splice(0), [...S.members.keys()]);
        const fm = director.current.focus ? S.members.get(director.current.focus) : undefined;
        const src = insetSource(fm ? feet(fm.pos) : null, t);
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
        drawInsetFrame(c, dst, fm ? (d.cards.find((x) => x.slug === fm.slug)?.name ?? "") : "");
      } else acted.current.length = 0;
      if (v.ticker && L.ticker) {
        const line = tickerText(d.cards, wb ? wb.today.opens : null, aloft(air.current).length, d.allowance ?? [], d.portalLocal ?? null);
        const pass = L.ticker ? drawTicker(c, line, tickerX.current, L.ticker) : 0;
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
    // the ticker, while it names a provider out of allowance: the Allowance list (queue 230)
    const tk = videoLayout(video).ticker;
    if (tk && y >= tk.y && data.allowance?.length) {
      window.location.hash = "allowance";
      return;
    }
    // a butterfly or bee: under 1024 px a tap shows its card for 4 s (on a wide screen the pointer already does)
    const insect = insectAt(butterfliesShown.current, x, y);
    if (insect) {
      if (!wide) tapInsect.current = { id: insect.id, until: performance.now() + 4000 };
      return;
    }
    const hit = hits.current
      .map((h) => ({ h, d: Math.hypot(h.x - x, h.y - 9 - y) }))
      .filter(({ h, d }) => d < (h.kind === "sleeper" ? 14 : 12))
      .sort((a, b) => a.d - b.d)[0]?.h;
    if (hit) {
      setWin({ kind: hit.kind, slug: hit.slug });
      return move("member");
    }
    // a floating page over the lake: open it in a new tab
    const page = floats.current.find((f) => inRect(f.rect, x, y));
    if (page) {
      if (!READ_ONLY && page.url) window.open(page.url, "_blank", "noopener,noreferrer");
      return;
    }
    // a member's big screen: look over its shoulder
    for (const sm of sim.current.members.values()) {
      if (inRect(screenBox(sim.current, sm.slug), x, y)) {
        setWin({ kind: "member", slug: sm.slug });
        move("screen");
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
    if (onTerminal(x, y)) {
      setWin({ kind: "web" });
      return move("terminal");
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
  // an agent asleep in the corner has Info and Chat (it reads the owner's message when started)
  const sleeperSlug = win && win.kind === "sleeper" ? win.slug : null;
  // the public world (READ_ONLY, queue 376): Info and Feed only; no chat, and no Screen (a lead's own web page)
  const chatSlug = READ_ONLY ? null : ([memberSlug, sleeperSlug].find((s): s is string => !!s && hasChat(s)) ?? null);
  const tabs: PanelTab[] = memberSlug ? (READ_ONLY ? ["info", "feed"] : ["info", "screen", "feed", ...(chatSlug ? (["chat"] as const) : [])]) : chatSlug ? ["info", "chat"] : [];
  const tab = tabs.includes(panel.tab) ? panel.tab : "info";
  // the family's web list: its own view, from the WEB terminal only (owner, 10-31: the same list on every agent was noise)
  const showWeb = win?.kind === "web";
  const tabbed = (
    <MemberTabs tabs={tabs} tab={tab} onTab={(t) => setPanel((p) => ({ ...p, tab: t }))} chatDot={!!chatSlug && unread.has(chatSlug)}>
      {chatSlug && tab === "chat" ? (
        <Frame onClose={close}>
          <ChatTab slug={chatSlug} name={data.cards.find((c) => c.slug === chatSlug)?.name ?? data.stopped.find((x) => x.slug === chatSlug)?.name ?? chatSlug} />
        </Frame>
      ) : showWeb ? (
        <Frame onClose={close}>
          <WebTab web={web} />
        </Frame>
      ) : memberSlug && tab !== "info" ? (
        <Frame onClose={close}>
          {tab === "screen" ? <ScreenTab slug={memberSlug} tick={data.at} last={data.cards.find((c) => c.slug === memberSlug)?.last ?? null} /> : <FeedTab slug={memberSlug} tick={data.at} />}
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
            <p className="min-w-0 text-xs text-muted">{downtimeLine(data.down, Date.parse(data.at))}</p>
            {/* wraps under the line on a phone instead of pushing the page sideways (476 px at 390) */}
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
            <button type="button" onClick={startRec} disabled={rec.state === "recording"} className="flex items-center gap-1.5 rounded-full bg-fill-3 px-3 py-1 text-xs font-semibold text-ink" title="The scene for 60 s, as a WebM download; nothing is uploaded">
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
            aria-label={`The lakeside: ${members.length} members at their screens, ${data.stopped.length} asleep under the tree. Arrow keys or Tab pick a member, Escape closes.`}
            onClick={pick}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * W;
            const y = ((e.clientY - r.top) / r.height) * videoLayout(video).height;
            hoverSlot.current = null;
            hoverFloat.current = floats.current.some((f) => inRect(f.rect, x, y)); // a page under the pointer pauses the carousel
            if (y < SKY_BAND_BOTTOM) wakeUntil.current = performance.now() + (e.pointerType === "touch" ? 8000 : WAKE_HOLD_MS);
            const tk = videoLayout(video).ticker;
            tickerHover.current = !!tk && y >= tk.y; // the ticker pauses under the pointer
            // the WEB terminal says today's numbers on hover
            hoverInsect.current = insectAt(butterfliesShown.current, x, y)?.id ?? null; // its card, drawn in the scene
            const tip = !hoverInsect.current && onTerminal(x, y) && web ? webTitle(web.today) : "";
            if (e.currentTarget.title !== tip) e.currentTarget.title = tip;
            for (const m of sim.current.members.values()) if (inRect(screenBox(sim.current, m.slug), x, y)) hoverSlot.current = m.slug;
          }}
          onPointerDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            if (((e.clientY - r.top) / r.height) * videoLayout(video).height < SKY_BAND_BOTTOM) wakeUntil.current = performance.now() + 8000; // a tap on a phone
          }}
          onPointerLeave={() => {
            hoverSlot.current = null;
            hoverInsect.current = null;
            tickerHover.current = false;
            hoverFloat.current = false;
          }}
            onKeyDown={onKey}
          />
          <ScreenLayer
            slots={slots}
            cards={data.cards}
            f={cssW / W}
            unread={unread}
            onOpen={(slug) => {
              setWin({ kind: "member", slug });
              move("member");
            }}
          />
          </div>
          {wide ? null : tabbed}
          {below /* the health banner, decisions and proposals, under the scene at its width (queue 55) */}
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

/** The WEB terminal's cabinet, badge included, in room pixels. */
const onTerminal = (x: number, y: number) => x >= TERMINAL_BOX.x && x <= TERMINAL_BOX.x + TERMINAL_BOX.w && y >= TERMINAL_BOX.y && y <= TERMINAL_BOX.y + TERMINAL_BOX.h;

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
  let now: { word: string; doing: string; counts: string; refused: number | null; pace?: string } | null = null;
  if (win?.kind === "member") {
    const c = data.cards.find((x) => x.slug === win.slug);
    if (c) {
      const d = dialogue(c, { now: true });
      // what the member's screen said before queue 221, at normal size: its state, what it is doing, today's counts
      const sc = screenFor(c);
      const doing = [...sc.lines, c.state.why].filter((x, i, all) => x && all.indexOf(x) === i);
      // queue 287: the 30-minute pace and the last model call left the screen for here
      now = { word: sc.word, doing: doing.join(" · "), counts: screenFoot(c), refused: c.refusedShare, pace: [sc.four[2], sc.four[3]].filter(Boolean).join(" · ") };
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
      lines = [
        s.retired
          ? `Retired by the owner${s.since ? `, ${s.since}` : ""}. It has no launch agents until it is brought back.`
          : s.by === "owner"
            ? `Stopped by the owner, ${s.since.slice(5)} ${s.at ?? ""}: ${s.reason ?? ""}`
            : s.reason
              ? `Asleep since ${s.since.slice(5)}: stopped by a script, not by you; the reason is above.`
              : `Asleep: stopped by the owner, since ${s.since.slice(5)}.`,
      ];
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
                stopReason={win.kind === "sleeper" ? (() => {
                  // the owner's own Stop reads plain "Start"; a script's STOP with a reason reads "Start anyway" (queue 238)
                  const st = data.stopped.find((s) => s.slug === target);
                  return st?.by === "owner" ? undefined : st?.reason;
                })() : undefined}
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
              <span className="mt-1 block text-xs opacity-70">Tap a member, the bulletin board, the mailbox or the WEB terminal.</span>
            </>
          ) : (
            "Tap a member to see what they are working on, or the bulletin board, the mailbox and the WEB terminal."
          )}
        </p>
      )}
    </div>
  );
}

const TAB_NAMES: Record<PanelTab, string> = { info: "Info", screen: "Screen", feed: "Feed", chat: "Chat" };

/** The member panel's tabs over its box: Info (the text box), Screen (what the bot sees), Feed (its last 20 actions),
 *  Chat (the owner's private chat with it). */
function MemberTabs({ tabs, tab, onTab, chatDot, children }: { tabs: PanelTab[]; tab: PanelTab; onTab: (t: PanelTab) => void; chatDot: boolean; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      {tabs.length ? (
        <div role="tablist" aria-label="Member" className="mb-1 flex flex-wrap gap-1 font-mono text-xs font-bold">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => onTab(t)}
              className="rounded-t-md border-2 border-b-0 border-[#1a0d00] px-3 py-1"
              style={tab === t ? { background: "#ff6600", color: "#1a0d00" } : { background: "#ffffff", color: "#1a0d00" }}
            >
              {TAB_NAMES[t]}
              {t === "chat" && chatDot ? <span className="ml-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: "#ff6600", boxShadow: "0 0 0 1px #1a0d00" }} aria-label="new reply" /> : null}
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

/** The owner's hand on a bot (creatorCC queue 23): Pause (30 min, 2 h, until tomorrow) or Resume, and Stop, for a member
 *  at work; Start for one asleep in the corner. Each asks first, Yes / No, with a one-line reason for the log; the
 *  result line is what the fleet script printed. */
function Controls(p: {
  name: string;
  stopped: boolean;
  retired: boolean;
  /** A STOP with a reason (a migration's): Start reads "Start anyway", the reason under it. */
  stopReason?: string;
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
          <span className="flex flex-col items-start gap-0.5">
            <button type="button" onClick={() => p.setAsk({ action: p.retired ? "bringback" : "start" })} className={btn}>
              {p.retired ? "Bring back" : p.stopReason ? "Start anyway" : "Start"}
            </button>
            {p.stopReason && !p.retired ? <span className="text-[11px] opacity-80">Stopped for: {p.stopReason}</span> : null}
          </span>
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

/** The bulletin board as a prompt (creatorCC queue 22): each open CEO proposal in turn with Yes / No and a note,
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

/** The member's state, what it is doing and today's counts, in the plain sans at normal size (queue 221: these left the
 *  screen on the terrace). The counts read on their own line, the refused share's meter on the row under them. */
function NowBlock({ now }: { now: { word: string; doing: string; counts: string; refused: number | null; pace?: string } }) {
  const pct = now.refused === null ? null : Math.round(now.refused * 100);
  return (
    <div className="mt-2 rounded-lg bg-[#fbf6ee] px-3 py-2 text-[14px] leading-normal">
      <p className="flex flex-wrap items-center gap-2">
        <span className="rounded-md px-2 py-0.5 font-mono text-[13px] font-bold text-[#1a0d00]" style={{ background: now.word === "working" ? BADGE_GOOD : "#ff6600" }}>
          {now.word}
        </span>
        {now.doing ? <span className="min-w-0 break-words">{now.doing}</span> : null}
      </p>
      <p className="mt-1.5 tabular-nums">{now.counts}</p>
      {now.pace ? <p className="mt-0.5 text-[13px] text-[#4d4d4d] tabular-nums">last call {now.pace}</p> : null}
      {pct !== null ? (
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#e6dfd3]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Share of actions refused today">
          <div className="h-full rounded-full bg-[#ff6600]" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/** The members' screens as HTML over the canvas (creatorCC queue 258, owner: "still not readable": canvas text came out at
 *  about 7 px and blurred). Each box sits on its slot's room coordinates times the canvas's CSS scale, with the name
 *  tab on top (a state other than working as an orange badge), the four lines and the refused share over a meter, in
 *  JetBrains Mono at 14 px (13 px in the compact form, never smaller). A box under 120 px wide is compact: the tab and
 *  the item only, the four lines on hover or focus and in the dialogue. The whole box opens the member's dialogue. */
function ScreenLayer({ slots, cards, f, unread, onOpen }: { slots: Record<string, { x: number; y: number; flag?: string }>; cards: Board["cards"]; f: number; unread: Set<string>; onOpen: (slug: string) => void }) {
  const w = SCREEN.w * f;
  const h = SCREEN.h * f;
  // 13-17 characters fit a 14 px line from about 120 px wide (measured at 1280 with the panel open: 138 px). At phone
  // width the box keeps its size in the room, and a state other than working is an orange stripe on the tab (its word
  // in the label), so the name keeps the tab.
  const { form, lines: fit } = screenForm(w, h);
  const compact = form !== "full";
  const tiny = form === "tiny";
  return (
    <div className="pointer-events-none absolute inset-0" style={{ fontFamily: "var(--font-screen), ui-monospace, Menlo, monospace" }}>
      {cards.map((c) => {
        const at = slots[c.slug];
        if (!at) return null;
        const sc = screenFor(c);
        const fd = screenFeed(c);
        const stuckWord = sc.word === "working" && isStuck(c) ? ", stuck (three refusals in a row)" : "";
        const dark = sc.mode === "dark";
        const bg = dark ? "#1b2030" : sc.mode === "alert" ? "#fde8e6" : sc.mode === "dim" ? "#e6e3dc" : "#fbfaf6";
        const ink = dark ? "#e6e9f2" : sc.mode === "alert" ? "#8a1c13" : "#1a0d00";
        const soft = dark ? "#aab3cc" : "#4d4d4d";
        const markColor = (m: string) => (m === "web" ? "#d63b3b" : m === "search" ? "#ff6600" : "");
        // each entry wraps onto the lines it needs (the feed scrolls, so nothing is cut); the time muted before the words
        const feedRow = (l: FeedLine, i: number) => {
          const m = /^(\d{2}:\d{2}) (.*)$/.exec(l.text);
          return (
            <p key={i} className={`mb-0.5 leading-[1.2] [overflow-wrap:anywhere] ${l.state ? "font-bold" : ""}`} style={{ color: ink }}>
              {l.mark ? <span aria-hidden className="mr-1 inline-block size-[7px] align-middle" style={{ background: markColor(l.mark) }} /> : null}
              {m ? (
                <>
                  <span style={{ color: soft }}>{m[1]}</span> {m[2]}
                </>
              ) : (
                l.text
              )}
            </p>
          );
        };
        const first = fd.lines[0];
        return (
          <button
            key={c.slug}
            type="button"
            onClick={() => onOpen(c.slug)}
            aria-label={`${c.name}, ${sc.word}${stuckWord}: ${fd.head}; ${fd.lines.slice(0, 3).map((l) => l.text).join("; ")}${at.flag ? `. New flag: ${at.flag}` : ""}. Open its card.`}
            className="group pointer-events-auto absolute text-left focus-visible:outline-2 focus-visible:outline-[#ff6600]"
            style={{ left: at.x * f, top: at.y * f, width: w, height: h }}
          >
            {/* the name tab on top of the frame; a state other than working rides on it as a badge */}
            <span className="absolute bottom-full left-[-2px] mb-[2px] flex max-w-[calc(100%+4px)] items-stretch border-2 border-[#26282e] bg-[#fbfaf6] font-bold text-[#1a0d00]" style={{ fontSize: compact ? 13 : 14, lineHeight: 1.25 }}>
              <span className="truncate px-1" style={tiny && sc.word !== "working" ? { boxShadow: "inset 0 -3px 0 #ff6600" } : undefined}>
                {c.name}
              </span>
              {sc.word !== "working" && !tiny ? <span className="shrink-0 truncate bg-[#ff6600] px-1 text-[#1a0d00]">{sc.word.replace(/ until .*/, "")}</span> : null}
              {sc.word === "working" && isStuck(c) && !tiny ? (
                <span className="shrink-0 bg-[#8a8a8a] px-1 text-white" title="three refusals in a row">
                  stuck
                </span>
              ) : null}
            </span>
            {unread.has(c.slug) ? <span aria-label="unread reply" className="absolute -top-2 -right-2 z-10 size-3 rounded-full border-2 border-[#fffaf0] bg-[#ff6600]" /> : null}
            <span className={`flex h-full flex-col overflow-hidden border-2 border-[#26282e] ${tiny ? "px-1 py-0.5" : "px-1.5 py-1"}`} style={{ background: bg, fontSize: compact ? 13 : 14 }}>
              {compact ? (
                // compact and phone width: the feed's first line only, wrapped over the lines that fit
                <span className={`leading-[1.2] [overflow-wrap:normal] ${first?.state ? "font-bold" : ""}`} style={{ color: first?.state ? ink : soft, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: tiny ? fit : 3, overflow: "hidden" }}>
                  {first?.mark ? <span aria-hidden className="mr-1 inline-block size-[7px] align-middle" style={{ background: markColor(first.mark) }} /> : null}
                  {first?.text ?? fd.head}
                </span>
              ) : (
                <>
                  <p className="shrink-0 truncate leading-[1.25] font-bold" style={{ color: ink }} title={fd.head}>
                    {fd.head}
                  </p>
                  {/* the feed: newest at the top, scrolling inside the box (wheel and touch), the box keeps its size */}
                  <span className="screen-feed mt-0.5 block min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5" style={{ scrollbarWidth: "thin", scrollbarColor: `${soft} transparent` }}>
                    {fd.lines.map(feedRow)}
                  </span>
                </>
              )}
            </span>
            {/* a new Validator flag: one red line across the box for its 10 seconds (queue 261) */}
            {at.flag ? (
              <span role="status" className="absolute inset-x-0 bottom-0 z-10 truncate border-2 border-t-0 border-[#26282e] bg-[#d63b3b] px-1.5 font-bold text-white" style={{ fontSize: 13, lineHeight: 1.4 }}>
                flag: {at.flag}
              </span>
            ) : null}
            {/* compact: the header and the newest lines on hover or focus, beside the box */}
            {compact ? (
              <span className="absolute top-full left-0 z-20 mt-1 hidden w-[240px] max-w-[80vw] border-2 border-[#26282e] px-2 py-1 text-[13px] shadow-lg group-hover:block group-focus-visible:block" style={{ background: bg }}>
                <p className="truncate leading-[1.25] font-bold" style={{ color: ink }}>
                  {fd.head}
                </p>
                {fd.lines.slice(0, 8).map(feedRow)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
