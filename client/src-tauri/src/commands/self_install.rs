//! Install a downloaded update and start the new version, where that needs nothing paid.
//!
//! `update_download` saves the platform's bundle; this replaces the running copy with it. A
//! small script does the work after the app has quit (a running program cannot be replaced),
//! then starts the new version. Whatever fails, the script starts the app again, so a failed
//! install leaves the old version running and the download where it was.
//!
//! What can be replaced this way:
//!
//! * Windows, installed: the setup `.exe` runs silently (`/S`, NSIS) into the same folder.
//! * Windows, portable: the zip holds one `PS5Upload.exe`, which replaces the running one.
//! * macOS: the `.app` in the `.dmg` replaces the running bundle, if its folder is writable.
//! * Linux, portable: the zip's `PS5Upload.AppImage` (and launcher) replace the running
//!   AppImage (`$APPIMAGE`), if its folder is writable.
//!
//! Not here: a `.deb` / `.rpm` (installing needs root: `update_download` hands over the command
//! instead), Android (the system asks before every install), iOS (re-signed by the user's own
//! tool) and Docker (the image is pulled).

use std::path::{Path, PathBuf};

use tauri::AppHandle;

/// What an install replaces, and with what.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Plan {
    /// Run the Windows setup silently, then start `exe` (it installs over it).
    WindowsSetup { installer: PathBuf, exe: PathBuf },
    /// Replace the portable `exe` with the zip's `PS5Upload.exe`.
    WindowsZip { zip: PathBuf, exe: PathBuf },
    /// Replace the `.app` bundle with the one in the `.dmg`.
    MacDmg { dmg: PathBuf, bundle: PathBuf },
    /// Replace the AppImage (and its launcher beside it) with the zip's.
    LinuxAppImage { zip: PathBuf, appimage: PathBuf },
}

/// The plan for installing `download` over this copy, or None when this copy cannot be
/// replaced by itself (see the module notes). `exe` is the running program and `appimage` the
/// `$APPIMAGE` path a Linux AppImage runs as.
pub fn plan_for(
    os: &str,
    download: &Path,
    exe: &Path,
    appimage: Option<&Path>,
    writable: &dyn Fn(&Path) -> bool,
) -> Option<Plan> {
    let name = download.file_name()?.to_str()?.to_ascii_lowercase();
    match os {
        "windows" if name.ends_with("-setup.exe") => Some(Plan::WindowsSetup {
            installer: download.to_path_buf(),
            exe: exe.to_path_buf(),
        }),
        "windows" if name.ends_with(".zip") && writable(exe.parent()?) => Some(Plan::WindowsZip {
            zip: download.to_path_buf(),
            exe: exe.to_path_buf(),
        }),
        "macos" if name.ends_with(".dmg") => {
            // …/PS5Upload.app/Contents/MacOS/PS5Upload
            let bundle = exe.parent()?.parent()?.parent()?;
            let is_bundle = bundle.extension().is_some_and(|e| e == "app");
            (is_bundle && writable(bundle.parent()?)).then(|| Plan::MacDmg {
                dmg: download.to_path_buf(),
                bundle: bundle.to_path_buf(),
            })
        }
        "linux" if name.ends_with(".zip") => {
            let appimage = appimage?;
            writable(appimage.parent()?).then(|| Plan::LinuxAppImage {
                zip: download.to_path_buf(),
                appimage: appimage.to_path_buf(),
            })
        }
        _ => None,
    }
}

/// A POSIX shell word.
fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// A PowerShell single-quoted string.
fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// The script that carries `plan` out once process `pid` has quit. Every path ends by starting
/// the app, new or old.
pub fn script_for(plan: &Plan, pid: u32) -> String {
    match plan {
        Plan::MacDmg { dmg, bundle } => {
            let dmg = sh_quote(&dmg.to_string_lossy());
            let app = sh_quote(&bundle.to_string_lossy());
            format!(
                r#"#!/bin/sh
# PS5Upload update: replace the app bundle with the one in the .dmg, then start it.
pid={pid}
dmg={dmg}
app={app}
n=0
while kill -0 "$pid" 2>/dev/null && [ "$n" -lt 120 ]; do sleep 0.5; n=$((n+1)); done
mnt=$(mktemp -d /tmp/ps5upload-update.XXXXXX)
if hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$mnt" "$dmg" >/dev/null; then
  src=$(ls -d "$mnt"/*.app 2>/dev/null | head -n 1)
  new="$app.new.$$"
  old="$app.old.$$"
  rm -rf "$new"
  if [ -n "$src" ] && ditto "$src" "$new"; then
    if mv "$app" "$old"; then
      if mv "$new" "$app"; then rm -rf "$old"; else mv "$old" "$app"; fi
    fi
  fi
  rm -rf "$new"
  hdiutil detach "$mnt" -quiet || hdiutil detach "$mnt" -force -quiet
fi
rmdir "$mnt" 2>/dev/null
xattr -dr com.apple.quarantine "$app" 2>/dev/null
open "$app"
"#
            )
        }
        Plan::LinuxAppImage { zip, appimage } => {
            let zip = sh_quote(&zip.to_string_lossy());
            let target = sh_quote(&appimage.to_string_lossy());
            format!(
                r#"#!/bin/sh
# PS5Upload update: replace the AppImage (and its launcher) with the zip's, then start it.
pid={pid}
zip={zip}
target={target}
n=0
while kill -0 "$pid" 2>/dev/null && [ "$n" -lt 120 ]; do sleep 0.5; n=$((n+1)); done
dir=$(mktemp -d /tmp/ps5upload-update.XXXXXX)
if unzip -oq "$zip" -d "$dir" 2>/dev/null || python3 -c 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$zip" "$dir"; then
  if [ -f "$dir/PS5Upload.AppImage" ]; then
    chmod +x "$dir/PS5Upload.AppImage"
    cp -f "$dir/PS5Upload.AppImage" "$target.new.$$" && mv -f "$target.new.$$" "$target"
    if [ -f "$dir/PS5Upload.sh" ] && [ -f "$(dirname "$target")/PS5Upload.sh" ]; then
      cp -f "$dir/PS5Upload.sh" "$(dirname "$target")/PS5Upload.sh"
      chmod +x "$(dirname "$target")/PS5Upload.sh"
    fi
  fi
fi
rm -rf "$dir"
nohup "$target" >/dev/null 2>&1 &
"#
            )
        }
        Plan::WindowsSetup { installer, exe } => {
            let installer = ps_quote(&installer.to_string_lossy());
            let exe = ps_quote(&exe.to_string_lossy());
            format!(
                r#"# PS5Upload update: run the installer silently, then start the app.
$ErrorActionPreference = 'Continue'
$installer = {installer}
$exe = {exe}
Wait-Process -Id {pid} -Timeout 60 -ErrorAction SilentlyContinue
# The engine beside the app holds its .exe open; the installer cannot replace it while it runs.
$dir = Split-Path -Parent $exe
Get-Process -ErrorAction SilentlyContinue | Where-Object {{ $_.Path -and $_.Path.StartsWith($dir, [System.StringComparison]::OrdinalIgnoreCase) }} | Stop-Process -Force -ErrorAction SilentlyContinue
try {{ Start-Process -FilePath $installer -ArgumentList '/S' -Wait }} catch {{ }}
Start-Process -FilePath $exe
"#
            )
        }
        Plan::WindowsZip { zip, exe } => {
            let zip = ps_quote(&zip.to_string_lossy());
            let exe = ps_quote(&exe.to_string_lossy());
            format!(
                r#"# PS5Upload update: replace the portable PS5Upload.exe with the zip's, then start it.
$ErrorActionPreference = 'Continue'
$zip = {zip}
$exe = {exe}
Wait-Process -Id {pid} -Timeout 60 -ErrorAction SilentlyContinue
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("ps5upload-update-" + [guid]::NewGuid())
try {{
  Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
  $new = Join-Path $tmp 'PS5Upload.exe'
  if (Test-Path -LiteralPath $new) {{
    for ($i = 0; $i -lt 20; $i++) {{
      try {{ Copy-Item -LiteralPath $new -Destination $exe -Force -ErrorAction Stop; break }}
      catch {{ Start-Sleep -Milliseconds 500 }}
    }}
  }}
}} catch {{ }}
Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
Start-Process -FilePath $exe
"#
            )
        }
    }
}

fn dir_writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".ps5upload-write-test-{}", std::process::id()));
    match std::fs::File::create(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// This copy's plan for `download`, from the running program and the platform.
pub fn plan(download: &Path) -> Option<Plan> {
    let exe = std::env::current_exe().ok()?;
    let appimage = std::env::var_os("APPIMAGE").map(PathBuf::from);
    plan_for(
        std::env::consts::OS,
        download,
        &exe,
        appimage.as_deref(),
        &dir_writable,
    )
}

/// Start `script` detached from this process, so it outlives the app.
fn spawn_detached(plan: &Plan, script: &str) -> Result<(), String> {
    let dir = std::env::temp_dir();
    let windows = matches!(plan, Plan::WindowsSetup { .. } | Plan::WindowsZip { .. });
    let path = dir.join(format!(
        "ps5upload-update-{}.{}",
        std::process::id(),
        if windows { "ps1" } else { "sh" }
    ));
    std::fs::write(&path, script).map_err(|e| format!("write {}: {e}", path.display()))?;
    let mut cmd;
    if windows {
        cmd = std::process::Command::new("powershell.exe");
        cmd.args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-File",
        ])
        .arg(&path);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const DETACHED_PROCESS: u32 = 0x0000_0008;
            const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
        }
    } else {
        cmd = std::process::Command::new("/bin/sh");
        cmd.arg(&path);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // Its own process group: nothing that ends the app's group ends the update.
            cmd.process_group(0);
        }
    }
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("start the update: {e}"))
}

/// Whether `update_install` can install `path` on this copy.
pub fn can_install(path: &str) -> bool {
    plan(Path::new(path)).is_some()
}

/// Install the downloaded update at `path` and restart into it. The app quits once the
/// installing script has started; the script starts the app again when it is done.
#[tauri::command]
pub async fn update_install(app: AppHandle, path: String) -> Result<(), String> {
    let download = PathBuf::from(&path);
    let downloads = super::updates::downloads_dir(&app)?;
    // Only a file update_download saved: never an arbitrary path handed in.
    if download.parent() != Some(downloads.as_path()) || !download.is_file() {
        return Err(format!("{path} is not a downloaded update"));
    }
    let plan = plan(&download).ok_or_else(|| {
        "this copy cannot install updates by itself; install the download by hand".to_string()
    })?;
    spawn_detached(&plan, &script_for(&plan, std::process::id()))?;
    // Let the reply reach the window before the app goes.
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const YES: &dyn Fn(&Path) -> bool = &|_: &Path| true;
    const NO: &dyn Fn(&Path) -> bool = &|_: &Path| false;

    #[test]
    fn each_platform_gets_its_own_plan_or_none() {
        let mac_exe = Path::new("/Applications/PS5Upload.app/Contents/MacOS/PS5Upload");
        assert_eq!(
            plan_for(
                "macos",
                Path::new("/d/PS5Upload-7.6.0-mac-arm64.dmg"),
                mac_exe,
                None,
                YES
            ),
            Some(Plan::MacDmg {
                dmg: "/d/PS5Upload-7.6.0-mac-arm64.dmg".into(),
                bundle: "/Applications/PS5Upload.app".into(),
            })
        );
        // /Applications not writable (a standard account): by hand.
        assert_eq!(
            plan_for("macos", Path::new("/d/x-mac-arm64.dmg"), mac_exe, None, NO),
            None
        );
        // Run from inside the mounted .dmg, not a bundle we can swap.
        assert_eq!(
            plan_for(
                "macos",
                Path::new("/d/x.dmg"),
                Path::new("/usr/local/bin/ps5upload"),
                None,
                YES
            ),
            None
        );
        let win_exe = Path::new(r"C:\Users\me\AppData\Local\PS5Upload\PS5Upload.exe");
        assert!(matches!(
            plan_for(
                "windows",
                Path::new("/d/PS5Upload-7.6.0-win-x64-setup.exe"),
                win_exe,
                None,
                NO
            ),
            Some(Plan::WindowsSetup { .. })
        ));
        assert!(matches!(
            plan_for(
                "windows",
                Path::new("/d/PS5Upload-7.6.0-win-x64.zip"),
                win_exe,
                None,
                YES
            ),
            Some(Plan::WindowsZip { .. })
        ));
        assert_eq!(
            plan_for(
                "windows",
                Path::new("/d/PS5Upload-7.6.0-win-x64.zip"),
                win_exe,
                None,
                NO
            ),
            None
        );
        let linux_exe = Path::new("/tmp/.mount_PS5UpXY/usr/bin/ps5upload");
        assert!(matches!(
            plan_for(
                "linux",
                Path::new("/d/PS5Upload-7.6.0-linux-x64.zip"),
                linux_exe,
                Some(Path::new("/home/me/Apps/PS5Upload.AppImage")),
                YES
            ),
            Some(Plan::LinuxAppImage { .. })
        ));
        // A packaged install (no $APPIMAGE) or a package download: by hand.
        assert_eq!(
            plan_for(
                "linux",
                Path::new("/d/x-linux-x64.zip"),
                linux_exe,
                None,
                YES
            ),
            None
        );
        assert_eq!(
            plan_for(
                "linux",
                Path::new("/d/x-linux-x64.rpm"),
                linux_exe,
                None,
                YES
            ),
            None
        );
        assert_eq!(
            plan_for(
                "android",
                Path::new("/d/x-android.apk"),
                linux_exe,
                None,
                YES
            ),
            None
        );
    }

    #[test]
    fn scripts_quote_paths_and_always_restart_the_app() {
        let plan = Plan::MacDmg {
            dmg: "/Users/o'neil/Downloads/PS5Upload.dmg".into(),
            bundle: "/Applications/PS5Upload.app".into(),
        };
        let s = script_for(&plan, 42);
        assert!(s.contains("pid=42"));
        assert!(s.contains(r"dmg='/Users/o'\''neil/Downloads/PS5Upload.dmg'"));
        assert!(s.trim_end().ends_with(r#"open "$app""#));

        let plan = Plan::WindowsZip {
            zip: r"C:\Users\o'neil\Downloads\PS5Upload.zip".into(),
            exe: r"C:\Apps\PS5Upload.exe".into(),
        };
        let s = script_for(&plan, 7);
        assert!(s.contains(r"$zip = 'C:\Users\o''neil\Downloads\PS5Upload.zip'"));
        assert!(s.contains("Wait-Process -Id 7"));
        assert!(s.trim_end().ends_with("Start-Process -FilePath $exe"));

        let plan = Plan::WindowsSetup {
            installer: r"C:\d\setup.exe".into(),
            exe: r"C:\Apps\PS5Upload.exe".into(),
        };
        let s = script_for(&plan, 7);
        assert!(s.contains("-ArgumentList '/S' -Wait"));
        assert!(s.trim_end().ends_with("Start-Process -FilePath $exe"));

        let plan = Plan::LinuxAppImage {
            zip: "/d/x.zip".into(),
            appimage: "/home/me/PS5Upload.AppImage".into(),
        };
        assert!(script_for(&plan, 9)
            .trim_end()
            .ends_with(r#"nohup "$target" >/dev/null 2>&1 &"#));
    }
}
