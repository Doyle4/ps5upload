import { describe, expect, it } from "vitest";

import { captureIsItsOwnThumb, captureThumbPath } from "./captureThumb";

const P = "/user/av_contents/photo/NPXS40087/PPSA22453/0ff/20261028_005931_00526534";
const V = "/user/av_contents/video/NPXS40087/PPSA22453/149/20261028_010131_00960323";
const T = "/user/av_contents/thumbnails";

describe("capture thumbnails (measured on 13.60)", () => {
  it("names each kind's thumbnail as the console does", () => {
    expect(captureThumbPath(`${P}.jxr`)).toBe(`${T}/photo/NPXS40087/PPSA22453/0ff/20261028_005931_00526534.jxr.jxr`);
    expect(captureThumbPath(`${P}.jpg`)).toBe(`${T}/photo/NPXS40087/PPSA22453/0ff/20261028_005931_00526534.jpg.jpeg`);
    expect(captureThumbPath(`${V}.webm`)).toBe(`${T}/video/NPXS40087/PPSA22453/149/20261028_010131_00960323.webm.jxr`);
    expect(captureThumbPath("/data/x.jpg")).toBeNull();
  });

  it("lets only a small SDR picture stand in for its thumbnail", () => {
    expect(captureIsItsOwnThumb(`${P}.jpg`)).toBe(true);
    expect(captureIsItsOwnThumb(`${P}.jxr`)).toBe(false);
    expect(captureIsItsOwnThumb(`${V}.webm`)).toBe(false);
  });
});
