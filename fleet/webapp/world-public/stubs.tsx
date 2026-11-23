"use client";
// next/link, next/navigation and the decision buttons for the public bundle: plain links, a router that does nothing,
// and no answers (the world never shows them when READ_ONLY).
import type { AnchorHTMLAttributes } from "react";

export default function Link({ href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a href={href} {...rest} />;
}
export function useRouter() {
  return { refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} };
}
export function usePathname() {
  return "/";
}
export function useDecisionAnswer(_done?: () => void) {
  return { busy: null as string | null, error: "", answer: async (..._a: unknown[]) => {} };
}
