#include "db.h"
#include <cstring>
#include <cstdio>

bool DB::connect(const std::string& host, int port,
                 const std::string& user, const std::string& pass,
                 const std::string& dbname) {
    conn_ = mysql_init(nullptr);
    if (!conn_) return false;
    mysql_options(conn_, MYSQL_SET_CHARSET_NAME, "utf8mb4");
    if (!mysql_real_connect(conn_, host.c_str(), user.c_str(), pass.c_str(),
                            dbname.c_str(), port, nullptr, 0)) {
        fprintf(stderr, "[db] 连接失败: %s\n", mysql_error(conn_));
        mysql_close(conn_);
        conn_ = nullptr;
        return false;
    }
    mysql_set_character_set(conn_, "utf8mb4");
    return true;
}

bool DB::query(const std::string& sql) {
    if (!conn_) return false;
    if (mysql_query(conn_, sql.c_str()) != 0) {
        fprintf(stderr, "[db] 执行失败: %s\n  SQL: %s\n", mysql_error(conn_), sql.c_str());
        return false;
    }
    return true;
}

std::vector<std::vector<std::string>> DB::rows(const std::string& sql) {
    std::vector<std::vector<std::string>> out;
    if (!conn_) return out;
    if (mysql_query(conn_, sql.c_str()) != 0) {
        fprintf(stderr, "[db] 查询失败: %s\n  SQL: %s\n", mysql_error(conn_), sql.c_str());
        return out;
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

unsigned long long DB::insert_id() {
    return conn_ ? (unsigned long long)mysql_insert_id(conn_) : 0;
}

std::string DB::escape(const std::string& s) const {
    if (!conn_) return s;
    std::string out(s.size() * 2 + 1, '\0');
    unsigned long n = mysql_real_escape_string(conn_, &out[0], s.data(), s.size());
    out.resize(n);
    return out;
}

void DB::close() {
    if (conn_) { mysql_close(conn_); conn_ = nullptr; }
}