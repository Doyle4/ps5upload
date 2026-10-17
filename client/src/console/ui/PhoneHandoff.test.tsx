import { describe, expect, it } from "vitest";
import { phoneUrl } from "./PhoneHandoff";

describe("continue on your phone", () => {
  it("is this page on the console's LAN address while LAN access is on", () => {
    expect(phoneUrl({ lan: true, addr: "192.168.86.99" }, "9180")).toBe("http://192.168.86.99:9180/");
    expect(phoneUrl({ lan: true, addr: "10.0.0.7" }, "")).toBe("http://10.0.0.7:9180/");
  });

  it("shows nothing when LAN access is off, the helper is older, or the address is not usable", () => {
    expect(phoneUrl({ lan: false, addr: "192.168.86.99" }, "9180")).toBeNull();
    expect(phoneUrl({ lan: true }, "9180")).toBeNull(); // an older helper: no addr
    expect(phoneUrl({ lan: true, addr: "" }, "9180")).toBeNull();
    expect(phoneUrl({ lan: true, addr: "127.0.0.1" }, "9180")).toBeNull();
    expect(phoneUrl({ lan: true, addr: "evil.example/x?" }, "9180")).toBeNull();
    expect(phoneUrl(null, "9180")).toBeNull();
  });
});
