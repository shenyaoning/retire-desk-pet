/** 应用内提示与确认框。WebView 里的 alert/confirm 会被系统吞掉，一律用这里的。 */

export function toast(msg: string, kind: "ok" | "err" = "ok", ms = 2400) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), kind === "err" ? Math.max(ms, 3600) : ms);
}

export function confirmDialog(msg: string, okText = "确定", cancelText = "取消"): Promise<boolean> {
  return new Promise((resolve) => {
    const mask = document.createElement("div");
    mask.className = "dlg-mask";
    const box = document.createElement("div");
    box.className = "dlg";
    const text = document.createElement("div");
    text.className = "dlg-text";
    text.textContent = msg;
    const row = document.createElement("div");
    row.className = "dlg-row";
    const ok = document.createElement("button");
    ok.className = "primary";
    ok.textContent = okText;
    const no = document.createElement("button");
    no.textContent = cancelText;
    const done = (v: boolean) => { mask.remove(); resolve(v); };
    ok.addEventListener("click", () => done(true));
    no.addEventListener("click", () => done(false));
    row.append(ok, no);
    box.append(text, row);
    mask.appendChild(box);
    document.body.appendChild(mask);
    ok.focus();
  });
}

export function promptDialog(msg: string, placeholder = ""): Promise<string | null> {
  return new Promise(resolve => {
    const mask = document.createElement("div"); mask.className = "dlg-mask";
    const box = document.createElement("div"); box.className = "dlg";
    const text = document.createElement("div"); text.className = "dlg-text"; text.textContent = msg;
    const input = document.createElement("input"); input.type = "text"; input.maxLength = 40; input.placeholder = placeholder; input.style.width = "100%";
    const row = document.createElement("div"); row.className = "dlg-row";
    const ok = document.createElement("button"); ok.className = "primary"; ok.textContent = "添加";
    const cancel = document.createElement("button"); cancel.textContent = "取消";
    const done = (value: string | null) => { mask.remove(); resolve(value); };
    ok.onclick = () => done(input.value.trim() || null); cancel.onclick = () => done(null);
    input.onkeydown = event => { if (event.key === "Enter") done(input.value.trim() || null); if (event.key === "Escape") done(null); };
    row.append(ok, cancel); box.append(text, input, row); mask.appendChild(box); document.body.appendChild(mask); input.focus();
  });
}
