#!/usr/bin/env python3
"""Generate the iOS app icons from the app's icon source, matching the Android launcher icon.

Writes client/src-tauri/icons/ios/ (committed): every size of the AppIcon set that
`tauri ios init` generates, under the same file names. ios-postinit-patch.sh copies them
into the generated Xcode project on every build, so the home screen shows the PS5Upload logo
instead of Tauri's placeholder.

iOS wants an opaque, full-bleed square (it rounds the corners itself), so each icon is the
logo centred on white, at the same fill as Android's legacy icon.

Run it again only when the logo changes:  python3 scripts/release/ios-icons.py
"""
import importlib.util
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "client/src-tauri/icons/ios"
FILL = 0.74

# AppIcon-<points>x<points>@<scale>x[-1].png, plus the 1024 px App Store icon.
NAMES = [
    "AppIcon-20x20@1x.png", "AppIcon-20x20@2x.png", "AppIcon-20x20@2x-1.png", "AppIcon-20x20@3x.png",
    "AppIcon-29x29@1x.png", "AppIcon-29x29@2x.png", "AppIcon-29x29@2x-1.png", "AppIcon-29x29@3x.png",
    "AppIcon-40x40@1x.png", "AppIcon-40x40@2x.png", "AppIcon-40x40@2x-1.png", "AppIcon-40x40@3x.png",
    "AppIcon-60x60@2x.png", "AppIcon-60x60@3x.png",
    "AppIcon-76x76@1x.png", "AppIcon-76x76@2x.png",
    "AppIcon-83.5x83.5@2x.png",
    "AppIcon-512@2x.png",
]


def android_icons():
    spec = importlib.util.spec_from_file_location("android_icons", Path(__file__).with_name("android-icons.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def pixels(name: str) -> int:
    if name == "AppIcon-512@2x.png":
        return 1024
    m = re.match(r"AppIcon-([\d.]+)x[\d.]+@(\d)x", name)
    assert m, name
    return round(float(m.group(1)) * int(m.group(2)))


def main() -> None:
    a = android_icons()
    mark = a.logo()
    OUT.mkdir(parents=True, exist_ok=True)
    for name in NAMES:
        side = pixels(name)
        canvas = Image.new("RGBA", (side, side), (255, 255, 255, 255))
        icon = a.centred(canvas, a.fit(mark, side, FILL))
        # Opaque: an alpha channel on an app icon is refused by the App Store and drawn black
        # by some iOS versions.
        icon.convert("RGB").save(OUT / name)
    print(f"wrote {len(NAMES)} icons to {OUT}")


if __name__ == "__main__":
    main()
