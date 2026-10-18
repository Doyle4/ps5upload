import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../api")>();
  return { ...real, call: vi.fn(), callRaw: vi.fn() };
});

import { call, callRaw } from "../api";
import { createFile, decodeEditable, encodeText, saveBody, saveText, TEXT_SAVE_MAX } from "./transfer";

const mCall = vi.mocked(call);
const mRaw = vi.mocked(callRaw);

beforeEach(() => {
  mCall.mockReset();
  mRaw.mockReset();
});

async function blobText(b: Blob): Promise<string> {
  return new TextDecoder().decode(await new Response(b).arrayBuffer());
}

describe("text save", () => {
  it("keeps CRLF files CRLF and refuses NUL or more than 1 MiB", () => {
    expect(new TextDecoder().decode(encodeText("a\nb\n", true) as Uint8Array)).toBe("a\r\nb\r\n");
    expect(new TextDecoder().decode(encodeText("a\nb", false) as Uint8Array)).toBe("a\nb");
    expect(encodeText("a\u0000b", false)).toBe("binary");
    expect(encodeText("x".repeat(TEXT_SAVE_MAX + 1), false)).toBe("too_large");
    expect((encodeText("é".repeat(TEXT_SAVE_MAX / 2), false) as Uint8Array).length).toBe(TEXT_SAVE_MAX);
  });
  it("opens only valid UTF-8 without NUL, keeping a BOM", () => {
    const enc = new TextEncoder();
    expect(decodeEditable(enc.encode("hi\n").buffer as ArrayBuffer)).toBe("hi\n");
    expect(decodeEditable(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]).buffer)).toBe("﻿A");
    expect(decodeEditable(new Uint8Array([0x41, 0xff, 0x42]).buffer)).toBeNull();
    expect(decodeEditable(new Uint8Array([0x41, 0x00]).buffer)).toBeNull();
  });
  it("sends one JSON line, then the bytes, with the stamp the editor read", async () => {
    mRaw.mockResolvedValue({ mtime: 5, size: 3 });
    const r = await saveText("/data/a.txt", new TextEncoder().encode("new"), { mtime: 1, size: 9 });
    expect(r).toEqual({ mtime: 5, size: 3 });
    const [route, body] = mRaw.mock.calls[0];
    expect(route).toBe("/api/fs/save-text");
    expect(await blobText(body)).toBe('{"path":"/data/a.txt","mtime":1,"size":9}\nnew');
    await saveText("/data/a.txt", new Uint8Array(0), { mtime: 1, size: 9, mtime_ns: 77 });
    expect(await blobText(mRaw.mock.calls[1][1])).toBe('{"path":"/data/a.txt","mtime":1,"size":9,"mtime_ns":77}\n');
  });
  it("creates an empty file with create", async () => {
    mRaw.mockResolvedValue({ mtime: 5, size: 0 });
    await createFile("/data/new.cfg");
    expect(await blobText(mRaw.mock.calls[0][1])).toBe('{"path":"/data/new.cfg","create":true}\n');
  });
  it("builds a body with a newline-free head", async () => {
    expect(await blobText(saveBody({ path: "/a\nb" }, new Uint8Array([0x41])))).toBe('{"path":"/a\\nb"}\nA');
  });
});
