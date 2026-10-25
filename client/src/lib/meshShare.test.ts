import { describe, expect, it } from "vitest";

import { Clock, merge, type LwwMap } from "./meshCrdt";
import { consoleKey, fieldKey, localView, plan, rosterFrom, settingKey, stampLocal } from "./meshShare";
import type { PS5Profile } from "../state/roster";

const PIN = "ps5upload.desktop-sidebar.pinned.v1";

/** A device: its console list, its settings, its copy of the map and its clock. */
function device(name: string, profiles: PS5Profile[], settings: Record<string, string> = {}) {
  let wall = 1_000;
  const clock = new Clock(name, undefined, () => wall);
  let m: LwwMap = {};
  const store = new Map(Object.entries(settings));
  let list = profiles;
  let n = 0;
  // The app takes its baseline when sharing starts.
  m = stampLocal(m, localView(list, (k) => store.get(k) ?? null), clock);
  const d = {
    get list() {
      return list;
    },
    store,
    tick(ms = 1000) {
      wall += ms;
    },
    edit(f: (l: PS5Profile[]) => PS5Profile[]) {
      list = f(list);
      m = stampLocal(m, localView(list, (k) => store.get(k) ?? null), clock);
    },
    set(k: string, v: string) {
      store.set(k, v);
      m = stampLocal(m, localView(list, (k2) => store.get(k2) ?? null), clock);
    },
    /** Syncs with a console's copy and returns the console's new copy. */
    sync(console: LwwMap): LwwMap {
      m = stampLocal(m, localView(list, (k) => store.get(k) ?? null), clock);
      const merged = merge(m, console);
      const todo = plan(merged, localView(list, (k) => store.get(k) ?? null), list, () => `${name}-${++n}`);
      for (const [k, v] of todo.settings) {
        if (v === null) store.delete(k);
        else store.set(k, v);
      }
      if (todo.roster) list = todo.roster;
      m = merged;
      return merged;
    },
  };
  return d;
}

const phat = (id: string, extra: Partial<PS5Profile> = {}): PS5Profile =>
  ({ id, name: "Phat", host: "192.168.86.99", ...extra }) as PS5Profile;
const pro = (id: string, extra: Partial<PS5Profile> = {}): PS5Profile =>
  ({ id, name: "Pro", host: "192.168.86.100", ...extra }) as PS5Profile;

describe("console list through the consoles", () => {
  it("the same PS5 on two devices stays one entry, under each device's own id", () => {
    const mac = device("mac", [phat("m1")]);
    const phone = device("phone", [phat("p1"), pro("p2")]);
    let x: LwwMap = {};
    x = mac.sync(x);
    x = phone.sync(x);
    x = mac.sync(x);
    expect(mac.list.map((p) => [p.id, p.host])).toEqual([
      ["m1", "192.168.86.99"],
      ["mac-1", "192.168.86.100"],
    ]);
    expect(phone.list.map((p) => p.id)).toEqual(["p1", "p2"]);
    // Syncing again changes nothing.
    const again = mac.sync(phone.sync(x));
    expect(again).toEqual(x);
    expect(mac.list).toHaveLength(2);
  });

  it("a console deleted on one device stays deleted through another console's stale copy", () => {
    const mac = device("mac", [phat("m1"), pro("m2")]);
    const phone = device("phone", [phat("p1"), pro("p2")]);
    let x: LwwMap = {};
    let y: LwwMap = {};
    x = mac.sync(x);
    y = phone.sync(mac.sync(y)); // both consoles know both PS5s
    mac.tick();
    mac.edit((l) => l.filter((p) => p.name !== "Pro")); // removed on the Mac
    x = mac.sync(x);
    // The phone meets the stale console first, then the one that heard of the removal.
    y = phone.sync(y);
    expect(phone.list.map((p) => p.name)).toEqual(["Phat", "Pro"]);
    phone.sync(x);
    expect(phone.list.map((p) => p.name)).toEqual(["Phat"]);
    // And it carries the removal to the stale console; the Mac never sees Pro again.
    y = phone.sync(y);
    mac.sync(y);
    expect(mac.list.map((p) => p.name)).toEqual(["Phat"]);
    expect(y[consoleKey("192.168.86.100")].v).toBeNull();
  });

  it("a rename on one device and a wake key set on another both survive", () => {
    const mac = device("mac", [phat("m1")]);
    const phone = device("phone", [phat("p1")]);
    let x = phone.sync(mac.sync({}));
    mac.tick();
    phone.tick();
    mac.edit((l) => l.map((p) => ({ ...p, name: "Living room" })));
    phone.edit((l) => l.map((p) => ({ ...p, wake_credential: "abc" })));
    x = mac.sync(x);
    x = phone.sync(x);
    mac.sync(x);
    for (const d of [mac, phone]) {
      expect(d.list[0]).toMatchObject({ name: "Living room", wake_credential: "abc" });
    }
    expect(x[fieldKey("192.168.86.99", "name")].v).toBe("Living room");
  });
});

describe("settings through the consoles", () => {
  it("a new device takes the set-up others changed; its untouched defaults do not win", () => {
    const mac = device("mac", [], { [PIN]: '["/files"]' });
    mac.tick();
    mac.set(PIN, '["/files","/games"]'); // changed after sharing began
    const phone = device("phone", [], { [PIN]: '["/upload"]' }); // its own, from before sharing
    const x = mac.sync({});
    phone.sync(x);
    expect(phone.store.get(PIN)).toBe('["/files","/games"]');
    expect(x[settingKey(PIN)].v).toBe('["/files","/games"]');
  });

  it("the later of two changes wins on every device, whichever syncs first", () => {
    const a = device("a", [], {});
    const b = device("b", [], {});
    a.tick(10);
    a.set(PIN, "A");
    b.tick(20);
    b.set(PIN, "B");
    const x = b.sync(a.sync({}));
    a.sync(x);
    expect([a.store.get(PIN), b.store.get(PIN)]).toEqual(["B", "B"]);
  });
});

describe("rosterFrom", () => {
  it("never lists one address twice, even if this device had", () => {
    const list = rosterFrom({}, [phat("a"), phat("b"), pro("c")]);
    expect(list.map((p) => p.id)).toEqual(["a", "c"]);
  });
});
