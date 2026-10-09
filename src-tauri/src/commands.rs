//! Tauri 命令：面板数据、分享卡保存/复制、自启、老板键。

use std::sync::atomic::Ordering;

use chrono::{Local, NaiveDate};
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt as _;

use crate::retire::{self, Category};
use crate::workdays;

#[derive(serde::Deserialize)]
pub struct RetireQuery {
    pub birth_ym: String,
    pub birth_day: Option<u32>,
    pub category: Category,
    pub join_ym: Option<String>,
    pub flex_months: Option<i64>,
}

#[derive(serde::Serialize)]
pub struct Progress {
    pub ratio: f64,
}

#[derive(serde::Serialize)]
pub struct RetireInfo {
    pub retire_date: String,
    pub retire_ym: String,
    pub days_left: i64,
    pub workdays_left: workdays::WorkdayCount,
    pub retire_age_label: String,
    pub base_age: u32,
    pub flex_ym: Option<String>,
    pub flex_date: Option<String>,
    pub flex_days_left: Option<i64>,
    pub progress: Option<Progress>,
    pub next_holiday: Option<workdays::NextHoliday>,
}

fn parse_ym(s: &str) -> Result<(i32, u32), String> {
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 2 {
        return Err(format!("年月格式应为 YYYY-MM: {s}"));
    }
    Ok((parts[0].parse().map_err(|e: std::num::ParseIntError| e.to_string())?,
        parts[1].parse().map_err(|e: std::num::ParseIntError| e.to_string())?))
}

#[tauri::command]
pub fn get_retire_info(
    birth_ym: String,
    birth_day: Option<u32>,
    category: Category,
    join_ym: Option<String>,
    flex_months: Option<i64>,
) -> Result<RetireInfo, String> {
    let q = RetireQuery { birth_ym, birth_day, category, join_ym, flex_months };
    let (by, bm) = parse_ym(&q.birth_ym)?;
    let today = Local::now().date_naive();
    let r = retire::compute(by, bm, q.birth_day, q.category, today)?;
    let retire_date = r.retire_date;

    let flex = if let Some(mo) = q.flex_months.filter(|m| *m != 0) {
        let (fy, fm, fdate) = retire::flex(
            r.retire_ym, q.birth_day, by, bm, q.category, mo,
        )?;
        Some((
            format!("{fy:04}-{fm:02}"),
            fdate.to_string(),
            (fdate - today).num_days(),
        ))
    } else {
        None
    };

    let progress = q.join_ym.as_ref().and_then(|j| {
        parse_ym(j).ok().and_then(|(jy, jm)| {
            NaiveDate::from_ymd_opt(jy, jm, 1).map(|start| {
                let end = retire_date;
                let total = (end - start).num_days();
                if total <= 0 {
                    Progress { ratio: 1.0 }
                } else {
                    Progress { ratio: ((today - start).num_days() as f64 / total as f64).clamp(0.0, 1.0) }
                }
            })
        })
    });

    let off_to = if r.days_left > 0 { retire_date.pred_opt() } else { None };
    let workdays_left = match off_to {
        Some(to) => workdays::count_workdays(today, to),
        None => workdays::WorkdayCount { days: 0, estimated: false },
    };

    Ok(RetireInfo {
        retire_date: retire_date.to_string(),
        retire_ym: format!("{:04}-{:02}", r.retire_ym.0, r.retire_ym.1),
        days_left: r.days_left,
        workdays_left,
        retire_age_label: r.retire_age_label,
        base_age: r.base_age,
        flex_ym: flex.as_ref().map(|f| f.0.clone()),
        flex_date: flex.as_ref().map(|f| f.1.clone()),
        flex_days_left: flex.as_ref().map(|f| f.2),
        progress,
        next_holiday: workdays::next_holiday(today),
    })
}

#[tauri::command]
pub fn get_next_holiday() -> Option<workdays::NextHoliday> {
    workdays::next_holiday(Local::now().date_naive())
}

#[tauri::command]
pub fn is_workday(date: String) -> Result<bool, String> {
    let date = NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|_| "日期格式应为 YYYY-MM-DD".to_string())?;
    Ok(workdays::is_workday(date))
}

/// 保存分享卡：弹系统保存框
#[tauri::command]
pub async fn save_png(app: AppHandle, data: Vec<u8>) -> Result<String, String> {
    let _ = app;
    tauri::async_runtime::spawn_blocking(move || {
        let path = rfd::FileDialog::new()
            .set_title("保存分享卡")
            .set_file_name("我的退休倒计时.png")
            .add_filter("PNG 图片", &["png"])
            .save_file();
        match path {
            Some(p) => std::fs::write(&p, &data)
                .map(|_| p.to_string_lossy().to_string())
                .map_err(|e| e.to_string()),
            None => Err("已取消".into()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 复制 RGBA 到剪贴板（分享卡）
#[tauri::command]
pub async fn copy_rgba(rgba: Vec<u8>, width: u32, height: u32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut clip = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        clip.set_image(arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: std::borrow::Cow::Owned(rgba),
        })
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enable: bool) -> Result<(), String> {
    let autostart = app.autolaunch();
    if enable {
        autostart.enable().map_err(|e| e.to_string())
    } else {
        autostart.disable().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn avoid_get_enabled(state: tauri::State<'_, crate::avoid::AvoidState>) -> bool {
    state.enabled.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn avoid_set_enabled(state: tauri::State<'_, crate::avoid::AvoidState>, enabled: bool) {
    state.enabled.store(enabled, Ordering::Relaxed);
}

/// 老板键重设（前端改键后调用；None 恢复默认）
#[tauri::command]
pub fn set_boss_key(app: AppHandle, accel: Option<String>) -> Result<(), String> {
    let key = accel.unwrap_or_else(crate::boss::default_boss_key);
    crate::boss::register(&app, &key)
}

/// 调试日志（开发排查用）：前端把异常写进 /tmp/retire-desk-pet-debug.log
#[tauri::command]
pub fn debug_log(msg: String) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/retire-desk-pet-debug.log")
    {
        let _ = writeln!(f, "{msg}");
    }
}

#[tauri::command]
pub fn boss_toggle(app: AppHandle) {
    crate::boss::toggle(&app);
}

#[tauri::command]
pub fn set_tray_pending(app: AppHandle, pending: bool) -> Result<(), String> {
    let tray = app.tray_by_id("main-tray").ok_or("找不到托盘图标")?;
    let icon = crate::tray_icon(pending).map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    tray.set_icon_with_as_template(Some(icon), !pending)
        .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "macos"))]
    tray.set_icon(Some(icon)).map_err(|error| error.to_string())?;
    tray.set_tooltip(Some(if pending { "退休桌宠 · 有待处理提醒" } else { "退休桌宠" }))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
