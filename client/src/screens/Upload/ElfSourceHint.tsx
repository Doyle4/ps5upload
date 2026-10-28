import { useNavigate } from "react-router";
import { Send } from "lucide-react";

import { Button } from "../../components";
import { useTr } from "../../state/lang";

/** A payload (`.elf`): something the console's ELF loader runs, not a game. */
export function isPayloadElf(path: string): boolean {
  return /\.elf$/i.test(path.trim());
}

/** Said when the picked source is an `.elf`. Uploading one puts a file on the PS5 and nothing
 *  more: ShadowMount+ only mounts and registers game folders (eboot.bin + sce_sys) and game
 *  images, so a homebrew `.elf` copied into a homebrew folder never shows up (a Discord report
 *  while installing Orbit Store, whose TV app is a `.ffpkg` image and whose `.elf` is sent to
 *  the loader). An `.elf` runs when it is sent: Payloads → Send payload. */
export function ElfSourceHint({ path }: { path: string }) {
  const tr = useTr();
  const navigate = useNavigate();
  if (!isPayloadElf(path)) return null;
  return (
    <div
      className="mt-2 rounded-[var(--radius-field)] border border-[var(--color-warn-border,var(--color-border))] bg-[var(--color-surface-3)] p-2.5 text-xs"
      data-testid="upload-elf-hint"
    >
      <div className="font-medium">
        {tr(
          "upload_elf_title",
          undefined,
          "This is a payload (.elf), not a game",
        )}
      </div>
      <div className="mt-1 text-[var(--color-muted)]">
        {tr(
          "upload_elf_body",
          undefined,
          "Uploading it only copies the file. ShadowMount+ picks up game folders (with eboot.bin and sce_sys) and game images, never an .elf, so it will not appear on the home screen. To run it, send it to the console's loader instead. A homebrew app that comes as a .ffpkg or .exfat image, or as a folder with eboot.bin, is what to upload.",
        )}
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="mt-2"
        leftIcon={<Send size={12} />}
        onClick={() => navigate("/payloads?tab=send")}
      >
        {tr("connection_send_payload_open", undefined, "Open Send payload")}
      </Button>
    </div>
  );
}
