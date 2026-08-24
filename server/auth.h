#pragma once
// =============================================
// 认证：SHA256 密码哈希 + 持久化会话（MySQL）
// =============================================
#include <string>

class DB;

struct Session {
    std::string username;
    std::string role;
};

class Auth {
public:
    // 密码 -> SHA256 十六进制串
    static std::string sha256(const std::string& s);

    // 登录成功：生成 token 并写入 sessions 表
    std::string login(DB& db, const std::string& username, const std::string& role);

    // 校验 token，成功返回 true 并填充会话（顺便刷新 last_seen）
    bool check(DB& db, const std::string& token, Session& out);

    // 注销会话
    void logout(DB& db, const std::string& token);
};
