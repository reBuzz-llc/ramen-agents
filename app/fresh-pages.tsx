"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { isOwnWrite, readAgainOnReturn } from "@/lib/page-memory";

const leftAt = new Map<string, number>();

/** Keeps the browser's remembered pages honest (lib/page-memory.ts). After a save of one's own the memory is
 *  cleared; a page with send or reply marks opened from memory is read again at once, behind what is already on the screen. */
export default function FreshPages() {
  const router = useRouter();
  const path = usePathname() ?? "/";

  useEffect(() => {
    const original = window.fetch;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watched: typeof window.fetch = async (input, init) => {
      const res = await original.call(window, input, init);
      if (res.ok && isOwnWrite(input, init, window.location.origin)) {
        clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), 250);
      }
      return res;
    };
    window.fetch = watched;
    return () => {
      clearTimeout(timer);
      if (window.fetch === watched) window.fetch = original;
    };
  }, [router]);

  useEffect(() => {
    if (readAgainOnReturn(path, leftAt.get(path), Date.now())) router.refresh();
    return () => {
      leftAt.set(path, Date.now());
    };
  }, [path, router]);

  return null;
}
