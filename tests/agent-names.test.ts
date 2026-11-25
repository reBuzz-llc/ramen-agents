// An agent's name on screen carries its nickname from NEXT_PUBLIC_PEEK_AGENT_NICKNAMES (Name=nick pairs split by ;),
// and is the plain name without it. Display only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { nicknames } from "@/lib/agent-names";

const SET = "The CEO=abcA; Site Builder = sitX ;Validator=valX;site helper=helpX;broken;=nope;Scout=";

describe("an agent's name on screen", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads Name=nick pairs split by ;, trimmed, skipping a pair without both halves", () => {
    expect([...nicknames(SET)]).toEqual([
      ["the ceo", "The CEO (abcA)"],
      ["site builder", "Site Builder (sitX)"],
      ["validator", "Validator (valX)"],
      ["site helper", "site helper (helpX)"],
    ]);
    expect(nicknames(undefined).size).toBe(0);
  });

  it("with the setting: an agent's name carries its nickname, any case; anything else stays as it is", async () => {
    vi.stubEnv("NEXT_PUBLIC_PEEK_AGENT_NICKNAMES", SET);
    const { agentName, nicknameOf } = await import("@/lib/agent-names");
    expect(agentName("Site Builder")).toBe("Site Builder (sitX)");
    expect(agentName("validator")).toBe("Validator (valX)");
    expect(["Mina", "rebuild", "Scout", ""].map(agentName)).toEqual(["Mina", "rebuild", "Scout", ""]);
    expect([nicknameOf("site helper"), nicknameOf("Mina")]).toEqual(["helpX", ""]);
  });

  it("without it: every name is plain", async () => {
    vi.stubEnv("NEXT_PUBLIC_PEEK_AGENT_NICKNAMES", "");
    const { agentName, nicknameOf } = await import("@/lib/agent-names");
    expect(["Site Builder", "Validator", "site helper"].map((n) => agentName(n))).toEqual(["Site Builder", "Validator", "site helper"]);
    expect(nicknameOf("site helper")).toBe("");
  });

  it("the site helper is recognised by its nickname too, when one is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_PEEK_AGENT_NICKNAMES", SET);
    const { requestState } = await import("@/lib/sample-labels");
    const r = { status: "open", pictures: [], answeredVersion: null } as unknown as Parameters<typeof requestState>[0];
    expect(requestState(r, "helpX")).toBe("with the site helper (helpX)");
    expect(requestState(r, "Site Builder")).toBe("waiting for the Site Builder (sitX)");
  });
});
