#pragma once
// =============================================
// MySQL 极简封装（基于官方 C API）
// =============================================
#include <mysql/mysql.h>
#include <string>
#include <vector>
#include <pthread.h>

class DB {
public:
    DB();
    ~DB();
    // 禁止拷贝
    DB(const DB&) = delete;
    DB& operator=(const DB&) = delete;

    bool connect(const std::string& host, int port,
                 const std::string& user, const std::string& pass,
                 const std::string& dbname,
                 const std::string& unix_socket = "");

    // 执行 UPDATE / INSERT / DELETE 等（自动重连+重试，线程安全）
    bool query(const std::string& sql);

    // 执行 SELECT，返回二维字符串表（NULL 变空串，自动重连+重试，线程安全）
    std::vector<std::vector<std::string>> rows(const std::string& sql);

    unsigned long long insert_id();
    std::string escape(const std::string& s);
    void close();
    bool ok() const;

    // 检测连接是否还有效（NULL 表示不检查）
    bool ping();

private:
    bool ensure_conn_locked();  // 保证连接有效，断了自动重连（须持有锁）
    bool reconnect_locked();     // 强制重连（须持有锁）

    mutable pthread_mutex_t mu_;  // 2026-10-04 修复：多线程并发抢 conn_ 导致 SIGSEGV；
                                  // 用 C 原生互斥锁（静态初始化器）避开 macOS 静态存储期 std::mutex 坑
    MYSQL* conn_ = nullptr;
    std::string host_, user_, pass_, dbname_, socket_;
    int port_ = 3306;
};