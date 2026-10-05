#!/usr/bin/env bash
# 比特 OJ 一键启动：MySQL + oj_server + ngrok
cd "$(dirname "$0")"

# 1. MySQL
if ! lsof -iTCP:3306 -sTCP:LISTEN -P -n >/dev/null 2>&1; then
  mkdir -p ~/mysql/logs
  nohup ~/mysql/bin/mysqld --datadir="$HOME/mysql/data" --basedir="$HOME/mysql" \
    --port=3306 --socket="$HOME/mysql/mysql.sock" --pid-file="$HOME/mysql/mysql.pid" \
    --wait-timeout=31536000 --interactive-timeout=31536000 \
    --innodb-buffer-pool-size=50331648 --innodb-log-buffer-size=8388608 \
    --innodb-buffer-pool-chunk-size=33554432 \
    --performance-schema=OFF \
    > "$HOME/mysql/mysql.log" 2>&1 &
  sleep 6
fi

# 2. oj_server
if ! lsof -iTCP:8080 -sTCP:LISTEN -P -n >/dev/null 2>&1; then
  mkdir -p logs temp
  nohup ./server/oj_server > logs/server.log 2>&1 &
  sleep 2
fi

# 3. ngrok
if ! pgrep -f 'ngrok http' >/dev/null 2>&1; then
  nohup ~/bin/ngrok http 8080 --log="$HOME/oj/logs/ngrok.log" > /dev/null 2>&1 &
  sleep 6
fi

echo "---- 状态 ----"
lsof -iTCP:3306 -sTCP:LISTEN -P -n >/dev/null 2>&1 && echo "MySQL: ✅" || echo "MySQL: ❌"
lsof -iTCP:8080 -sTCP:LISTEN -P -n >/dev/null 2>&1 && echo "oj_server: ✅" || echo "oj_server: ❌"
pgrep -f 'ngrok http' >/dev/null 2>&1 && echo "ngrok: ✅" || echo "ngrok: ❌"
grep -oE 'url=https://[a-z0-9.-]+' "$HOME/oj/logs/ngrok.log" 2>/dev/null | tail -1
