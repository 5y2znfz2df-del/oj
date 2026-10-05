#!/bin/bash
# ============================================================
# 比特全家桶 每日备份（OJ 数据库 + 博客数据库 + 网盘文件）
# 用法: bash ~/oj/backup-all.sh   （可挂 cron/launchd 每日跑）
# 备份目录: ~/oj-backups/YYYY-MM-DD/  （放在网站目录外，防被下载）
# ============================================================
set -e
STAMP=$(date +%Y-%m-%d)
BK="$HOME/oj-backups/$STAMP"
mkdir -p "$BK"

echo "[1/4] 备份 OJ 数据库 (MySQL dump)..."
if lsof -iTCP:3306 -sTCP:LISTEN -P -n >/dev/null 2>&1; then
  ~/mysql/bin/mysqldump --socket="$HOME/mysql/mysql.sock" -u root -p123456 oj \
    > "$BK/oj-db-$(date +%H%M).sql" 2>/dev/null && echo "  ✅ OJ 库已备份" || echo "  ⚠️ mysqldump 失败"
fi

echo "[2/4] 备份博客数据库 (SQLite)..."
if [ -f "$HOME/blog/data/blog.db" ]; then
  cp "$HOME/blog/data/blog.db" "$BK/blog.db" && echo "  ✅ 博客库已备份"
fi

echo "[3/4] 备份 OJ 题库与网盘元数据..."
if [ -d "$HOME/oj/data" ]; then
  tar -czf "$BK/oj-data.tar.gz" -C "$HOME/oj" data 2>/dev/null && echo "  ✅ OJ data 已备份"
fi
if [ -d "$HOME/oj/files" ]; then
  tar -czf "$BK/oj-files.tar.gz" -C "$HOME/oj" files 2>/dev/null && echo "  ✅ 网盘文件已备份"
fi

echo "[4/4] 清理 30 天前的旧备份..."
find "$HOME/oj-backups" -type d -mtime +30 -exec rm -rf {} + 2>/dev/null || true

echo "完成 ✅ 备份在: $BK"
du -sh "$BK" 2>/dev/null | awk '{print "大小:", $1}'
echo ""
ls -lh "$BK" | grep -v '^total' | awk '{print "  ", $NF, "("$5")"}'