import Link from "next/link";

export const metadata = { title: "Guide · ramen-agents" };

// The team's step-by-step guide, reshaped from the fleet's docs/peek-guide.md:
// what a person changes in the portal, step by step, and what the agent family and the scoreboard read from that change. Every
// button and cell name is the one on the page. Edit LAST_UPDATED by hand when the text changes. Each section has an
// anchor (/guide#send) so an agent or a teammate can link one step.
const LAST_UPDATED = "2026-11-06";

type Step = { id: string; title: string; intro?: string; steps: React.ReactNode[]; seen: string };

const B = ({ children }: { children: React.ReactNode }) => <strong className="font-semibold text-ink">{children}</strong>;

const SECTIONS: Step[] = [
  {
    id: "sign-in",
    title: "Sign in",
    steps: [
      <>Open ramen-agents and press <B>Continue with Google</B>.</>,
      <>Pick the Google account the owner added you with. Any other address gets no access; if the portal says so, ask the owner to check Settings → People.</>,
      <>The first time, read the privacy notice and accept it. Nothing is recorded for you before that.</>,
      <>On the <B>Clock</B>, pick a project and press <B>Clock in</B>. <B>Clock out</B> at the end of the day, with a line about what you got done.</>,
    ],
    seen: "your name. Every change you make is recorded under it in the lead's History, and This week and the Leaderboard count your work by the name or the Google address you signed in with.",
  },
  {
    id: "pick",
    title: "Pick the next lead",
    steps: [
      <>Open <B>Leads</B>: its first tab, <B>Send next</B>, is the Validator&apos;s pick of what to send, best first.</>,
      <>Press <B>Take it</B> on the top lead nobody has taken. <B>Give back</B> if you cannot finish it.</>,
      <>Open the lead and read the <B>Draft email</B>. If a name or a detail is wrong, press <B>Edit</B> on the draft and fix it first.</>,
      <>Press <B>Copy address</B> (or copy <B>Business email</B> in the drawer), then <B>Copy draft</B>. If files are attached, the copy ends with a line &ldquo;Attachments: …&rdquo; naming them.</>,
      <>To attach a file yourself: in the lead&apos;s drawer, under <B>Attachments</B>, pick it from <B>Attach a file…</B>. The files themselves are on the <Link href="/files" className="underline">Files</Link> page.</>,
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
      <>Back in the portal, press <B>Mark sent</B> in Send next or <B>Mark email sent</B> in the drawer. They are the same step.</>,
      <>Check the lead now shows <B>Email Sent</B>, with <B>Sent by</B> your name and <B>Sent at</B> today. If you pressed it by mistake, the <B>×</B> on the chip clears all three.</>,
    ],
    seen: "Email status, Sent by and Sent at. The Validator counts the team's sends from them, This week shows them as sent this week, and the Leaderboard gives the lead to the person in Sent by on the day in Sent at.",
  },
  {
    id: "whatsapp",
    title: "Check a WhatsApp number",
    steps: [
      <>In <B>Leads</B>, set the <B>WhatsApp</B> filter to &ldquo;(not set)&rdquo; and open a lead with a WhatsApp link.</>,
      <>The <B>Phone</B> cell is the number in the international format (+1…); tap it on a phone to call. The <B>WhatsApp</B> link opens a chat.</>,
      <>If the number is on WhatsApp, press <B>Verified</B>. If you sent a message asking, press <B>Asked to verify</B>, and later <B>Verified</B> or <B>False number</B>.</>,
      <>If the number is not on WhatsApp, press <B>False number</B>. The status becomes &ldquo;False Whatsapp Number&rdquo;.</>,
      <>Once verified and the <B>Draft WhatsApp</B> is ready, copy it, send it from WhatsApp, and press <B>WhatsApp message sent</B>.</>,
    ],
    seen: "WhatsApp status. On “False Whatsapp Number” the Validator clears the number, the agents look for a better one, and no WhatsApp draft is written for that lead.",
  },
  {
    id: "result",
    title: "Record a reply, a meeting, a win or a loss",
    steps: [
      <>Search the business in <B>Leads</B> and open it.</>,
      <>Press <B>Replied</B>, <B>Meeting booked</B>, <B>Won</B>, <B>Lost</B> or <B>Bounced</B>. Won sets the <B>Result</B> to Client, Lost to Not interested.</>,
      <>The <B>Result date</B> fills itself with today. If the reply came on another day, press <B>Edit</B> on Result date and set it.</>,
      <>Pressed the wrong one? Clear it with the <B>×</B> on its chip and press the right one.</>,
    ],
    seen: "Result and Result date, which only people set; the agents never change them. The Leaderboard and This week count replies, meetings and clients by the result date, for the person who sent the lead.",
  },
  {
    id: "fix",
    title: "Fix what an agent got wrong",
    steps: [
      <>Open the lead and press <B>Edit</B> next to the wrong cell. If the cell is empty, press <B>Show empty fields</B> first.</>,
      <>Type the right value and press <B>Save</B>.</>,
      <>That&apos;s it: your value stays. <B>History</B> at the bottom of the drawer shows any later agent write that was refused because of it.</>,
    ],
    seen: "your value, from then on. A person's cell wins over the agents': they read it and can no longer overwrite it, and the filter Corrected by the team lists the leads you fixed.",
  },
  {
    id: "tasks",
    title: "Team tasks",
    steps: [
      <>Open <B>To-do</B>. The standing task comes first, then yours, then the rest by priority.</>,
      <>Press <B>I&apos;m on it</B> on the task you take. <B>Release</B> gives it back.</>,
      <>Press the status step the task has reached; tick each line under <B>Done when</B> as you finish it.</>,
      <>Press <B>Done</B> at the end. A red flag on a task is the Validator&apos;s note about something to fix; fix it and the flag goes on its next run.</>,
    ],
    seen: "the task's status and its assignees. A Done task counts once for each person assigned, on This week and the Leaderboard; the Validator's flags on it clear once it is fixed.",
  },
];

/** The Guide (profile menu): numbered steps the team follows, each section ending with what the family sees. Open to
 *  anyone, like Privacy: the sign-in page links it for a person who has not signed in yet, and it
 *  holds no company data. */
export default function Guide() {
  return (
    <article className="max-w-2xl text-[0.9375rem] leading-relaxed">
      <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">Guide</h1>
      <p className="mt-1 text-xs text-muted">Last updated {LAST_UPDATED}</p>
      <p className="mt-3">
        What you change in the portal, step by step, and what the agent family sees from it. The agents fill the Leads board and write the drafts; you check them,
        send them yourself and record what happened, and the agents and the scoreboard read what you recorded.
      </p>
      <nav aria-label="Steps in this guide" className="mt-4 rounded-xl bg-panel p-3">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="underline decoration-line underline-offset-2 hover:decoration-accent">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {SECTIONS.map((s, i) => (
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
        </section>
      ))}
    </article>
  );
}
