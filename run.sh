#!/usr/bin/env bash
# =============================================
# 比特 OJ 启动/停止脚本（nohup 后台运行）
# 用法: ./run.sh start | stop | restart | status
# =============================================
set -e
cd "$(dirname "$0")"
mkdir -p logs temp

case "${1:-start}" in
  start)
    if [ -f logs/server.pid ] && kill -0 "$(cat logs/server.pid)" 2>/dev/null; then
      echo "已在运行 (PID $(cat logs/server.pid))"
      exit 0
    fi
    nohup ./server/oj_server >> logs/server.log 2>&1 &
    echo $! > logs/server.pid
    echo "✅ 比特 OJ 已启动 (PID $!)"
    echo "   访问: http://<服务器IP>:$(grep -o '"port": *[0-9]*' server/config.json | grep -o '[0-9]*')"
    echo "   日志: tail -f logs/server.log"
    ;;
  stop)
    if [ -f logs/server.pid ] && kill -0 "$(cat logs/server.pid)" 2>/dev/null; then
      kill "$(cat logs/server.pid)"
      rm -f logs/server.pid
      echo "🛑 已停止"
    else
      echo "没在运行"
    fi
    ;;
  restart)
    "$0" stop || true
    sleep 1
    "$0" start
    ;;
  status)
    if [ -f logs/server.pid ] && kill -0 "$(cat logs/server.pid)" 2>/dev/null; then
      echo "🟢 运行中 (PID $(cat logs/server.pid))"
    else
      echo "⚪ 未运行"
    fi
    ;;
  *)
    echo "用法: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac