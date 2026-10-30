//! "Game mode" while a Remote Play stream plays: whatever each platform lets an app ask for,
//! asked for when the picture starts and given back when it stops.
//!
//!   macOS, iOS: nothing to call. The system turns Game Mode on by itself for an app whose
//!               Info.plist says it is a game (`LSApplicationCategoryType`,
//!               `LSSupportsGameMode`, `GCSupportsGameMode`), on the Mac only while it is
//!               full screen. The Mac also keeps the computer and screen awake (below).
//!   Windows:    no API turns Game Mode on for an app (Windows decides from its own list of
//!               games). Keeps the computer and screen awake. `timeBeginPeriod` and the
//!               power-throttling switch were left out on purpose: both apply only to the
//!               calling process, and the stream is decoded and drawn in WebView2's own
//!               processes, not this one.
//!   Linux:      Feral GameMode (`gamemoded`) over the session D-Bus, when it is installed:
//!               its effects that matter here (CPU governor, GPU performance level, no screen
//!               saver) are system-wide, so registering this process is enough. No service:
//!               nothing happens. Also keeps the computer and screen awake.
//!   Android:    `Window.setSustainedPerformanceMode` (steady clocks instead of bursts that
//!               throttle, on devices that support it) and, on Android 11+,
//!               `Window.setPreferMinimalPostProcessing` (a TV or monitor on HDMI switches to
//!               its own game mode). The screen is already kept on by the page.
//!
//! Best effort everywhere: the stream never fails because one of these was refused.

use tokio::sync::Mutex;

/// Keep-awake reason held while a stream plays (see keep_awake.rs: refcounted by name, so it
/// never drops a hold the user set in Settings or one a transfer holds).
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const KEEP_AWAKE_REASON: &str = "remote-play";

/// Whether game mode is on now: repeats are dropped, and the calls are serialized so an off
/// can never overtake its on.
static STATE: Mutex<bool> = Mutex::const_new(false);

/// Turn game mode on (a stream started playing) or off (it stopped). Returns what was done,
/// for the log.
#[tauri::command]
pub async fn game_mode_set(window: tauri::WebviewWindow, on: bool) -> serde_json::Value {
    let mut state = STATE.lock().await;
    if *state == on {
        return serde_json::json!({ "on": on, "changed": false });
    }
    *state = on;
    #[allow(unused_mut)] // iOS: nothing to do at run time
    let mut done: Vec<String> = Vec::new();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = &window;
        if on {
            let r = super::keep_awake_acquire(KEEP_AWAKE_REASON.to_string()).await;
            if r.get("active").and_then(|v| v.as_bool()) == Some(true) {
                done.push("keep-awake".into());
            }
        } else {
            super::keep_awake_release(KEEP_AWAKE_REASON.to_string()).await;
            done.push("keep-awake".into());
        }
    }

    #[cfg(target_os = "linux")]
    match feral::set(on).await {
        Ok(()) => done.push("gamemoded".into()),
        Err(e) => eprintln!("[game-mode] gamemoded on={on}: {e}"),
    }

    #[cfg(target_os = "android")]
    {
        let queued = window.with_webview(move |wv| {
            wv.jni_handle().exec(move |env, activity, _webview| {
                let out = android::apply(env, activity, on);
                // Never hand the UI thread back with a pending exception.
                if env.exception_check().unwrap_or(false) {
                    let _ = env.exception_describe();
                    let _ = env.exception_clear();
                }
                if let Err(e) = out {
                    eprintln!("[game-mode] android on={on}: {e}");
                }
            })
        });
        match queued {
            Ok(()) => done.push("sustained-performance".into()),
            Err(e) => eprintln!("[game-mode] android on={on}: {e}"),
        }
    }

    #[cfg(target_os = "ios")]
    let _ = &window;

    serde_json::json!({ "on": on, "changed": true, "done": done })
}

/// App exit with a stream still playing: unregister from gamemoded (it would notice the
/// process is gone on its own, a few seconds later). The keep-awake hold is released by
/// `keep_awake_release_on_exit`.
pub async fn game_mode_release_on_exit() {
    let mut state = STATE.lock().await;
    if !*state {
        return;
    }
    *state = false;
    #[cfg(target_os = "linux")]
    let _ = feral::set(false).await;
}

#[cfg(target_os = "linux")]
mod feral {
    use std::time::Duration;

    const SERVICE: &str = "com.feralinteractive.GameMode";
    const PATH: &str = "/com/feralinteractive/GameMode";

    /// Register (or unregister) this process with gamemoded. A missing service is an error
    /// here and nothing more; an installed one that is not running is started by D-Bus.
    pub async fn set(on: bool) -> Result<(), String> {
        let call = async {
            let conn = zbus::Connection::session()
                .await
                .map_err(|e| e.to_string())?;
            let pid = std::process::id() as i32;
            let method = if on { "RegisterGame" } else { "UnregisterGame" };
            let reply = conn
                .call_method(Some(SERVICE), PATH, Some(SERVICE), method, &(pid,))
                .await
                .map_err(|e| e.to_string())?;
            // 0 = done, -1 = failed, -2 = refused (gamemoded's own rules).
            let code: i32 = reply.body().deserialize().map_err(|e| e.to_string())?;
            if code == 0 {
                Ok(())
            } else {
                Err(format!("{method} returned {code}"))
            }
        };
        tokio::time::timeout(Duration::from_secs(3), call)
            .await
            .map_err(|_| "no answer in 3 s".to_string())?
    }
}

#[cfg(target_os = "android")]
mod android {
    use jni::objects::{JObject, JValue};
    use jni::JNIEnv;

    pub fn apply(env: &mut JNIEnv, activity: &JObject, on: bool) -> jni::errors::Result<()> {
        let window = env
            .call_method(activity, "getWindow", "()Landroid/view/Window;", &[])?
            .l()?;
        if window.is_null() {
            return Ok(());
        }
        let sdk = env
            .get_static_field("android/os/Build$VERSION", "SDK_INT", "I")?
            .i()?;
        // API 24. A no-op on devices without the mode
        // (`PowerManager.isSustainedPerformanceModeSupported()`).
        if sdk >= 24 {
            env.call_method(
                &window,
                "setSustainedPerformanceMode",
                "(Z)V",
                &[JValue::Bool(on as u8)],
            )?;
        }
        // API 30: HDMI Auto Low Latency Mode / the display's game content type.
        if sdk >= 30 {
            env.call_method(
                &window,
                "setPreferMinimalPostProcessing",
                "(Z)V",
                &[JValue::Bool(on as u8)],
            )?;
        }
        Ok(())
    }
}
