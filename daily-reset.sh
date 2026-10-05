#!/usr/bin/env bash
# ============================================================
# 每日低峰期重置 MySQL + oj_server（2026-10-05）
# 目的：长连接被系统掐断（网络栈/内存压力）导致偶发查询失败。
#       虽然 oj_server 现已带线程锁+自动重建连接（不会崩），
#       但每天换新连接可彻底杜绝偶发窗口。选凌晨 4 点低峰执行。
#
# 顺序（铁律）：先停 oj_server → 重启 MySQL → 就绪后拉 oj_server
# （MySQL 停机时 oj_server 的查询会碰连接消失，必须先停它）
# 调度：launchd com.bit.oj-daily-reset（每天 04:05）
# ============================================================
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/bin:$PATH"
LOG="$HOME/.openclaw/workspace/memory/oj-daily-reset.log"
log() { echo "$(date '+%F %T') | $1" >> "$LOG"; }
up() { lsof -iTCP:"$1" -sTCP:LISTEN -P -n >/dev/null 2>&1; }

log "开始每日重置（pid=$$）"

# 1. 停 oj_server（先停，防 MySQL 停机时它查询崩）
if up 8080; then
  pkill -x oj_server 2>/dev/null
  sleep 2
  log "oj_server 已停"
fi

# 2. 重启 MySQL（优雅关停后拉起，用与看门狗一致的参数）
if up 3306; then
  ~/mysql/bin/mysqladmin --socket="$HOME/mysql/mysql.sock" -u root -p123456 shutdown 2>/dev/null
  # 等最多 15 秒真正停掉
  for _ in $(seq 1 15); do up 3306 || break; sleep 1; done
fi
nohup "$HOME/mysql/bin/mysqld" --datadir="$HOME/mysql/data" --basedir="$HOME/mysql" \
  --port=3306 --socket="$HOME/mysql/mysql.sock" --pid-file="$HOME/mysql/mysql.pid" \
  --wait-timeout=31536000 --interactive-timeout=31536000 \
  --innodb-buffer-pool-size=50331648 --innodb-log-buffer-size=8388608 \
  --innodb-buffer-pool-chunk-size=33554432 \
  --performance-schema=OFF \
  >> "$HOME/mysql/mysql.log" 2>&1 &
for _ in $(seq 1 25); do sleep 1; up 3306 && break; done
if up 3306; then
  log "MySQL 已重启 ✅"
else
  log "⚠️ MySQL 启动失败（看门狗会兜底）"
fi

# 3. 拉起 oj_server
cd "$HOME/oj" 2>/dev/null || exit 0
mkdir -p logs temp
if ! up 8080; then
  nohup ./server/oj_server >> logs/server.log 2>&1 &
  for _ in $(seq 1 20); do sleep 1; up 8080 && break; done
fi
log "oj_server 状态: $([ up 8080 ] && echo 在跑 ✅ || echo 未起⚠️)"

# 4. 公网验证
PUB=$(curl -s -o /dev/null -w "%{http_code}" https://bitoj.dpdns.org/ --max-time 12 2>/dev/null)
[ -z "$PUB" ] && PUB=000
log "公网=$PUB"
log "每日重置完成"
exit 0