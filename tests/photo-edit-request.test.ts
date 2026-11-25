// The full-size photo's panel asks for an edit to that photo: the text is sent as an ordinary change request on the
// sample (POST /api/samples/<id>/requests), with the photo's name and file in front so the Site Builder knows which one.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PhotoViewer, { EDIT_MAX } from "@/app/samples/photo-viewer";

const base = { src: "/x.webp", title: "Listing photo: Galbi", accepted: false, rejected: false, busy: false, onSeen: () => {}, onAccept: () => {}, onReject: () => {}, onClose: () => {} };

describe("an edit request from the full-size photo", () => {
  it("the panel has the box and its button when an edit can be sent, and none otherwise", () => {
    const html = renderToStaticMarkup(createElement(PhotoViewer, { ...base, onRequestEdit: async () => null }));
    expect(html).toContain("Ask for an edit to this photo");
    expect(html).toMatch(new RegExp(`data-photo-edit-text[^>]*|maxLength="${EDIT_MAX}"`));
    expect(html).toContain("Send edit request");
    expect(renderToStaticMarkup(createElement(PhotoViewer, base))).not.toContain("data-photo-edit");
  });

  it("leaves room for the photo's name within a request's 1000 characters", () => {
    expect(EDIT_MAX + `Edit the photo "" (): `.length + 80 + 80).toBeLessThanOrEqual(1000);
  });

  it("the sample's photo list sends it to the sample's requests, naming the photo and its file", () => {
    const src = readFileSync(path.join(process.cwd(), "app", "samples", "sample-cards.tsx"), "utf8");
    expect(src).toMatch(/onRequestEdit=\{async \(text\) => \{[\s\S]*?form\.set\("text", `Edit the photo "\$\{open\.dish \|\| open\.base\}" \(\$\{open\.file\}\): \$\{text\}`\)[\s\S]*?fetch\(`\/api\/samples\/\$\{sampleId\}\/requests`, \{ method: "POST", body: form \}\)/);
  });
});
