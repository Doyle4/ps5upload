import { afterEach, describe, expect, it, vi } from "vitest";
import { rpBrowserAdvice } from "./browserAdvice";

const UA = {
  chrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  firefox: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
  safari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
};

/** This browser, as the platform helpers and the advice both read it. */
function as(userAgent: string, extra: object = {}) {
  const nav = { userAgent, maxTouchPoints: 0, ...extra };
  vi.stubGlobal("navigator", nav);
  return nav;
}

afterEach(() => vi.unstubAllGlobals());

describe("rpBrowserAdvice", () => {
  it("is quiet in Chrome and Edge, desktop or Android", () => {
    expect(rpBrowserAdvice(as(UA.chrome))).toBeNull();
    expect(rpBrowserAdvice(as(UA.edge))).toBeNull();
    expect(rpBrowserAdvice(as(UA.androidChrome))).toBeNull();
    expect(rpBrowserAdvice(as("Mozilla/5.0", { userAgentData: { brands: [{ brand: "Chromium" }] } }))).toBeNull();
  });
  it("names what Firefox and Safari miss", () => {
    expect(rpBrowserAdvice(as(UA.firefox))).toBe("firefox");
    expect(rpBrowserAdvice(as(UA.safari))).toBe("safari");
    expect(rpBrowserAdvice(as("SomeBrowser/1.0"))).toBe("other");
    expect(rpBrowserAdvice(as(UA.androidFirefox))).toBe("other_mobile");
  });
  it("says nothing where there is no better browser (iPhone, iPad)", () => {
    expect(rpBrowserAdvice(as(UA.iphone))).toBeNull();
  });
});
