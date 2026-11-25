// The Team page's week card shows its link only while the exact public page answers 200.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST_UNAVAILABLE, WeekCard } from "@/app/family/week-card";
import { checkWeekLink, weekLinkOk } from "@/lib/week-link";

const URL_A = "https://blog.example.test/family-week/2026-11-22";
const answers = (status: number) => vi.fn(async () => new Response(status === 200 ? "ok" : null, { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const week = { title: "This week in the family: 16 to 22 November", summary: "37 leads", url: URL_A };
const card = (available: boolean) => renderToStaticMarkup(createElement(WeekCard, { week, available }));

beforeEach(() => {
  delete (globalThis as { __peekWeekLinks?: unknown }).__peekWeekLinks;
  vi.stubEnv("NEXT_PUBLIC_PEEK_BLOG_HOST", "blog.example.test");
});

describe("the week link's check", () => {
  it("checks nothing, so shows no link, when the team set no blog host", async () => {
    vi.stubEnv("NEXT_PUBLIC_PEEK_BLOG_HOST", "");
    const get = answers(200);
    expect(await checkWeekLink(URL_A, get)).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it("is not available before the first answer", () => {
    expect(weekLinkOk(URL_A)).toBe(false);
  });

  it("is available on a 200", async () => {
    expect(await checkWeekLink(URL_A, answers(200))).toBe(true);
    expect(weekLinkOk(URL_A)).toBe(true);
  });

  it.each([402, 404, 301, 500])("is not available on a %i", async (status) => {
    expect(await checkWeekLink(URL_A, answers(status))).toBe(false);
    expect(weekLinkOk(URL_A)).toBe(false);
  });

  it("is not available when nothing answers", async () => {
    const down = vi.fn(async () => { throw new Error("no answer"); }) as unknown as typeof fetch;
    expect(await checkWeekLink(URL_A, down)).toBe(false);
    expect(weekLinkOk(URL_A)).toBe(false);
  });

  it("asks at most once an hour, and the next answer replaces the last", async () => {
    const t = Date.parse("2026-12-15T14:00:00Z");
    const blocked = answers(402);
    await checkWeekLink(URL_A, blocked, t);
    await checkWeekLink(URL_A, blocked, t + 3_599_999);
    expect(blocked).toHaveBeenCalledTimes(1);
    const back = answers(200);
    expect(await checkWeekLink(URL_A, back, t + 3_600_000)).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("asks once when two page loads arrive together", async () => {
    const get = answers(200);
    await Promise.all([checkWeekLink(URL_A, get), checkWeekLink(URL_A, get)]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("does not follow a redirect", async () => {
    const get = answers(200);
    await checkWeekLink(URL_A, get);
    expect(get.mock.calls[0][1]).toMatchObject({ redirect: "manual", cache: "no-store" });
  });

  it.each(["https://evil.example/family-week/2026-11-22", "http://blog.example.test/family-week/2026-11-22", "https://blog.example.test:8443/family-week/x", "https://a@blog.example.test/family-week/x", "not a link"])("never asks %s", async (url) => {
    const get = answers(200);
    expect(await checkWeekLink(url, get)).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("the week card", () => {
  it("links to the post while it answers", () => {
    const html = card(true);
    expect(html).toContain(`href="${URL_A}"`);
    expect(html).toContain("Read the week");
    expect(html).not.toContain(POST_UNAVAILABLE);
  });

  it("keeps the title and summary and drops the link otherwise", () => {
    const html = card(false);
    expect(html).toContain(week.title);
    expect(html).toContain(week.summary);
    expect(html).toContain("The public post is not available right now.");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain(URL_A);
  });
});
