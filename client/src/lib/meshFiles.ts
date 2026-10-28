/**
 * The files a Mesh Drive keeps in its folders for its own use (engine mesh_drive_plan.rs:
 * MARKER, TMP, BASE_FILE). Files hides them: the marker is what says "this folder is the
 * drive", and deleting it made the drive treat the folder as offline. The trash folder stays
 * visible, so deleted files can be got back.
 */
export const MESH_MARKER = ".ps5upload-mesh";
const MESH_INTERNAL = new Set([MESH_MARKER, ".ps5upload-mesh-tmp", ".ps5upload-mesh-base"]);

export function isMeshInternal(name: string): boolean {
  return MESH_INTERNAL.has(name);
}
