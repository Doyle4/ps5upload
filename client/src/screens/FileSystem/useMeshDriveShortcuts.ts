// The Mesh Drives on this console, as shortcuts in Files' Drives row (8.0.1): each jumps to the
// drive's home folder on the console. Read when the console comes up and once a minute after;
// an engine or helper from before 8.0.0 simply shows none.

import { useEffect, useState } from "react";

import { fetchDrives } from "../../api/meshDrive";

export interface MeshDriveShortcut {
  id: string;
  name: string;
  hub: string;
}

const EVERY_MS = 60_000;

export function useMeshDriveShortcuts(host: string, up: boolean): MeshDriveShortcut[] {
  const [drives, setDrives] = useState<MeshDriveShortcut[]>([]);
  useEffect(() => {
    if (!host || !up) {
      setDrives([]);
      return;
    }
    let stopped = false;
    const load = () => {
      fetchDrives(host)
        .then((a) => {
          if (stopped) return;
          setDrives(a.supported ? a.drives.map((d) => ({ id: d.id, name: d.name, hub: d.hub })) : []);
        })
        .catch(() => {
          // A failed read keeps the last list: the shortcuts are a convenience.
        });
    };
    load();
    const id = window.setInterval(load, EVERY_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [host, up]);
  return drives;
}
