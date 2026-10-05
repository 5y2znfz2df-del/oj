#!/bin/bash
# ============================================================
# 原子重启 MySQL + oj_server（2026-10-02）
# 铁律：在这台 mac12 上，绝不能在 oj_server 活着时动 MySQL——
#       查询中途连接消失会让 libmysqlclient(mac14) 内部清理路径 SIGABRT。
#       所以重启 MySQL 必须先杀 oj_server，等 MySQL 就绪再拉起。
# 用法: ~/oj/restart-mysql.sh
# ============================================================
set -u
HOME_DIR="$HOME"
MYSQL_DIR="$HOME_DIR/mysql"
OJ_DIR="$HOME_DIR/oj"

echo "[1/4] 先停 oj_server（避免查询中途连接消失崩溃）..."
pkill -x oj_server 2>/dev/null
sleep 2

echo "[2/4] 停 MySQL..."
pkill -f 'mysqld.*datadir' 2>/dev/null
sleep 3

echo "[3/4] 启动 MySQL（省内存参数）..."
nohup "$MYSQL_DIR/bin/mysqld" --datadir="$MYSQL_DIR/data" --basedir="$MYSQL_DIR" \
  --port=3306 --socket="$MYSQL_DIR/mysql.sock" --pid-file="$MYSQL_DIR/mysql.pid" \
  --wait-timeout=31536000 --interactive-timeout=31536000 \
  --innodb-buffer-pool-size=50331648 --innodb-log-buffer-size=8388608 \
  --innodb-buffer-pool-chunk-size=33554432 \
  --performance-schema=OFF \
  > "$MYSQL_DIR/mysql.log" 2>&1 &
# 等 MySQL 就绪（最多 25 秒）
for _ in $(seq 1 25); do
  lsof -iTCP:3306 -sTCP:LISTEN -P -n >/dev/null 2>&1 && break
  sleep 1
done
if ! lsof -iTCP:3306 -sTCP:LISTEN -P -n >/dev/null 2>&1; then
  echo "❌ MySQL 启动失败，看 $MYSQL_DIR/mysql.log"
  exit 1
fi
echo "✅ MySQL 已就绪 (3306)"

echo "[4/4] 拉起 oj_server..."
cd "$OJ_DIR" && mkdir -p logs temp && nohup ./server/oj_server >> logs/server.log 2>&1 &
sleep 4
if lsof -iTCP:8080 -sTCP:LISTEN -P -n >/dev/null 2>&1; then
  echo "✅ oj_server 已就绪 (8080)"
else
  echo "❌ oj_server 启动失败"
  exit 1
fi

echo "=== 验证 ==="
curl -s -o /dev/null -w "本地OJ: %{http_code}\n" --max-time 8 http://localhost:8080/ 2>/dev/null
echo "全部完成 ✅"