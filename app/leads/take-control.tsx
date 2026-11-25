// Take it sits to the left of the copy icons at the top of a lead. One person holds a lead: everyone sees
// who, and only that person is offered Give back.
export type Holder = { userId: string; name: string };

export default function TakeControl({ holder, meId, busy, onTake, onGiveBack }: { holder: Holder | null; meId: string; busy: boolean; onTake: () => void; onGiveBack: () => void }) {
  if (!holder) {
    return (
      <button type="button" disabled={busy} onClick={onTake} className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50" data-take>
        Take it
      </button>
    );
  }
  const mine = holder.userId === meId;
  return (
    <span className="inline-flex max-w-full shrink-0 items-center gap-2" data-taken={mine ? "mine" : "other"}>
      <span className="max-w-40 truncate text-xs text-muted" title={mine ? undefined : `Taken by ${holder.name}`}>
        Taken by {mine ? "you" : holder.name}
      </span>
      {mine ? (
        <button type="button" disabled={busy} onClick={onGiveBack} className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-line px-3 text-sm font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-50" data-give-back>
          Give back
        </button>
      ) : null}
    </span>
  );
}
