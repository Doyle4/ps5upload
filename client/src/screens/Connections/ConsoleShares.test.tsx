import { describe, expect, it } from "vitest";
import { ConsoleShareError } from "../../api/consoleShares";
import type { Connection } from "../../api/remote";
import type { Translator } from "../../state/lang";
import { emptyShareForm, formOfConnection, formOfShare, shareErrorText, shareInput } from "./ConsoleShares";

const tr = ((k: string, a?: unknown, b?: string) => (typeof a === "string" ? a : (b ?? k))) as Translator;

describe("Shares on the PS5", () => {
  it("edits a console share without resending its password unless one is typed", () => {
    const f = formOfShare({
      id: "3fa2c1d0",
      name: "NAS",
      host: "192.168.1.10",
      port: 4450,
      share: "Games",
      user: "amy",
      domain: "",
      start_path: "PS5",
      has_password: true,
    });
    expect(f.server).toBe("192.168.1.10:4450");
    const input = shareInput(f);
    expect(input).toEqual({ id: "3fa2c1d0", name: "NAS", server: "192.168.1.10:4450", share: "Games", start_path: "PS5", user: "amy", domain: "" });
    expect("password" in input).toBe(false);
    expect(shareInput({ ...f, password: "pw" }).password).toBe("pw");
    // a new share always sends one (empty = guest)
    expect(shareInput({ ...emptyShareForm(), server: " nas ", share: "x" })).toMatchObject({ server: "nas", password: "" });
  });

  it("copies a server saved on this computer as a new share, asking for the password again", () => {
    const c: Connection = {
      id: "pc1",
      name: "Home NAS",
      protocol: "smb",
      host: "nas.local",
      port: 445,
      share: "Media",
      user: "bob",
      start_path: "/Games/PS5/",
      host_key: null,
      has_secret: true,
    };
    const f = formOfConnection(c);
    expect(f).toMatchObject({ id: "", name: "Home NAS", server: "nas.local", share: "Media", start_path: "Games/PS5", user: "bob", fromPc: true, password: "" });
  });

  it("words the console's refusals", () => {
    expect(shareErrorText(new ConsoleShareError("x", "smb_auth"), tr)).toBe("The server refused that user name or password.");
    expect(shareErrorText(new ConsoleShareError("x", "shares_full"), tr)).toContain("16");
    expect(shareErrorText(new Error("boom"), tr)).toBe("boom");
  });
});
