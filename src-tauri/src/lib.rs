mod avoid;
mod boss;

/// 托盘「开机自启」菜单项句柄（点击后更新文字用）
pub struct TrayItems(pub std::sync::Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>>);
mod commands;
mod retire;
mod workdays;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_autostart::MacosLauncher;

pub fn tray_icon(pending: bool) -> tauri::Result<tauri::image::Image<'static>> {
    #[cfg(target_os = "macos")]
    let mut icon = tauri::image::Image::from_bytes(include_bytes!(
        "../../public/assets/tray/tray-16.png"))?;
    #[cfg(not(target_os = "macos"))]
    let mut icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    if !pending {
        return Ok(icon);
    }
    let width = icon.width();
    let height = icon.height();
    let mut rgba = icon.rgba().to_vec();
    let radius = (width.min(height) / 5).max(2) as i32;
    let center_x = width as i32 - radius - 1;
    let center_y = radius;
    for y in 0..height as i32 {
        for x in 0..width as i32 {
            let dx = x - center_x;
            let dy = y - center_y;
            if dx * dx + dy * dy <= radius * radius {
                let offset = ((y as u32 * width + x as u32) * 4) as usize;
                rgba[offset..offset + 4].copy_from_slice(&[220, 48, 48, 255]);
            }
        }
    }
    icon = tauri::image::Image::new_owned(rgba, width, height);
    Ok(icon)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(TrayItems(std::sync::Mutex::new(None)))
        .manage(avoid::AvoidState {
            enabled: std::sync::atomic::AtomicBool::new(true),
            suppressed: std::sync::atomic::AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_retire_info,
            commands::get_next_holiday,
            commands::is_workday,
            commands::save_png,
            commands::copy_rgba,
            commands::set_autostart,
            commands::get_autostart,
            commands::avoid_get_enabled,
            commands::avoid_set_enabled,
            commands::set_boss_key,
            commands::debug_log,
            commands::boss_toggle,
            commands::set_tray_pending,
            commands::quit_app,
        ])
        .setup(|app| {
            // macOS：做成「配件」应用——不进 Dock/Cmd+Tab，也不受台前调度收纳，小人才能一直浮在桌面上
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // ---- 托盘 ----
            use tauri_plugin_autostart::ManagerExt as _;
            let toggle_item = MenuItem::with_id(app, "toggle", "显示 / 隐藏", true, None::<&str>)?;
            let panel_item = MenuItem::with_id(app, "panel", "打开倒计时", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
            let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
            let autostart_item = MenuItem::with_id(
                app, "autostart",
                if autostart_on { "开机自启：开" } else { "开机自启：关" },
                true, None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(
                app, &[&toggle_item, &panel_item, &settings_item, &autostart_item, &quit_item])?;

            // 菜单栏用单色剪影模板图；其余平台用彩色小图标
            let icon = tray_icon(false)?;
            let mut tray = TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .tooltip("退休桌宠")
                .menu(&menu)
                .show_menu_on_left_click(true);
            #[cfg(target_os = "macos")]
            {
                tray = tray.icon_as_template(true);
            }
            *app.state::<TrayItems>().0.lock().unwrap() = Some(autostart_item);
            let tray = tray.build(app)?;
            #[cfg(debug_assertions)]
            if std::env::var("RETIRE_E2E").is_ok() {
                let debug_tray = tray.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    if let Ok(Some(rect)) = debug_tray.rect() {
                        eprintln!("RETIRE_E2E_TRAY_RECT={rect:?}");
                    }
                });
            }

            // ---- 老板键 ----
            boss::register(app.handle(), &boss::default_boss_key())
                .map_err(|e| format!("老板键注册失败: {e}"))?;

            // ---- 全屏避让轮询 ----
            avoid::start_poll(app.handle().clone());

            // 仅 debug 构建起的 E2E 开关：为真机验收播种测试资料，不进入发布构建
            #[cfg(debug_assertions)]
            {
                let e2e = std::env::var("RETIRE_E2E").unwrap_or_default();
                if matches!(e2e.as_str(), "pet" | "panel" | "settings" | "sedentary" | "water" | "reset") {
                    if let Some(webview) = app.get_webview_window("pet") {
                        let mode_js = if e2e == "reset" {
                            "Object.keys(localStorage).filter(function(k){return k.indexOf('rdp.v1.')===0;})\
                             .forEach(function(k){localStorage.removeItem(k);});".to_string()
                        } else if e2e == "panel" || e2e == "settings" {
                            format!(
                                "localStorage.setItem('rdp.v1.mode','{e2e}');\
                                 localStorage.removeItem('rdp.v1.winpos');"
                            )
                        } else {
                            "localStorage.setItem('rdp.v1.mode','pet');\
                             localStorage.removeItem('rdp.v1.winpos');".to_string()
                        };
                        let reminder_js = if e2e == "sedentary" || e2e == "water" {
                            let kind = e2e.as_str();
                            let health = if e2e == "water" { 13 } else { 2 };
                            format!(r#"
                                (function() {{
                                  var now = Date.now(), d = new Date(now), pad = function(v) {{ return String(v).padStart(2, '0'); }};
                                  var date = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
                                  localStorage.setItem('rdp.v1.reminder-runtime', JSON.stringify({{
                                    date: date, nextSedentaryAt: now + 3600000, nextWaterAt: now + 5400000,
                                    active: {{ id: '{kind}-e2e', kind: '{kind}', healthIndex: {health} }}, queue: [],
                                    mutedToday: {{ sedentary: false, water: false }},
                                    stats: {{ standUps: 2, waterCups: 3, missed: 1 }},
                                    firedAt: [now], lastHealthIndex: {health}, goalJustReached: false
                                  }}));
                                }})();
                            "#)
                        } else {
                            String::new()
                        };
                        let _ = webview.eval(&format!(
                            r#"
                            localStorage.setItem('rdp.v1.profile', JSON.stringify({{
                              birthYm: '1985-06', birthDay: 12, category: 'male', joinYm: '2010-09'
                            }}));
                            localStorage.setItem('rdp.v1.avatar', JSON.stringify({{
                              gender: 'm', tone: 'light', hair: 'm2', hairColor: 'black',
                              glasses: 'off', bottom: 'pants'
                            }}));
                            {mode_js}
                            {reminder_js}
                            location.reload();
                        "#
                        ));
                    }
                }
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            use tauri_plugin_autostart::ManagerExt as _;
            match event.id().as_ref() {
                "toggle" => boss::toggle(app),
                "panel" => {
                    if let Some(win) = app.get_webview_window("pet") {
                        let _ = win.show();
                        let _ = app.emit("pet:boss-shown", ());
                    }
                    let _ = app.emit("ui:open", "panel");
                }
                "settings" => {
                    if let Some(win) = app.get_webview_window("pet") {
                        let _ = win.show();
                        let _ = app.emit("pet:boss-shown", ());
                    }
                    let _ = app.emit("ui:open", "settings");
                }
                "autostart" => {
                    let autolaunch = app.autolaunch();
                    let enabled = autolaunch.is_enabled().unwrap_or(false);
                    let r = if enabled {
                        autolaunch.disable()
                    } else {
                        autolaunch.enable()
                    };
                    if r.is_ok() {
                        // 菜单项文字带上当前状态（托盘菜单没有弹出前钩子，点击后更新）
                        if let Some(item) = app.state::<TrayItems>().0.lock().unwrap().as_ref() {
                            let _ = item.set_text(if !enabled { "开机自启：开" } else { "开机自启：关" });
                        }
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("退休桌宠启动失败");
}

#[cfg(test)]
mod tray_tests {
    #[test]
    fn pending_tray_icon_contains_a_red_badge() {
        let image = super::tray_icon(true).unwrap();
        assert!(image.rgba().chunks_exact(4).any(|pixel|
            pixel[0] > 180 && pixel[1] < 100 && pixel[2] < 100 && pixel[3] > 200));
    }
}
