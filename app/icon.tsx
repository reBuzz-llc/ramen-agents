import { ImageResponse } from "next/og";
import { Glyph } from "./icon-glyph";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<Glyph size={512} />, size);
}
