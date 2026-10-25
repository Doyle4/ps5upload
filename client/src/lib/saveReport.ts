/**
 * Writes a built report to a zip the user keeps (spec §2 step 4). In the browser every file is
 * redacted here with one `Redactor` and the engine zips it as a download; on desktop the Tauri
 * builder adds the files it reads from disk and redacts the whole archive the same way.
 */
import { invoke } from "./invokeLogged";
import { downloadBugBundle, type BundleEntry } from "./browserBugBundle";
import { createRedactor } from "./redaction";
import type { BuiltReport } from "./reportBuilder";
import { isTauriEnv } from "./tauriEnv";
import { log } from "../state/logs";

export interface SavedReport {
  /** Where it was saved (desktop) or the downloaded file's name (browser). */
  dest: string;
  bytes: number;
}

export async function saveReport(
  b: BuiltReport,
  o: { redact: boolean; since: number; imagePaths: string[] },
): Promise<SavedReport | null> {
  if (!isTauriEnv()) {
    const red = createRedactor({ redact: o.redact });
    const entries: BundleEntry[] = b.entries.map((e) =>
      e.text === undefined ? { ...e } : { ...e, text: red.text(e.text) },
    );
    await downloadBugBundle(entries, b.filename);
    return { dest: b.filename, bytes: 0 };
  }
  const { pickSaveDest } = await import("./pickSaveDest");
  const dest = await pickSaveDest({
    defaultPath: b.filename,
    filters: [{ name: "Zip", extensions: ["zip"] }],
  });
  if (!dest || typeof dest !== "string") return null;
  const report = b.entries.find((e) => e.path === "report.json");
  log.info("bugreport", `saving the report to ${dest}`);
  let res: { dest: string; bytes: number };
  try {
    res = await invoke<{ dest: string; bytes: number }>("bug_report_build", {
      args: {
        dest,
        dest_filename: b.filename,
        report_json: report?.text ?? "{}",
        redact: o.redact,
        window_minutes: 0,
        since_ms: o.since,
        klog_text: null,
        syslog_text: null,
        payload_logs: [],
        image_paths: o.imagePaths,
        include: {
          ...b.desktop,
          ps5_logs: false,
          images: o.imagePaths.length > 0,
        },
        extra_entries: b.entries.filter((e) => e.path !== "report.json"),
      },
    });
  } catch (e) {
    log.error(
      "bugreport",
      `saving the report to ${dest} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    throw e;
  }
  // Said in the log either way, so a report that "came out empty" leaves a trace of where it went.
  log.info("bugreport", `report saved: ${res.dest} (${res.bytes} bytes)`);
  if (!(res.bytes > 0)) {
    log.error("bugreport", `the report at ${res.dest} is empty`);
    throw new Error(
      `The report at ${res.dest} came out empty. Please try again, and tell us if it keeps happening.`,
    );
  }
  return { dest: res.dest, bytes: res.bytes };
}
