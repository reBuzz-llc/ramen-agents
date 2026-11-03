import { ImageResponse } from "next/og";
import { Glyph } from "./icon-glyph";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<Glyph size={180} />, size);
}
