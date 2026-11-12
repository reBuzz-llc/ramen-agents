// Where a key is made or replaced, per provider (owner, 2026-11-12: "need a link so that I can fix not working"). The
// Key providers page shows it on every key that is not working, limited, paused or missing, beside the file the new key
// goes into. A provider whose own key page is not known links to its site; one with no known site gets no link.

const PAGES: Record<string, string> = {
  // AI models
  gemini: "https://aistudio.google.com/apikey",
  groq: "https://console.groq.com/keys",
  mistral: "https://console.mistral.ai/api-keys",
  openrouter: "https://openrouter.ai/settings/keys",
  "ollama-cloud": "https://ollama.com/settings/keys",
  zai: "https://z.ai/manage-apikey/apikey-list",
  openai: "https://platform.openai.com/api-keys",
  deepseek: "https://platform.deepseek.com/api_keys",
  together: "https://api.together.ai/settings/api-keys",
  replicate: "https://replicate.com/account/api-tokens",
  moonshot: "https://platform.moonshot.ai/console/api-keys",
  sambanova: "https://cloud.sambanova.ai/apis",
  cerebras: "https://cloud.cerebras.ai/",
  orcarouter: "https://www.orcarouter.ai/",
  freeai: "https://free.ai/api/",
  freetheai: "https://github.com/Free-The-Ai/free-ai",
  speka: "https://speka.me/",
  "gonka-broker": "https://gonkabroker.com/",
  "dahl-inference": "https://inference.dahl.global/",
  // search, checks, storage, tools
  tavily: "https://app.tavily.com/home",
  langsearch: "https://langsearch.com/",
  parallel: "https://platform.parallel.ai/",
  apify: "https://console.apify.com/settings/integrations",
  notion: "https://www.notion.so/profile/integrations",
  kaggle: "https://www.kaggle.com/settings",
  "cloudflare-pages": "https://dash.cloudflare.com/profile/api-tokens",
  "cloudflare-r2": "https://dash.cloudflare.com/?to=/:account/r2/api-tokens",
  quickemailverification: "https://quickemailverification.com/",
  sniffmail: "https://sniffmail.io/",
  microlink: "https://microlink.io/",
  ezverify: "https://ezverify.app/",
  textperfector: "https://textperfector.com/",
};

/** Keys that are the team's own (the portal, the world link): fixed in the portal or by hand, not on a provider's site. */
const OWN = /^(portal-|peek-|world-share|google-oauth|supabase-|neon-)/;

export type KeyFix = { url: string; host: string } | null;

/** The page to make a new key for this provider, or null. */
export function keyPage(name: string): KeyFix {
  if (OWN.test(name)) return null;
  const url = PAGES[name];
  if (!url) return null;
  return { url, host: new URL(url).hostname.replace(/^www\./, "") };
}

/** A key needs fixing when it is refused, held back by its limits, or missing. */
export const NEEDS_FIX = ["not working", "limited", "paused", "no key"] as const;
