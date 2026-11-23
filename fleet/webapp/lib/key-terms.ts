// A Gemini key is added in the terminal only: sh scripts/add-key.sh gemini shows Google's sentence on personal
// information and asks whether Gemini may read lead data. The dashboard cannot ask that question, so it does not save one.
export const TERMS_FIRST =
  "Add this key in a terminal: sh scripts/add-key.sh gemini. It shows Google's terms for the free tier and asks whether Gemini may read lead data.";

export function needsTermsScript(name: string): boolean {
  return name === "gemini";
}
