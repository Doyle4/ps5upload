import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { SendPayloadPointer } from "./index";

describe("Connection points at Send payload", () => {
  it("says where other payloads are sent from, with a button that goes there", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SendPayloadPointer />
      </MemoryRouter>,
    );
    expect(html).toContain('data-testid="connection-send-payload-pointer"');
    expect(html).toContain("Payloads → Send payload");
    expect(html).toContain("Open Send payload");
  });
});
