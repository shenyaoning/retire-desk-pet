#!/usr/bin/env bash
# Usage: scripts/measure-memory.sh [/path/to/退休桌宠.app]
set -euo pipefail
app="${1:-}"
if [[ -n "$app" ]]; then open "$app"; fi
sleep 60
pid="$(pgrep -f 'Contents/MacOS/retire-desk-pet' | tail -n 1)"
if [[ -z "$pid" ]]; then echo '未找到打包应用主进程'; exit 1; fi
echo "主进程 PID: $pid"
main_rss="$(ps -o rss= -p "$pid" | tr -d ' ')"
ps -o lstart= -p "$pid" | awk '{printf "主进程启动: %s %s %s %s %s\n", $1,$2,$3,$4,$5}'
awk -v rss="$main_rss" 'BEGIN {printf "主进程 RSS: %.1f MiB\n", rss/1024}'
# macOS 的 WebKit 辅助进程会被 launchd(1) 收养，不能按 PPID 归属。
# 这里用与主进程相同的启动分钟筛选，并完整列出命中的 PID，便于人工核对。
stamp="$(ps -o lstart= -p "$pid" | awk '{print $1" "$2" "$3" "$4" "$5}' | cut -c1-16)"
webkit="$(ps -axo pid=,ppid=,rss=,lstart=,command= | awk -v stamp="$stamp" '$0 ~ /WebKit/ { started=$4" "$5" "$6" "$7" "$8; if (index(started, stamp)==1) print }')"
if [[ -n "$webkit" ]]; then
  echo "$webkit" | awk '{printf "WebKit PID %s RSS: %.1f MiB\n", $1, $3/1024; sum += $3} END {printf "WebKit 合计: %.1f MiB\n", sum/1024}'
else
  echo "WebKit 合计: 0.0 MiB（同启动分钟未找到；请核对下面的完整进程表）"
fi
if command -v footprint >/dev/null; then
  footprint -p "$pid" 2>/dev/null | awk '/phys_footprint/ {print "主进程 " $0}' || true
else
  echo "未找到 footprint，无法输出 phys_footprint"
fi
echo '触发 3 次动画后请再次执行此脚本，并保留两次原始输出。'
