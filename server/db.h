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

    // 执行 UPDATE / INSERT / DELETE 等（自动重连+重试）
    bool query(const std::string& sql);

    // 执行 SELECT，返回二维字符串表（NULL 变空串，自动重连+重试）
    std::vector<std::vector<std::string>> rows(const std::string& sql);

    unsigned long long insert_id();
    std::string escape(const std::string& s);
    void close();
    bool ok() const { return conn_ != nullptr; }

    // 检测连接是否还有效（NULL 表示不检查）
    bool ping();

private:
    bool ensure_conn();  // 保证连接有效，断了自动重连
    bool reconnect();     // 强制重连

    MYSQL* conn_ = nullptr;
    std::string host_, user_, pass_, dbname_;
    int port_ = 3306;
};