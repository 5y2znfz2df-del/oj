#!/bin/bash
# 日志轮转：OJ 看门狗日志超 5MB 截断保留尾部 2000 行
for f in ~/.openclaw/workspace/memory/oj-local-watchdog.log ~/.openclaw/workspace/memory/oj-quick-guard.log ~/oj/logs/server.log ~/oj/logs/cf-named.log; do
  if [ -f "$f" ] && [ "$(stat -f%z "$f" 2>/dev/null || echo 0)" -gt 5242880 ]; then
    tail -2000 "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    echo "$(date '+%F %T') | 轮转: $f" >> ~/.openclaw/workspace/memory/oj-local-watchdog.log
  fi
done
