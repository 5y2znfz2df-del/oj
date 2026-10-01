#include "db.h"
#include <cstring>
#include <cstdio>
#include <thread>
#include <chrono>

bool DB::connect(const std::string& host, int port,
                 const std::string& user, const std::string& pass,
                 const std::string& dbname,
                 const std::string& unix_socket) {
    host_ = host; port_ = port; user_ = user; pass_ = pass; dbname_ = dbname;
    socket_ = unix_socket;
    return reconnect();
}

bool DB::reconnect() {
    // 绝不 mysql_close 旧句柄：这个 macOS 14 编译的 libmysqlclient 在已断开的连接上
    // 调用任何库函数（mysql_ping/mysql_close/mysql_real_query）都会崩（SIGSEGV/SIGABRT）。
    // 检测到连接断开后直接丢弃引用重建，旧句柄交给进程退出/GC 回收，泄漏量可忽略。
    conn_ = mysql_init(nullptr);
    if (!conn_) return false;
    // 不再设 MYSQL_OPT_RECONNECT（MySQL 8.0 deprecated，且会报错）
    mysql_options(conn_, MYSQL_SET_CHARSET_NAME, "utf8mb4");
    // 本地回环连接禁用 SSL（2026-10-01 修复：老 Mac 上 libmysqlclient+libssl 读库时 SIGSEGV 崩溃，
    // 崩溃栈 libssl.3.dylib::SSL_read → libmysqlclient::vio_ssl_read；回环不走公网，无需加密）
    unsigned int ssl_mode = SSL_MODE_DISABLED;
    mysql_options(conn_, MYSQL_OPT_SSL_MODE, &ssl_mode);
    // 优先走 unix socket（2026-10-01 根治：这台 mac14 库在 mac12 上走 TCP 反复崩——
    // mysql_ping/mysql_close/mysql_real_query/net_read_packet 各种 SIGSEGV；
    // unix socket 路径一整天实测从未崩过）。socket 非空时 host 传 "localhost" 即可。
    const char* sock = socket_.empty() ? nullptr : socket_.c_str();
    const char* h = socket_.empty() ? host_.c_str() : "localhost";
    if (!mysql_real_connect(conn_, h, user_.c_str(), pass_.c_str(),
                            dbname_.c_str(), port_, sock, 0)) {
        fprintf(stderr, "[db] 连接失败: %s\n", mysql_error(conn_));
        mysql_close(conn_);
        conn_ = nullptr;
        return false;
    }
    mysql_set_character_set(conn_, "utf8mb4");
    return true;
}

bool DB::ensure_conn() {
    // 不再用 mysql_ping 探测连接（2026-10-01 修复：libmysqlclient 在已被服务端掐断的
    // 连接上 ping 会堆损坏 SIGABRT 崩溃，崩溃栈 mysql_ping → cli_advanced_command →
    // cli_safe_read_with_ok_complete → end_server → malloc abort）。死连接由
    // query()/rows() 在实际查询报 2013/2006 后自动重连兑底，这里只保证有连接对象。
    if (!conn_) {
        // 重连（最多重试 3 次，每次间隔 1 秒）
        for (int i = 0; i < 3; i++) {
            if (reconnect()) return true;
            std::this_thread::sleep_for(std::chrono::seconds(1));
        }
        fprintf(stderr, "[db] 重连 MySQL 失败，已放弃\n");
        return false;
    }
    return true;
}

bool DB::ping() {
    // 不再调用 mysql_ping（见 ensure_conn 注释，死连接上 ping 会触发 libmysqlclient 堆崩溃）
    return conn_ != nullptr;
}

bool DB::query(const std::string& sql) {
    for (int attempt = 0; attempt < 2; attempt++) {
        if (!ensure_conn()) return false;
        if (mysql_query(conn_, sql.c_str()) == 0) return true;
        unsigned int err = mysql_errno(conn_);
        fprintf(stderr, "[db] 执行失败(attempt=%d errno=%u): %s\n  SQL: %s\n",
                attempt, err, mysql_error(conn_), sql.c_str());
        // 连接级错误才重试
        if (err != 2006 /*CR_SERVER_GONE_ERROR*/ &&
            err != 2013 /*CR_SERVER_LOST*/ &&
            err != 2003 /*CR_CONN_HOST_ERROR*/) {
            return false;
        }
        // 连接已死：绝不再碰旧句柄（mysql_close 在死连接上会段错误），直接丢弃引用，
        // 下一轮 ensure_conn() 会走 reconnect() 重建（2026-10-01 二次修复）
        fprintf(stderr, "[db] 检测到连接断开，准备重连...\n");
        conn_ = nullptr;
    }
    return false;
}

std::vector<std::vector<std::string>> DB::rows(const std::string& sql) {
    std::vector<std::vector<std::string>> out;
    for (int attempt = 0; attempt < 2; attempt++) {
        if (!ensure_conn()) return out;
        if (mysql_query(conn_, sql.c_str()) != 0) {
            unsigned int err = mysql_errno(conn_);
            fprintf(stderr, "[db] 查询失败(attempt=%d errno=%u): %s\n  SQL: %s\n",
                    attempt, err, mysql_error(conn_), sql.c_str());
            if (err != 2006 && err != 2013 && err != 2003) return out;
            fprintf(stderr, "[db] 检测到连接断开，准备重连...\n");
            // 同上：死连接直接丢弃引用，绝不 close，下一轮 ensure_conn() 重建
            conn_ = nullptr;
            continue;
        }
        MYSQL_RES* r = mysql_store_result(conn_);
        if (!r) return out;
        unsigned int ncol = mysql_num_fields(r);
        MYSQL_ROW row;
        while ((row = mysql_fetch_row(r))) {
            unsigned long* lens = mysql_fetch_lengths(r);
            std::vector<std::string> line;
            for (unsigned int i = 0; i < ncol; i++) {
                if (row[i]) line.emplace_back(row[i], lens[i]);
                else line.emplace_back();
            }
            out.push_back(std::move(line));
        }
        mysql_free_result(r);
        return out;
    }
    return out;
}

unsigned long long DB::insert_id() {
    return conn_ ? (unsigned long long)mysql_insert_id(conn_) : 0;
}

std::string DB::escape(const std::string& s) {
    ensure_conn();
    if (!conn_) return s;
    std::string out(s.size() * 2 + 1, '\0');
    unsigned long n = mysql_real_escape_string(conn_, &out[0], s.data(), s.size());
    out.resize(n);
    return out;
}

void DB::close() {
    if (conn_) { mysql_close(conn_); conn_ = nullptr; }
}
