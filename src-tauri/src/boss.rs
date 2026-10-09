//! 老板键：全局快捷键一键隐藏/显示。默认 Ctrl+Alt+H（Mac 上 Cmd+Option+H）。

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

pub fn default_boss_key() -> String {
    if cfg!(target_os = "macos") {
        "Cmd+Alt+H".into()
    } else {
        "Ctrl+Alt+H".into()
    }
}

/// 注册（或重注册）老板键
pub fn register(app: &AppHandle, accel: &str) -> Result<(), String> {
    let shortcut: Shortcut = accel.parse().map_err(|e| format!("快捷键无法解析: {accel} ({e})"))?;
    let gs = app.global_shortcut();
    gs.unregister_all().ok();
    gs.on_shortcut(shortcut, move |app, _shortcut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            toggle(app);
        }
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn toggle(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("pet") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            let _ = app.emit("pet:boss-hidden", ());
        } else {
            let _ = win.show();
            let _ = app.emit("pet:boss-shown", ());
        }
    }
    // 恢复被全屏避让压下的状态，避免两边打架
    if let Some(state) = app.try_state::<crate::avoid::AvoidState>() {
        state.suppressed.store(false, Ordering::Relaxed);
    }
}
