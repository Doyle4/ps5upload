import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { ElfSourceHint, isPayloadElf } from "./ElfSourceHint";

const render = (path: string) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <ElfSourceHint path={path} />
    </MemoryRouter>,
  );

describe("an .elf picked for upload", () => {
  it("is told apart from games and images", () => {
    expect(isPayloadElf("/dl/orbit_store.elf")).toBe(true);
    expect(isPayloadElf("C:\\dl\\ORBIT.ELF ")).toBe(true);
    expect(isPayloadElf("/dl/PPSA99177.ffpkg")).toBe(false);
    expect(isPayloadElf("/dl/eboot.bin")).toBe(false);
  });

  it("says ShadowMount+ will not pick it up and points at Send payload", () => {
    const html = render("/dl/orbit_store.elf");
    expect(html).toContain('data-testid="upload-elf-hint"');
    expect(html).toContain("never an .elf");
    expect(html).toContain("Open Send payload");
  });

  it("says nothing for a game image", () => {
    expect(render("/dl/PPSA99177.ffpkg")).toBe("");
  });
});
