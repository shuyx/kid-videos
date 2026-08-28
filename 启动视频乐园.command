#!/bin/bash
# 诗濛的视频乐园 - 本地启动器
# 双击运行：启动本地服务器并打开页面（YouTube 嵌入要求 http:// 来源，不能直接双击 html）
cd "$(dirname "$0")"
PORT=8899
# 如果端口已被占用，说明服务器已在运行，直接打开页面即可
if ! lsof -i :$PORT >/dev/null 2>&1; then
  python3 -m http.server $PORT >/dev/null 2>&1 &
  sleep 1
fi
open "http://localhost:$PORT/index.html"
