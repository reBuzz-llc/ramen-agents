import Link from "next/link";
import { me } from "@/lib/auth";
import type { TenantSettings } from "@/lib/db/schema";

export const metadata = { title: "Guide · ramen-agents" };

// The team's step-by-step guide, reshaped from the fleet's docs/peek-guide.md:
// what a person changes in the portal, step by step, and what the agent family and the scoreboard read from that change. Every
// button and cell name is the one on the page. Edit LAST_UPDATED by hand when the text changes. Each section has an
// anchor (/guide#send) so an agent or a teammate can link one step.
const LAST_UPDATED = "2026-11-06";

type Step = { id: string; title: string; intro?: React.ReactNode; steps: React.ReactNode[]; seen: string };

const B = ({ children }: { children: React.ReactNode }) => <strong className="font-semibold text-ink">{children}</strong>;
/** A page or tab a step names, as a link (every page a step names is one click away). */
const P = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link href={href} className="font-semibold text-ink underline decoration-accent/60 underline-offset-2 hover:decoration-accent">
    {children}
  </Link>
);
/** The board filtered to verified WhatsApp numbers: Leads reads its filters from the address. */
const WA_VERIFIED = "/leads?tab=board&whatsapp=WhatsApp%20Verified";

const SECTIONS: Step[] = [
  {
    id: "sign-in",
    title: "Sign in",
    steps: [
      <>Open ramen-agents and press <B>Continue with Google</B>.</>,
      <>Pick the Google account the owner added you with. Any other address gets no access; if the portal says so, ask the owner to check <P href="/settings/people">Settings → People</P>.</>,
      <>The first time, read the privacy notice and accept it. Nothing is recorded for you before that.</>,
      <>On the <P href="/">Clock</P>, pick a project and press <B>Clock in</B>. <B>Clock out</B> at the end of the day, with a line about what you got done.</>,
    ],
    seen: "your name. Every change you make is recorded under it in the lead's History, and This week and the Leaderboard count your work by the name or the Google address you signed in with.",
  },
  {
    id: "pick",
    title: "Pick the next lead",
    steps: [
      <>Open <P href="/leads">Leads</P>. It opens on its first tab, <B>Send next</B>: the Validator&apos;s pick of what to send, best first.</>,
      <>Press <B>Take it</B> on the top lead nobody has taken. It now shows as yours; <B>Give back</B> if you cannot finish it. The same <B>Take it</B> / <B>Give back</B> is at the bottom of the lead&apos;s drawer.</>,
      <>Press the business name to open the drawer and read the <B>Draft email</B>. If a name or a detail is wrong, press <B>Edit</B> on the draft and fix it first.</>,
      <>Copy the address from <B>Business email</B>, then press <B>Copy draft</B> in Send next (or <B>Copy</B> on the draft in the drawer). If files are attached, the copy ends with a line &ldquo;Attachments: …&rdquo; naming them.</>,
      <>To attach a file yourself: in the drawer, under <B>Attachments</B>, pick it from <B>Attach a file…</B>. The files themselves are on the <P href="/files">Files</P> page; what we offer is on <P href="/packages">Packages</P> and <P href="/asset">Asset</P>.</>,
      <><B>Copy link</B> in the drawer shares a lead with a colleague.</>,
    ],
    seen: "your claim. The lead shows as yours in Send next, so nobody else sends the same email, and your fixes to the draft are saved into the lead, where they win over the agents'.",
  },
  {
    id: "send",
    title: "Send by hand and record it",
    intro: "The portal never sends anything by itself. You send from your own mailbox; the portal records that you did.",
    steps: [
      <>Paste the draft into a new email from your own mailbox, to the address you copied.</>,
      <>Attach the files the last line names, then delete that line. Send it.</>,
      <>Back in the portal, press <B>Mark sent</B> in Send next (it shows once the lead is yours) or <B>Mark email sent</B> in the drawer. They are the same step.</>,
      <>Check the lead now shows <B>Email Sent</B>, with <B>Sent by</B> your name and <B>Sent at</B> today. If you pressed it by mistake, the <B>×</B> on the chip clears all three.</>,
    ],
    seen: "Email status, Sent by and Sent at. The Validator counts the team's sends from them, This week shows them as sent this week, and the Leaderboard gives the lead to the person in Sent by on the day in Sent at.",
  },
  {
    id: "whatsapp",
    title: "Check a WhatsApp number",
    steps: [
      <>In <P href="/leads?tab=board">Leads → Board</P>, set the <B>WhatsApp</B> filter to &ldquo;(not set)&rdquo; and open a lead with a WhatsApp link.</>,
      <>The <B>Phone</B> cell is the number in the international format (+1…); tap it on a phone to call. The <B>WhatsApp</B> link opens a chat.</>,
      <>If the number is on WhatsApp, press <B>Verified</B>. If you sent a message asking, press <B>Asked to verify</B>, and later <B>Verified</B> or <B>False number</B>.</>,
      <>If the number is not on WhatsApp, press <B>False number</B>. The status becomes &ldquo;False Whatsapp Number&rdquo;.</>,
    ],
    seen: "WhatsApp status. On “False Whatsapp Number” the Validator clears the number, the agents look for a better one, and no WhatsApp draft is written for that lead.",
  },
  {
    id: "whatsapp-send",
    title: "Send a WhatsApp message and record it",
    intro: "Like an email: the portal never sends it. You send from WhatsApp; the portal records that you did.",
    steps: [
      <>Open <P href={WA_VERIFIED}>Leads filtered to WhatsApp Verified</P> and open a lead that has a <B>Draft WhatsApp message</B>.</>,
      <>Read the draft. If anything is wrong or weak, press <B>Edit</B> on it and fix it: your version wins over the agents&apos;.</>,
      <>Press <B>Copy</B> on the draft.</>,
      <>Press the <B>WhatsApp</B> link (it opens a chat with that number), paste the message and send it from WhatsApp.</>,
      <>Back in the portal, press <B>WhatsApp message sent</B>. Check the chip now reads <B>WhatsApp msg sent</B>, with <B>Sent by</B> your name and <B>Sent at</B> today (if the lead was emailed first, those keep the email&apos;s). Pressed it by mistake? The <B>×</B> on the chip clears it.</>,
      <>A reply or a meeting from WhatsApp is recorded the same way as from email: see <a href="#result" className="underline">Record a reply, a meeting, a win or a loss</a>.</>,
    ],
    seen: "WhatsApp status, Sent by and Sent at, under your name in the lead's History. This week, the Leaderboard and your statement count it as a send for the person who pressed the button, shown beside the emails (\"12 emails · 4 WhatsApp\"), worth the same points as an email; a reply, meeting or client you record afterwards counts as usual.",
  },
  {
    id: "result",
    title: "Record a reply, a meeting, a win or a loss",
    steps: [
      <>Search the business in <P href="/leads?tab=board">Leads → Board</P> and open it.</>,
      <>Press <B>Replied</B>, <B>Meeting booked</B>, <B>Won</B>, <B>Lost</B> or <B>Bounced</B>. Won sets the <B>Result</B> to Client, Lost to Not interested.</>,
      <>The <B>Result date</B> fills itself with today. If the reply came on another day, press <B>Edit</B> on Result date and set it.</>,
      <>Pressed the wrong one? Clear it with the <B>×</B> on its chip and press the right one.</>,
    ],
    seen: "Result and Result date, which only people set; the agents never change them. The Leaderboard and This week count replies, meetings and clients by the result date, for the person who sent the lead.",
  },
  {
    id: "tasks",
    title: "Team tasks",
    steps: [
      <>Open <P href="/todo">To-do</P>. The standing task comes first, then yours, then the rest by priority.</>,
      <>Press <B>I&apos;m on it</B> on the task you take. <B>Release</B> gives it back.</>,
      <>Press the status step the task has reached; tick each line under <B>Done when</B> as you finish it.</>,
      <>Press <B>Done</B> at the end. A red flag on a task is the Validator&apos;s note about something to fix; fix it and the flag goes on its next run.</>,
    ],
    seen: "the task's status and its assignees. A Done task counts once for each person assigned, on This week and the Leaderboard; the Validator's flags on it clear once it is fixed.",
  },
];

/** This week's goals as the owner set them (Settings → Company), for a signed-in person; none for a visitor. */
function goalsOf(kr: TenantSettings["keyResults"]): string[] {
  const k = kr ?? {};
  return [
    k.sent ? `${k.sent} emails sent` : "",
    k.replies ? `${k.replies} replies` : "",
    k.meetings ? `${k.meetings} meetings` : "",
    k.tasksDone ? `${k.tasksDone} tasks done` : "",
  ].filter(Boolean);
}

const nextLink = "text-sm font-medium text-accent-ink underline underline-offset-2";

/** The Guide (profile menu): the mission and this week's goals, why a person's edits matter, then numbered steps, each
 *  ending with what the family sees and a link to the next. Open to anyone, like Privacy: the
 *  sign-in page links it for a person who has not signed in yet; the week's goals show only once signed in. */
export default async function Guide() {
  const who = await me().catch(() => null);
  const goals = who ? goalsOf(who.settings.keyResults) : [];
  const steps = SECTIONS;
  return (
    <article className="max-w-2xl text-[0.9375rem] leading-relaxed">
      <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">Guide</h1>
      <p className="mt-1 text-xs text-muted">Last updated {LAST_UPDATED}</p>

      <section id="mission" aria-labelledby="mission-title" className="mt-4 scroll-mt-20 rounded-xl border border-line bg-panel p-4">
        <h2 id="mission-title" className="text-lg font-semibold">
          Mission and this week
        </h2>
        <p className="mt-2">
          Your mission in plain words: who you help, what you offer them first so they see the work before they pay, and how you help them grow. (Edit
          this line in app/guide/page.tsx.)
        </p>
        <p className="mt-3 font-semibold">This week</p>
        {!who ? (
          <p className="text-muted">Sign in to see this week&apos;s goals.</p>
        ) : goals.length ? (
          <p>
            {goals.join(" · ")}.{" "}
            <Link href="/week" className="underline">
              How the week is going
            </Link>
            .
          </p>
        ) : (
          <p className="text-muted">The owner has not set this week&apos;s goals yet (Settings → Company).</p>
        )}
        <p className="mt-3 font-semibold">Your part</p>
        <p>
          The agents find the businesses and write the drafts. You <B>check</B> each draft and fix it, <B>send</B> it yourself, and <B>record</B> what happened.
          The agents read what you recorded, and so does the scoreboard: <P href="/week">This week</P> and the <P href="/leaderboard">Leaderboard</P>.
        </p>
      </section>

      <section id="edits" aria-labelledby="edits-title" className="mt-4 scroll-mt-20 rounded-xl border-2 border-accent bg-accent-tint p-4">
        <h2 id="edits-title" className="text-lg font-semibold">
          Your edits are the important data
        </h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 marker:text-accent">
          <li>Whatever you write in a cell is the true value. The agents read it and never overwrite it; if one tries, <B>History</B> at the bottom of the drawer shows its write as refused.</li>
          <li>The Validator counts it as the team&apos;s correction; the <B>Corrected by the team</B> filter on <P href="/leads?tab=board">Leads → Board</P> lists those leads.</li>
          <li>The drafts you edit and send are what the agents learn their writing from.</li>
        </ul>
        <p className="mt-2">So fix anything wrong or weak in place. It is never wasted.</p>
        <p className="mt-2 text-sm">
          <span className="font-semibold">How:</span> open the lead, press <B>Edit</B> next to the cell (if the cell is empty, press <B>Show empty fields</B> first), type the
          right value and press <B>Save</B>.
        </p>
      </section>

      <nav id="steps" aria-label="Steps in this guide" className="mt-6 scroll-mt-20 rounded-xl bg-panel p-3">
        <p className="text-sm font-semibold">Steps</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
          {steps.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="underline decoration-line underline-offset-2 hover:decoration-accent">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {steps.map((s, i) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="mt-8 scroll-mt-20">
          <h2 id={`${s.id}-title`} className="text-lg font-semibold">
            <a href={`#${s.id}`} className="hover:underline">
              {i + 1}. {s.title}
            </a>
          </h2>
          {s.intro ? <p className="mt-1 text-muted">{s.intro}</p> : null}
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 marker:text-muted">
            {s.steps.map((step, j) => (
              <li key={j}>{step}</li>
            ))}
          </ol>
          <p className="mt-3 rounded-lg border-l-4 border-accent bg-accent-tint px-3 py-2 text-sm">
            <span className="font-semibold">Seen by the family as:</span> {s.seen}
          </p>
          <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            {steps[i + 1] ? (
              <a href={`#${steps[i + 1].id}`} className={nextLink}>
                Next: {steps[i + 1].title}
              </a>
            ) : null}
            <a href="#steps" className={nextLink}>
              Back to steps
            </a>
          </p>
        </section>
      ))}
    </article>
  );
}
