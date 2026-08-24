#include "db.h"
#include <cstring>
#include <cstdio>
#include <thread>
#include <chrono>

bool DB::connect(const std::string& host, int port,
                 const std::string& user, const std::string& pass,
                 const std::string& dbname) {
    host_ = host; port_ = port; user_ = user; pass_ = pass; dbname_ = dbname;
    return reconnect();
}

bool DB::reconnect() {
    if (conn_) { mysql_close(conn_); conn_ = nullptr; }
    conn_ = mysql_init(nullptr);
    if (!conn_) return false;
    // 不再设 MYSQL_OPT_RECONNECT（MySQL 8.0 deprecated，且会报错）
    mysql_options(conn_, MYSQL_SET_CHARSET_NAME, "utf8mb4");
    if (!mysql_real_connect(conn_, host_.c_str(), user_.c_str(), pass_.c_str(),
                            dbname_.c_str(), port_, nullptr, 0)) {
        fprintf(stderr, "[db] 连接失败: %s\n", mysql_error(conn_));
        mysql_close(conn_);
        conn_ = nullptr;
        return false;
    }
    mysql_set_character_set(conn_, "utf8mb4");
    return true;
}

bool DB::ensure_conn() {
    if (conn_) {
        // ping 检测连接是否还活着
        if (mysql_ping(conn_) == 0) return true;
        // ping 失败说明连接断了
    }
    // 重连（最多重试 3 次，每次间隔 1 秒）
    for (int i = 0; i < 3; i++) {
        if (reconnect()) return true;
        std::this_thread::sleep_for(std::chrono::seconds(1));
    }
    fprintf(stderr, "[db] 重连 MySQL 失败，已放弃\n");
    return false;
}

bool DB::ping() {
    return conn_ && mysql_ping(conn_) == 0;
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
        fprintf(stderr, "[db] 检测到连接断开，准备重连...\n");
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
