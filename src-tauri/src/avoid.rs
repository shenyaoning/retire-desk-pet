//! 全屏避让：检测到全屏应用（PPT 放映、视频、投屏）时通知前端把桌宠藏起来。
//! - Windows：取前台窗口，判断是否无边框且铺满某台显示器（必须做到）
//! - macOS：CGWindowList 找铺满显示器的 layer-0 他进程窗口（尽力而为）
//! - Linux：未实现，README 说明

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

pub struct AvoidState {
    pub enabled: AtomicBool,
    pub suppressed: AtomicBool,
}

pub fn start_poll(app: AppHandle) {
    let state = app.state::<AvoidState>();
    state.enabled.store(true, Ordering::Relaxed);
    std::thread::spawn(move || {
        let mut suppressed = false;
        loop {
            let enabled = app
                .state::<AvoidState>()
                .enabled
                .load(Ordering::Relaxed);
            if enabled {
                let fullscreen = detect_fullscreen();
                if fullscreen && !suppressed {
                    suppressed = true;
                    app.state::<AvoidState>().suppressed.store(true, Ordering::Relaxed);
                    let _ = app.emit("pet:avoid-hidden", ());
                } else if !fullscreen && suppressed {
                    suppressed = false;
                    app.state::<AvoidState>().suppressed.store(false, Ordering::Relaxed);
                    let _ = app.emit("pet:avoid-shown", ());
                }
            } else if suppressed {
                suppressed = false;
                app.state::<AvoidState>().suppressed.store(false, Ordering::Relaxed);
                let _ = app.emit("pet:avoid-shown", ());
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}

#[cfg(target_os = "windows")]
fn detect_fullscreen() -> bool {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowLongW, GetWindowRect, GWL_STYLE,
        WS_CAPTION,
    };

    unsafe {
        let fg = GetForegroundWindow();
        if fg.is_null() {
            return false;
        }
        // 无边框（全屏放映窗口一般没有标题栏）
        let style = GetWindowLongW(fg, GWL_STYLE) as u32;
        if style & WS_CAPTION != 0 {
            return false;
        }
        let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        if GetWindowRect(fg, &rect) == 0 {
            return false;
        }
        let mon = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(mon, &mut mi) == 0 {
            return false;
        }
        // 铺满该显示器（±8px 容差）
        let covers = (rect.left - mi.rcMonitor.left).abs() <= 8
            && (rect.top - mi.rcMonitor.top).abs() <= 8
            && (rect.right - mi.rcMonitor.right).abs() <= 8
            && (rect.bottom - mi.rcMonitor.bottom).abs() <= 8;
        if !covers {
            return false;
        }
        // 排除桌面/外壳窗口
        let mut buf = [0u16; 64];
        let n = GetClassNameW(fg, &mut buf);
        let class = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        !matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd")
    }
}

#[cfg(target_os = "macos")]
fn detect_fullscreen() -> bool {
    use core_foundation::base::TCFType;
    use core_foundation::dictionary::CFDictionaryRef;
    use core_foundation::string::{CFString, CFStringRef};

    #[allow(non_snake_case)]
    type CFArrayRef = *const std::ffi::c_void;
    #[allow(non_snake_case)]
    type CFNumberRef = *const std::ffi::c_void;
    #[allow(non_snake_case)]
    type CFTypeRef = *const std::ffi::c_void;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, relative: u32) -> CFArrayRef;
        fn CGRectMakeWithDictionaryRepresentation(
            dict: CFDictionaryRef,
            rect: *mut core_graphics::geometry::CGRect,
        ) -> u8;
        fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
        fn CGDisplayBounds(display: u32) -> core_graphics::geometry::CGRect;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(array: CFArrayRef) -> isize;
        fn CFArrayGetValueAtIndex(array: CFArrayRef, idx: isize) -> CFTypeRef;
        fn CFDictionaryGetValue(dict: CFDictionaryRef, key: CFStringRef) -> CFTypeRef;
        fn CFNumberGetValue(number: CFNumberRef, kind: isize, value: *mut std::ffi::c_void) -> u8;
    }

    unsafe {
        use core_graphics::geometry::CGRect;
        // kCGWindowListOptionOnScreenOnly = 1, kCGNullWindowID = 0
        let list = CGWindowListCopyWindowInfo(1, 0);
        if list.is_null() {
            return false;
        }
        let mut displays = [0u32; 8];
        let mut count: u32 = 0;
        CGGetActiveDisplayList(8, displays.as_mut_ptr(), &mut count);
        let screen_rects: Vec<CGRect> = (0..count)
            .map(|i| CGDisplayBounds(displays[i as usize]))
            .collect();

        let key_layer = CFString::new("kCGWindowLayer");
        let key_bounds = CFString::new("kCGWindowBounds");
        let key_pid = CFString::new("kCGWindowOwnerPID");
        let n = CFArrayGetCount(list);
        let my_pid = std::process::id() as i64;
        for i in 0..n {
            let dict = CFArrayGetValueAtIndex(list, i) as CFDictionaryRef;
            if dict.is_null() {
                continue;
            }
            let layer_ref = CFDictionaryGetValue(dict, key_layer.as_CFTypeRef() as CFStringRef);
            if layer_ref.is_null() {
                continue;
            }
            let mut layer: i64 = 0;
            if CFNumberGetValue(layer_ref as CFNumberRef, 4 /* kCFNumberSInt64Type */, &mut layer as *mut _ as *mut std::ffi::c_void) == 0
                || layer != 0
            {
                continue;
            }
            let pid_ref = CFDictionaryGetValue(dict, key_pid.as_CFTypeRef() as CFStringRef);
            if !pid_ref.is_null() {
                let mut pid: i64 = 0;
                if CFNumberGetValue(pid_ref as CFNumberRef, 4, &mut pid as *mut _ as *mut std::ffi::c_void) != 0
                    && pid == my_pid
                {
                    continue;
                }
            }
            let bounds_ref = CFDictionaryGetValue(dict, key_bounds.as_CFTypeRef() as CFStringRef);
            if bounds_ref.is_null() {
                continue;
            }
            let mut rect = CGRect::default();
            if CGRectMakeWithDictionaryRepresentation(bounds_ref as CFDictionaryRef, &mut rect) != 0
            {
                for sr in &screen_rects {
                    let near = |a: f64, b: f64| (a - b).abs() < 8.0;
                    if near(rect.origin.x, sr.origin.x)
                        && near(rect.origin.y, sr.origin.y)
                        && near(rect.size.width, sr.size.width)
                        && near(rect.size.height, sr.size.height)
                    {
                        return true;
                    }
                }
            }
        }
        false
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn detect_fullscreen() -> bool {
    false // Linux/麒麟/统信：未实现，见 README
}
