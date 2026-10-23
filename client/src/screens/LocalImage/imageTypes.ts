/** The image files the picker offers: raw disk images, which the OS mounts
 *  itself (exFAT in practice). Mirrors `looks_like_image` in the engine's
 *  local_image.rs. A .ffpkg is not one: no desktop OS can mount it. */
export const LOCAL_IMAGE_EXTENSIONS = ["exfat", "img", "image", "raw"] as const;

/** The images the browser looks inside (#479): every kind the engine reads, mounted or not.
 *  Mirrors `browse::open` in the engine's ps5upload-fpkg. A .pkg is a debug-key package. */
export const BROWSE_IMAGE_EXTENSIONS = ["exfat", "ffpkg", "ufs2", "ffpfs", "ffpfsc", "pkg"] as const;
