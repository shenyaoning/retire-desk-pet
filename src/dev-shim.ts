/**
 * 浏览器开发垫片：没有 Tauri 环境（纯浏览器/无头调试）时 mock 掉 IPC 层，
 * 让 UI 能渲染、能截屏。真实应用里完全不生效。
 */
import type { RetireInfo } from "./pet";

interface MockWindow {
  __TAURI_INTERNALS__?: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => Promise<unknown>;
    transformCallback: (cb: (e: unknown) => void, once?: boolean) => number;
    metadata: { currentWindow: { label: string }; currentWebview: { label: string } };
    plugins?: unknown;
  };
}

const MOCK_INFO: RetireInfo = {
  retire_date: "2043-01-12",
  days_left: 5961,
  retire_age_label: "63岁",
  base_age: 60,
};

const mockInvoke = (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
  // window/event 插件命令按后缀给形状
  if (cmd.startsWith("plugin:window|") || cmd.startsWith("plugin:webview|")) {
    const op = cmd.split("|")[1];
    if (op === "scale_factor") return Promise.resolve(2);
    if (op.endsWith("position")) return Promise.resolve({ type: "Physical", x: 100, y: 100 });
    if (op.endsWith("size")) return Promise.resolve({ type: "Physical", width: 132, height: 178 });
    if (op.startsWith("is_")) return Promise.resolve(false);
    return Promise.resolve(null);
  }
  if (cmd.startsWith("plugin:event|")) return Promise.resolve(1);
  switch (cmd) {
    case "get_retire_info": {
      const flexMonths = Number(args?.flexMonths ?? 0);
      const days = flexMonths === 0
        ? MOCK_INFO.days_left
        : MOCK_INFO.days_left + flexMonths * 30.44;
      return Promise.resolve({
        ...MOCK_INFO,
        days_left: Math.round(days),
        workdays_left: { days: Math.round(days * 0.68), estimated: true },
        flex_ym: flexMonths === 0 ? null : "2040-07",
        flex_date: flexMonths === 0 ? null : "2040-07-12",
        flex_days_left: flexMonths === 0 ? null : Math.round(days),
        progress: { ratio: 0.47 },
        next_holiday: { name: "元旦（估算）", date: "2027-01-01" },
      });
    }
    case "get_next_holiday":
      return Promise.resolve({ name: "元旦（估算）", date: "2027-01-01" });
    case "get_autostart":
      return Promise.resolve(false);
    case "avoid_get_enabled":
      return Promise.resolve(true);
    case "set_tray_pending":
      return Promise.resolve(null);
    default:
      return Promise.resolve(null);
  }
};

const w = window as unknown as MockWindow;
if (!w.__TAURI_INTERNALS__) {
  let cbId = 1;
  w.__TAURI_INTERNALS__ = {
    invoke: (cmd, args) => mockInvoke(cmd, args as Record<string, unknown>),
    transformCallback: () => cbId++,
    metadata: { currentWindow: { label: "pet" }, currentWebview: { label: "pet" } },
  };
  // 浏览器调试：?mode=pet|panel|settings 直接定形态；?seedlines=1 预置几条自定义台词
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode");
  if (mode) {
    localStorage.setItem("rdp.v1.mode", mode);
    localStorage.setItem("rdp.v1.profile", JSON.stringify({
      birthYm: "1985-06", birthDay: 12, category: "male", joinYm: "2010-09",
    }));
  }
  if (params.get("seedlines")) {
    localStorage.setItem("rdp.v1.lines", JSON.stringify({
      custom: [
        { id: "s1", scene: "general", text: "领导画的饼，我先吃自己的饭。" },
        { id: "s2", scene: "friday", text: "周五下班，世界都亮了。" },
        { id: "s3", scene: "retire", text: "熬着熬着，就熬到 {days} 天了。" },
      ],
      disabledBuiltin: ["又开会啊。"],
      mode: "mix",
    }));
  }
  (window as unknown as { __DEV_SHIM__?: boolean }).__DEV_SHIM__ = true;
  console.info("[dev-shim] 无 Tauri 环境，已启用浏览器 mock。");
}

export {};
