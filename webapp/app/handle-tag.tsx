/** A handle as a small monospaced tag beside a name: "The CEO  ceoA". The handle is computed on the server
 * (lib/bots.ts), which knows whether the name belongs to an agent or a bot. */
export default function HandleTag({ handle, name, className = "" }: { handle: string; name: string; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md bg-fill-3 px-1.5 py-px font-mono text-[11px] leading-4 font-semibold text-muted ${className}`}
      title={`${name} is ${handle}`}
    >
      {handle}
    </span>
  );
}
