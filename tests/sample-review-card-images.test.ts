// Peek stopped reading a review card at its first closing tag, so a picture in the
// figcaption after the quote passed. Peek now reads the whole card, as the engine does.
import { describe, expect, it } from "vitest";
import { reviewerProblems } from "@/lib/sample-page";

const QUOTE = "The short rib was tender and the staff kept the grill clean all night long.";
const FACTS = { quotes: [{ first_name: "Jinwook C.", text: QUOTE, photos: ["https://x.test/own.jpg"] }], photos: [{ url: "https://x.test/listing.jpg" }] };
const refused = (page: string) => reviewerProblems(page, FACTS).some((p) => p.includes("image inside a review card"));
const card = (caption: string, open = '<figure class="review">', close = "</figure>") => `${open}<blockquote>${QUOTE}</blockquote><figcaption>${caption}</figcaption>${close}`;

describe("a picture in a review card", () => {
  it("is refused in the figcaption after the quote", () => {
    expect(refused(card('<img src="https://x.test/face.jpg"> Jinwook C.'))).toBe(true);
  });
  it("is refused in a slider card and an article card too", () => {
    expect(refused(card('<img src="https://x.test/face.jpg"> Jinwook C.', "<figure data-slide>"))).toBe(true);
    expect(refused(card('<img src="https://x.test/face.jpg"> Jinwook C.', '<article class="testimonial">', "</article>"))).toBe(true);
  });
  it("is refused inside the quote, as before", () => {
    expect(refused(`<blockquote class="quote"><img src="https://x.test/face.jpg">${QUOTE}</blockquote>`)).toBe(true);
  });
  it("passes when it is the review's own photo or one of the listing's", () => {
    expect(refused(card('<img src="https://x.test/own.jpg"> Jinwook C.'))).toBe(false);
    expect(refused(card('<img src="https://x.test/listing.jpg"> Jinwook C.'))).toBe(false);
  });
  it("passes with the initial and no picture, and does not read past the card", () => {
    expect(refused(card("<span>J</span> Jinwook C."))).toBe(false);
    expect(refused(`${card("Jinwook C.")}<img src="https://x.test/menu.jpg">`)).toBe(false);
  });
});
