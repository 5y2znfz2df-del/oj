#pragma once
// =============================================
// MySQL 极简封装（基于官方 C API）
// =============================================
#include <mysql/mysql.h>
#include <string>
#include <vector>

class DB {
public:
    DB() = default;
    ~DB() { close(); }

    bool connect(const std::string& host, int port,
                 const std::string& user, const std::string& pass,
                 const std::string& dbname);

    // 执行 UPDATE / INSERT / DELETE 等
    bool query(const std::string& sql);

    // 执行 SELECT，返回二维字符串表（NULL 变空串）
    std::vector<std::vector<std::string>> rows(const std::string& sql);

    unsigned long long insert_id();
    std::string escape(const std::string& s) const;
    void close();
    bool ok() const { return conn_ != nullptr; }

private:
    MYSQL* conn_ = nullptr;
};