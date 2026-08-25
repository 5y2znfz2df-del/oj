#!/bin/bash
# 心跳守护 v2：每3分钟检查，仅重启，静默
while true; do
  sleep 180
  if ! pgrep -x oj_server > /dev/null 2>&1; then
    cd /workspaces/oj && ./run.sh start >> logs/heartbeat.log 2>&1
    echo "$(date '+%F %T') 重启OJ" >> logs/heartbeat.log
  fi
done